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
      if (!cancelled.has(id)) {
        console.error("Go AI request failed", error);
        postMessage({ id, type: "error", message: type === "init"
          ? "AI 准备失败，请检查网络后重试，或换用其他浏览器"
          : "AI 暂时无法落子，请重试" });
      }
    } finally {
      cancelled.delete(id);
    }
  });
};
