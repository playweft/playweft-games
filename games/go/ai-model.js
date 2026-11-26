import bundledB6Url from "./assets/katago-b6.bin.gz?url";
import { GO_AI_DIFFICULTIES } from "./rules.js";

export const GO_AI_MODELS = {
  b6: { label: "b6", difficulty: GO_AI_DIFFICULTIES.b6, url: bundledB6Url },
};
const enhancedUrl = import.meta.env.VITE_GO_AI_MODEL_URL?.trim();
if (enhancedUrl) {
  GO_AI_MODELS.b18 = { label: "困难", difficulty: GO_AI_DIFFICULTIES.b18, url: enhancedUrl };
}
export const DEFAULT_GO_AI_MODEL_ID = enhancedUrl ? "b18" : "b6";
export const resolveGoAiModelId = id => GO_AI_MODELS[id] ? id : DEFAULT_GO_AI_MODEL_ID;
