import { getGameStorage } from "../../../src/game-storage-cache.js";
export const MAHJONG_SOLO_SAVE_KEY = "playweft.mahjong.solo-save.v1";
export const MAHJONG_SOLO_SAVE_VERSION = 4;
export const MAHJONG_SOLO_SEAT_MODEL = "opening-winds";
export const MAHJONG_SOLO_CHECKPOINT_VERSION = 1;
// Increment only when a game.lua state change cannot read an older raw state.
export const MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION = 2;

export function readMahjongSoloSave(storage = getGameStorage("mahjong")) {
  if (!storage) return null;
  try {
    return normalizeSave(JSON.parse(storage.getItem(MAHJONG_SOLO_SAVE_KEY)));
  } catch {
    return null;
  }
}

export function writeMahjongSoloSave(save, storage = getGameStorage("mahjong")) {
  const normalized = normalizeSave(save);
  if (!storage || !normalized) return false;
  try {
    storage.setItem(
      MAHJONG_SOLO_SAVE_KEY,
      JSON.stringify({
        ...normalized,
        savedAt: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearMahjongSoloSave(storage = getGameStorage("mahjong")) {
  if (!storage) return;
  try {
    storage.removeItem(MAHJONG_SOLO_SAVE_KEY);
  } catch {
    // Private-mode and storage-quota failures should not prevent play.
  }
}

export function createMahjongSoloSave({
  randomSeed,
  matchId,
  matchType,
  rules,
  playerName,
  actions = [],
  autoActions,
  opponentPortraits,
  opponentNames,
  playerPresentations,
} = {}) {
  return normalizeSave({
    version: MAHJONG_SOLO_SAVE_VERSION,
    seatModel: MAHJONG_SOLO_SEAT_MODEL,
    randomSeed,
    matchId,
    matchType,
    rules,
    playerName,
    actions,
    autoActions,
    opponentPortraits,
    opponentNames,
    playerPresentations,
  });
}

export function appendMahjongSoloAction(save, action, actorId) {
  const normalized = normalizeSave(save);
  if (!normalized || !isPlainObject(action) || typeof actorId !== "string") {
    return null;
  }
  return {
    ...normalized,
    actions: [
      ...normalized.actions,
      { action: structuredClone(action), actorId },
    ],
  };
}

export function setMahjongSoloCheckpoint(save, checkpoint) {
  const normalized = normalizeSave(save);
  if (!normalized) return null;
  const nextCheckpoint = normalizeCheckpoint(checkpoint, normalized.actions.length);
  if (!nextCheckpoint) return null;
  return { ...normalized, checkpoint: nextCheckpoint };
}

export function setMahjongSoloAutoActions(save, autoActions) {
  const normalized = normalizeSave(save);
  if (!normalized) return null;
  return {
    ...normalized,
    autoActions: normalizeAutoActions(autoActions),
  };
}

export function setMahjongSoloOpponentPortraits(save, opponentPortraits) {
  const normalized = normalizeSave(save);
  if (!normalized) return null;
  return {
    ...normalized,
    opponentPortraits: normalizeOpponentPortraits(opponentPortraits),
  };
}

function normalizeSave(value) {
  if (
    !isPlainObject(value) ||
    value.version !== MAHJONG_SOLO_SAVE_VERSION ||
    value.seatModel !== MAHJONG_SOLO_SEAT_MODEL
  ) {
    return null;
  }
  if (!/^[0-9a-f]{32}$/.test(value.randomSeed ?? "")) return null;
  if (typeof value.matchId !== "string" || !value.matchId) return null;
  if (value.matchType !== "east" && value.matchType !== "hanchan") return null;
  if (!isPlainObject(value.rules) || !Array.isArray(value.actions)) return null;
  if (!value.actions.every(isSavedAction)) return null;
  return {
    version: MAHJONG_SOLO_SAVE_VERSION,
    seatModel: MAHJONG_SOLO_SEAT_MODEL,
    randomSeed: value.randomSeed,
    matchId: value.matchId,
    matchType: value.matchType,
    rules: { ...value.rules },
    playerName: typeof value.playerName === "string" ? value.playerName : "",
    actions: value.actions.map(({ action, actorId }) => ({
      action: structuredClone(action),
      actorId,
    })),
    autoActions: normalizeAutoActions(value.autoActions),
    opponentPortraits: normalizeOpponentPortraits(value.opponentPortraits),
    opponentNames: normalizeOpponentNames(value.opponentNames),
    playerPresentations: normalizePlayerPresentations(value.playerPresentations),
    checkpoint: normalizeCheckpoint(value.checkpoint, value.actions.length),
  };
}

function normalizeOpponentPortraits(value) {
  const portraits = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    ["right", "opposite", "left"].map((position) => [
      position,
      typeof portraits[position] === "string" ? portraits[position] : "",
    ]),
  );
}

function normalizeOpponentNames(value) {
  const names = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    ["right", "opposite", "left"].map((position) => [
      position,
      typeof names[position] === "string" ? names[position] : "",
    ]),
  );
}

function normalizePlayerPresentations(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([playerId, presentation]) => {
        if (!playerId || !presentation || typeof presentation !== "object") {
          return null;
        }
        const theme = presentation.themeCharacter;
        const result = {
          avatarPreference: presentation.avatarPreference === "theme"
            ? "theme"
            : "auto",
        };
        if (
          theme &&
          typeof theme === "object" &&
          typeof theme.packId === "string" &&
          typeof theme.characterId === "string" &&
          theme.packId &&
          theme.characterId
        ) {
          result.themeCharacter = {
            packId: theme.packId,
            characterId: theme.characterId,
          };
        }
        if (typeof presentation.builtinCharacterId === "string" && presentation.builtinCharacterId) {
          result.builtinCharacterId = presentation.builtinCharacterId;
        }
        return [playerId, result];
      })
      .filter(Boolean),
  );
}

function normalizeCheckpoint(value, actionCount) {
  if (!isPlainObject(value)) return null;
  if (value.formatVersion !== MAHJONG_SOLO_CHECKPOINT_VERSION) return null;
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex > actionCount ||
    !isPlainObject(value.state) ||
    (!Array.isArray(value.events) && !isPlainObject(value.events)) ||
    value.engineVersion !== MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION ||
    !Number.isSafeInteger(value.stateVersion) ||
    value.stateVersion < 0
  ) {
    return null;
  }
  return {
    formatVersion: MAHJONG_SOLO_CHECKPOINT_VERSION,
    actionIndex: value.actionIndex,
    state: structuredClone(value.state),
    events: structuredClone(value.events),
    engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
    stateVersion: value.stateVersion,
  };
}

function normalizeAutoActions(value) {
  return {
    autoWin: value?.autoWin === true,
    passClaims: value?.passClaims === true,
    autoTsumogiri: value?.autoTsumogiri === true,
  };
}

function isSavedAction(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.action) &&
    typeof value.actorId === "string"
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
