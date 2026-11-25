import { createGoAiRuntime } from "./ai-runtime.js";

let runtime;
const cancelled = new Set();
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  if (data.type === "cancel") { cancelled.add(data.id); return; }
  queue = queue.then(async () => {
    const { id, type } = data;
    try {
      if (cancelled.has(id)) return;
      runtime ??= createGoAiRuntime({ modelId: data.modelId });
      if (type === "init") {
        const backend = await runtime.prepare(data.size, message =>
          postMessage({ id, type: "status", message }));
        if (!cancelled.has(id)) postMessage({ id, type: "ready", backend });
      } else if (type === "choose") {
        const result = await runtime.choose(data.position, () => cancelled.has(id));
        if (!cancelled.has(id)) postMessage({ id, type: "move", ...result });
      }
    } catch (error) {
      if (!cancelled.has(id)) postMessage({ id, type: "error", message: error.message || String(error) });
    } finally {
      cancelled.delete(id);
    }
  });
};
