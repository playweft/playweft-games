import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Ellipsis,
  Flag,
  History,
  Info,
  NotebookPen,
  RotateCcw,
  Settings2,
  Trash2,
  Undo2,
  X,
  createIcons,
} from "lucide";
import {
  canResumeGoRecord,
  createGoHistoryStore,
  goRecordToReplayFrames,
  goRecordToSgf,
  historyResultLabel,
  restoreGoResumeState,
  updateGoResumeSnapshot,
  updateGoHistory,
} from "./history.js";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";
import {
  applySoloGoAction,
  calculateGoScore,
  createSoloGoState,
} from "./solo.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import "../../src/components/board-stones.css";
import "./styles.css";
import tableTextureUrl from "./assets/table-texture-plywood.webp?url";

scheduleTableTexture();

const elements = {
  actionFeedback: document.querySelector("#action-feedback"),
  board: document.querySelector("#board"),
  boardShell: document.querySelector(".board-shell"),
  confirmMove: document.querySelector("#confirm-move"),
  table: document.querySelector("#table-layout"),
  actionPanel: document.querySelector(".action-panel"),
  setupPanel: document.querySelector("#setup-panel"),
  setupForm: document.querySelector("#setup-form"),
  setupNote: document.querySelector("#setup-note"),
  sourceSetting: document.querySelector("#source-setting"),
  newGameSettings: document.querySelector("#new-game-settings"),
  resumeSource: document.querySelector("#resume-source"),
  resumeSetup: document.querySelector("#resume-setup"),
  resumeSetting: document.querySelector("#resume-setting"),
  resumeSummary: document.querySelector("#resume-summary"),
  sizeSetting: document.querySelector("#size-setting"),
  rulesSetting: document.querySelector("#rules-setting"),
  komiSetting: document.querySelector("#komi-setting"),
  blackSetting: document.querySelector("#black-setting"),
  handicapSetting: document.querySelector("#handicap-setting"),
  handicapNote: document.querySelector("#handicap-note"),
  setupFeedback: document.querySelector("#setup-feedback"),
  historyPanel: document.querySelector("#history-panel"),
  historyDialog: document.querySelector("#history-dialog"),
  historyList: document.querySelector("#history-list"),
  historyOpen: document.querySelector("#history-button"),
  help: document.querySelector("#help-link"),
  historyClose: document.querySelector("#history-close"),
  historyClear: document.querySelector("#history-clear"),
  historyClearLabel: document.querySelector("#history-clear-label"),
  gameInfoPanel: document.querySelector("#game-info-panel"),
  gameInfoDialog: document.querySelector("#game-info-dialog"),
  gameInfoList: document.querySelector("#game-info-list"),
  gameInfoOpen: document.querySelector("#game-info-button"),
  gameInfoClose: document.querySelector("#game-info-close"),
  replayOpen: document.querySelector("#replay-button"),
  replayControls: document.querySelector("#replay-controls"),
  replayStatus: document.querySelector("#replay-status"),
  replaySliderField: document.querySelector("#replay-slider-field"),
  replaySlider: document.querySelector("#replay-slider"),
  replayFirst: document.querySelector("#replay-first"),
  replayPrevious: document.querySelector("#replay-previous"),
  replayNext: document.querySelector("#replay-next"),
  replayLast: document.querySelector("#replay-last"),
  moveLogCount: document.querySelector("#move-log-count"),
  moveLogList: document.querySelector("#move-log-list"),
  start: document.querySelector("#start-button"),
  startLabel: document.querySelector("#start-label"),
  undo: document.querySelector("#undo-button"),
  undoLabel: document.querySelector("#undo-label"),
  undoRequest: document.querySelector("#undo-request"),
  undoRequestLabel: document.querySelector("#undo-request-label"),
  undoResponseActions: document.querySelector("#undo-response-actions"),
  undoAccept: document.querySelector("#undo-accept"),
  undoReject: document.querySelector("#undo-reject"),
  pass: document.querySelector("#pass-button"),
  more: document.querySelector("#more-button"),
  moreMenu: document.querySelector("#more-menu"),
  resign: document.querySelector("#resign-button"),
  resignLabel: document.querySelector("#resign-label"),
  rematch: document.querySelector("#rematch-button"),
  settings: document.querySelector("#settings-button"),
  scoringSummary: document.querySelector("#scoring-summary"),
  moveNumbers: [...document.querySelectorAll("[data-move-number]")],
  players: [
    document.querySelector("#black-player"),
    document.querySelector("#white-player"),
  ],
  playerTimes: [...document.querySelectorAll("[data-player-time]")],
};
const segmentNames = ["a", "b", "c", "d", "e", "f", "g"];
const digitSegments = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

function scheduleTableTexture() {
  const applyTexture = () => {
    document.body.style.setProperty(
      "--table-texture-image",
      `url("${tableTextureUrl}")`,
    );
  };
  const scheduleWhenIdle = () => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(applyTexture, { timeout: 1500 });
      return;
    }
    window.setTimeout(applyTexture, 0);
  };

  if (document.readyState === "complete") {
    scheduleWhenIdle();
  } else {
    window.addEventListener("load", scheduleWhenIdle, { once: true });
  }
}

let playerId;
let state;
let pendingAction;
let settingsRequestId;
let queuedSettings;
let draftSettings;
let scoreRequestRound;
let playMode = "room";
let localMatchId;
let localVersion = 0;
const points = [];
let boardSize = 0;
let pendingMove;
let lastPointerType = "";
let historyClearTimer;
let resignConfirmTimer;
let moreMenuCloseTimer;
let serverTimeAtSync;
let localTimeAtSync;
let replayGameKey = "";
let replayFrames = [];
let replayIndex;
let setupSource = "new";
let selectedResumeRecordId = "";

createIcons({
  icons: {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    CircleHelp,
    Ellipsis,
    Flag,
    History,
    Info,
    NotebookPen,
    RotateCcw,
    Settings2,
    Trash2,
    Undo2,
    X,
  },
});
const clockTimer = window.setInterval(renderClocks, 1000);
const historyStore = createGoHistoryStore();
elements.playerTimes.forEach((element) => renderClockDigits(element, "00:00"));

const preview = {
  players: ["preview-one", "preview-two"],
  phase: "playing",
  settings: {
    size: 19,
    rules: "chinese",
    komi: 6.5,
    handicap: 0,
    blackMode: "random",
  },
  board: Array.from({ length: 19 }, () => Array(19).fill(0)),
  current: 1,
  blackIndex: 1,
  captures: [0, 0],
  consecutivePasses: 0,
  moves: 0,
  ended: false,
  winner: "",
  winnerIndex: 0,
  scores: { black: 0, white: 0, komi: 6.5 },
  timeUsed: [0, 0],
  turnStartedAt: 0,
  scoreRound: 0,
  scoreSubmitted: [false, false],
  lastMove: { row: 0, column: 0 },
  lastEvent: { kind: "start", playerIndex: 1, captured: 0 },
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

const setupDialog = createOverlayDialog({
  root: elements.setupPanel,
  surface: elements.setupForm,
  dismissible: false,
  initialFocus: elements.setupForm,
});
const historyDialog = createOverlayDialog({
  root: elements.historyPanel,
  surface: elements.historyDialog,
  closeButtons: [elements.historyClose],
  initialFocus: elements.historyDialog,
  returnFocus: elements.more,
  beforeOpen: renderHistory,
  beforeClose: resetHistoryClear,
});
const gameInfoDialog = createOverlayDialog({
  root: elements.gameInfoPanel,
  surface: elements.gameInfoDialog,
  closeButtons: [elements.gameInfoClose],
  initialFocus: elements.gameInfoDialog,
  returnFocus: elements.more,
  beforeOpen: () => renderGameInfo(state ?? preview),
});

function handleReady(message) {
  playMode = message.mode ?? "room";
  if (playMode === "solo") {
    playerId = "solo-player-1";
    localMatchId = `solo-${crypto.randomUUID()}`;
    localVersion = 0;
    const now = Date.now();
    handleState({
      playerId,
      state: createSoloGoState(),
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
  clearPendingMove();
  elements.actionFeedback.hidden = true;
  playerId = playMode === "solo" ? "solo-player-1" : message.playerId;
  state = message.state;
  recordReplayFrame(message);
  historyStore.save(
    updateGoHistory(historyStore.load(), { ...message, mode: playMode }),
  );
  if (elements.historyPanel.open) renderHistory();
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
  if (state.phase !== "scoring") {
    scoreRequestRound = undefined;
  } else if (
    scoreRequestRound !== undefined &&
    scoreRequestRound !== Number(state.scoreRound)
  ) {
    scoreRequestRound = undefined;
  }
  render(state);
  submitScoreIfNeeded();
}

function handleActionResult(result) {
  if (result.requestId === settingsRequestId) {
    settingsRequestId = undefined;
    if (queuedSettings && state?.phase === "setup" && !pendingAction) {
      sendSettingsUpdate(queuedSettings);
    }
    return;
  }
  if (result.requestId !== pendingAction?.requestId) return;
  const completedAction = pendingAction;
  pendingAction = undefined;
  if (state?.phase === "setup") {
    if (completedAction.type === "configure") {
      render(state);
      return;
    }
    showSetupFeedback("设置已确认，正在同步棋盘…", "pending");
    return;
  }
  render(state ?? preview);
  submitScoreIfNeeded();
}

function handleError(error, code, requestId) {
  if (requestId === settingsRequestId) {
    settingsRequestId = undefined;
    queuedSettings = undefined;
    draftSettings = undefined;
    if (!pendingAction) {
      const message = translateError(error, code);
      render(state ?? preview);
      showSetupFeedback(message, "error");
    }
    return;
  }
  if (requestId === pendingAction?.requestId) {
    pendingAction = undefined;
    if (
      state?.phase === "scoring" &&
      scoreRequestRound === Number(state.scoreRound)
    ) {
      scoreRequestRound = undefined;
    }
  }
  const message = translateError(error, code);
  render(state ?? preview);
  showActionError(message);
}

window.addEventListener("pagehide", () => {
  persistSoloResumeSnapshot();
  window.clearInterval(clockTimer);
  window.clearTimeout(historyClearTimer);
  window.clearTimeout(resignConfirmTimer);
  window.clearTimeout(moreMenuCloseTimer);
  client?.destroy();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistSoloResumeSnapshot();
});
document.addEventListener("pointerdown", (event) => {
  if (
    pendingMove &&
    !elements.board.contains(event.target) &&
    !elements.confirmMove.contains(event.target)
  ) {
    clearPendingMove();
  }
  if (
    !elements.moreMenu.hidden &&
    !elements.more.contains(event.target) &&
    !elements.moreMenu.contains(event.target)
  ) {
    setMoreMenuOpen(false);
  }
});
window.addEventListener("resize", positionConfirmMove);
window.addEventListener("scroll", positionConfirmMove, { passive: true });
window.visualViewport?.addEventListener("resize", positionConfirmMove);
window.visualViewport?.addEventListener("scroll", positionConfirmMove);
elements.confirmMove.addEventListener("click", () => {
  if (!pendingMove) return;
  const move = pendingMove;
  clearPendingMove();
  sendAction({ type: "play", row: move.row, column: move.column });
});
elements.confirmMove.addEventListener("animationend", (event) => {
  if (event.animationName !== "confirm-move-out" || pendingMove) return;
  elements.confirmMove.hidden = true;
  elements.confirmMove.classList.remove("is-exiting");
});
elements.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearSetupFeedback();
  if (setupSource === "resume") {
    if (playMode === "solo" && selectedResumeRecordId) {
      resumeHistoryRecord(selectedResumeRecordId);
      return;
    }
    showSetupFeedback("这份棋谱暂时无法在房间中续下", "error");
    return;
  }
  queuedSettings = undefined;
  draftSettings = undefined;
  const sent = sendAction(
    {
      type: "start",
      ...readSetupSettings(),
    },
    false,
  );
  if (!sent) {
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  showSetupFeedback("正在创建对局…", "pending");
  setSetupOpen(false);
});
elements.setupForm.addEventListener("input", (event) => {
  if (event.target.name === "setupSource") {
    setupSource = event.target.value;
    clearSetupFeedback();
    render(state ?? preview);
    return;
  }
  if (event.target === elements.resumeSetting) {
    selectedResumeRecordId = elements.resumeSetting.value;
    clearSetupFeedback();
    render(state ?? preview);
    return;
  }
  if (!isSettingControl(event.target)) return;
  updateHandicapControls();
  renderSettingValues();
  syncSetupSettings();
});

for (const select of elements.setupForm.querySelectorAll("select")) {
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
elements.komiSetting.closest(".setting-field").addEventListener("click", () => {
  if (!elements.komiSetting.disabled) {
    elements.komiSetting.focus({ preventScroll: true });
  }
});
elements.pass.addEventListener("click", () => sendAction({ type: "pass" }));
elements.undo.addEventListener("click", () =>
  sendAction({ type: playMode === "solo" ? "undo" : "request_undo" }),
);
elements.undoAccept.addEventListener("click", () =>
  sendAction({ type: "respond_undo", accept: true }),
);
elements.undoReject.addEventListener("click", () =>
  sendAction({ type: "respond_undo", accept: false }),
);
elements.more.addEventListener("click", (event) => {
  const shouldOpen =
    elements.moreMenu.hidden || elements.moreMenu.dataset.state === "closing";
  setMoreMenuOpen(shouldOpen, event.detail === 0);
});
elements.moreMenu.addEventListener("animationend", (event) => {
  if (event.animationName === "more-menu-out") finishMoreMenuClose();
});
elements.moreMenu.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [
    ...elements.moreMenu.querySelectorAll('[role="menuitem"]'),
  ].filter((item) => !item.hidden && !item.disabled);
  if (items.length === 0) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex =
    currentIndex < 0
      ? direction > 0
        ? 0
        : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
  items[nextIndex].focus();
});
elements.resign.addEventListener("click", () => {
  if (elements.resign.dataset.confirming === "true") {
    setMoreMenuOpen(false);
    sendAction({ type: "resign" });
    return;
  }
  elements.resign.dataset.confirming = "true";
  elements.resignLabel.textContent = "确认认输";
  window.clearTimeout(resignConfirmTimer);
  resignConfirmTimer = window.setTimeout(resetResignConfirmation, 3000);
});
elements.rematch.addEventListener("click", () =>
  sendAction({ type: "rematch" }),
);
elements.settings.addEventListener("click", () =>
  sendAction({ type: "configure" }),
);
elements.historyOpen.addEventListener("click", () => {
  setMoreMenuOpen(false);
  setHistoryOpen(true);
});
elements.gameInfoOpen.addEventListener("click", () => {
  setMoreMenuOpen(false);
  setGameInfoOpen(true);
});
elements.help.addEventListener("click", () => setMoreMenuOpen(false));
elements.replayOpen.addEventListener("click", () =>
  setReplayOpen(!isReplayOpen()),
);
elements.replayControls.addEventListener("animationend", (event) => {
  if (event.target !== elements.replayControls) return;
  if (event.animationName === "replay-controls-in" && isReplayOpen()) {
    elements.replayControls.dataset.state = "open";
  }
  if (event.animationName === "replay-controls-out" && !isReplayOpen()) {
    elements.replayControls.hidden = true;
    delete elements.replayControls.dataset.state;
  }
});
elements.replayFirst.addEventListener("click", () => showReplayFrame(0));
elements.replayPrevious.addEventListener("click", () =>
  showReplayFrame((replayIndex ?? replayFrames.length - 1) - 1),
);
elements.replayNext.addEventListener("click", () =>
  showReplayFrame((replayIndex ?? replayFrames.length - 1) + 1),
);
elements.replayLast.addEventListener("click", () =>
  showReplayFrame(replayFrames.length - 1),
);
elements.replaySlider.addEventListener("input", () =>
  showReplayFrame(Number(elements.replaySlider.value)),
);
elements.moveLogList.addEventListener("click", (event) => {
  const entry = event.target.closest("[data-move-number]");
  if (entry) showReplayMove(Number(entry.dataset.moveNumber));
});
elements.historyList.addEventListener("click", (event) => {
  const resumeButton = event.target.closest("[data-history-resume]");
  if (resumeButton) {
    resumeHistoryRecord(resumeButton.dataset.historyResume);
    return;
  }
  const exportButton = event.target.closest("[data-history-export]");
  if (exportButton) exportHistoryRecord(exportButton.dataset.historyExport);
});
elements.historyClear.addEventListener("click", () => {
  if (elements.historyClear.dataset.confirm !== "true") {
    elements.historyClear.dataset.confirm = "true";
    elements.historyClearLabel.textContent = "再次点击确认清空";
    window.clearTimeout(historyClearTimer);
    historyClearTimer = window.setTimeout(resetHistoryClear, 3000);
    return;
  }
  historyStore.save([]);
  resetHistoryClear();
  renderHistory();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.moreMenu.hidden) {
    setMoreMenuOpen(false);
    elements.more.focus();
  } else if (event.key === "Escape" && isReplayOpen()) {
    setReplayOpen(false);
  }
});
if (isStandalone) {
  handleReady({ mode: "solo" });
} else {
  render(preview);
}

function buildBoard(size) {
  elements.board.replaceChildren();
  elements.boardShell.setAttribute("aria-label", `${size} × ${size} 围棋棋盘`);
  points.length = 0;
  boardSize = size;
  elements.board.style.setProperty("--edge", `${50 / size}%`);
  elements.board.style.setProperty("--point-size", `${90 / size}%`);
  elements.board.style.setProperty("--line-step", `${100 / (size - 1)}%`);
  const star = size === 9 ? [3, 5, 7] : size === 13 ? [4, 7, 10] : [4, 10, 16];

  for (let row = 1; row <= size; row += 1) {
    for (let column = 1; column <= size; column += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "go-point";
      point.style.top = `${(row - 0.5) * (100 / size)}%`;
      point.style.left = `${(column - 0.5) * (100 / size)}%`;
      point.setAttribute("role", "gridcell");
      point.setAttribute("aria-label", `第 ${row} 行，第 ${column} 列`);
      point.disabled = true;
      if (star.includes(row) && star.includes(column)) {
        point.classList.add("is-star");
      }
      point.addEventListener("pointerdown", (event) => {
        lastPointerType = event.pointerType;
      });
      point.addEventListener("click", (event) => {
        if (requiresMoveConfirmation(event)) {
          selectPendingMove(row, column, point);
          return;
        }
        clearPendingMove();
        sendAction({ type: "play", row, column });
      });
      elements.board.append(point);
      points.push(point);
    }
  }
}

function requiresMoveConfirmation(event) {
  if (event.detail === 0) return false;
  return (
    lastPointerType === "touch" ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function sendAction(action, renderPendingState = true) {
  if (pendingAction || !state) return;
  clearPendingMove();
  const requestId = dispatchAction(action);
  if (!requestId) {
    showActionError("尚未连接 Playweft 平台");
    return false;
  }
  pendingAction = { requestId, type: action.type };
  if (renderPendingState) render(state);
  return true;
}

function dispatchAction(action) {
  if (playMode !== "solo") return client?.sendAction(action);
  const requestId = crypto.randomUUID();
  window.queueMicrotask(() => {
    const result = applySoloGoAction(state, action, { now: Date.now() });
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

function selectPendingMove(row, column, point) {
  if (pendingAction || point.disabled || point.dataset.piece !== "0") return;
  pendingMove?.point.classList.remove("is-pending-move");
  pendingMove?.point.removeAttribute("aria-pressed");
  pendingMove = {
    row,
    column,
    point,
  };
  point.classList.add("is-pending-move");
  point.setAttribute("aria-pressed", "true");
  point.blur();
  elements.confirmMove.classList.remove("is-exiting");
  elements.confirmMove.hidden = false;
  elements.confirmMove.setAttribute(
    "aria-label",
    `在第 ${row} 行，第 ${column} 列落子`,
  );
  positionConfirmMove();
}

function clearPendingMove() {
  const shouldAnimate = pendingMove && !elements.confirmMove.hidden;
  pendingMove?.point.classList.remove("is-pending-move");
  pendingMove?.point.removeAttribute("aria-pressed");
  pendingMove = undefined;
  elements.confirmMove.removeAttribute("aria-label");
  if (shouldAnimate) {
    elements.confirmMove.classList.add("is-exiting");
  }
}

function positionConfirmMove() {
  if (!pendingMove || elements.confirmMove.hidden) return;
  const point = pendingMove.point;
  const button = elements.confirmMove;
  const pointRect = point.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
  const viewportHeight =
    viewport?.height ?? document.documentElement.clientHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const safeInset = 8;
  const touchClearance = Math.max(48, pointRect.width / 2 + 30);
  const anchorX = pointRect.left + pointRect.width / 2;
  const anchorY = pointRect.top + pointRect.height / 2;
  const horizontalPadding = button.offsetWidth / 2 + safeInset;
  const left = Math.min(
    viewportRight - horizontalPadding,
    Math.max(viewportLeft + horizontalPadding, anchorX),
  );
  const minimumTop = viewportTop + safeInset;
  const maximumTop = viewportBottom - button.offsetHeight - safeInset;
  const topAbove = anchorY - touchClearance - button.offsetHeight;
  const topBelow = anchorY + touchClearance;
  const preferredTop = topAbove >= minimumTop ? topAbove : topBelow;
  const top = Math.min(maximumTop, Math.max(minimumTop, preferredTop));
  button.style.left = `${Math.round(left)}px`;
  button.style.top = `${Math.round(top)}px`;
}

function setPointClasses(
  point,
  piece,
  playable = false,
  previewColor = 0,
  isLastMove = false,
) {
  const stoneColor = piece || (playable ? previewColor : 0);
  point.classList.toggle("has-stone", piece !== 0);
  point.classList.toggle("piece-black", stoneColor === 1);
  point.classList.toggle("piece-white", stoneColor === 2);
  point.classList.toggle("is-playable", playable);
  point.classList.toggle("is-last-move", isLastMove);
}

function recordReplayFrame(message) {
  const nextState = message.state;
  if (!nextState || nextState.phase === "setup") {
    replayGameKey = "";
    replayFrames = [];
    hideReplayImmediately();
    return;
  }

  const gameKey = `${message.matchId ?? localMatchId ?? "current"}:${nextState.round ?? 1}`;
  const moveNumber = Math.max(0, Number(nextState.moves) || 0);
  const wasAtLatest =
    replayIndex === undefined || replayIndex >= replayFrames.length - 1;
  if (gameKey !== replayGameKey) {
    replayGameKey = gameKey;
    replayFrames = [];
    hideReplayImmediately();
  } else if (moveNumber < (replayFrames.at(-1)?.moveNumber ?? 0)) {
    replayFrames = replayFrames.filter(
      (frame) => frame.moveNumber <= moveNumber,
    );
    hideReplayImmediately();
  }

  const lastFrame = replayFrames.at(-1);
  const eventKind = nextState.lastEvent?.kind;
  const playerIndex = Number(nextState.lastEvent?.playerIndex) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const move =
    moveNumber > 0 && (eventKind === "play" || eventKind === "pass")
      ? {
          number: moveNumber,
          color: playerIndex === blackIndex ? 1 : 2,
          pass: eventKind === "pass",
          row: Number(nextState.lastMove?.row) || 0,
          column: Number(nextState.lastMove?.column) || 0,
        }
      : lastFrame?.moveNumber === moveNumber
        ? lastFrame.move
        : undefined;
  const frame = {
    moveNumber,
    board: (nextState.board ?? []).map((row) => [...row]),
    lastMove: { ...nextState.lastMove },
    lastEvent: { ...nextState.lastEvent },
    move,
  };
  if (lastFrame?.moveNumber === moveNumber) {
    replayFrames[replayFrames.length - 1] = frame;
  } else {
    replayFrames.push(frame);
  }

  if (isReplayOpen()) {
    replayIndex = wasAtLatest
      ? replayFrames.length - 1
      : Math.min(replayIndex ?? 0, replayFrames.length - 1);
  }
}

function setReplayOpen(open) {
  if (open === isReplayOpen()) return;
  if (open && replayFrames.length <= 1) return;
  if (open) setMoreMenuOpen(false);
  clearPendingMove();
  elements.replayOpen.setAttribute("aria-expanded", String(open));
  replayIndex = open ? replayFrames.length - 1 : undefined;
  if (open) {
    elements.replayControls.hidden = false;
    elements.replayControls.dataset.state = "opening";
  } else if (!elements.replayControls.hidden) {
    elements.replayControls.dataset.state = "closing";
  }
  render(state ?? preview);
}

function isReplayOpen() {
  return elements.replayOpen.getAttribute("aria-expanded") === "true";
}

function hideReplayImmediately() {
  elements.replayOpen.setAttribute("aria-expanded", "false");
  elements.replayControls.hidden = true;
  delete elements.replayControls.dataset.state;
  replayIndex = undefined;
}

function showReplayFrame(index) {
  if (!isReplayOpen() || replayFrames.length === 0) return;
  clearPendingMove();
  replayIndex = Math.min(
    replayFrames.length - 1,
    Math.max(0, Number(index) || 0),
  );
  render(state ?? preview);
}

function showReplayMove(moveNumber) {
  const frameIndex = replayFrames.findIndex(
    (frame) => frame.moveNumber === moveNumber,
  );
  if (frameIndex < 0) return;
  setMoreMenuOpen(false);
  setReplayOpen(true);
  showReplayFrame(frameIndex);
}

function renderReplayControls() {
  const latestIndex = replayFrames.length - 1;
  const selectedIndex = Math.min(
    latestIndex,
    Math.max(0, replayIndex ?? latestIndex),
  );
  const frame = replayFrames[selectedIndex];
  const moveNumber = frame?.moveNumber ?? 0;
  const replayRatio = latestIndex > 0 ? selectedIndex / latestIndex : 0;
  elements.replayOpen.disabled = replayFrames.length <= 1;
  elements.replaySlider.max = String(Math.max(0, latestIndex));
  elements.replaySlider.value = String(Math.max(0, selectedIndex));
  elements.replaySliderField.style.setProperty(
    "--replay-progress",
    `${replayRatio * 100}%`,
  );
  elements.replayStatus.value = String(moveNumber);
  elements.replaySlider.setAttribute(
    "aria-valuetext",
    moveNumber > 0 ? `第 ${moveNumber} 手` : "开局",
  );
  elements.replayFirst.disabled = selectedIndex <= 0;
  elements.replayPrevious.disabled = selectedIndex <= 0;
  elements.replayNext.disabled = selectedIndex >= latestIndex;
  elements.replayLast.disabled = selectedIndex >= latestIndex;
}

function renderMoveLog(size) {
  const moves = replayFrames.map((frame) => frame.move).filter(Boolean);
  const previousScrollTop = elements.moveLogList.scrollTop;
  const previousCount = Number(elements.moveLogList.dataset.moveCount) || 0;
  const latestIndex = replayFrames.length - 1;
  const selectedMove =
    replayFrames[replayIndex ?? latestIndex]?.moveNumber ??
    moves.at(-1)?.number;
  elements.moveLogCount.textContent = `${moves.length} 手`;
  elements.moveLogList.dataset.moveCount = String(moves.length);
  elements.moveLogList.replaceChildren();

  if (moves.length === 0) {
    const empty = document.createElement("li");
    empty.className = "move-log-empty";
    empty.textContent = "尚未落子";
    elements.moveLogList.append(empty);
    return;
  }

  for (let index = 0; index < moves.length; index += 2) {
    const row = document.createElement("li");
    row.className = "move-log-row";
    for (const move of moves.slice(index, index + 2)) {
      const entry = document.createElement("button");
      const colorName = move.color === 1 ? "黑棋" : "白棋";
      const coordinate = formatMoveCoordinate(move, size);
      entry.type = "button";
      entry.className = "move-log-entry";
      entry.classList.toggle("is-selected", move.number === selectedMove);
      if (move.number === selectedMove)
        entry.setAttribute("aria-current", "step");
      entry.dataset.moveNumber = String(move.number);
      entry.setAttribute(
        "aria-label",
        `第 ${move.number} 手，${colorName}，${coordinate}`,
      );

      const stone = document.createElement("span");
      stone.className = `go-stone move-log-stone ${move.color === 1 ? "go-stone--black" : "go-stone--white"}`;
      stone.setAttribute("aria-hidden", "true");
      const number = document.createElement("span");
      number.className = "move-log-number";
      number.textContent = String(move.number);
      const point = document.createElement("strong");
      point.textContent = coordinate;
      entry.append(stone, number, point);
      row.append(entry);
    }
    if (row.children.length === 1) {
      const placeholder = document.createElement("span");
      placeholder.className = "move-log-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      row.append(placeholder);
    }
    elements.moveLogList.append(row);
  }

  if (isReplayOpen() && replayIndex < latestIndex) {
    const selected = elements.moveLogList.querySelector(".is-selected");
    if (selected) {
      elements.moveLogList.scrollTop = Math.max(
        0,
        selected.offsetTop -
          elements.moveLogList.offsetTop -
          (elements.moveLogList.clientHeight - selected.offsetHeight) / 2,
      );
    }
  } else if (moves.length > previousCount) {
    elements.moveLogList.scrollTop = elements.moveLogList.scrollHeight;
  } else {
    elements.moveLogList.scrollTop = previousScrollTop;
  }
}

function formatMoveCoordinate(move, size) {
  if (move.pass) return "停一手";
  const columns = "ABCDEFGHJKLMNOPQRST";
  const column = columns[move.column - 1] ?? "?";
  return `${column}${size - move.row + 1}`;
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const isSetup = nextState.phase === "setup";
  const actionPending = Boolean(pendingAction);
  const currentIndex = Number(nextState.current) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const whiteIndex = blackIndex === 0 ? 1 : 0;
  const ended = Boolean(nextState.ended);
  const isScoring = nextState.phase === "scoring";
  elements.scoringSummary.hidden = !isScoring;
  if (isScoring) {
    elements.scoringSummary.textContent = scoringRuleSummary(
      nextState.settings,
    );
  }
  if (elements.gameInfoPanel.open) renderGameInfo(nextState);
  const colorPlayers = [
    { playerIndex: blackIndex, label: "黑方", color: 1 },
    { playerIndex: whiteIndex, label: "白方", color: 2 },
  ];
  const size =
    Number(nextState.settings?.size) || nextState.board?.length || 19;
  if (boardSize !== size) buildBoard(size);
  const latestReplayIndex = replayFrames.length - 1;
  const selectedReplayFrame = isReplayOpen()
    ? replayFrames[replayIndex ?? latestReplayIndex]
    : undefined;
  const isReviewingPast =
    Boolean(selectedReplayFrame) && replayIndex < latestReplayIndex;
  const boardState = isReviewingPast
    ? {
        ...nextState,
        board: selectedReplayFrame.board,
        moves: selectedReplayFrame.moveNumber,
        lastMove: selectedReplayFrame.lastMove,
        lastEvent: selectedReplayFrame.lastEvent,
      }
    : nextState;
  renderPlayerCards(nextState, ownIndex, currentIndex, ended, colorPlayers);
  renderMoveLog(size);

  if (isSetup) {
    elements.undo.hidden = true;
    elements.undoRequest.hidden = true;
    renderSetup(nextState, ownIndex);
    renderSetupBoard(nextState, size);
    elements.replayOpen.disabled = true;
    setSetupOpen(!actionPending);
    return;
  }
  setSetupOpen(false);
  clearSetupFeedback();

  const undoRequest = nextState.undoRequest;
  const hasUndoRequest = Boolean(undoRequest);
  const undoRequesterIndex = Number(undoRequest?.requesterIndex) - 1;
  const isUndoRequester = hasUndoRequest && undoRequesterIndex === ownIndex;
  const previewColor = currentIndex === blackIndex ? 1 : 2;
  const canAct =
    Boolean(state) &&
    !ended &&
    !isScoring &&
    !hasUndoRequest &&
    (playMode === "solo" || ownIndex === currentIndex) &&
    !actionPending &&
    !isReviewingPast;
  const canResign =
    Boolean(state) &&
    !ended &&
    !isScoring &&
    (playMode === "solo" || ownIndex >= 0) &&
    !actionPending &&
    !isReviewingPast;

  const moveNumber = Number(boardState.moves) || 0;
  const moveNumberLabel = isReviewingPast
    ? `回看 · ${moveNumber > 0 ? `第 ${moveNumber} 手` : "开局"}`
    : moveNumber > 0
      ? `第 ${moveNumber} 手`
      : "开局";
  for (const moveNumberElement of elements.moveNumbers) {
    moveNumberElement.hidden = false;
    moveNumberElement.textContent = moveNumberLabel;
  }
  const canUndo =
    Boolean(state) &&
    !ended &&
    !isScoring &&
    !hasUndoRequest &&
    Boolean(nextState.undoAvailable) &&
    Number(nextState.moves) > 0 &&
    !actionPending &&
    !isReviewingPast &&
    (playMode === "solo" ||
      Number(nextState.lastEvent?.playerIndex) - 1 === ownIndex);
  elements.undo.hidden = ended || isScoring;
  elements.undo.disabled = !canUndo;
  elements.undoLabel.textContent = isUndoRequester ? "等待同意" : "悔棋";
  elements.undoRequest.hidden = playMode === "solo" || !hasUndoRequest || ended;
  if (!elements.undoRequest.hidden) {
    const requesterName =
      nextState.playerNames?.[undoRequesterIndex] ||
      (undoRequesterIndex === blackIndex ? "黑方" : "白方");
    elements.undoRequestLabel.textContent = isUndoRequester
      ? "已请求悔棋，等待对方同意"
      : `${requesterName}请求悔棋`;
    elements.undoResponseActions.hidden = isUndoRequester;
    elements.undoAccept.disabled = actionPending;
    elements.undoReject.disabled = actionPending;
  }
  elements.pass.disabled = !canAct;
  elements.pass.hidden = ended || isScoring;
  elements.resign.disabled = !canResign;
  elements.resign.hidden = ended || isScoring;
  if (!canResign) resetResignConfirmation();
  elements.rematch.hidden = !state || !ended || ownIndex < 0;
  elements.rematch.disabled = actionPending;
  elements.settings.hidden = !state || !ended || ownIndex < 0;
  elements.settings.disabled = actionPending;
  renderReplayControls();
  renderClocks();

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      const value = Number(boardState.board?.[row]?.[column]) || 0;
      const playable = canAct && value === 0;
      const isLastMove =
        boardState.lastEvent?.kind === "play" &&
        Number(boardState.lastMove?.row) === row + 1 &&
        Number(boardState.lastMove?.column) === column + 1;
      point.dataset.piece = String(value);
      point.disabled = !playable;
      setPointClasses(point, value, playable, previewColor, isLastMove);
      const pieceName = value === 1 ? "黑子" : value === 2 ? "白子" : "空位";
      point.setAttribute(
        "aria-label",
        `第 ${row + 1} 行，第 ${column + 1} 列，${pieceName}${
          isLastMove ? "，最后一手" : ""
        }`,
      );
    }
  }

}

function renderPlayerCards(
  nextState,
  ownIndex,
  currentIndex,
  ended,
  colorPlayers,
) {
  colorPlayers.forEach(({ playerIndex, label, color }, panelIndex) => {
    const panel = elements.players[panelIndex];
    const isSelf =
      playMode === "solo"
        ? color === 1
        : ownIndex >= 0
          ? playerIndex === ownIndex
          : color === 1;
    const savedName = nextState.playerNames?.[playerIndex];
    const name =
      typeof savedName === "string" && savedName.trim()
        ? savedName.trim()
        : label;
    panel.querySelector("[data-player-name]").textContent = name;
    panel.classList.toggle("is-self", isSelf);
    panel.classList.toggle("is-opponent", !isSelf);
    const detail = panel.querySelector("[data-player-detail]");
    if (ended && nextState.lastEvent?.kind === "resigned") {
      detail.textContent =
        Number(nextState.winnerIndex) - 1 === playerIndex ? "获胜" : "已认输";
    } else if (ended && nextState.scores) {
      const score =
        color === 1 ? nextState.scores.black : nextState.scores.white;
      detail.textContent = `${formatScore(score)} 目`;
    } else {
      const captures = Number(nextState.captures?.[playerIndex]) || 0;
      detail.textContent = `提子 ${captures}`;
    }
    panel.classList.toggle(
      "is-current",
      !ended && playerIndex === currentIndex,
    );
    panel.classList.toggle(
      "is-winner",
      ended && Number(nextState.winnerIndex) - 1 === playerIndex,
    );
  });
}

function resetResignConfirmation() {
  window.clearTimeout(resignConfirmTimer);
  resignConfirmTimer = undefined;
  elements.resign.dataset.confirming = "false";
  elements.resignLabel.textContent = "认输";
}

function setMoreMenuOpen(open, focusFirst = false) {
  window.clearTimeout(moreMenuCloseTimer);
  moreMenuCloseTimer = undefined;
  elements.more.setAttribute("aria-expanded", String(open));

  if (open) {
    if (isReplayOpen()) setReplayOpen(false);
    elements.moreMenu.hidden = false;
    elements.moreMenu.dataset.state = "open";
    if (focusFirst) {
      window.queueMicrotask(() =>
        elements.moreMenu
          .querySelector('[role="menuitem"]:not([hidden]):not(:disabled)')
          ?.focus(),
      );
    }
    return;
  }

  resetResignConfirmation();
  if (elements.moreMenu.hidden) return;
  elements.moreMenu.dataset.state = "closing";
  moreMenuCloseTimer = window.setTimeout(finishMoreMenuClose, 170);
}

function finishMoreMenuClose() {
  if (elements.moreMenu.dataset.state !== "closing") return;
  window.clearTimeout(moreMenuCloseTimer);
  moreMenuCloseTimer = undefined;
  elements.moreMenu.hidden = true;
  elements.moreMenu.removeAttribute("data-state");
}

function formatScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 1) : "0";
}

function renderSetup(nextState, ownIndex) {
  const hostId = nextState.hostId ?? nextState.players?.[0];
  const isHost = Boolean(state) && (nextState.canConfigure ?? playerId === hostId);
  const canConfigure = isHost && !pendingAction;
  const resumeRecords = availableSetupResumeRecords();
  if (
    !selectedResumeRecordId ||
    !resumeRecords.some((record) => record.id === selectedResumeRecordId)
  ) {
    selectedResumeRecordId = resumeRecords[0]?.id ?? "";
  }
  if (setupSource === "resume" && resumeRecords.length === 0) {
    setupSource = "new";
  }
  elements.newGameSettings.hidden = setupSource === "resume";
  elements.handicapNote.hidden = setupSource === "resume";
  elements.sourceSetting.value = setupSource;
  elements.sourceSetting.disabled = !canConfigure;
  elements.resumeSource.disabled = resumeRecords.length === 0;
  renderSetupResumePicker(resumeRecords, canConfigure);
  const selectedRecord = resumeRecords.find(
    (record) => record.id === selectedResumeRecordId,
  );
  const settings =
    setupSource === "resume" && selectedRecord
      ? selectedRecord.settings
      : (isHost && draftSettings) || nextState.settings || preview.settings;
  elements.setupNote.textContent = canConfigure
    ? playMode === "solo"
      ? "本机控制黑白双方轮流落子"
      : "调整会立即同步给另一方，确认后开始"
    : "设置会随房主调整实时更新";
  elements.sizeSetting.value = String(settings.size ?? 19);
  elements.rulesSetting.value = settings.rules ?? "chinese";
  elements.komiSetting.value = String(settings.komi ?? 6.5);
  elements.blackSetting.value = settings.blackMode ?? "random";
  elements.handicapSetting.value = String(settings.handicap ?? 0);
  const controls = [
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.blackSetting,
    elements.handicapSetting,
    elements.start,
  ];
  for (const control of controls) {
    control.disabled = !canConfigure || setupSource === "resume";
  }
  elements.start.disabled = !canConfigure;
  elements.startLabel.textContent = pendingAction
    ? "正在开始…"
    : setupSource === "resume"
      ? "继续对局"
      : "开始对局";
  updateHandicapControls();
  renderSettingValues();
}

function renderSettingValues() {
  for (const select of elements.setupForm.querySelectorAll("select")) {
    const option = select.selectedOptions[0];
    const value = select.closest(".setting-field").querySelector(".setting-value");
    value.textContent = option?.dataset.display ?? option?.textContent ?? "";
  }
}

function availableSetupResumeRecords() {
  return historyStore
    .load()
    .filter(
      (record) =>
        record.mode === playMode && !record.result && canResumeGoRecord(record),
    );
}

function renderSetupResumePicker(records, canConfigure) {
  elements.resumeSetup.hidden = setupSource !== "resume";
  if (elements.resumeSetup.hidden) return;

  elements.resumeSetting.replaceChildren(
    ...records.map((record) => {
      const option = document.createElement("option");
      option.value = record.id;
      option.textContent = `第 ${record.round} 局 · ${record.moves.length} 手 · ${new Date(record.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      return option;
    }),
  );
  elements.resumeSetting.value = selectedResumeRecordId;
  elements.resumeSetting.disabled = !canConfigure;
  const record = records.find((entry) => entry.id === selectedResumeRecordId);
  elements.resumeSummary.replaceChildren();
  if (!record) return;

  const settings = record.settings ?? {};
  const currentIndex = Number(record.resume?.state?.current) - 1;
  const blackIndex = Number(record.resume?.state?.blackIndex) - 1;
  const currentColor = currentIndex === blackIndex ? "黑方" : "白方";
  const values = [
    ["对局", `黑方 ${record.blackPlayer} 对 白方 ${record.whitePlayer}`],
    ["进度", `第 ${record.moves.length} 手 · 轮到${currentColor}`],
    [
      "规则",
      `${settings.size ?? 19} × ${settings.size ?? 19} · ${settings.rules === "japanese" ? "日本规则" : "中国规则"} · 贴 ${settings.komi ?? 0} 目`,
    ],
  ];
  for (const [label, value] of values) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    elements.resumeSummary.append(term, description);
  }
}

function renderSetupBoard(nextState, size) {
  for (const moveNumberElement of elements.moveNumbers) {
    moveNumberElement.hidden = true;
  }
  renderClocks();
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      const value = Number(nextState.board?.[row]?.[column]) || 0;
      point.dataset.piece = String(value);
      point.disabled = true;
      setPointClasses(point, value);
    }
  }
}

function setSetupOpen(open) {
  setupDialog.setOpen(open);
}

function setHistoryOpen(open) {
  historyDialog.setOpen(open);
}

function setGameInfoOpen(open) {
  gameInfoDialog.setOpen(open);
}

function renderGameInfo(nextState) {
  const settings = nextState.settings ?? preview.settings;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const blackName =
    nextState.playerNames?.[blackIndex] ||
    (playMode === "solo" ? "黑方" : `玩家 ${blackIndex + 1}`);
  const blackMethod =
    Number(settings.handicap) > 0
      ? `${blackName}（受让）`
      : settings.blackMode === "random"
        ? `${blackName}（随机）`
        : blackName;
  const entries = [
    ["棋盘", `${settings.size ?? 19} × ${settings.size ?? 19}`],
    ["规则", ruleLabel(settings)],
    ["贴目", `${formatScore(settings.komi)} 目`],
    [
      "让子",
      Number(settings.handicap) > 0 ? `让 ${settings.handicap} 子` : "不让子",
    ],
    ["执黑", blackMethod],
  ];

  elements.gameInfoList.replaceChildren(
    ...entries.map(([label, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      return row;
    }),
  );
}

function resetHistoryClear() {
  window.clearTimeout(historyClearTimer);
  delete elements.historyClear.dataset.confirm;
  elements.historyClearLabel.textContent = "清空全部";
}

function renderHistory() {
  const records = historyStore.load();
  elements.historyClear.disabled = records.length === 0;
  elements.historyList.replaceChildren();

  if (records.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "完成或进行中的棋局会自动出现在这里";
    elements.historyList.append(empty);
    return;
  }

  records.forEach((record, index) => {
    const entry = document.createElement("li");
    entry.className = "history-entry";

    const main = document.createElement("div");
    main.className = "history-entry-main";
    const title = document.createElement("p");
    title.className = "history-entry-title";
    title.textContent = `第 ${record.round} 局 · 黑方 ${record.blackPlayer} 对 白方 ${record.whitePlayer}`;
    const meta = document.createElement("p");
    meta.className = "history-entry-meta";
    const settings = record.settings ?? {};
    meta.textContent = [
      new Date(record.createdAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      `${settings.size ?? 19} × ${settings.size ?? 19}`,
      settings.rules === "japanese" ? "日本规则" : "中国规则",
      `${record.moves?.length ?? 0} 手`,
      record.partial ? "部分记录" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    main.append(title, meta);

    const isCurrentRecord =
      playMode === "solo" &&
      record.matchId === localMatchId &&
      Number(record.round) === Number(state?.round) &&
      !state?.ended;
    const canResume =
      playMode === "solo" && !isCurrentRecord && canResumeGoRecord(record);

    const actions = document.createElement("div");
    actions.className = "history-entry-actions";
    const result = document.createElement("p");
    result.className = "history-entry-result";
    result.textContent = isCurrentRecord
      ? "当前对局"
      : historyResultLabel(record);

    const buttons = document.createElement("div");
    buttons.className = "history-entry-buttons";

    if (canResume) {
      const resumeButton = document.createElement("button");
      resumeButton.type = "button";
      resumeButton.className = "history-resume";
      resumeButton.dataset.historyResume = record.id;
      resumeButton.textContent = "继续对局";
      buttons.append(resumeButton);
    }

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "history-export";
    exportButton.dataset.historyExport = record.id;
    exportButton.textContent = "导出 SGF";

    buttons.append(exportButton);
    actions.append(result, buttons);
    entry.append(main, actions);
    elements.historyList.append(entry);

    if (index < records.length - 1) {
      const divider = document.createElement("li");
      divider.className = "history-divider";
      divider.setAttribute("role", "separator");
      divider.setAttribute("aria-orientation", "horizontal");
      elements.historyList.append(divider);
    }
  });
}

function resumeHistoryRecord(recordId) {
  if (playMode !== "solo" || pendingAction) return;
  persistSoloResumeSnapshot();
  const record = historyStore.load().find((entry) => entry.id === recordId);
  const resumedAt = Date.now();
  const resumedState = restoreGoResumeState(record, resumedAt);
  if (!record?.matchId || !resumedState) {
    renderHistory();
    return;
  }

  localMatchId = record.matchId;
  const moveVersions = record.moves.map((move) => Number(move.version) || 0);
  localVersion = Math.max(0, Number(record.lastVersion) || 0, ...moveVersions);
  replayGameKey = `${record.matchId}:${resumedState.round ?? record.round ?? 1}`;
  replayFrames = goRecordToReplayFrames(record);
  hideReplayImmediately();
  setHistoryOpen(false);
  handleState({
    playerId: "solo-player-1",
    state: resumedState,
    events: [],
    matchId: localMatchId,
    version: localVersion,
    serverTime: resumedAt,
  });
}

function persistSoloResumeSnapshot() {
  if (playMode !== "solo" || !localMatchId || !state) return;
  historyStore.save(
    updateGoResumeSnapshot(
      historyStore.load(),
      localMatchId,
      state,
      Date.now(),
    ),
  );
}

function exportHistoryRecord(recordId) {
  const record = historyStore.load().find((entry) => entry.id === recordId);
  if (!record) return;
  const content = goRecordToSgf(record);
  const blob = new Blob([content], {
    type: "application/x-go-sgf;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date(record.createdAt).toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `go-${date}-round-${record.round}.sgf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function updateHandicapControls() {
  const hasHandicap = Number(elements.handicapSetting.value) > 0;
  const randomOption = elements.blackSetting.querySelector(
    'option[value="random"]',
  );
  randomOption.disabled = hasHandicap;
  if (hasHandicap && elements.blackSetting.value === "random") {
    elements.blackSetting.value = "player1";
  }
}

function isSettingControl(target) {
  return [
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.blackSetting,
    elements.handicapSetting,
  ].includes(target);
}

function readSetupSettings() {
  return {
    size: Number(elements.sizeSetting.value),
    rules: elements.rulesSetting.value,
    komi: Number(elements.komiSetting.value),
    blackMode: elements.blackSetting.value,
    handicap: Number(elements.handicapSetting.value),
  };
}

function syncSetupSettings() {
  if (
    state?.phase !== "setup" ||
    elements.start.disabled ||
    !elements.komiSetting.value ||
    !elements.komiSetting.validity.valid
  ) {
    return;
  }
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
    Number(left.size) === Number(right.size) &&
    left.rules === right.rules &&
    Number(left.komi) === Number(right.komi) &&
    left.blackMode === right.blackMode &&
    Number(left.handicap) === Number(right.handicap)
  );
}

function submitScoreIfNeeded() {
  if (
    state?.phase !== "scoring" ||
    pendingAction ||
    scoreRequestRound === Number(state.scoreRound)
  ) {
    return;
  }
  const ownIndex = state.players?.indexOf(playerId) ?? -1;
  if (ownIndex < 0 || state.scoreSubmitted?.[ownIndex]) return;

  const round = Number(state.scoreRound);
  scoreRequestRound = round;
  const sent = sendAction(
    {
      type: "score",
      scoreRound: round,
      score: calculateGoScore(state),
    },
    false,
  );
  if (!sent) {
    scoreRequestRound = undefined;
    return;
  }
}

function renderClocks() {
  if (!state || state.phase === "setup") {
    for (const time of elements.playerTimes) {
      time.textContent = "00:00";
      time.dateTime = "PT0S";
    }
    return;
  }
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const playerIndexes = [blackIndex, blackIndex === 0 ? 1 : 0];
  const currentIndex = Number(state.current) - 1;
  const estimatedServerTime = Number.isFinite(serverTimeAtSync)
    ? serverTimeAtSync + (Date.now() - localTimeAtSync)
    : Number(state.turnStartedAt);

  playerIndexes.forEach((playerIndex, colorIndex) => {
    let milliseconds = Math.max(0, Number(state.timeUsed?.[playerIndex]) || 0);
    if (!state.ended && playerIndex === currentIndex) {
      milliseconds += Math.max(
        0,
        estimatedServerTime -
          (Number(state.turnStartedAt) || estimatedServerTime),
      );
    }
    const seconds = Math.floor(milliseconds / 1000);
    const clock = elements.playerTimes[colorIndex];
    renderClockDigits(clock, formatDuration(seconds));
    clock.dateTime = `PT${seconds}S`;
  });
}

function renderClockDigits(element, value) {
  if (
    element.dataset.clockValue === value &&
    element.querySelector(".segment-display")
  ) {
    return;
  }

  const display = document.createElement("span");
  display.className = "segment-display";
  display.setAttribute("aria-hidden", "true");

  for (const character of value) {
    const part = document.createElement("span");
    if (character === ":") {
      part.className = "segment-colon";
    } else {
      part.className = "segment-digit";
      const litSegments = digitSegments[Number(character)] ?? "";
      for (const name of segmentNames) {
        const segment = document.createElement("span");
        segment.className = `segment segment-${name}`;
        segment.classList.toggle("is-lit", litSegments.includes(name));
        part.append(segment);
      }
    }
    display.append(part);
  }

  const text = document.createElement("span");
  text.className = "clock-text";
  text.textContent = value;

  element.replaceChildren(display, text);
  element.dataset.clockValue = value;
  element.setAttribute("aria-label", value);
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ruleLabel(settings = {}) {
  return settings.rules === "japanese" ? "日本规则" : "中国规则";
}

function scoringRuleSummary(settings = {}) {
  return `按${ruleLabel(settings)}计分 · 贴 ${formatScore(settings.komi)} 目`;
}

function translateError(error, code) {
  const messages = {
    occupied: "这个交叉点已经有棋子",
    OCCUPIED: "这个交叉点已经有棋子",
    suicide: "这里不能落子：棋子将没有气",
    SUICIDE: "这里不能落子：棋子将没有气",
    ko: "劫争：不能立即还原上一手棋盘",
    KO: "劫争：不能立即还原上一手棋盘",
    not_your_turn: "还没轮到你",
    NOT_YOUR_TURN: "还没轮到你",
    game_over: "本局已经结束",
    GAME_OVER: "本局已经结束",
    handicap_requires_fixed_black: "让子时需要指定一位玩家执黑",
    HANDICAP_REQUIRES_FIXED_BLACK: "让子时需要指定一位玩家执黑",
    only_host_can_setup: "只有房主可以调整并确认对局设置",
    ONLY_HOST_CAN_SETUP: "只有房主可以调整并确认对局设置",
    invalid_score: "计分结果无效",
    INVALID_SCORE: "计分结果无效",
    scoring_required: "当前正在等待双方确认计分",
    SCORING_REQUIRED: "当前正在等待双方确认计分",
    stale_score_round: "计分状态已更新，请重新确认",
    STALE_SCORE_ROUND: "计分状态已更新，请重新确认",
    score_already_submitted: "你已经提交了本轮计分结果",
    SCORE_ALREADY_SUBMITTED: "你已经提交了本轮计分结果",
    undo_unavailable: "当前不能悔棋",
    UNDO_UNAVAILABLE: "当前不能悔棋",
    no_move_to_undo: "当前没有可以撤回的一手",
    NO_MOVE_TO_UNDO: "当前没有可以撤回的一手",
    undo_already_requested: "已经发起悔棋请求",
    UNDO_ALREADY_REQUESTED: "已经发起悔棋请求",
    only_last_player_can_undo: "只有刚刚落子的一方可以申请悔棋",
    ONLY_LAST_PLAYER_CAN_UNDO: "只有刚刚落子的一方可以申请悔棋",
    no_undo_request: "悔棋请求已经失效",
    NO_UNDO_REQUEST: "悔棋请求已经失效",
    undo_requester_cannot_respond: "请等待对方回应悔棋请求",
    UNDO_REQUESTER_CANNOT_RESPOND: "请等待对方回应悔棋请求",
    invalid_undo_response: "悔棋回应无效",
    INVALID_UNDO_RESPONSE: "悔棋回应无效",
    undo_response_required: "请先回应悔棋请求",
    UNDO_RESPONSE_REQUIRED: "请先回应悔棋请求",
  };
  return messages[code] ?? messages[error] ?? error;
}

function showActionError(message) {
  if (state?.phase === "setup") {
    showSetupFeedback(message, "error");
    return;
  }
  elements.actionFeedback.textContent = message;
  elements.actionFeedback.hidden = false;
}
