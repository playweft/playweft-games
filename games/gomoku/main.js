import {
  ChevronRight,
  CircleHelp,
  RotateCcw,
  Settings2,
  createIcons,
} from "lucide";
import { applySoloGomokuAction, createSoloGomokuState } from "./solo.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { createGomokuAiController } from "./ai-controller.js";
import "../../src/components/board-stones.css";
import "./styles.css";

const elements = {
  board: document.querySelector("#board"),
  boardShell: document.querySelector(".board-shell"),
  table: document.querySelector("#table-layout"),
  setupPanel: document.querySelector("#setup-panel"),
  setupForm: document.querySelector("#setup-form"),
  setupFeedback: document.querySelector("#setup-feedback"),
  forbiddenSetting: document.querySelector("#forbidden-setting"),
  opponentSetting: document.querySelector("#opponent-setting"),
  opponentSettingItem: document.querySelector("#opponent-setting-item"),
  opponentSettingDivider: document.querySelector("#opponent-setting-divider"),
  opponentSettingValue: document.querySelector("#opponent-setting-value"),
  blackSetting: document.querySelector("#black-setting"),
  blackSettingValue: document.querySelector("#black-setting-value"),
  forbiddenSettingValue: document.querySelector("#forbidden-setting-value"),
  start: document.querySelector("#start-button"),
  startLabel: document.querySelector("#start-label"),
  rematch: document.querySelector("#rematch-button"),
  settings: document.querySelector("#settings-button"),
  settingsSummary: document.querySelector("#settings-summary"),
  round: document.querySelector("#round-number"),
  moveCount: document.querySelector("#move-count"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  players: [
    document.querySelector("#black-player"),
    document.querySelector("#white-player"),
  ],
  playerTimes: [...document.querySelectorAll("[data-player-time]")],
};

let playerId;
let state;
let pendingActionId;
let pendingActionType;
let settingsRequestId;
let queuedSettings;
let draftSettings;
let boardSize = 0;
let setupCloseTimer;
let serverTimeAtSync;
let localTimeAtSync;
let playMode = "room";
let localMatchId;
let localVersion = 0;
const points = [];

createIcons({ icons: { ChevronRight, CircleHelp, RotateCcw, Settings2 } });
let clockTimer = window.setInterval(renderClocks, 1000);
const ai = createGomokuAiController({
  onMove: (action) => sendAction(action, true, 2),
  onError: showActionError,
});

const preview = {
  players: ["preview-one", "preview-two"],
  hostId: "preview-one",
  phase: "playing",
  settings: { size: 15, blackMode: "random", forbiddenMoves: false },
  board: Array.from({ length: 15 }, () => Array(15).fill(0)),
  current: 1,
  blackIndex: 1,
  timeUsed: [0, 0],
  turnStartedAt: 0,
  moves: 0,
  ended: false,
  winner: "",
  winnerIndex: 0,
  draw: false,
  winningCells: [],
  lastMove: { row: 0, column: 0 },
  lastEvent: { kind: "start", playerIndex: 1 },
  round: 1,
};

const isStandalone = window.parent === window;
const client = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady: handleReady,
      onState: handleState,
      onActionResult: handleActionResult,
      onError: handleError,
    });

function handleReady(message) {
  ai.dispose();
  playMode = message.mode ?? "room";
  elements.opponentSettingItem.hidden = playMode !== "solo";
  elements.opponentSettingDivider.hidden = playMode !== "solo";
  if (playMode === "solo") {
    playerId = "solo-player-1";
    localMatchId = `solo-${crypto.randomUUID()}`;
    localVersion = 0;
    const now = Date.now();
    handleState({
      playerId,
      state: createSoloGomokuState(),
      events: [],
      matchId: localMatchId,
      version: localVersion,
      serverTime: now,
    });
    return;
  }
  playerId = message.playerId;
}

function handleState(message) {
  playerId = playMode === "solo" ? "solo-player-1" : message.playerId;
  state = message.state;
  serverTimeAtSync = Number.isFinite(Number(message.serverTime))
    ? Number(message.serverTime)
    : undefined;
  localTimeAtSync = Date.now();
  if (
    state.phase === "setup" &&
    draftSettings &&
    sameSettings(state.settings, draftSettings)
  ) {
    draftSettings = undefined;
  } else if (state.phase !== "setup") {
    settingsRequestId = undefined;
    queuedSettings = undefined;
    draftSettings = undefined;
  }
  render(state);
  if (isAiGame()) ai.update(state, `${localMatchId}:${localVersion}`, true);
  else ai.dispose();
}

function handleActionResult(result) {
  if (result.requestId === settingsRequestId) {
    settingsRequestId = undefined;
    if (queuedSettings && state?.phase === "setup" && !pendingActionId) {
      sendSettingsUpdate(queuedSettings);
    }
    return;
  }
  if (result.requestId !== pendingActionId) return;
  const completedActionType = pendingActionType;
  pendingActionId = undefined;
  pendingActionType = undefined;
  if (state?.phase === "setup") {
    if (completedActionType === "configure") {
      render(state);
      return;
    }
    showSetupFeedback("设置已确认，正在同步棋盘…", "pending");
    return;
  }
  render(state ?? preview);
}

function handleError(error, code, requestId) {
  if (requestId === settingsRequestId) {
    settingsRequestId = undefined;
    queuedSettings = undefined;
    draftSettings = undefined;
  }
  if (requestId === pendingActionId) {
    pendingActionId = undefined;
    pendingActionType = undefined;
  }
  const message = translateError(error, code);
  render(state ?? preview);
  showActionError(message);
}

window.addEventListener("pagehide", (event) => {
  window.clearInterval(clockTimer);
  ai.dispose();
  if (!event.persisted) client?.destroy();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  clockTimer = window.setInterval(renderClocks, 1000);
  if (state) ai.update(state, `${localMatchId}:${localVersion}`, isAiGame());
});

elements.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  queuedSettings = undefined;
  draftSettings = undefined;
  const sent = sendAction({ type: "start", ...readSetupSettings() }, false);
  if (!sent) {
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  showSetupFeedback("正在创建对局…", "pending");
  setSetupOpen(false);
});

elements.setupForm.addEventListener("input", (event) => {
  if (
    ![
      elements.opponentSetting,
      elements.forbiddenSetting,
      elements.blackSetting,
    ].includes(event.target)
  ) {
    return;
  }
  renderSettingValues();
  syncSetupSettings();
});

for (const select of [
  elements.opponentSetting,
  elements.blackSetting,
  elements.forbiddenSetting,
]) {
  select.closest(".setting-field").addEventListener("click", (event) => {
    if (event.target === select || select.disabled) return;
    select.focus({ preventScroll: true });
    if (typeof select.showPicker === "function") {
      try {
        select.showPicker();
        return;
      } catch {
        // Cross-origin game frames may only allow direct select activation.
      }
    }
    select.click();
  });
}

elements.rematch.addEventListener("click", () =>
  sendAction({ type: "rematch" }),
);
elements.settings.addEventListener("click", () =>
  sendAction({ type: "configure" }),
);

if (isStandalone) handleReady({ mode: "solo" });
else render(preview);

function buildBoard(size) {
  elements.board.replaceChildren();
  elements.boardShell.setAttribute(
    "aria-label",
    `${size} × ${size} 五子棋棋盘`,
  );
  points.length = 0;
  boardSize = size;
  elements.board.style.setProperty("--edge", `${50 / size}%`);
  elements.board.style.setProperty("--point-size", `${92 / size}%`);
  elements.board.style.setProperty("--line-step", `${100 / (size - 1)}%`);
  const star = [4, 8, 12];

  for (let row = 1; row <= size; row += 1) {
    for (let column = 1; column <= size; column += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "gomoku-point";
      point.style.top = `${(row - 0.5) * (100 / size)}%`;
      point.style.left = `${(column - 0.5) * (100 / size)}%`;
      point.setAttribute("role", "gridcell");
      point.setAttribute("aria-label", `第 ${row} 行，第 ${column} 列`);
      point.disabled = true;
      if (star.includes(row) && star.includes(column)) {
        point.classList.add("is-star");
      }
      point.addEventListener("click", () =>
        sendAction({ type: "play", row, column }),
      );
      elements.board.append(point);
      points.push(point);
    }
  }
}

function isAiGame(settings = state?.settings) {
  return playMode === "solo" && settings?.opponent !== "local";
}

function isLocalTwoPlayerGame() {
  return playMode === "solo" && !isAiGame();
}

function sendAction(action, renderPendingState = true, actorIndex) {
  if (pendingActionId || !state) return false;
  actorIndex ??= isLocalTwoPlayerGame() ? state.current : 1;
  if (
    playMode === "solo" &&
    action.type === "play" &&
    state.current !== actorIndex
  )
    return false;
  const requestId = dispatchAction(action, actorIndex);
  if (!requestId) {
    showActionError("尚未连接 Playweft 平台");
    return false;
  }
  pendingActionId = requestId;
  pendingActionType = action.type;
  if (renderPendingState) render(state);
  return true;
}

function dispatchAction(action, actorIndex = 1) {
  if (playMode !== "solo") return client?.sendAction(action);
  const requestId = crypto.randomUUID();
  const matchId = localMatchId;
  window.queueMicrotask(() => {
    if (playMode !== "solo" || localMatchId !== matchId) return;
    const result = applySoloGomokuAction(state, action, {
      now: Date.now(),
      actorIndex,
    });
    if (!result.accepted) {
      handleError(
        result.error?.message ?? "Action rejected",
        result.error?.code ?? "ACTION_REJECTED",
        requestId,
      );
      return;
    }
    localVersion += 1;
    handleState({
      playerId: "solo-player-1",
      state: result.state,
      events: result.events,
      matchId: localMatchId,
      version: localVersion,
      serverTime: Date.now(),
    });
    handleActionResult({ requestId, accepted: true });
  });
  return requestId;
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const size =
    Number(nextState.settings?.size) || nextState.board?.length || 15;
  if (boardSize !== size) buildBoard(size);

  if (nextState.phase === "setup") {
    renderSetup(nextState, ownIndex);
    renderSetupBoard(nextState, size);
    setSetupOpen(!pendingActionId);
    return;
  }

  setSetupOpen(false);
  clearSetupFeedback();
  const currentIndex = Number(nextState.current) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const whiteIndex = blackIndex === 0 ? 1 : 0;
  const ended = Boolean(nextState.ended);
  const canAct =
    Boolean(state) &&
    !ended &&
    (isLocalTwoPlayerGame() || ownIndex === currentIndex) &&
    !pendingActionId;
  const winning = new Set(
    Array.isArray(nextState.winningCells)
      ? nextState.winningCells.map((cell) => `${cell.row}:${cell.column}`)
      : [],
  );

  elements.board.dataset.turnColor =
    currentIndex === blackIndex ? "black" : "white";
  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = `已落 ${nextState.moves ?? 0} 子`;
  elements.settingsSummary.textContent = `15 × 15 · ${nextState.settings?.forbiddenMoves ? "黑方禁手" : "无禁手"}`;
  elements.rematch.hidden = !state || !ended || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingActionId);
  elements.settings.hidden = !state || !ended || ownIndex < 0;
  elements.settings.disabled = Boolean(pendingActionId);

  const colorPlayers = [
    { playerIndex: blackIndex, label: "黑方" },
    { playerIndex: whiteIndex, label: "白方" },
  ];
  colorPlayers.forEach(({ playerIndex, label }, panelIndex) => {
    const panel = elements.players[panelIndex];
    const own = playerIndex === ownIndex;
    panel.querySelector("[data-player-name]").textContent = isAiGame()
      ? `${label} · ${own ? "你" : "电脑"}`
      : isLocalTwoPlayerGame()
        ? `${label} · 玩家 ${playerIndex + 1}`
        : own
          ? `${label} · 你`
          : `${label} · 玩家 ${playerIndex + 1}`;
    panel.querySelector("[data-player-detail]").textContent =
      label === "黑方" ? "先手" : "后手";
    panel.classList.toggle(
      "is-current",
      !ended && playerIndex === currentIndex,
    );
    panel.classList.toggle(
      "is-winner",
      ended && Number(nextState.winnerIndex) - 1 === playerIndex,
    );
  });

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      const value = Number(nextState.board?.[row]?.[column]) || 0;
      point.dataset.piece = String(value);
      point.disabled = !canAct || value !== 0;
      point.classList.toggle(
        "is-last",
        value !== 0 &&
          Number(nextState.lastMove?.row) === row + 1 &&
          Number(nextState.lastMove?.column) === column + 1,
      );
      point.classList.toggle(
        "is-winning",
        winning.has(`${row + 1}:${column + 1}`),
      );
      const pieceName = value === 1 ? "黑子" : value === 2 ? "白子" : "空位";
      point.setAttribute(
        "aria-label",
        `第 ${row + 1} 行，第 ${column + 1} 列，${pieceName}`,
      );
    }
  }

  renderClocks();
  renderStatus(nextState, ownIndex, currentIndex);
}

function renderSetup(nextState, ownIndex) {
  const hostId = nextState.hostId ?? nextState.players?.[0];
  const isHost = Boolean(state) && (nextState.canConfigure ?? playerId === hostId);
  const canConfigure = isHost && !pendingActionId;
  const settings =
    (isHost && draftSettings) || nextState.settings || preview.settings;

  elements.opponentSetting.value = settings.opponent ?? "ai";
  elements.opponentSetting.disabled = !canConfigure || playMode !== "solo";
  elements.blackSetting.querySelector('[value="player1"]').textContent =
    isAiGame(settings) ? "你执黑 · 先手" : "玩家 1 执黑";
  elements.blackSetting.querySelector('[value="player2"]').textContent =
    isAiGame(settings) ? "电脑执黑 · 你后手" : "玩家 2 执黑";
  elements.forbiddenSetting.value = settings.forbiddenMoves ? "renju" : "none";
  elements.blackSetting.value = settings.blackMode ?? "random";
  elements.forbiddenSetting.disabled = !canConfigure;
  elements.blackSetting.disabled = !canConfigure;
  renderSettingValues();
  elements.start.disabled = !canConfigure;
  elements.startLabel.textContent = pendingActionId ? "正在开始…" : "开始对局";
}

function renderSettingValues() {
  for (const [select, value] of [
    [elements.opponentSetting, elements.opponentSettingValue],
    [elements.blackSetting, elements.blackSettingValue],
    [elements.forbiddenSetting, elements.forbiddenSettingValue],
  ]) {
    const option = select.selectedOptions[0];
    value.textContent = option?.dataset.display ?? option?.textContent ?? "";
  }
}

function renderSetupBoard(nextState, size) {
  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = "已落 0 子";
  elements.settingsSummary.textContent = `15 × 15 · ${nextState.settings?.forbiddenMoves ? "黑方禁手" : "无禁手"}`;
  elements.statusTitle.textContent = "配置本局规则";
  elements.statusDetail.textContent = "黑方先行，率先连成五子获胜";
  elements.rematch.hidden = true;
  elements.settings.hidden = true;
  for (const point of points) {
    point.dataset.piece = "0";
    point.disabled = true;
    point.classList.remove("is-last", "is-winning");
  }
  renderClocks();
}

function renderStatus(nextState, ownIndex, currentIndex) {
  if (!state) return;
  if (nextState.draw) {
    elements.statusTitle.textContent = "本局平手";
    elements.statusDetail.textContent = "棋盘已满，双方未连成五子";
    return;
  }
  if (nextState.winner) {
    if (isLocalTwoPlayerGame()) {
      elements.statusTitle.textContent = `玩家 ${nextState.winnerIndex} 获胜`;
      elements.statusDetail.textContent = "五子连珠，本局结束";
      return;
    }
    if (isAiGame()) {
      elements.statusTitle.textContent =
        Number(nextState.winnerIndex) - 1 === ownIndex ? "你赢了" : "电脑获胜";
      elements.statusDetail.textContent = "五子连珠，本局结束";
      return;
    }
    const won = Number(nextState.winnerIndex) - 1 === ownIndex;
    elements.statusTitle.textContent =
      ownIndex < 0
        ? `玩家 ${nextState.winnerIndex} 获胜`
        : won
          ? "你赢了"
          : "对手获胜";
    elements.statusDetail.textContent =
      nextState.lastEvent?.kind === "player_left"
        ? "另一方已离开对局"
        : "五子连珠，本局结束";
    return;
  }
  if (isLocalTwoPlayerGame()) {
    const color =
      Number(nextState.current) === Number(nextState.blackIndex)
        ? "黑方"
        : "白方";
    elements.statusTitle.textContent = `轮到${color}落子`;
    elements.statusDetail.textContent = `玩家 ${currentIndex + 1}，选择一个空交叉点`;
    return;
  }
  if (isAiGame()) {
    elements.statusTitle.textContent =
      currentIndex === ownIndex ? "轮到你落子" : "电脑正在思考";
    elements.statusDetail.textContent =
      currentIndex === ownIndex ? "选择一个空交叉点" : "请稍候，电脑将自动落子";
    return;
  }
  if (ownIndex < 0) {
    elements.statusTitle.textContent = `玩家 ${currentIndex + 1} 正在思考`;
    elements.statusDetail.textContent = "你正在观战";
  } else if (ownIndex === currentIndex) {
    elements.statusTitle.textContent = "轮到你落子";
    elements.statusDetail.textContent = "选择一个空交叉点";
  } else {
    elements.statusTitle.textContent = "等待对手落子";
    elements.statusDetail.textContent = "棋盘会实时同步";
  }
}

function setSetupOpen(open) {
  window.clearTimeout(setupCloseTimer);
  document.body.classList.toggle("has-setup-modal", open);
  elements.table.inert = open;
  elements.table.setAttribute("aria-hidden", String(open));
  if (open) {
    if (elements.setupPanel.dataset.state === "open") return;
    elements.setupPanel.hidden = false;
    elements.setupPanel.dataset.state = "opening";
    window.requestAnimationFrame(() => {
      elements.setupPanel.dataset.state = "open";
      elements.setupForm.focus({ preventScroll: true });
    });
    return;
  }
  if (elements.setupPanel.hidden) return;
  elements.setupPanel.dataset.state = "closing";
  setupCloseTimer = window.setTimeout(() => {
    elements.setupPanel.hidden = true;
    delete elements.setupPanel.dataset.state;
  }, 220);
}

function readSetupSettings() {
  return {
    ...(playMode === "solo"
      ? { opponent: elements.opponentSetting.value }
      : {}),
    blackMode: elements.blackSetting.value,
    forbiddenMoves: elements.forbiddenSetting.value === "renju",
  };
}

function syncSetupSettings() {
  if (state?.phase !== "setup" || elements.start.disabled) return;
  const settings = readSetupSettings();
  draftSettings = settings;
  clearSetupFeedback();
  if (settingsRequestId) {
    queuedSettings = settings;
    return;
  }
  sendSettingsUpdate(settings);
}

function sendSettingsUpdate(settings) {
  queuedSettings = undefined;
  const requestId = dispatchAction({
    type: "update_settings",
    ...settings,
  });
  if (!requestId) {
    draftSettings = undefined;
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  settingsRequestId = requestId;
}

function sameSettings(left = {}, right = {}) {
  return (
    left.blackMode === right.blackMode &&
    (playMode !== "solo" ||
      (left.opponent ?? "ai") === (right.opponent ?? "ai")) &&
    Boolean(left.forbiddenMoves) === Boolean(right.forbiddenMoves)
  );
}

function renderClocks() {
  const nextState = state ?? preview;
  const activeIndex =
    !nextState.ended && nextState.phase === "playing"
      ? Number(nextState.current) - 1
      : -1;
  const extra = estimatedActiveTime(nextState);
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const panelPlayers = [blackIndex, blackIndex === 0 ? 1 : 0];
  panelPlayers.forEach((playerIndex, panelIndex) => {
    const total =
      (Number(nextState.timeUsed?.[playerIndex]) || 0) +
      (playerIndex === activeIndex ? extra : 0);
    const time = elements.playerTimes[panelIndex];
    time.textContent = formatDuration(total);
    time.dateTime = `PT${Math.floor(total / 1000)}S`;
  });
}

function estimatedActiveTime(nextState) {
  if (
    nextState.ended ||
    nextState.phase !== "playing" ||
    !Number.isFinite(Number(nextState.turnStartedAt))
  ) {
    return 0;
  }
  const serverNow =
    Number.isFinite(serverTimeAtSync) && Number.isFinite(localTimeAtSync)
      ? serverTimeAtSync + (Date.now() - localTimeAtSync)
      : Number(nextState.turnStartedAt);
  return Math.max(0, serverNow - Number(nextState.turnStartedAt));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showSetupFeedback(message, mode) {
  elements.setupFeedback.hidden = false;
  elements.setupFeedback.dataset.mode = mode;
  elements.setupFeedback.textContent = message;
  elements.startLabel.textContent =
    mode === "pending" ? "正在开始…" : "开始对局";
}

function clearSetupFeedback() {
  elements.setupFeedback.hidden = true;
  elements.setupFeedback.removeAttribute("data-mode");
  elements.setupFeedback.textContent = "";
  elements.startLabel.textContent = "开始对局";
}

function translateError(error, code) {
  const messages = {
    NOT_YOUR_TURN: "还没轮到你",
    INVALID_POINT: "请选择棋盘内的交叉点",
    OCCUPIED: "这个位置已经有棋子",
    GAME_OVER: "本局已经结束",
    GAME_NOT_OVER: "本局尚未结束",
    ONLY_HOST_CAN_SETUP: "只有房主可以调整设置",
    INVALID_BLACK_MODE: "执黑方式无效",
    INVALID_OPPONENT: "对战方式无效",
    INVALID_FORBIDDEN_MOVES: "禁手规则无效",
    FORBIDDEN_OVERLINE: "黑方禁手：不能形成长连",
    FORBIDDEN_DOUBLE_FOUR: "黑方禁手：不能形成双四",
    FORBIDDEN_DOUBLE_THREE: "黑方禁手：不能形成双三",
    SETUP_REQUIRED: "请先由房主开始对局",
  };
  return messages[code] ?? error ?? "操作未完成";
}

function showActionError(message) {
  if (state?.phase === "setup") showSetupFeedback(message, "error");
  else elements.statusDetail.textContent = message;
}
