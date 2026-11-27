// One position at a time keeps peak memory bounded. Nothing is loaded until start().
export function createGoRecordAnalysis({ onUpdate, createWorker = () =>
  new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" }) }) {
  const cache = new Map();
  let worker, key, values = [], getPosition, total = 0, sequence = 0;
  let pending, running = false, message = "";
  function notify() { onUpdate({ values: [...values], running, message, total }); }
  function stop() {
    worker?.terminate();
    worker = pending = undefined;
    running = false;
  }
  function fail() { stop(); message = "分析暂时不可用，请检查网络或更换浏览器后重试"; notify(); }
  function next() {
    const index = values.findIndex(value => value === null);
    if (index < 0) { stop(); message = "分析完成 · AI 估计"; notify(); return; }
    pending = { id: ++sequence, index };
    worker.postMessage({ id: pending.id, type: "analyze", modelId: "b18", position: getPosition(index) });
  }
  return {
    select(nextKey, count, position) {
      stop(); key = nextKey; total = count; getPosition = position;
      const cached = cache.get(key);
      values = cached?.length === total ? cached : Array(total).fill(null);
      cache.set(key, values);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      message = values.every(value => value !== null) ? "分析完成 · AI 估计" : "按需分析，不会自动下载资源";
      notify();
    },
    start() {
      if (running || !total || values.every(value => value !== null)) return;
      running = true; message = "正在准备分析资源…"; notify();
      try {
        const active = createWorker(); worker = active;
        active.onerror = () => { if (worker === active) fail(); };
        active.onmessage = ({ data }) => {
          if (worker !== active || data.id !== pending?.id) return;
          if (data.type === "status") { message = data.message; notify(); return; }
          if (data.type === "error") { fail(); return; }
          if (data.type === "ready") { next(); return; }
          if (data.type !== "analysis") return;
          const value = data.blackWinRate;
          if (!Number.isFinite(value) || value < 0 || value > 1) { fail(); return; }
          values[pending.index] = value;
          message = `已分析 ${values.filter(value => value !== null).length} / ${total} 个局面 · AI 估计`;
          notify(); next();
        };
        pending = { id: ++sequence };
        active.postMessage({ id: pending.id, type: "init", modelId: "b18", size: getPosition(0).board.length });
      } catch { fail(); }
    },
    pause() { if (!running) return; stop(); message = "分析已暂停"; notify(); },
    destroy: stop,
  };
}
