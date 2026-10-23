import { getGameStorage } from "../../../src/game-storage-cache.js";
import { MAHJONG_BUILTIN_CHARACTER_IDS } from "./builtin-characters.js";

export const MAHJONG_DEFAULT_CHARACTER_STORAGE_KEY =
  "playweft.mahjong.default-character.v1";

const memory = new Map();

function randomIndex(length) {
  if (length <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

export function getOrCreateMahjongDefaultCharacter({
  storage,
  characterIds = MAHJONG_BUILTIN_CHARACTER_IDS,
  chooseIndex = randomIndex,
} = {}) {
  const validIds = [...new Set(
    (Array.isArray(characterIds) ? characterIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];
  if (!validIds.length) return null;
  const key = MAHJONG_DEFAULT_CHARACTER_STORAGE_KEY;
  let storageApi = storage;
  if (storageApi === undefined) {
    try {
      storageApi = getGameStorage("mahjong");
    } catch {
      storageApi = undefined;
    }
  }
  const isValid = (value) =>
    value?.characterId && validIds.includes(value.characterId);
  const cached = memory.get(key);
  if (isValid(cached)) return { ...cached };
  try {
    const saved = JSON.parse(storageApi?.getItem?.(key) || "null");
    if (isValid(saved)) {
      memory.set(key, saved);
      return { ...saved };
    }
  } catch {
    // Storage can be unavailable or contain an obsolete value.
  }
  const index = Math.max(
    0,
    Math.min(validIds.length - 1, Number(chooseIndex(validIds.length)) || 0),
  );
  const preference = { characterId: validIds[index] };
  memory.set(key, preference);
  try {
    storageApi?.setItem?.(key, JSON.stringify(preference));
  } catch {
    // In-memory stability still applies for this page when storage is blocked.
  }
  return { ...preference };
}

export function clearMahjongDefaultCharacterMemory() {
  memory.clear();
}
