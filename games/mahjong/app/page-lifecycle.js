export function createMahjongPageLifecycle({
  window = globalThis.window,
  document = window?.document,
  getSession,
  getTableController,
  isDestroyed,
  onDestroy,
  resumeMatchMusic,
} = {}) {
  function revealAppAfterStyles() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.documentElement.classList.add("mahjong-app-ready");
          const splash = document.querySelector("#mahjong-boot-splash");
          window.setTimeout(() => splash?.remove(), 220);
          resolve();
        });
      });
    });
  }

  function onPageHide(event) {
    getSession?.()?.cancelScheduledActions();
    getTableController?.()?.suspend();
    if (!event.persisted) onDestroy?.();
  }

  function onPageShow(event) {
    if (event.persisted) resumeAfterSuspension();
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      getSession?.()?.cancelScheduledActions();
      getTableController?.()?.suspend();
      return;
    }
    resumeAfterSuspension();
  }

  function resumeAfterSuspension() {
    if (isDestroyed?.()) return;
    getTableController?.()?.resume();
  }

  function bind() {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", resumeMatchMusic, { passive: true });
    document.addEventListener("keydown", resumeMatchMusic);
  }

  function destroy() {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("pointerdown", resumeMatchMusic);
    document.removeEventListener("keydown", resumeMatchMusic);
  }

  return { bind, destroy, revealAppAfterStyles };
}
