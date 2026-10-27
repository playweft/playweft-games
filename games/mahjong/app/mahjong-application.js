// The lobby is independent of the Three.js match runtime.
import { BookOpen, ChevronRight, Cog, UsersRound, createIcons } from "lucide";
import { createPlayweftClient } from "../../../src/playweft-client.js";
import { initializeMahjongStorage } from "../storage.js";
import { readMahjongSoloSave } from "../replay/solo-save.js";
import { deferMahjongDecorativeAssets } from "../theme/deferred-visual-assets.js";
import { bindFixedViewport } from "./fixed-viewport.js";
import { createMahjongPageLifecycle } from "./page-lifecycle.js";
import { createMahjongSetupScreenController } from "./setup-screen-controller.js";
import { createMahjongTransientNotice } from "./transient-notice.js";
import { createMahjongRoomEntry } from "./room-entry.js";
import { createMahjongRuntimePreloader } from "./runtime-preloader.js";
import defaultTableBackgroundUrl from "../assets/moonlit-table-v3.jpg?url";
import defaultPortraitsUrl from "../assets/player-portraits-v1.jpg?url";
import defaultResultTableclothUrl from "../assets/felt-skin-moonwave-v1.jpg?url";
import defaultLobbyBackgroundUrl from "../assets/waiting-evening-v1.jpg?url";
import defaultTileFacesUrl from "../assets/tiles/riichi-faces.webp?url";

export async function createMahjongApplication({
  document = globalThis.document,
  window = globalThis.window,
} = {}) {
  const elements = {
    app: document.querySelector("#mahjong-app"),
    setup: document.querySelector("#setup-panel"),
    loading: document.querySelector("#loading-panel"),
    loadingMessage: document.querySelector("#loading-message"),
  };
  const settingsButton = document.querySelector("#settings-button");
  const paipuButton = document.querySelector(".setup-paipu-entry");
  createIcons({ icons: { BookOpen, ChevronRight, UsersRound }, root: elements.setup });
  createIcons({ icons: { Cog }, root: settingsButton });
  deferMahjongDecorativeAssets({ document, window, urls: {
    "--mahjong-default-portrait-image": defaultPortraitsUrl,
    "--mahjong-default-table-background-image": defaultTableBackgroundUrl,
    "--mahjong-result-tablecloth-image": defaultResultTableclothUrl,
    "--mahjong-setup-background-image": defaultLobbyBackgroundUrl,
    "--mahjong-tile-face-image": defaultTileFacesUrl,
  } });

  let handlers;
  let initialContext;
  let initialState;
  let runtime;
  let lobbyReady = false;
  let destroyed = false;
  let pendingEntry = false;
  const standalone = window.parent === window;
  const transientNotice = createMahjongTransientNotice({
    element: document.querySelector("#mahjong-transient-notice"), window,
  });
  const client = standalone ? undefined : createPlayweftClient({
    onReady(context) {
      initialContext = context;
      roomEntry?.setContext(context);
      if (handlers) handlers.onReady(context);
      else if (lobbyReady) showLobby();
    },
    onState(message) {
      initialState = message;
      if (handlers) handlers.onState(message);
      else if (lobbyReady) showLobby();
    },
    onActionResult: (...args) => handlers?.onActionResult(...args),
    onError: (...args) => handlers?.onError(...args),
    onLatency: (...args) => handlers?.onLatency(...args),
    onPlayerProfileChanged: (...args) => handlers?.onPlayerProfileChanged(...args),
  });
  let roomEntry;
  const storage = await initializeMahjongStorage(client);
  roomEntry = createMahjongRoomEntry({
    button: document.querySelector("#create-room-button"),
    getClient: () => client,
    beforeCreate: () => storage.flush(),
    showError: (message) => transientNotice.show(message),
  });
  if (initialContext) roomEntry.setContext(initialContext);
  const releaseFixedViewport = bindFixedViewport(
    document.querySelector("#mahjong-viewport"), elements.app,
  );
  const setup = createMahjongSetupScreenController({
    window, elements, transientNotice,
    closePaipuPanel() {},
    getSoloSave: readMahjongSoloSave,
  });

  function showLobby() {
    if (!standalone && initialContext?.mode === "room") {
      if (initialState?.state?.phase === "lobby" && initialState.state.roomIsOwner) {
        setup.showRoom();
      } else {
        elements.setup.hidden = true;
        showWaiting();
      }
    } else {
      setup.show();
      elements.loading.hidden = true;
    }
    elements.app.setAttribute("aria-busy", "false");
  }
  function showWaiting() {
    elements.setup.inert = true;
    elements.loading.hidden = false;
    elements.loading.classList.remove("is-error");
    elements.loading.classList.add("is-active");
    elements.loadingMessage.hidden = true;
  }
  function showError() {
    elements.setup.inert = false;
    elements.loading.hidden = false;
    elements.loading.classList.add("is-error", "is-active");
    elements.loadingMessage.textContent = "对局资源加载失败，请刷新页面重试";
    elements.loadingMessage.hidden = false;
  }

  lobbyReady = true;
  showLobby();
  const lifecycle = createMahjongPageLifecycle({ window, document });
  const lobbyShown = lifecycle.revealAppAfterStyles();
  const preloader = createMahjongRuntimePreloader({
    window, document, lobbyShown,
    async loadRuntime() {
      const { createMahjongMatchRuntime } = await import("./match-runtime.js");
      if (destroyed) throw new DOMException("Mahjong page closed", "AbortError");
      runtime = createMahjongMatchRuntime({
        document, window, storage, playweftClient: client, roomEntry,
        releaseFixedViewport, initialContext, initialState,
        setBridgeHandlers: (next) => { handlers = next; },
      });
      if (pendingEntry) showWaiting();
      return runtime;
    },
  });
  let warmed = false;
  void preloader.ready.then(() => { warmed = true; }, (error) => {
    if (destroyed) return;
    console.error("Mahjong runtime warm-up failed", error);
    if (!pendingEntry) transientNotice.show("对局资源加载失败，请刷新页面重试");
  });

  async function enter(action) {
    if (pendingEntry || destroyed) return;
    pendingEntry = true;
    showWaiting();
    try {
      const readyRuntime = await preloader.ready;
      if (destroyed) return;
      elements.setup.inert = false;
      elements.loading.hidden = true;
      await action(readyRuntime);
    } catch (error) {
      if (!destroyed) showError();
    } finally {
      pendingEntry = false;
    }
  }
  function onEarlyClick(event) {
    if (warmed || destroyed) return;
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    const type = button.dataset.matchType;
    if (!type && button !== settingsButton && button !== paipuButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void enter((readyRuntime) => type
      ? readyRuntime.initialize(type)
      : button === settingsButton ? readyRuntime.openSettings() : readyRuntime.openPaipuPanel());
  }
  // Capture prevents the runtime's listeners from also handling an early click
  // while renderer initialization is still pending.
  document.addEventListener("click", onEarlyClick, true);
  function onPageHide(event) {
    if (!event.persisted) destroy();
  }
  window.addEventListener("pagehide", onPageHide);
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    handlers = undefined;
    document.removeEventListener("click", onEarlyClick, true);
    window.removeEventListener("pagehide", onPageHide);
    preloader.destroy();
    if (!runtime) {
      roomEntry.destroy();
      releaseFixedViewport();
      void storage.flush().catch(() => {}).finally(() => client?.destroy());
    }
  }
  return { ready: preloader.ready, destroy };
}
