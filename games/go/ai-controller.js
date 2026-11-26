import { goAiPosition, isGoAiTurn } from "./ai-position.js";
import { applySoloGoAction } from "./solo.js";

export function createGoAiController({ onMove, onStatus, createWorker = () =>
  new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" }) }) {
  let worker, sequence = 0, turn, ready, readyModel;
  let generation = 0;
  const requests = new Map();
  function ensureWorker() {
    if (worker) return;
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      const request = requests.get(data.id);
      if (!request) return;
      if (data.type === "status") { onStatus({ phase: "loading", message: data.message }); return; }
      requests.delete(data.id);
      if (data.type === "error") request.reject(new Error(data.message));
      else request.resolve(data);
    };
    worker.onerror = () => {
      const error = new Error("AI 暂时不可用，请重试");
      for (const request of requests.values()) request.reject(error);
      requests.clear();
      worker.terminate();
      worker = ready = readyModel = undefined;
    };
  }
  function request(message) {
    const id = ++sequence;
    const promise = new Promise((resolve, reject) => {
      try {
        ensureWorker();
        requests.set(id, { resolve, reject });
        worker.postMessage({ ...message, id });
      } catch (error) {
        console.error("Go AI worker unavailable", error);
        requests.delete(id);
        reject(new Error("AI 暂时不可用，请更新浏览器后重试", { cause: error }));
      }
    });
    return { id, promise };
  }
  function cancel() {
    if (!turn) return;
    if (requests.has(turn.id)) {
      worker.postMessage({ type: "cancel", id: turn.id });
      requests.get(turn.id).resolve({ cancelled: true });
      requests.delete(turn.id);
    }
    turn = undefined;
    onStatus({ phase: "ready" });
  }
  function destroy() {
    cancel();
    generation++;
    for (const request of requests.values()) request.resolve({ cancelled: true });
    requests.clear();
    worker?.terminate();
    worker = ready = readyModel = undefined;
  }
  function selectModel(modelId) {
    if (readyModel && readyModel !== modelId) destroy();
    readyModel = modelId;
  }
  return {
    prepare(size = 19, modelId = "b6") {
      selectModel(modelId);
      if (!ready) {
        const currentGeneration = generation;
        onStatus({ phase: "loading", message: "正在准备 AI…" });
        ready = request({ type: "init", size, modelId }).promise.then(result => {
          if (result.cancelled || currentGeneration !== generation) throw new Error("AI 准备已取消");
          onStatus({ phase: "ready", backend: result.backend });
          return result;
        }).catch(error => {
          if (currentGeneration === generation) {
            ready = undefined;
            onStatus({ phase: "error", message: error.message });
          }
          throw error;
        });
      }
      return ready;
    },
    update(state, frames, enabled, modelId = state?.settings?.aiModel ?? "b6") {
      if (!isGoAiTurn(state, enabled)) { cancel(); return; }
      selectModel(modelId);
      if (turn?.state === state) return;
      cancel();
      const job = request({ type: "choose", modelId, position: goAiPosition(state, frames) });
      turn = { ...job, state };
      const current = turn;
      onStatus({ phase: "thinking" });
      job.promise.then(result => {
        if (turn !== current || result.cancelled) return;
        const move = result.moves.find(action => applySoloGoAction(state, action).accepted);
        if (!move) throw new Error("AI 暂时无法落子，请重试");
        turn = undefined;
        onStatus({ phase: "ready", backend: result.backend, visits: result.visits });
        onMove(move);
      }).catch(error => {
        if (turn !== current) return;
        // Keep this turn until explicitly retried or the position changes.
        onStatus({ phase: "error", message: error.message });
      });
    },
    cancel,
    retry() { cancel(); },
    destroy,
  };
}
