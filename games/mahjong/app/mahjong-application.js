// Application composition lives here; main.js is the package entry only.
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Cog,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Pause,
  Play,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SkipBack,
  SkipForward,
  Trash2,
  X,
  createIcons,
} from "lucide";
import { createPlayweftClient } from "../../../src/playweft-client.js";
import {
  AI_DELAY_MS,
  AUTO_DECISION_DELAY_MS,
  HUMAN_ID,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
} from "../rules/constants.js";
import { MahjongDomView } from "./dom-view.js";
import { createMahjongSessionController } from "./session-controller.js";
import { createMahjongRoomPlayerProfiles } from "./room-player-profiles.js";
import { createMahjongRoomPlayerPresentations } from "./room-player-identities.js";
import { createMahjongRoomController } from "./room-controller.js";
import { bindFixedViewport } from "./fixed-viewport.js";
import {
  asArray,
  blankDoubleClickAction,
  errorMessage,
} from "../rules/game-format.js";
import { MahjongThreeRenderer } from "../three-renderer.js";
import { MahjongResultHandRenderer } from "../result/result-hand-renderer.js";
import { MahjongPresentationController } from "./presentation-controller.js";
import { createMahjongThemeController } from "../theme/theme-controller.js";
import { createMahjongTableController } from "./table-controller.js";
import { createMahjongEffectRunner } from "./effect-runner.js";
import { createMahjongTransientNotice } from "./transient-notice.js";
import { createMahjongReplayController } from "./replay-controller.js";
import { createMahjongPlayerPresentationStore } from "./player-presentation-store.js";
import { applyMahjongReplayPlayerPresentations } from "./replay-player-presentations.js";
import { createMahjongPageLifecycle } from "./page-lifecycle.js";
import { createMahjongSoloMatchController } from "./solo-match-controller.js";
import { createMahjongConnectionStatus } from "./connection-status.js";
import { createMahjongSoloSaveController } from "./solo-save-controller.js";
import { createMahjongAutoActionController } from "./auto-action-controller.js";
import { createMahjongSetupScreenController } from "./setup-screen-controller.js";
import { createMahjongMatchCoordinator } from "./match-coordinator.js";
import { bindMahjongUi } from "./ui-bindings.js";
import { createMahjongSettingsDialog } from "../settings-dialog.js";
import { createMahjongHelpIframePortal } from "./help-iframe-portal.js";
import { createMahjongOfflineResourceController } from "./offline-resource-controller.js";
import { MahjongMatchMusic } from "../theme/match-music.js";
import {
  deferMahjongDecorativeAssets,
  deferMahjongImageAssets,
} from "../theme/deferred-visual-assets.js";
import discardSoundSource from "../assets/audio/discard-sound.js";
import defaultTableBackgroundUrl from "../assets/moonlit-table-v3.jpg?url";
import defaultPortraitsUrl from "../assets/player-portraits-v1.jpg?url";
import defaultResultTableclothUrl from "../assets/felt-skin-moonwave-v1.jpg?url";
import defaultLobbyBackgroundUrl from "../assets/waiting-evening-v1.jpg?url";
import defaultLobbySignpostUrl from "../assets/waiting-signpost-v3.webp?url";
import defaultPaipuNotebookUrl from "../assets/paipu-notebook-v1.jpg?url";
import defaultTileFacesUrl from "../assets/tiles/riichi-faces.webp?url";
import { DEFAULT_MATCH_MUSIC_VOLUME } from "../theme/media-config.js";
import {
  notifyGameOfflineSettings,
  readGameOfflineSettings,
  registerMahjongOfflineServiceWorker,
} from "../../../src/game-offline-cache.js";
import {
  readMahjongSoloSave,
  setMahjongSoloOpponentPortraits,
} from "../replay/solo-save.js";
import {
  listMahjongPaipuSummaries,
  loadMahjongPaipu,
  saveMahjongPaipu,
  setMahjongPaipuPinned,
} from "../replay/paipu-store.js";
import { createMahjongCompletedPaipuSaver } from "../replay/completed-paipu.js";
import { createMahjongPaipuPanel } from "../replay/paipu-panel.js";
import { mahjongInitialEntry } from "./entry-flow.js";

export function createMahjongApplication({
  document = globalThis.document,
  window = globalThis.window,
} = {}) {
  const lucideIcons = {
    ChevronLeft,
    ChevronRight,
    ChevronsUpDown,
    Cog,
    Download,
    Eye,
    EyeOff,
    LoaderCircle,
    Pause,
    Play,
    SignalHigh,
    SignalLow,
    SignalMedium,
    SkipBack,
    SkipForward,
    Trash2,
    X,
  };
  createIcons({ icons: lucideIcons, root: document });

  deferMahjongDecorativeAssets({
    document,
    window,
    urls: {
      "--mahjong-default-portrait-image": defaultPortraitsUrl,
      "--mahjong-default-table-background-image": defaultTableBackgroundUrl,
      "--mahjong-result-tablecloth-image": defaultResultTableclothUrl,
      "--mahjong-setup-background-image": defaultLobbyBackgroundUrl,
      "--mahjong-tile-face-image": defaultTileFacesUrl,
    },
  });
  deferMahjongImageAssets({
    document,
    window,
    urls: {
      signpost: defaultLobbySignpostUrl,
      "paipu-notebook": defaultPaipuNotebookUrl,
    },
  });

  const effectRunner = createMahjongEffectRunner();
  const isStandalone = window.parent === window;
  let roomPlayerProfiles;
  let roomPlayerPresentations;
  let roomController;
  let session;
  let tableController;
  let playweftClient;
  let connectionStatus;
  let replayController;
  let soloController;
  let releaseUiBindings;
  // Static icons are mounted once; dynamic controllers scope later renders.
  connectionStatus = createMahjongConnectionStatus({
    element: document.querySelector("#connection-status"),
    latencyElement: document.querySelector("#connection-latency"),
    resolveIcon: (level) =>
      document.querySelector(`[data-connection-level="${level}"]`),
  });
  const replayPlayerPresentationStore = createMahjongPlayerPresentationStore();
  const soloPlayerPresentationStore = createMahjongPlayerPresentationStore();
  const matchCoordinator = createMahjongMatchCoordinator({
    initialMode: isStandalone ? "solo" : null,
    onModeChange(nextMode, previousMode) {
      if (previousMode === "replay" && nextMode !== "replay") {
        replayPlayerPresentationStore.clear();
      }
      connectionStatus?.setRoomActive(nextMode === "room");
      syncReplayHandVisibilityControl();
    },
  });

  const paipuElements = {
    entry: document.querySelector(".setup-paipu-entry"),
    panel: document.querySelector("#paipu-panel"),
    card: document.querySelector(".paipu-card"),
    close: document.querySelector("#paipu-close-button"),
    list: document.querySelector("#paipu-list"),
    empty: document.querySelector("#paipu-empty"),
  };

  const replayElements = {
    controls: document.querySelector("#paipu-playback-controls"),
    previousHand: document.querySelector("#paipu-replay-previous-hand"),
    nextHand: document.querySelector("#paipu-replay-next-hand"),
    status: document.querySelector("#paipu-replay-status"),
    speed: document.querySelector("#paipu-replay-speed"),
    stepBack: document.querySelector("#paipu-replay-step-back"),
    toggle: document.querySelector("#paipu-replay-toggle"),
    stepForward: document.querySelector("#paipu-replay-step-forward"),
    progress: document.querySelector("#paipu-replay-progress"),
    stepStatus: document.querySelector("#paipu-replay-step-status"),
    handVisibility: document.querySelector("#replay-hand-visibility-button"),
  };

  const paipuPanel = createMahjongPaipuPanel({
    document,
    window,
    elements: paipuElements,
    getGame: matchCoordinator.getGame,
    getPlayMode: matchCoordinator.getMode,
    listMahjongPaipuSummaries,
    setMahjongPaipuPinned,
    onReplay: (id) => replayMahjongPaipu(id),
  });
  const saveCompletedPaipu = createMahjongCompletedPaipuSaver({
    save: saveMahjongPaipu,
  });
  const soloSaveController = createMahjongSoloSaveController({
    initialSave: readMahjongSoloSave(),
    humanId: HUMAN_ID,
    getThemeController: () => themeController,
    saveCompletedPaipu,
  });

  const matchMusic = new Audio();
  matchMusic.loop = true;
  matchMusic.preload = "metadata";
  matchMusic.volume = DEFAULT_MATCH_MUSIC_VOLUME;
  const riverTileSound = new Audio(discardSoundSource);
  riverTileSound.preload = "auto";
  const defaultMusicCopyright = document.querySelector(
    "#default-bgm-copyright",
  );

  const releaseFixedViewport = bindFixedViewport(
    document.querySelector("#mahjong-viewport"),
    document.querySelector("#mahjong-app"),
  );
  const domView = new MahjongDomView({
    onAction: (action) =>
      tableController ? tableController.submitAction(action) : dispatch(action),
    onSelectTile: (tileId) => tableController?.selectTile(tileId),
    onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
    onTenpaiPreviewStart: (pointerId) =>
      tableController?.beginConfirmedTenpaiPreview(pointerId),
    onTenpaiPreviewEnd: (pointerId) =>
      tableController?.endConfirmedTenpaiPreview(pointerId),
  });
  const { elements } = domView;
  const transientNotice = createMahjongTransientNotice({
    element: elements.transientNotice,
    window,
  });
  const helpIframePortal = createMahjongHelpIframePortal({
    template: elements.settingsHelpFrameTemplate,
    slot: elements.settingsHelpFrameSlot,
    panel: elements.settingsHelpPanel,
    dialog: elements.settingsDialog,
    viewport: document.querySelector("#mahjong-viewport"),
  });
  const setupScreen = createMahjongSetupScreenController({
    window,
    elements,
    closePaipuPanel,
    transientNotice,
  });
  const offlineResourceController = createMahjongOfflineResourceController({
    button: document.querySelector("#mahjong-offline-action-button"),
    feedback: document.querySelector("#mahjong-offline-feedback"),
    createIconsImpl: createIcons,
    confirm: (message) =>
      isStandalone ? window.confirm(message) : playweftClient?.confirm(message),
    extraUrls: [
      defaultTileFacesUrl,
      defaultPortraitsUrl,
      defaultTableBackgroundUrl,
    ],
  });
  const settingsDialog = createMahjongSettingsDialog({
    trigger: elements.settingsButton,
    root: elements.settingsDialog,
    surface: elements.settingsDialogCard,
    closeButton: elements.settingsClose,
    returnButton: elements.settingsReturn,
    endMatchButton: elements.settingsEndMatch,
    tabButtons: elements.settingsTabs,
    tabPanels: elements.settingsPanels,
    gameHints: elements.gameHints,
    autoWinAfterRiichi: elements.autoWinAfterRiichi,
    doubleClickTsumogiri: elements.doubleClickTsumogiri,
    doubleClickPass: elements.doubleClickPass,
    discardVolume: elements.riverTileVolume,
    discardVolumeValue: elements.riverTileVolumeValue,
    masterVolume: elements.masterVolume,
    masterVolumeValue: elements.masterVolumeValue,
    musicVolume: elements.musicVolume,
    musicVolumeValue: elements.musicVolumeValue,
    voiceVolume: elements.voiceVolume,
    voiceVolumeValue: elements.voiceVolumeValue,
    avatarSourcePreference: elements.avatarSourcePreference,
    offlinePolicy: document.querySelector("#mahjong-offline-policy-setting"),
    offlineAction: document.querySelector("#mahjong-offline-action-button"),
    onMusicVolumeChange: () => tableController?.applyAudioVolumes(),
    onMasterVolumeChange: () => tableController?.applyAudioVolumes(),
    onVoiceVolumeChange: () => tableController?.applyAudioVolumes(),
    onGameHintsChange: () => tableController?.renderCurrentState(),
    onAvatarSourcePreferenceChange: () => {
      if (matchCoordinator.getMode() === "replay") {
        void applyReplayPlayerPresentations(
          matchCoordinator.getReplayState()?.record,
        );
        return;
      }
      const currentState = tableController?.getState?.();
      if (
        (matchCoordinator.getMode() === "solo" && matchCoordinator.getGame()) ||
        (matchCoordinator.getMode() === "room" &&
          currentState?.phase !== "lobby")
      )
        return;
      themeController?.applyPackAvatars?.();
      if (matchCoordinator.getMode() === "room")
        roomController?.syncPlayerPresentation?.();
    },
    onEndMatch: () => {
      if (matchCoordinator.getMode() === "replay")
        void exitMahjongPaipuReplay();
      else void endSoloMatch();
    },
    onOfflinePolicyChange: (policy) =>
      notifyGameOfflineSettings("mahjong", {
        ...readGameOfflineSettings("mahjong"),
        policy,
      }),
    onOfflineAction: () => void offlineResourceController.handleAction(),
    getAdditionalFocusable: () => helpIframePortal.getFocusableElements(),
    onOpenChange: (open) =>
      helpIframePortal.setActive(open && elements.settingsHelpPanel?.hidden === false),
    onTabChange: (name) => helpIframePortal.setActive(name === "help"),
  });
  const autoActionController = createMahjongAutoActionController({
    elements,
    settingsDialog,
    getMode: matchCoordinator.getMode,
    getSession: () => session,
    getRoomController: () => roomController,
    getSoloSave: () => soloSaveController.get(),
    setSoloSave: (save) => soloSaveController.set(save),
    scheduleAi,
  });

  void registerMahjongOfflineServiceWorker().then(() => {
    notifyGameOfflineSettings("mahjong");
  });
  const matchMusicController = new MahjongMatchMusic({
    audio: matchMusic,
    getVolumeScale: () =>
      settingsDialog.masterVolumeScale * settingsDialog.musicVolumeScale,
    fadeDuration: 800,
  });
  const presentation = new MahjongPresentationController({
    onHandInsertionReady: () => tableController?.renderCurrentState(),
    onKanDrawReady: () => {
      tableController?.renderCurrentState();
      session?.scheduleAi();
    },
    onResultReady: () => {
      tableController?.renderPresentationOverlays();
      replayController?.onResultReady();
      replayController?.renderControls();
    },
    onDrawRevealReady: () => tableController?.renderPresentationOverlays(),
  });
  const visualRenderer = new MahjongThreeRenderer(elements.stage, {
    onSelectTile: (tileId) => tableController?.selectTile(tileId),
    onClearSelection: () => tableController?.clearSelectedTile(),
    onPreviewDragTile: (tileId) =>
      tableController?.beginDraggedTilePreview(tileId),
    onEndDragPreview: () => tableController?.endDraggedTilePreview(),
    onHandRevealComplete: (key) => tableController?.handRevealSettled(key),
    onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
    onDoubleClickBlank() {
      if (matchCoordinator.getMode() === "replay") return;
      const current = tableController?.getState();
      const action = blankDoubleClickAction({
        doubleClickPassEnabled: settingsDialog.doubleClickPassEnabled,
        passAvailable: !elements.pass.hidden && !elements.pass.disabled,
        doubleClickTsumogiriEnabled: settingsDialog.doubleClickTsumogiriEnabled,
        riichiMode: tableController?.isRiichiMode(),
        canDiscard: current?.legalActions?.canDiscard === true,
        drawnTile: current?.drawnTile,
      });
      if (action) tableController?.submitAction(action);
    },
    onToggleScoreDisplay: () => tableController?.toggleScoreDisplay(),
  });
  const resultHandRenderer = new MahjongResultHandRenderer(
    elements.resultDetailContent,
    {
      handsHost: elements.resultDetailHands,
      yakuHost: elements.resultDetailYaku,
      scoreHost: elements.resultScoreContent,
      startControlHost: elements.rematch,
      onStartButtonClick: () => void tableController?.continueResult(),
      onBlankDoubleClick: () => void tableController?.continueResult(),
    },
  );
  const visualRendererReady = visualRenderer.init().catch((error) => {
    console.error("Mahjong renderer failed", error);
    showLoadingError("图形渲染器加载失败，请刷新页面重试");
  });
  const resultHandRendererReady = resultHandRenderer.init().catch((error) => {
    console.error("Mahjong result hand renderer failed", error);
  });

  const themePackElements = {
    upload: document.querySelector("#settings-theme-upload"),
    uploadZone: document.querySelector(".settings-theme-upload"),
    list: document.querySelector("#settings-theme-list"),
  };
  const appearanceElements = {
    controls: document.querySelector("#settings-appearance-controls"),
  };
  const soundElements = {
    controls: document.querySelector("#settings-sound-controls"),
  };
  const themeController = createMahjongThemeController({
    document,
    window,
    isStandalone,
    confirm: (message) => playweftClient?.confirm(message),
    themeElements: themePackElements,
    appearanceElements,
    soundElements,
    copyrightElement: defaultMusicCopyright,
    waitForRenderers: () =>
      Promise.all([visualRendererReady, resultHandRendererReady]),
    setRendererAppearance: ({ tablecloth, tileBack }) =>
      Promise.all([
        visualRenderer.setAppearance({ tablecloth, tileBack }),
        resultHandRenderer.setAppearance({ tablecloth, tileBack }),
      ]),
    setPlayerIdentityState: (state) => domView.applyPlayerIdentityState(state),
    getAvatarSourcePreference: () => settingsDialog.avatarSourcePreference,
    initialMatchPortraitRequest: soloSaveController.get()
      ? {
          savedPortraits: soloSaveController.get().opponentPortraits,
          randomSeed: soloSaveController.get().randomSeed,
        }
      : undefined,
    isRoomActive: () => matchCoordinator.getMode() === "room",
    onAssetsChanged() {
      tableController?.syncMatchMusic();
      if (matchCoordinator.getMode() === "room")
        roomController?.syncPlayerPresentation();
      const replayState = matchCoordinator.getReplayState();
      if (matchCoordinator.getMode() === "replay" && replayState?.record) {
        void applyReplayPlayerPresentations(replayState.record);
      }
      if (tableController?.getState()) {
        tableController.renderCurrentState();
        if (matchCoordinator.getMode() === "room") {
          void roomPlayerPresentations?.apply(tableController.getState());
        }
      }
    },
  });
  // Create the stable local default before either solo play or room identity is
  // entered. A room later replaces HUMAN_ID with the authoritative player ID.
  themeController.setRoomPlayerIdentity?.(HUMAN_ID);
  tableController = createMahjongTableController({
    document,
    window,
    elements,
    domView,
    visualRenderer,
    resultHandRenderer,
    presentation,
    effectRunner,
    settingsDialog,
    matchMusicController,
    riverTileSound,
    humanId: HUMAN_ID,
    getGame: matchCoordinator.getGame,
    getGameInitializing: matchCoordinator.isGameInitializing,
    getMode: matchCoordinator.getMode,
    getPlayerName: matchCoordinator.getPlayerName,
    playerNameIsAuthoritative: matchCoordinator.playerNameIsAuthoritative,
    getThemeAssetUrl: themeController.getAssetUrl,
    getRoomCharacterVoiceSource: (...args) =>
      roomPlayerPresentations?.resolveCharacterVoice(...args),
    getThemeDefaultNames: themeController.getDefaultNames,
    ensurePlayerPresentations: (state) => {
      if (
        matchCoordinator.getMode() !== "solo" ||
        !Array.isArray(state?.players)
      )
        return;
      const persisted =
        themeController.getPaipuPlayerPresentations?.(
          state.players,
          state.viewerPlayerId ||
            state.players?.[Number(state.viewerSeat) - 1] ||
            HUMAN_ID,
        ) || {};
      soloPlayerPresentationStore.replace(
        new Map(
          Object.entries(persisted).map(([playerId, presentation]) => [
            playerId,
            presentation || {},
          ]),
        ),
      );
    },
    getThemeMatchMusicUrl: themeController.getMatchMusicUrl,
    getThemeRiichiMusicUrl: themeController.getRiichiMusicUrl,
    dispatch: (...args) => session?.dispatch(...args),
    isActionInFlight: () => session?.isActionInFlight() === true,
    scheduleAi: (...args) => session?.scheduleAi(...args),
    onRerollPortraits: async () => {
      if (matchCoordinator.getMode() !== "solo") return;
      await themeController.rerollPortraits(
        crypto.randomUUID().replaceAll("-", ""),
      );
      const soloSave = soloSaveController.get();
      if (matchCoordinator.getMode() !== "solo" || !soloSave) return;
      const next = setMahjongSoloOpponentPortraits(
        soloSave,
        themeController.getPortraits(),
      );
      if (!next) return;
      soloSaveController.write(next);
    },
    onReplayAdvance: (action) => advanceMahjongPaipuReplayFromResult(action),
    onReplayResultExitStart: () => replayController?.onResultExitStart(),
    onReturnToSetup: teardownCompletedSoloMatch,
  });

  roomPlayerProfiles = createMahjongRoomPlayerProfiles({
    isRoom: () => matchCoordinator.getMode() === "room",
    getState: () => tableController?.getState(),
    onChanged: () => void roomPlayerPresentations?.apply(),
    onOwnPlatformPortraitChanged: (source) => {
      const applied =
        roomPlayerPresentations?.setPlatformPortraitSource(source);
      roomController?.syncPlayerPresentation();
      return applied;
    },
  });
  roomPlayerPresentations = createMahjongRoomPlayerPresentations({
    isRoom: () => matchCoordinator.getMode() === "room",
    getState: () => tableController?.getState(),
    getRoomPlayerId: () => roomController?.getPlayerId(),
    getProfile: (playerId) => roomPlayerProfiles?.get(playerId),
    themeController,
    domView,
  });
  resultHandRenderer.setPlayerPresentationProvider({
    get: (context) => {
      if (matchCoordinator.getMode() === "room") {
        return roomPlayerPresentations?.getPlayerPresentation(context);
      }
      if (matchCoordinator.getMode() === "replay") {
        return replayPlayerPresentationStore.get(context);
      }
      if (matchCoordinator.getMode() === "solo") {
        return soloPlayerPresentationStore.get(context);
      }
      return themeController.getPlayerPresentation(context);
    },
    subscribe: (listener) => {
      const unsubscribeRoom =
        roomPlayerPresentations.subscribePlayerPresentations(listener);
      const unsubscribeTheme =
        themeController.subscribePlayerPresentations(listener);
      const unsubscribeReplay =
        replayPlayerPresentationStore.subscribe(listener);
      const unsubscribeSolo = soloPlayerPresentationStore.subscribe(listener);
      return () => {
        unsubscribeRoom();
        unsubscribeTheme();
        unsubscribeReplay();
        unsubscribeSolo();
      };
    },
  });

  const pageLifecycle = createMahjongPageLifecycle({
    window,
    document,
    getSession: () => session,
    getTableController: () => tableController,
    isDestroyed: matchCoordinator.isDestroyed,
    onDestroy: () => destroy(),
    resumeMatchMusic,
  });

  void Promise.all([
    visualRendererReady,
    resultHandRendererReady,
    themeController.ready,
  ]).then(() => themeController.applyVisualPack());
  themeController.syncDefaultMusicCopyright();
  void themeController.refreshThemePacks();

  releaseUiBindings = bindMahjongUi({
    paipuElements,
    replayElements,
    elements,
    tableController,
    resultHandRenderer,
    autoActionController,
    getMode: matchCoordinator.getMode,
    getReplayState: matchCoordinator.getReplayState,
    getRoomController: () => roomController,
    getReplayController: () => replayController,
    openPaipuPanel,
    closePaipuPanel,
    initializeSoloMatch: initialize,
    pageLifecycle,
  });
  playweftClient = isStandalone
    ? undefined
    : createPlayweftClient({
        onReady: (context) => roomController?.handleReady(context),
        onState: (message) => roomController?.handleState(message),
        onActionResult: (...args) =>
          roomController?.handleActionResult(...args),
        onError: (...args) => roomController?.handleError(...args),
        onLatency: (rttMs) => connectionStatus?.setLatency(rttMs),
        onPlayerProfileChanged: (change) =>
          roomController?.handlePlayerProfileChanged(change),
      });
  session = createMahjongSessionController({
    humanId: HUMAN_ID,
    getMode: matchCoordinator.getMode,
    getGame: matchCoordinator.getGame,
    getState: () => tableController.getState(),
    getAutoActions: () => autoActionController.get(),
    getRiichiMode: () => tableController.isRiichiMode(),
    isKanDrawPending: () => presentation.kanDrawPending,
    sendRoomAction: (...args) =>
      roomController?.sendActionWithTenpaiReport(...args),
    onRoomUnavailable: () => {
      tableController.rollbackPendingDiscard();
      tableController.clearActionInFlight();
      showMessage("尚未连接到房间");
    },
    persistAcceptedAction: (...args) =>
      soloSaveController.persistAcceptedAction(...args),
    refreshProjection: tableController.refresh,
    onSoloActionAccepted(action, projection) {
      if (action.type === "riichi") {
        const event = asArray(projection?.events).find(
          (candidate) =>
            candidate?.type === "riichi" &&
            Number(candidate.playerIndex) ===
              (Number(projection?.state?.viewerSeat) ||
                (projection?.state?.players?.indexOf(HUMAN_ID) ?? 0) + 1),
        );
        autoActionController.enableAfterRiichi(projection?.state, event);
      }
      if (action.type === "next_hand" || action.type === "new_match")
        autoActionController.reset();
      tableController.clearActionUi();
    },
    onActionRejected: (code) => {
      tableController.rollbackPendingDiscard();
      tableController.clearActionInFlight();
      showMessage(errorMessage(code));
    },
    onActionError(error) {
      tableController.rollbackPendingDiscard();
      tableController.clearActionInFlight();
      console.error("Mahjong action failed", error);
      showMessage("动作处理失败，请重试");
    },
    onProjectionTransitionError(error) {
      console.error(
        "Mahjong result transition failed; restoring the projection",
        error,
      );
    },
    onAiActionRejected(outcome) {
      console.error(
        "AI action rejected",
        outcome.actorId,
        outcome.action,
        outcome.result,
      );
      showMessage("AI 动作未通过规则校验");
    },
    onAiError(error) {
      console.error("Mahjong AI worker failed", error);
      showMessage("AI 思考失败，请刷新页面重试");
    },
    delays: {
      ai: AI_DELAY_MS,
      autoDecision: AUTO_DECISION_DELAY_MS,
      newHandDeal: NEW_HAND_DEAL_DURATION_MS,
      ownDrawEntry: OWN_DRAW_ENTRY_DURATION_MS,
    },
  });

  roomController = createMahjongRoomController({
    window,
    elements,
    getPlayMode: matchCoordinator.getMode,
    setPlayMode: matchCoordinator.setMode,
    getPlayerId: matchCoordinator.getRoomPlayerId,
    setPlayerId: matchCoordinator.setRoomPlayerId,
    setPlayerName: matchCoordinator.setPlayerName,
    setHasPlatformName: matchCoordinator.setPlayerNameIsAuthoritative,
    setIsOwner: () => {},
    getGameInitializing: matchCoordinator.isGameInitializing,
    setGameInitializing: matchCoordinator.setGameInitializing,
    getDestroyed: matchCoordinator.isDestroyed,
    getClient: () => playweftClient,
    getSession: () => session,
    tableController,
    visualRendererReady,
    settingsDialog,
    transientNotice,
    roomPlayerProfiles,
    roomPlayerPresentations,
    themeController,
    beginSetupExit: setupScreen.beginExit,
    resetAutoActions: (...args) => autoActionController.reset(...args),
    syncRoomPassClaims: (...args) =>
      autoActionController.syncRoomPassClaims(...args),
    enableAutoWinAfterRiichi: (...args) =>
      autoActionController.enableAfterRiichi(...args),
    persistCompletedPaipu: saveCompletedPaipu,
    showMessage,
    showLoadingError,
    showSetupRecoveryError: setupScreen.showRecoveryError,
    showRoomSetup: setupScreen.showRoom,
    startSoloEntry: startMahjongEntry,
  });

  replayController = createMahjongReplayController({
    window,
    elements,
    replayElements,
    getGame: matchCoordinator.getGame,
    setGame: matchCoordinator.setGame,
    getGameInitializing: matchCoordinator.isGameInitializing,
    setGameInitializing: matchCoordinator.setGameInitializing,
    getPlayMode: matchCoordinator.getMode,
    setPlayMode: matchCoordinator.setMode,
    getReplayState: matchCoordinator.getReplayState,
    setReplayState: matchCoordinator.setReplayState,
    closePaipuPanel,
    loadMahjongPaipu,
    tableController,
    presentation,
    settingsDialog,
    session,
    showMessage,
    showSetup: setupScreen.show,
    applyPlayerPresentations: applyReplayPlayerPresentations,
  });

  soloController = createMahjongSoloMatchController({
    elements,
    getGame: matchCoordinator.getGame,
    setGame: matchCoordinator.setGame,
    getGameInitializing: matchCoordinator.isGameInitializing,
    setGameInitializing: matchCoordinator.setGameInitializing,
    getPlayerName: matchCoordinator.getPlayerName,
    setPlayerName: matchCoordinator.setPlayerName,
    getAutoActions: () => autoActionController.get(),
    setAutoActions: (value) => autoActionController.set(value),
    getSoloSave: () => soloSaveController.get(),
    setSoloSave: (value) => soloSaveController.set(value),
    tableController,
    themeController,
    settingsDialog,
    visualRendererReady,
    beginSetupExit: setupScreen.beginExit,
    selectedMatchRules,
    resetAutoActions: (...args) => autoActionController.reset(...args),
    syncAutoActionControls: () => autoActionController.syncControls(),
    scheduleAi,
    showLoadingError,
    showSetup: setupScreen.show,
    showSetupRecoveryError: setupScreen.showRecoveryError,
  });

  if (isStandalone) startMahjongEntry();
  pageLifecycle.revealAppAfterStyles();

  function openPaipuPanel() {
    return paipuPanel.show();
  }

  function closePaipuPanel(options) {
    return paipuPanel.hide(options);
  }

  async function replayMahjongPaipu(id) {
    return replayController?.replay(id);
  }

  async function advanceMahjongPaipuReplayFromResult(action) {
    return replayController?.advanceFromResult(action) ?? false;
  }

  async function exitMahjongPaipuReplay(options) {
    return replayController?.exit(options);
  }

  async function initialize(matchType = "east") {
    if (matchCoordinator.getMode() !== "solo") return;
    return soloController?.initialize(matchType);
  }

  function selectedMatchRules() {
    return Object.fromEntries(
      [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
        input.dataset.rule,
        input.checked,
      ]),
    );
  }

  async function resumeSavedMatch() {
    return soloController?.resumeSavedMatch();
  }

  function applyReplayPlayerPresentations(record) {
    return applyMahjongReplayPlayerPresentations({
      record,
      themeController,
      presentationStore: replayPlayerPresentationStore,
      domView,
    });
  }

  function syncReplayHandVisibilityControl() {
    const isReplay = matchCoordinator.getMode() === "replay";
    for (const button of [
      elements.autoWin,
      elements.passClaims,
      elements.autoTsumogiri,
    ]) {
      button.hidden = isReplay;
    }
    const visibility = replayElements.handVisibility;
    if (!visibility) return;
    visibility.hidden = !isReplay;
    if (!isReplay) {
      visibility.setAttribute("aria-pressed", "false");
      visibility.setAttribute("aria-label", "显示其他玩家手牌");
      visibility.title = "显示其他玩家手牌";
    }
  }

  function startMahjongEntry() {
    if (
      matchCoordinator.getMode() !== "solo" ||
      matchCoordinator.getGame() ||
      matchCoordinator.isGameInitializing()
    )
      return;
    if (
      mahjongInitialEntry(
        matchCoordinator.getMode(),
        Boolean(soloSaveController.get()),
      ) === "resume"
    ) {
      void resumeSavedMatch();
      return;
    }
    setupScreen.show();
  }

  async function endSoloMatch() {
    if (
      !matchCoordinator.getGame() ||
      matchCoordinator.isGameInitializing() ||
      !matchCoordinator.beginEnding()
    )
      return;
    try {
      const message = "结束本局并返回标题？本局进度不会保留。";
      const confirmed = isStandalone
        ? window.confirm(message)
        : await playweftClient?.confirm(message);
      if (!confirmed) return;
      settingsDialog.setOpen(false, { restoreFocus: false, animate: false });
      await teardownCompletedSoloMatch();
    } catch (error) {
      console.error("Unable to confirm ending the Mahjong match", error);
    } finally {
      matchCoordinator.endEnding();
    }
  }

  async function teardownCompletedSoloMatch() {
    session?.cancelScheduledActions();
    tableController.syncMatchMusic({ enabled: false });
    presentation.suspend();
    matchCoordinator.getGame()?.close();
    matchCoordinator.setGame(undefined);
    tableController.reset();
    elements.result.hidden = true;
    elements.loading.hidden = true;
    setupScreen.show();
    settingsDialog.setSoloMatchActive(false);
    settingsDialog.setEndMatchLabel("结束本局");
    soloSaveController.clear();
    await themeController.clearMatchPortraits();
  }

  function showLoadingError(message) {
    elements.loading.classList.add("is-error");
    elements.loadingMessage.textContent = message;
    elements.loadingMessage.hidden = false;
  }

  function showMessage(message) {
    elements.message.textContent = message;
    elements.message.classList.add("is-error");
  }

  function dispatch(action, options) {
    if (matchCoordinator.getMode() === "replay") return false;
    return session?.dispatch(action, options) ?? false;
  }

  function scheduleAi(options) {
    session?.scheduleAi(options);
  }

  function resumeMatchMusic() {
    tableController?.syncMatchMusic({ userGesture: true });
  }

  function destroy() {
    if (!matchCoordinator.destroy()) return;
    releaseUiBindings?.();
    session?.cancelScheduledActions();
    tableController?.destroy();
    pageLifecycle.destroy();
    themeController.destroy();
    releaseFixedViewport();
    settingsDialog.destroy();
    helpIframePortal.destroy();
    visualRenderer.destroy();
    resultHandRenderer.destroy();
    matchCoordinator.getGame()?.close();
    roomController?.destroy();
    playweftClient?.destroy();
  }

  return { destroy };
}
