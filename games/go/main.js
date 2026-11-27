import {
  DEFAULT_GO_SETTINGS,
  defaultGoKomi,
  goTieBreakLabel,
  goAiPlayerName,
} from "./rules.js";
import { createGoAiController } from "./ai-controller.js";
import {
  GO_AI_MODELS,
  DEFAULT_GO_AI_MODEL_ID,
  resolveGoAiModelId,
} from "./ai-model.js";
import {
  Bot,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Ellipsis,
  Flag,
  History,
  House,
  Info,
  Globe,
  NotebookPen,
  Play,
  Pause,
  Settings2,
  SkipForward,
  Trash2,
  Undo2,
  Users,
  X,
  createIcons,
} from "lucide";
import {
  canResumeGoRecord,
  createGoHistoryStore,
  goRecordAnalysisKey,
  goRecordToReplayFrames,
  goRecordToReview,
  goRecordToSgf,
  historyResultLabel,
  latestGoResumeRecord,
  goResumeModeLabel,
  restoreGoResumeState,
  updateGoResumeSnapshot,
  updateGoHistory,
  updateGoRecordAnalysis,
} from "./history.js";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";
import {
  applySoloGoAction,
  calculateGoScore,
  createSoloGoState,
} from "./solo.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { initializeGoStorage } from "./storage.js";
import { createStartScreen } from "./start-screen.js";
import { createGoResultDialog } from "./result-dialog.js";
import { createGoStoneDrag } from "./stone-drag.js";
import { createGoSceneView } from "./scene-view.js";
import { goAiPosition } from "./ai-position.js";
import { createGoRecordReview } from "./record-review.js";
import { goTableView } from "./table-view.js";
import "../../src/game-storage.css";
import "../../src/components/board-stones.css";
import "./styles.css";
import bowlArt from "./assets/stone-bowl.svg?raw";

const elements = {
  startScreen: document.querySelector("#start-screen"),
  gameScreen: document.querySelector("#game-screen"),
  gameBack: document.querySelector("#game-back"),
  gameBackSpacer: document.querySelector("#game-back-spacer"),
  setupBack: document.querySelector("#setup-back"),
  home: document.querySelector("#home-button"),
  actionFeedback: document.querySelector("#action-feedback"),
  board: document.querySelector("#board"),
  boardShell: document.querySelector(".board-shell"),
  bowls: [document.querySelector("#black-bowl"), document.querySelector("#white-bowl")],
  dragStone: document.querySelector("#drag-stone"),
  confirmMove: document.querySelector("#confirm-move"),
  table: document.querySelector("#table-layout"),
  actionPanel: document.querySelector(".action-panel"),
  setupPanel: document.querySelector("#setup-panel"),
  setupForm: document.querySelector("#setup-form"),
  setupNote: document.querySelector("#setup-note"),
  opponentSettings: document.querySelector("#opponent-settings"),
  opponentSetting: document.querySelector("#opponent-setting"),
  aiDifficulty: document.querySelector("#ai-difficulty"),
  aiDifficultyField: document.querySelector("#ai-difficulty-field"),
  aiDifficultyDivider: document.querySelector("#ai-difficulty-divider"),
  aiFeedback: document.querySelector("#ai-feedback"),
  aiStatus: document.querySelector("#ai-status"),
  aiRetry: document.querySelector("#ai-retry"),
  aiErrorDialog: document.querySelector("#ai-error-dialog"),
  aiErrorClose: document.querySelector("#ai-error-close"),
  aiErrorOpen: document.querySelector("#ai-error-button"),
  sourceSetting: document.querySelector("#source-setting"),
  newGameSettings: document.querySelector("#new-game-settings"),
  resumeSource: document.querySelector("#resume-source"),
  resumeSetup: document.querySelector("#resume-setup"),
  resumeSetting: document.querySelector("#resume-setting"),
  resumeSummary: document.querySelector("#resume-summary"),
  sizeSetting: document.querySelector("#size-setting"),
  rulesSetting: document.querySelector("#rules-setting"),
  komiSetting: document.querySelector("#komi-setting"),
  tieBreakSetting: document.querySelector("#tie-break-setting"),
  blackSetting: document.querySelector("#black-setting"),
  handicapSetting: document.querySelector("#handicap-setting"),
  handicapNote: document.querySelector("#handicap-note"),
  setupFeedback: document.querySelector("#setup-feedback"),
  historyPanel: document.querySelector("#history-panel"),
  historyDialog: document.querySelector("#history-dialog"),
  historyBack: document.querySelector("#history-back"),
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
  portraitReplay: document.querySelector("#portrait-replay-button"),
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
  undoDialog: document.querySelector("#undo-dialog"),
  undoAccept: document.querySelector("#undo-accept"),
  undoReject: document.querySelector("#undo-reject"),
  pass: document.querySelector("#pass-button"),
  more: document.querySelector("#more-button"),
  moreMenu: document.querySelector("#more-menu"),
  resign: document.querySelector("#resign-button"),
  resignLabel: document.querySelector("#resign-label"),
  settings: document.querySelector("#settings-button"),
  resultPanel: document.querySelector("#result-panel"),
  resultDialog: document.querySelector("#result-dialog"),
  resultClose: document.querySelector("#result-close"),
  resultOpen: document.querySelector("#result-button"),
  moveNumbers: [...document.querySelectorAll("[data-move-number]")],
  players: [
    document.querySelector("#black-player"),
    document.querySelector("#white-player"),
  ],
  playerTimes: [...document.querySelectorAll("[data-player-time]")],
};
for (const bowl of elements.bowls) {
  bowl.innerHTML = bowlArt.replaceAll("bowl-", `${bowl.id}-`);
}
const segmentNames = ["a", "b", "c", "d", "e", "f", "g"];
for (const [id, model] of Object.entries(GO_AI_MODELS)) {
  elements.aiDifficulty.add(new Option(model.difficulty, id));
}
elements.aiDifficulty.value = DEFAULT_GO_AI_MODEL_ID;
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
let reviewingRecord;
let setupSource = "new";
let selectedResumeRecordId = "";
let startingAi = false;
let aiStatus = { phase: "idle" };
let shownAiError = false;
let actionFeedbackTimer;
let menuVisible = true;
let platformReady = false;
let canCreateRoom = false;
let creatingRoom = false;
let roomState;
let historyStorage;
const pendingRoomStates = [];

createIcons({
  icons: {
    Bot,
    ChartNoAxesCombined,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    CircleHelp,
    Ellipsis,
    Flag,
    History,
    House,
    Info,
    Globe,
    NotebookPen,
    Play,
    Pause,
    Settings2,
    SkipForward,
    Trash2,
    Undo2,
    Users,
    X,
  },
});
const clockTimer = window.setInterval(renderClocks, 1000);
const historyStore = createGoHistoryStore(() => historyStorage);
const startScreen = createStartScreen({
  root: elements.startScreen,
  models: GO_AI_MODELS,
  difficulty: DEFAULT_GO_AI_MODEL_ID,
  onAi: () => startLocalGame("ai"),
  onLocal: () => startLocalGame("local"),
  onOnline: createOnlineRoom,
  onResume: resumeHistoryRecord,
  onBack: showStartScreen,
  onAdvanced: () => setSetupOpen(true),
  onStart: startConfiguredGame,
  onDifficulty(id) {
    elements.aiDifficulty.value = id;
    syncSetupSettings();
    goAi.prepare(Number(elements.sizeSetting.value), id).catch(() => {});
  },
});
elements.playerTimes.forEach((element) => renderClockDigits(element, "00:00"));

const preview = {
  players: ["preview-one", "preview-two"],
  phase: "playing",
  settings: { ...DEFAULT_GO_SETTINGS },
  board: Array.from({ length: 19 }, () => Array(19).fill(0)),
  current: 1,
  blackIndex: 1,
  captures: [0, 0],
  consecutivePasses: 0,
  moves: 0,
  ended: false,
  winner: "",
  winnerIndex: 0,
  scores: { black: 0, white: 0, komi: defaultGoKomi() },
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
      onState: (message) => {
        if (playMode !== "room") return;
        if (!platformReady) pendingRoomStates.push(message);
        else handleState(message);
      },
      onContext: (context) => {
        roomState = context.room;
      },
      onRoomState: enterRoom,
      onRoomClosed: showStartScreen,
      onActionResult: handleActionResult,
      onError: handleError,
    });

const setupDialog = createOverlayDialog({
  root: elements.setupPanel,
  surface: elements.setupForm,
  dismissible: false,
  initialFocus: elements.setupForm,
  returnFocus: () => (isSetupMenu() ? startScreen.advancedButton : undefined),
});
const goAi = createGoAiController({
  onMove: (action) => sendAction(action),
  onStatus: (status) => {
    aiStatus = { ...aiStatus, ...status };
    renderAiFeedback();
  },
});
const recordReview = createGoRecordReview({ root: elements.gameScreen,
  enabled: Boolean(GO_AI_MODELS.b18), onSelect: showReplayFrame,
  beforeAnalysis: () => goAi.destroy(),
  onSave(analysis) {
    const records = historyStore.load();
    const next = updateGoRecordAnalysis(records, reviewingRecord?.id, GO_AI_MODELS.b18?.url, analysis);
    if (next !== records) historyStore.save(next);
  },
});

function updateAiTurn() {
  goAi.update(
    state,
    replayFrames,
    playMode === "solo" &&
      !pendingAction &&
      !isReplayOpen() &&
      !document.hidden,
    resolveGoAiModelId(state?.settings?.aiModel),
  );
  renderAiFeedback();
}

function renderAiFeedback() {
  const enabled =
    playMode === "solo" &&
    state?.settings?.opponent === "ai" &&
    state.phase !== "setup" &&
    !state.ended;
  const message =
    aiStatus.phase === "error" || aiStatus.phase === "loading"
      ? aiStatus.message
      : "";
  const failed = enabled && aiStatus.phase === "error";
  elements.aiErrorOpen.hidden = !failed;
  if (!failed) {
    shownAiError = false;
    aiErrorDialog.setOpen(false);
  } else if (!menuVisible && !shownAiError) {
    elements.aiStatus.textContent = message;
    shownAiError = true;
    aiErrorDialog.setOpen(true);
  }
  if (isAiMenu()) {
    if (setupDialog.isOpen && aiStatus.phase === "error") {
      showSetupFeedback(message, "error");
      return;
    }
    startScreen.setStatus(
      startingAi
        ? message || "正在准备对局…"
        : aiStatus.phase === "error"
          ? message
          : "",
    );
    return;
  }
  if (menuVisible && startingAi) {
    startScreen.setStatus(message || "正在准备对局…");
    return;
  }
  if (state?.phase === "setup" && elements.opponentSetting.value === "ai") {
    if (aiStatus.phase === "error") showSetupFeedback(message, "error");
    else if (startingAi) elements.startLabel.textContent = "正在准备…";
  }
}
const historyDialog = createOverlayDialog({
  root: elements.historyPanel,
  surface: elements.historyDialog,
  closeButtons: [elements.historyClose, elements.historyBack],
  initialFocus: elements.historyDialog,
  returnFocus: () => reviewingRecord ? elements.replaySlider : menuVisible ? elements.historyOpen : elements.more,
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
const resultDialog = createGoResultDialog({
  root: elements.resultPanel,
  dialog: createOverlayDialog({
    root: elements.resultPanel,
    surface: elements.resultDialog,
    closeButtons: [elements.resultClose],
    initialFocus: elements.resultDialog,
    returnFocus: elements.more,
    beforeOpen: () => setMoreMenuOpen(false),
  }),
  onRematch: () => sendAction({ type: "rematch" }),
  onHome: showStartScreen,
  onRetryScore: () => {
    scoreRequestRound = undefined;
    submitScoreIfNeeded();
  },
});
const aiErrorDialog = createOverlayDialog({
  root: elements.aiFeedback,
  surface: elements.aiErrorDialog,
  closeButtons: [elements.aiErrorClose],
  initialFocus: elements.aiRetry,
  returnFocus: elements.more,
  beforeOpen: () => setMoreMenuOpen(false),
});
const undoDialog = createOverlayDialog({
  root: elements.undoRequest,
  surface: elements.undoDialog,
  dismissible: false,
  initialFocus: elements.undoReject,
  returnFocus: elements.more,
  beforeOpen: () => setMoreMenuOpen(false),
});
const stoneDrag = createGoStoneDrag({
  sources: elements.bowls,
  board: elements.board,
  stone: elements.dragStone,
  getPoint: (row, column) => points[(row - 1) * boardSize + column - 1],
  getIntersection: (position, rect, size) => sceneView.getIntersection(position, rect, size),
  onPickup: clearPendingMove,
  onPlay: point => sendAction({ type: "play", ...point }),
});
const sceneView = createGoSceneView({ root: elements.gameScreen, board: elements.board,
  bowls: elements.bowls,
  onUnavailable: () => stoneDrag.cancel(),
  onViewChange() { stoneDrag.cancel(); clearPendingMove(); },
});

async function handleReady(message) {
  canCreateRoom = message.capabilities?.includes("rooms.create") ?? false;
  playMode = message.mode ?? "room";
  playerId = message.playerId;
  renderStartScreen();
  historyStorage = await initializeGoStorage(client);
  platformReady = true;
  if (roomState) enterRoom(roomState);
  renderStartScreen();
  for (const update of pendingRoomStates.splice(0)) handleState(update);
}

function renderStartScreen(message = "") {
  if (menuVisible) stoneDrag.cancel();
  elements.gameScreen.hidden = menuVisible;
  sceneView.setVisible(!menuVisible);
  elements.gameBack.hidden = menuVisible || playMode !== "solo";
  elements.gameBack.setAttribute("aria-label", reviewingRecord ? "返回棋谱" : "返回首页");
  elements.gameBackSpacer.hidden = elements.gameBack.hidden;
  document.querySelector(".game-header").hidden = menuVisible;
  const record =
    menuVisible && platformReady
      ? latestGoResumeRecord(historyStore.load())
      : undefined;
  startScreen.render({
    visible: menuVisible,
    ready: platformReady,
    busy: creatingRoom || startingAi || Boolean(pendingAction),
    creatingRoom,
    room: Boolean(roomState),
    canCreateRoom,
    standalone: isStandalone,
    resumeId: record?.id,
    resumeLabel: record ? goResumeModeLabel(record) : "",
    starting: startingAi,
    message: message || (platformReady && roomState ? "等待房间开始…" : ""),
  });
}

function isSetupMenu() {
  return menuVisible && startScreen.page !== "home";
}

function isAiMenu() {
  return menuVisible && startScreen.page === "ai";
}

function showStartScreen() {
  pendingRoomStates.length = 0;
  persistSoloResumeSnapshot();
  recordReview.close();
  reviewingRecord = undefined;
  elements.gameScreen.classList.remove("is-record-review");
  if (isAiMenu()) goAi.destroy();
  else goAi.cancel();
  menuVisible = true;
  startScreen.show("home");
  playMode = "solo";
  state = undefined;
  roomState = undefined;
  pendingAction =
    settingsRequestId =
    queuedSettings =
    draftSettings =
      undefined;
  replayGameKey = "";
  replayFrames = [];
  replayIndex = undefined;
  clearPendingMove();
  clearSetupFeedback();
  setSetupOpen(false);
  setMoreMenuOpen(false);
  setHistoryOpen(false);
  setGameInfoOpen(false);
  resultDialog.reset();
  aiErrorDialog.setOpen(false);
  undoDialog.setOpen(false);
  window.clearTimeout(actionFeedbackTimer);
  elements.actionFeedback.classList.remove("is-visible");
  renderStartScreen();
}

function startLocalGame(opponent) {
  if (!platformReady || creatingRoom || roomState) return;
  playMode = "solo";
  menuVisible = true;
  startScreen.show(opponent);
  setupSource = "new";
  playerId = "solo-player-1";
  localMatchId = `solo-${crypto.randomUUID()}`;
  localVersion = 0;
  const initial = applySoloGoAction(createSoloGoState(), {
    type: "update_settings",
    ...DEFAULT_GO_SETTINGS,
    opponent,
    aiModel: DEFAULT_GO_AI_MODEL_ID,
  });
  renderStartScreen();
  handleState({
    playerId,
    state: initial.state,
    events: [],
    matchId: localMatchId,
    version: localVersion,
    serverTime: Date.now(),
  });
  if (opponent === "ai")
    goAi
      .prepare(initial.state.settings.size, DEFAULT_GO_AI_MODEL_ID)
      .catch(() => {});
}

function enterRoom(next) {
  if (!next) return;
  if (playMode !== "room") {
    persistSoloResumeSnapshot();
    goAi.cancel();
    state = undefined;
    pendingAction =
      settingsRequestId =
      queuedSettings =
      draftSettings =
        undefined;
    setupSource = "new";
    setSetupOpen(false);
  }
  playMode = "room";
  roomState = next;
  renderStartScreen();
}

async function createOnlineRoom() {
  if (isStandalone) {
    const url = new URL("https://play.longern.com/");
    url.searchParams.set(
      "game",
      new URL("./playweft.json", location.href).href,
    );
    window.location.assign(url);
    return;
  }
  if (!canCreateRoom || creatingRoom || roomState) return;
  creatingRoom = true;
  renderStartScreen();
  let errorMessage = "";
  try {
    await historyStorage.flush();
    enterRoom(
      await client.createRoom({
        minPlayers: 2,
        maxPlayers: 2,
        lobby: "platform",
      }),
    );
  } catch (error) {
    errorMessage = error.message || "创建房间失败，请重试";
  } finally {
    creatingRoom = false;
    renderStartScreen(errorMessage);
  }
}

function handleState(message) {
  menuVisible =
    startScreen.page !== "home" &&
    playMode === "solo" &&
    message.state.phase === "setup";
  renderStartScreen();
  clearPendingMove();
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
  updateAiTurn();
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
  updateAiTurn();
}

function handleError(error, code, requestId) {
  if (menuVisible) {
    renderStartScreen(translateError(error, code));
    return;
  }
  if (settingsRequestId && requestId === settingsRequestId) {
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
  if (pendingAction && requestId === pendingAction.requestId) {
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
  void Promise.resolve(historyStorage?.flush())
    .catch(() => {})
    .finally(() => client?.destroy());
  goAi.destroy();
  recordReview.close();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) recordReview.pause();
  if (document.visibilityState === "hidden") persistSoloResumeSnapshot();
  updateAiTurn();
});
elements.aiRetry.addEventListener("click", () => {
  aiErrorDialog.setOpen(false);
  goAi.retry();
  updateAiTurn();
});
elements.aiErrorOpen.addEventListener("click", () => aiErrorDialog.setOpen(true));
elements.setupBack.addEventListener("click", () => {
  if (isSetupMenu()) setSetupOpen(false);
  else showStartScreen();
});
elements.setupPanel.addEventListener("click", (event) => {
  if (isSetupMenu() && event.target === elements.setupPanel)
    setSetupOpen(false);
});
elements.setupPanel.addEventListener("cancel", () => {
  if (isSetupMenu()) setSetupOpen(false);
});
elements.home.addEventListener("click", showStartScreen);
elements.gameBack.addEventListener("click", () => {
  const returnToHistory = Boolean(reviewingRecord);
  showStartScreen();
  if (returnToHistory) setHistoryOpen(true);
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
  if (isSetupMenu()) {
    syncSetupSettings();
    setSetupOpen(false);
  } else startConfiguredGame();
});

async function startConfiguredGame() {
  if (startingAi || pendingAction) return;
  if (!elements.setupForm.checkValidity()) {
    setSetupOpen(true);
    elements.setupForm.reportValidity();
    return;
  }
  clearSetupFeedback();
  if (setupSource === "resume") {
    if (playMode === "solo" && selectedResumeRecordId) {
      resumeHistoryRecord(selectedResumeRecordId);
      return;
    }
    showSetupFeedback("这份棋谱暂时无法在房间中续下", "error");
    return;
  }
  const settings = readSetupSettings();
  if (playMode === "solo" && settings.opponent === "ai") {
    startingAi = true;
    render(state);
    renderAiFeedback();
    try {
      await goAi.prepare(settings.size, settings.aiModel);
    } catch {
      startingAi = false;
      render(state);
      renderAiFeedback();
      return;
    }
    startingAi = false;
  }
  queuedSettings = undefined;
  draftSettings = undefined;
  const sent = sendAction(
    {
      type: "start",
      ...settings,
    },
    false,
  );
  if (!sent) {
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  showSetupFeedback("正在创建对局…", "pending");
  setSetupOpen(false);
}
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
  if (
    elements.opponentSetting.value === "ai" &&
    (event.target === elements.opponentSetting ||
      event.target === elements.aiDifficulty)
  ) {
    goAi
      .prepare(Number(elements.sizeSetting.value), elements.aiDifficulty.value)
      .catch(() => {});
  }
  if (event.target === elements.rulesSetting) {
    const previousRules = (draftSettings || state?.settings || preview.settings)
      .rules;
    if (Number(elements.komiSetting.value) === defaultGoKomi(previousRules)) {
      elements.komiSetting.value = String(
        defaultGoKomi(elements.rulesSetting.value),
      );
    }
  }
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
elements.resultOpen.addEventListener("click", () => resultDialog.open());
elements.settings.addEventListener("click", () => {
  setMoreMenuOpen(false);
  sendAction({ type: "configure" });
});
elements.historyOpen.addEventListener("click", () => {
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
elements.portraitReplay.addEventListener("click", () => setReplayOpen(!isReplayOpen()));
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
  const reviewButton = event.target.closest("[data-history-review]");
  if (reviewButton) { openHistoryReview(reviewButton.dataset.historyReview); return; }
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
  if (event.key === "Escape") stoneDrag.cancel();
  if (event.key === "Escape" && isSetupMenu()) {
    event.preventDefault();
    if (startingAi) return;
    if (setupDialog.isOpen) setSetupOpen(false);
    else showStartScreen();
    return;
  }
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
  renderStartScreen();
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
  if (reviewingRecord) return false;
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
  if (reviewingRecord && !open) return;
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
  updateAiTurn();
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
  if (reviewingRecord) recordReview.select(selectedIndex);
  const replayRatio = latestIndex > 0 ? selectedIndex / latestIndex : 0;
  elements.replayOpen.disabled = replayFrames.length <= 1;
  elements.portraitReplay.disabled = elements.replayOpen.disabled;
  elements.portraitReplay.querySelector("span").textContent = isReplayOpen() ? "退出回看" : "回看对局";
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
  if (menuVisible) {
    if (isSetupMenu() && nextState.phase === "setup") renderSetup(nextState);
    return;
  }
  elements.home.hidden = playMode !== "solo";
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const isSetup = nextState.phase === "setup";
  const actionPending = Boolean(pendingAction);
  const currentIndex = Number(nextState.current) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const ended = Boolean(nextState.ended);
  const isScoring = nextState.phase === "scoring";
  elements.resultOpen.hidden = Boolean(reviewingRecord) || (!ended && !isScoring);
  if (!reviewingRecord) resultDialog.update(nextState, {
    key: replayGameKey,
    participant: ownIndex >= 0,
    local: playMode === "solo",
    busy: actionPending,
  });
  if (elements.gameInfoPanel.open) renderGameInfo(nextState);
  const tableView = goTableView(nextState, { mode: playMode, playerId });
  for (const bowl of elements.bowls) {
    const near = Number(bowl.dataset.color) === tableView.nearColor;
    bowl.classList.toggle("stone-bowl--near", near);
    bowl.classList.toggle("stone-bowl--far", !near);
  }
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
  elements.board.dataset.animateMoves = String(!isReplayOpen() && nextState.phase === "playing");
  renderPlayerCards(nextState, currentIndex, ended, tableView.players);
  renderMoveLog(size);

  if (isSetup) {
    stoneDrag.update({ enabled: false });
    elements.undo.disabled = true;
    undoDialog.setOpen(false);
    renderSetup(nextState, ownIndex);
    renderSetupBoard(nextState, size);
    elements.replayOpen.disabled = true;
    elements.portraitReplay.disabled = true;
    setSetupOpen(!actionPending);
    return;
  }
  setSetupOpen(false);
  clearSetupFeedback();

  const undoRequest = nextState.undoRequest;
  const hasUndoRequest = Boolean(undoRequest);
  const undoRequesterIndex = Number(undoRequest?.requesterIndex) - 1;
  const isUndoRequester = hasUndoRequest && undoRequesterIndex === ownIndex;
  const previewColor = tableView.currentColor;
  const canAct =
    !reviewingRecord &&
    Boolean(state) &&
    !ended &&
    !isScoring &&
    !hasUndoRequest &&
    (playMode === "solo"
      ? nextState.settings?.opponent !== "ai" || currentIndex === 0
      : ownIndex === currentIndex) &&
    !actionPending &&
    !isReviewingPast;
  const canResign =
    !reviewingRecord &&
    Boolean(state) &&
    !ended &&
    !isScoring &&
    (playMode === "solo" || ownIndex >= 0) &&
    !actionPending &&
    !isReviewingPast;
  stoneDrag.update({
    enabled: canAct && !isReplayOpen(),
    currentColor: tableView.currentColor,
    size,
    key: `${replayGameKey}:${nextState.moves}:${nextState.current}`,
  });

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
  const canUndoAi =
    playMode === "solo" && nextState.settings?.opponent === "ai";
  const canUndo =
    !reviewingRecord &&
    Boolean(state) &&
    (canUndoAi || (!ended && !isScoring)) &&
    !hasUndoRequest &&
    Boolean(nextState.undoAvailable) &&
    Number(nextState.moves) > 0 &&
    !actionPending &&
    !isReviewingPast &&
    (playMode === "solo" ||
      Number(nextState.lastEvent?.playerIndex) - 1 === ownIndex);
  elements.undo.disabled = !canUndo;
  elements.undoLabel.textContent = isUndoRequester ? "等待同意" : "悔棋";
  const respondToUndo = playMode !== "solo" && hasUndoRequest && !isUndoRequester && ownIndex >= 0 && !ended;
  if (respondToUndo) {
    const requesterName =
      nextState.playerNames?.[undoRequesterIndex] ||
      (undoRequesterIndex === blackIndex ? "黑方" : "白方");
    elements.undoRequestLabel.textContent = `${requesterName}请求悔棋`;
    elements.undoAccept.disabled = actionPending;
    elements.undoReject.disabled = actionPending;
  }
  undoDialog.setOpen(respondToUndo);
  elements.pass.disabled = !canAct;
  elements.resign.disabled = !canResign;
  elements.resign.hidden = ended || isScoring;
  if (!canResign) resetResignConfirmation();
  elements.settings.hidden = Boolean(reviewingRecord) || !state || !ended || ownIndex < 0;
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
  currentIndex,
  ended,
  colorPlayers,
) {
  colorPlayers.forEach(({ playerIndex, label, color, near }, panelIndex) => {
    const panel = elements.players[panelIndex];
    const savedName =
      playMode === "solo" && nextState.settings?.opponent === "ai"
        ? playerIndex === 0
          ? "你"
          : goAiPlayerName({
              ...nextState.settings,
              aiModel: resolveGoAiModelId(nextState.settings.aiModel),
            })
        : nextState.playerNames?.[playerIndex];
    const name =
      typeof savedName === "string" && savedName.trim()
        ? savedName.trim()
        : label;
    panel.querySelector("[data-player-name]").textContent = name;
    panel.classList.toggle("is-near", near);
    panel.classList.toggle("is-far", !near);
    const detail = panel.querySelector("[data-player-detail]");
    if (reviewingRecord) {
      detail.textContent = `提子 ${Number(nextState.captures?.[playerIndex]) || 0}`;
    } else if (ended && nextState.lastEvent?.kind === "resigned") {
      detail.textContent =
        Number(nextState.winnerIndex) - 1 === playerIndex ? "获胜" : "已认输";
    } else if (ended && nextState.scores) {
      const score =
        color === 1 ? nextState.scores.black : nextState.scores.white;
      const result =
        Number(nextState.winnerIndex) === 0
          ? " · 和棋"
          : nextState.scores.black === nextState.scores.white &&
              Number(nextState.winnerIndex) - 1 === playerIndex
            ? " · 获胜"
            : "";
      detail.textContent = `${formatScore(score)} 目${result}`;
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
    if (isReplayOpen() && !reviewingRecord) setReplayOpen(false);
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
  const setupMenu = isSetupMenu();
  elements.setupPanel.classList.toggle(
    "overlay-dialog--sheet-narrow",
    setupMenu,
  );
  elements.setupBack.hidden = playMode !== "solo";
  elements.setupBack.setAttribute(
    "aria-label",
    setupMenu
      ? startScreen.page === "ai"
        ? "返回人机对战"
        : "返回本地双人"
      : "返回启动页",
  );
  elements.setupBack.disabled = startingAi || Boolean(pendingAction);
  const hostId = nextState.hostId ?? nextState.players?.[0];
  const isHost =
    Boolean(state) && (nextState.canConfigure ?? playerId === hostId);
  const canConfigure = isHost && !pendingAction && !startingAi;
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
  elements.opponentSettings.hidden = playMode !== "solo" || setupMenu;
  elements.sourceSetting.closest(".settings-list").hidden = setupMenu;
  elements.opponentSetting.value = settings.opponent ?? "local";
  elements.opponentSetting.disabled = !canConfigure || setupSource === "resume";
  const aiMatch = playMode === "solo" && settings.opponent === "ai";
  elements.aiDifficultyField.hidden = elements.aiDifficultyDivider.hidden =
    !aiMatch;
  elements.aiDifficulty.value = resolveGoAiModelId(settings.aiModel);
  startScreen.setDifficulty(elements.aiDifficulty.value);
  elements.aiDifficulty.disabled = !canConfigure || setupSource === "resume";
  elements.blackSetting.querySelector('[value="player1"]').textContent = aiMatch
    ? "我执黑"
    : "玩家 1 执黑";
  elements.blackSetting.querySelector('[value="player2"]').textContent = aiMatch
    ? "AI 执黑"
    : "玩家 2 执黑";
  elements.setupNote.textContent = isHost
    ? playMode === "solo"
      ? aiMatch
        ? "首次使用需下载 AI 资源，请稍候"
        : "本机控制黑白双方轮流落子"
      : "调整会立即同步给另一方，确认后开始"
    : "设置会随房主调整实时更新";
  elements.sizeSetting.value = String(settings.size ?? 19);
  elements.rulesSetting.value = settings.rules ?? "chinese";
  elements.komiSetting.value = String(
    settings.komi ?? defaultGoKomi(settings.rules),
  );
  elements.tieBreakSetting.value = settings.tieBreak ?? "white";
  elements.blackSetting.value = settings.blackMode ?? "random";
  elements.handicapSetting.value = String(settings.handicap ?? 0);
  const controls = [
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.tieBreakSetting,
    elements.blackSetting,
    elements.handicapSetting,
    elements.start,
  ];
  for (const control of controls) {
    control.disabled = !canConfigure || setupSource === "resume";
  }
  elements.start.disabled = !canConfigure;
  elements.startLabel.textContent =
    pendingAction || startingAi
      ? "正在开始…"
      : setupMenu
        ? "保存设置"
        : setupSource === "resume"
          ? "继续对局"
          : "开始对局";
  updateHandicapControls();
  renderSettingValues();
  if (setupMenu) renderStartScreen();
  renderAiFeedback();
}

function renderSettingValues() {
  for (const select of elements.setupForm.querySelectorAll("select")) {
    const option = select.selectedOptions[0];
    const value = select
      .closest(".setting-field")
      .querySelector(".setting-value");
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
    ...(playMode === "solo"
      ? [
          [
            "对战",
            settings.opponent === "ai" ? "人机对战 · 本地 AI" : "本机双人",
          ],
        ]
      : []),
    ["棋盘", `${settings.size ?? 19} × ${settings.size ?? 19}`],
    ["规则", ruleLabel(settings)],
    ["贴目", `${formatScore(settings.komi)} 目`],
    ["平分判定", goTieBreakLabel(settings.tieBreak)],
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

    const reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.className = "history-review";
    reviewButton.dataset.historyReview = record.id;
    reviewButton.textContent = "回看";
    reviewButton.disabled = Boolean(record.partial);
    if (record.partial) reviewButton.title = "这份棋谱记录不完整，暂时无法回看";
    buttons.append(reviewButton);

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

async function resumeHistoryRecord(recordId) {
  if (playMode !== "solo" || pendingAction || startingAi) return;
  persistSoloResumeSnapshot();
  const record = historyStore.load().find((entry) => entry.id === recordId);
  const resumedAt = Date.now();
  const resumedState = restoreGoResumeState(record, resumedAt);
  if (!record?.matchId || !resumedState) {
    if (menuVisible) renderStartScreen();
    renderHistory();
    return;
  }
  if (resumedState.settings.opponent === "ai") {
    startingAi = true;
    if (menuVisible) renderStartScreen();
    goAi.cancel();
    try {
      resumedState.settings.aiModel = resolveGoAiModelId(
        resumedState.settings.aiModel,
      );
      resumedState.playerNames = ["你", goAiPlayerName(resumedState.settings)];
      await goAi.prepare(
        resumedState.board.length,
        resumedState.settings.aiModel,
      );
    } catch {
      startingAi = false;
      if (menuVisible) {
        renderStartScreen("AI 准备失败，请再次点击“继续对局”重试");
        return;
      }
      renderAiFeedback();
      showActionError("AI 准备失败，请再次点击“继续对局”重试");
      return;
    }
    startingAi = false;
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

function openHistoryReview(recordId) {
  const record = historyStore.load().find(entry => entry.id === recordId);
  if (!record || pendingAction || startingAi || roomState) return;
  const replay = goRecordToReview(record);
  if (!replay || replay.frames.length <= 1) {
    showActionError("这份棋谱记录不完整，暂时无法回看");
    return;
  }
  goAi.destroy();
  reviewingRecord = record;
  playMode = "solo";
  menuVisible = false;
  state = { ...replay.state, phase: "review", ended: true,
    settings: { ...replay.state.settings, opponent: "local" },
    timeUsed: [...(record.timeUsed ?? [0, 0])], turnStartedAt: 0,
    playerNames: replay.state.blackIndex === 1
      ? [record.blackPlayer, record.whitePlayer] : [record.whitePlayer, record.blackPlayer],
  };
  playerId = undefined;
  replayGameKey = `review:${record.id}`;
  replayFrames = replay.frames;
  hideReplayImmediately();
  elements.gameScreen.classList.add("is-record-review");
  recordReview.open(goRecordAnalysisKey(record, GO_AI_MODELS.b18?.url), replayFrames.length, index => {
    const frame = replayFrames[index];
    return goAiPosition({ ...state, board: frame.board, moves: frame.moveNumber, current: frame.current },
      replayFrames.slice(0,index+1));
  }, record.analysis);
  setHistoryOpen(false);
  renderStartScreen();
  setReplayOpen(true);
}

function persistSoloResumeSnapshot() {
  if (reviewingRecord) return;
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
  elements.setupFeedback.classList.toggle("is-visible", mode === "error");
  if (mode === "error") elements.setupFeedback.textContent = message;
  elements.startLabel.textContent =
    mode === "pending" ? "正在开始…" : isSetupMenu() ? "保存设置" : "开始对局";
}

function clearSetupFeedback() {
  elements.setupFeedback.classList.remove("is-visible");
  elements.startLabel.textContent = isSetupMenu() ? "保存设置" : "开始对局";
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
    elements.opponentSetting,
    elements.aiDifficulty,
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.tieBreakSetting,
    elements.blackSetting,
    elements.handicapSetting,
  ].includes(target);
}

function readSetupSettings() {
  return {
    ...(playMode === "solo"
      ? {
          opponent: elements.opponentSetting.value,
          ...(elements.opponentSetting.value === "ai"
            ? { aiModel: elements.aiDifficulty.value }
            : {}),
        }
      : {}),
    size: Number(elements.sizeSetting.value),
    rules: elements.rulesSetting.value,
    komi: Number(elements.komiSetting.value),
    tieBreak: elements.tieBreakSetting.value,
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
    (left.opponent ?? "local") === (right.opponent ?? "local") &&
    (left.aiModel ?? "b6") === (right.aiModel ?? "b6") &&
    Number(left.size) === Number(right.size) &&
    left.rules === right.rules &&
    (left.tieBreak ?? "white") === (right.tieBreak ?? "white") &&
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
    INVALID_TIE_BREAK: "平分判定无效",
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
  if (resultDialog.showError(message)) return;
  if (state?.phase === "setup") {
    showSetupFeedback(message, "error");
    return;
  }
  elements.actionFeedback.textContent = message;
  elements.actionFeedback.classList.add("is-visible");
  window.clearTimeout(actionFeedbackTimer);
  actionFeedbackTimer = window.setTimeout(() => {
    elements.actionFeedback.classList.remove("is-visible");
  }, 4000);
}
