// One position at a time keeps peak memory bounded. Nothing is loaded until start().
export function createGoRecordAnalysis({ onUpdate, onSave = () => {}, createWorker = () =>
  new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" }) }) {
  const cache = new Map();
  let worker, key, results = [], getPosition, total = 0, sequence = 0;
  let pending, running = false, message = "";
  function notify() {
    onUpdate({ values: results.map(result => result?.blackWinRate ?? null),
      recommendations: results.map(result => result?.candidates?.[0] ?? null), running, message, total,
      complete: total > 0 && results.every(isComplete) });
  }
  function stop() {
    worker?.terminate();
    worker = pending = undefined;
    running = false;
  }
  function fail() { stop(); message = "分析暂时不可用，请检查网络或更换浏览器后重试"; notify(); }
  function next() {
    const index = results.findIndex(result => !isComplete(result));
    if (index < 0) { stop(); message = "分析完成 · AI 估计"; notify(); return; }
    pending = { id: ++sequence, index };
    worker.postMessage({ id: pending.id, type: "analyze", modelId: "b18", position: getPosition(index) });
  }
  return {
    select(nextKey, count, position, saved) {
      stop(); key = nextKey; total = count; getPosition = position;
      const cached = cache.get(key) ?? (saved?.formatVersion === 1 && saved.key === key ? saved.results : undefined);
      results = Array.from({ length: total }, (_, index) => normalizeResult(cached?.[index]));
      cache.set(key, results);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      message = results.every(isComplete) ? "分析完成 · AI 估计"
        : results.some(result => result !== null && !isComplete(result))
          ? "已保存胜率，继续分析可补充推荐落点" : "按需分析，不会自动下载资源";
      notify();
    },
    start() {
      if (running || !total || results.every(isComplete)) return;
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
          const result = normalizeResult(data);
          if (!isComplete(result)) { fail(); return; }
          results[pending.index] = result;
          // Save each completed point, including partial runs. The game's
          // existing storage queue orders/coalesces writes and handles retries.
          onSave({ formatVersion: 1, key, results: structuredClone(results) });
          message = `已分析 ${results.filter(isComplete).length} / ${total} 个局面 · AI 估计`;
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

function normalizeResult(result) {
  const value = result?.blackWinRate;
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return {
    blackWinRate: value,
    ...(Number.isFinite(result.scoreLead) ? { scoreLead: result.scoreLead } : {}),
    ...(Number.isInteger(result.visits) && result.visits >= 0 ? { visits: result.visits } : {}),
    ...(Array.isArray(result.candidates) && result.candidates.length <= 2 &&
        result.candidates.every(isValidCandidate)
      ? { candidates: result.candidates.map(candidate => ({
          ...(candidate.type === "pass" ? { type: "pass" }
            : { type: "play", row: candidate.row, column: candidate.column }),
          blackWinRate: candidate.blackWinRate, scoreLead: candidate.scoreLead, visits: candidate.visits,
        })) } : {}),
  };
}

function isComplete(result) { return Array.isArray(result?.candidates); }

function isValidCandidate(candidate) {
  return candidate && (candidate.type === "pass" || (candidate.type === "play" &&
    Number.isInteger(candidate.row) && candidate.row >= 1 && candidate.row <= 19 &&
    Number.isInteger(candidate.column) && candidate.column >= 1 && candidate.column <= 19)) &&
    Number.isFinite(candidate.blackWinRate) && candidate.blackWinRate >= 0 && candidate.blackWinRate <= 1 &&
    Number.isFinite(candidate.scoreLead) && Number.isInteger(candidate.visits) && candidate.visits >= 0;
}
