import { initializeGameStorage } from "../../src/game-storage-ui.js";
import { GO_HISTORY_KEY } from "./history.js";

export function initializeGoStorage(bridge) {
  // Choose one authority. Do not import or delete saves from another backend.
  const backend = window.parent !== window ? bridge.localStorage : {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  };
  return initializeGameStorage(bridge, {
    gameId: "go",
    keys: [GO_HISTORY_KEY],
    backend,
    validate(_key, raw) {
      if (raw === null) return;
      try {
        const archive = JSON.parse(raw);
        if (archive?.format === "playweft-go-history" && archive.formatVersion === 1 &&
            Array.isArray(archive.records)) return;
      } catch {}
      throw Object.assign(new Error("围棋存档格式无效，原始数据已保留。"), { code: "INVALID_GO_HISTORY" });
    },
  });
}
