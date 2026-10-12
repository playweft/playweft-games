import { chooseConnectFourMove } from "./ai.js";

export function createConnectFourAiController({
  onMove,
  onError,
  createWorker = () => new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" }),
  schedule = (callback, delay = 0) => setTimeout(callback, delay),
  unschedule = (timer) => clearTimeout(timer),
}) {
  let worker;
  let pending;
  let timer;
  let watchdog;
  let serial = 0;
  let workerFailed = false;

  function finish(requestId, move) {
    if (pending?.requestId !== requestId) return;
    if (watchdog !== undefined) unschedule(watchdog);
    watchdog = undefined;
    pending = undefined;
    if (move) onMove({ type: "drop", column: move.column });
    else onError("电脑没有可落子的合法位置");
  }
  function fallback() {
    if (watchdog !== undefined) unschedule(watchdog);
    watchdog = undefined;
    worker?.terminate();
    worker = undefined;
    workerFailed = true;
    const request = pending;
    if (!request) return;
    // Keep a bounded local fallback for browsers that cannot start a module Worker.
    timer = schedule(() => {
      timer = undefined;
      if (pending !== request) return;
      try { finish(request.requestId, chooseConnectFourMove(request.state, { timeBudgetMs: 0, maxNodes: 0 })); }
      catch { pending = undefined; onError("电脑暂时无法落子，请重新打开游戏"); }
    });
  }
  function cancel() {
    if (timer !== undefined) unschedule(timer);
    if (watchdog !== undefined) unschedule(watchdog);
    timer = undefined;
    watchdog = undefined;
    if (pending) { worker?.terminate(); worker = undefined; }
    pending = undefined;
  }
  return {
    update(state, key, enabled) {
      const eligible = enabled && state && !state.winner && !state.draw && state.current === 2;
      if (!eligible) { cancel(); return; }
      if (pending?.key === key) return;
      cancel();
      pending = { key, requestId: ++serial, state };
      if (workerFailed) { fallback(); return; }
      try {
        if (!worker) {
          worker = createWorker();
          const currentWorker = worker;
          currentWorker.onmessage = ({ data }) => {
            if (worker !== currentWorker) return;
            if (pending?.requestId !== data.requestId) return;
            if (data.error) fallback();
            else finish(data.requestId, data.move);
          };
          currentWorker.onerror = () => { if (worker === currentWorker) fallback(); };
        }
        const requestId = pending.requestId;
        watchdog = schedule(() => {
          if (pending?.requestId === requestId) fallback();
        }, 3000);
        worker.postMessage({ requestId: pending.requestId, state });
      } catch { fallback(); }
    },
    dispose() {
      cancel();
      worker?.terminate();
      worker = undefined;
    },
  };
}
