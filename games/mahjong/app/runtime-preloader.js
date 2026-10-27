/** Starts automatically after the lobby has painted and the iframe load has ended. */
export function createMahjongRuntimePreloader({ document, window, lobbyShown, loadRuntime }) {
  let loaded = document.readyState === "complete";
  let shown = false;
  let scheduled = false;
  let destroyed = false;
  let frame;
  let timer;
  let runtime;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Background failures are surfaced by the lobby; an early click awaits this
  // same promise rather than starting another import or renderer initialization.
  void ready.catch(() => {});

  function schedule() {
    if (!loaded || !shown || scheduled || destroyed) return;
    scheduled = true;
    frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(async () => {
        try {
          if (destroyed) return;
          runtime = await loadRuntime();
          if (destroyed) { runtime.destroy(); return; }
          await runtime.ready;
          if (!destroyed) resolveReady(runtime);
        } catch (error) {
          if (!destroyed) rejectReady(error);
        }
      }, 0);
    });
  }
  function onLoad() {
    loaded = true;
    schedule();
  }
  if (!loaded) window.addEventListener("load", onLoad, { once: true });
  void Promise.resolve(lobbyShown).then(() => {
    shown = true;
    schedule();
  }, rejectReady);

  return {
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("load", onLoad);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      runtime?.destroy();
      rejectReady(new DOMException("Mahjong page closed", "AbortError"));
    },
  };
}
