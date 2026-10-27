import { initializeGameStorage } from "../../src/game-storage-ui.js";
import {
  MAHJONG_SOLO_SAVE_KEY,
  readMahjongSoloSave,
} from "./replay/solo-save.js";

import { CAREER_KEYS, parseCareer } from "./career/career.js";

export const MAHJONG_STORAGE_KEYS = [
  ...CAREER_KEYS,
  MAHJONG_SOLO_SAVE_KEY,
  "playweft.mahjong.double-click-tsumogiri",
  "playweft.mahjong.double-click-pass",
  "playweft.mahjong.game-hints",
  "playweft.mahjong.auto-win-after-riichi",
  "playweft.mahjong.discard-volume",
  "playweft.mahjong.music-volume",
  "playweft.mahjong.master-volume",
  "playweft.mahjong.voice-volume",
  "playweft.mahjong.avatar-source-preference",
  "playweft.mahjong.default-character.v1",
  "playweft.mahjong.default-asset-appearance",
  "playweft.mahjong.offline-cache-mode",
  "playweft.mahjong.offline-cache-policy",
  "playweft.mahjong.offline-cache-version",
];

export function initializeMahjongStorage(bridge) {
  return initializeGameStorage(bridge, {
    gameId: "mahjong",
    keys: MAHJONG_STORAGE_KEYS,
    validate(key, raw) {
      if (CAREER_KEYS.includes(key)) { parseCareer(raw); return; }
      if (key !== MAHJONG_SOLO_SAVE_KEY || raw === null) return;
      if (!readMahjongSoloSave({ getItem: () => raw }))
        throw Object.assign(
          new Error(
            "The saved Mahjong match is malformed or uses an unsupported format. The original data has been preserved.",
          ),
          { code: "INVALID_MAHJONG_SAVE" },
        );
    },
  });
}
