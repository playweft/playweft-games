import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgpu";
import { setThreadsCount, setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import wasmUrl from "@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url";
import simdUrl from "@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url";
import threadedUrl from "@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url";
import { GO_AI_MODELS, DEFAULT_GO_AI_MODEL_ID } from "./ai-model.js";
import { downloadGoAiModel } from "./ai-model-download.js";
import { parseKataGoModelV8 } from "./vendor/web-katrain/engine/katago/loadModelV8.ts";
import { KataGoModelV8Tf } from "./vendor/web-katrain/engine/katago/modelV8.ts";
import { MctsSearch } from "./vendor/web-katrain/engine/katago/analyzeMcts.ts";
import { setBoardSize } from "./vendor/web-katrain/engine/katago/fastBoard.ts";

// Runs inside the worker; alternate backend orders are also useful for checking
// compatibility on devices without GPU acceleration.
export function createGoAiRuntime({ modelId = DEFAULT_GO_AI_MODEL_ID, backends = ["webgpu", "wasm", "cpu"] } = {}) {
  const selectedModel = GO_AI_MODELS[modelId];
  if (!selectedModel) throw new Error("未知的 AI 模型");
  let model, parsed;
  tf.enableProdMode();
  setThreadsCount(1); // Works inside platform iframes without COOP/COEP headers.
  setWasmPaths({
    "tfjs-backend-wasm.wasm": wasmUrl,
    "tfjs-backend-wasm-simd.wasm": simdUrl,
    "tfjs-backend-wasm-threaded-simd.wasm": threadedUrl,
  });


  async function loadModel(size, status) {
    if (model) return tf.getBackend();
    if (!parsed) {
      status(`正在下载${selectedModel.difficulty} AI 资源…`);
      let reported = 0;
      const bytes = await downloadGoAiModel(selectedModel.url, {
        onProgress(loaded, total) {
          const megabytes = Math.floor(loaded / 1_000_000);
          if (megabytes === reported) return;
          reported = megabytes;
          const progress = total > 0 ? `${megabytes} / ${Math.ceil(total / 1_000_000)} MB` : `${megabytes} MB`;
          status(`正在下载${selectedModel.difficulty} AI 资源 · ${progress}…`);
        },
      });
      status(`正在准备${selectedModel.difficulty} AI…`);
      parsed = parseKataGoModelV8(bytes);
    }
    if (!model) {
      for (const backend of backends) {
        let candidate;
        try {
          if (backend === "webgpu" && !navigator.gpu) continue;
          status(`正在准备${selectedModel.difficulty} AI…`);
          if (!await tf.setBackend(backend)) continue;
          await tf.ready();
          candidate = new KataGoModelV8Tf(parsed);
          await warmup(candidate, size);
          model = candidate;
          parsed = undefined; // Drop parsed weight references after initialization.
          break;
        } catch (error) {
          candidate?.dispose();
          console.warn(`Go AI ${backend} unavailable`, error);
        }
      }
      if (!model) throw new Error("此浏览器无法初始化 AI，请更新浏览器后重试");
    }
    return tf.getBackend();
  }

  async function warmup(candidate, size) {
    const spatial = tf.zeros([1, size, size, 22]);
    const global = tf.zeros([1, 19]);
    let output;
    try {
      output = candidate.forwardPolicyValue(spatial, global);
      await Promise.all(Object.values(output).map(tensor => tensor.data()));
    } finally {
      spatial.dispose();
      global.dispose();
      if (output) tf.dispose(output);
    }
  }


  return {
    async prepare(size, status = () => {}) {
      setBoardSize(size);
      return loadModel(size, status);
    },
    async choose(position, shouldAbort = () => false) {
      setBoardSize(position.board.length);
      const backend = await loadModel(position.board.length, () => {});
      const search = await MctsSearch.create({
        ...position,
        model,
        nnRandomize: true,
        conservativePass: true,
        fillDameBeforePass: true,
        maxChildren: 24,
        ownershipMode: "none",
        wideRootNoise: 0,
        rootSymmetrySamples: 1,
      });
      if (shouldAbort()) return;
      await search.run({
        visits: modelId === "b18" ? 128 : 48,
        maxTimeMs: modelId === "b18" ? 2000 : backend === "webgpu" ? 800 : 500,
        batchSize: 1, // Bound peak activation memory for the larger network on phones.
        shouldAbort,
      });
      if (shouldAbort()) return;
      const result = search.getAnalysis({ topK: 24, analysisPvLen: 0 });
      const moves = result.moves.map(move => move.x < 0 || move.y < 0
        ? { type: "pass" }
        : { type: "play", row: move.y + 1, column: move.x + 1 });
      if (!moves.length) throw new Error("AI 未返回合法着法，请重试");

      return { moves, backend, visits: result.rootVisits };
    },
    async analyze(position, shouldAbort = () => false) {
      setBoardSize(position.board.length);
      await loadModel(position.board.length, () => {});
      const search = await MctsSearch.create({ ...position, model,
        nnRandomize: false, maxChildren: 16, ownershipMode: "none",
        wideRootNoise: 0, rootSymmetrySamples: 1 });
      if (shouldAbort()) return;
      await search.run({ visits: 32, maxTimeMs: 1000, batchSize: 1, shouldAbort });
      if (shouldAbort()) return;
      const result = search.getAnalysis({ topK: 2, analysisPvLen: 0 });
      // The engine's values are always from Black's perspective, even on White's turn.
      return { blackWinRate: result.rootWinRate, scoreLead: result.rootScoreLead,
        visits: result.rootVisits,
        // Keep the engine's recommendation order, including pass, without
        // running another search or saving the full search tree.
        // getAnalysis may expand symmetric equivalents after applying topK.
        candidates: result.moves.slice(0, 2).map(move => ({
          ...(move.x < 0 || move.y < 0 ? { type: "pass" }
            : { type: "play", row: move.y + 1, column: move.x + 1 }),
          blackWinRate: move.winRate, scoreLead: move.scoreLead, visits: move.visits,
        })),
      };
    },
  };
}
