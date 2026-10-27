import { usesMahjongOpfs } from "../storage/environment.js";
import { openMahjongPaipuOpfs } from "../storage/paipu-opfs.js";
import {
  hasCompleteRoomPaipuHandSequence,
  mergeRoomPaipuFragmentRecord,
} from "./room-paipu.js";

export const MAHJONG_PAIPU_DB_NAME = "playweft-mahjong";
export const MAHJONG_PAIPU_DB_VERSION = 1;
export const MAHJONG_PAIPU_MAX_RECORDS = 500;
export const MAHJONG_PAIPU_MAX_BYTES = 50 * 1024 * 1024;
export const MAHJONG_PAIPU_MAX_RECORD_BYTES = 2 * 1024 * 1024;

async function saveMahjongPaipuImpl(record, options = {}) {
  const maxRecords = options.maxRecords ?? MAHJONG_PAIPU_MAX_RECORDS;
  const maxBytes = options.maxBytes ?? MAHJONG_PAIPU_MAX_BYTES;
  const maxRecordBytes = options.maxRecordBytes ?? MAHJONG_PAIPU_MAX_RECORD_BYTES;
  const db = await openPaipuStorage(options);
  try {
    if (record?.roomFragment === true) {
      const previous = await readOne(db, "records", record.id);
      if (previous?.status === "completed") {
        return { saved: false, reason: "duplicate" };
      }
      const merged = mergeRoomPaipuFragmentRecord(previous, record);
      if (!merged) return { saved: false, reason: "invalid_fragment" };
      const byteSize = encodedByteSize(merged);
      if (byteSize > maxRecordBytes) {
        return { saved: false, reason: "record_too_large" };
      }
      if (record.status !== "completed") {
        await writeProgressRecord(db, merged);
        return { saved: true, completed: false };
      }
      if (!hasCompleteRoomPaipuHandSequence(merged)) {
        return { saved: false, reason: "missing_hands" };
      }
      const normalized = validateMahjongPaipu(merged);
      return await saveCompletedRecord(db, normalized, {
        maxRecords,
        maxBytes,
        maxRecordBytes,
      });
    }

    const normalized = validateMahjongPaipu(record);
    return await saveCompletedRecord(db, normalized, {
      maxRecords,
      maxBytes,
      maxRecordBytes,
    });
  } finally {
    db.close();
  }
}

async function saveCompletedRecord(
  db,
  normalized,
  { maxRecords, maxBytes, maxRecordBytes },
) {
  const byteSize = encodedByteSize(normalized);
  if (byteSize > maxRecordBytes) return { saved: false, reason: "record_too_large" };

  const summaries = await readAll(db, "matches");
  const retained = summaries.filter((entry) => entry.id !== normalized.id);
  let totalBytes = retained.reduce(
    (total, entry) => total + Math.max(0, Number(entry.byteSize) || 0),
    0,
  );
  const evictedIds = [];
  const candidates = retained
    .filter((entry) => entry.pinned !== true)
    .sort((left, right) => Number(left.endedAtMs) - Number(right.endedAtMs));
  while (
    retained.length - evictedIds.length >= maxRecords ||
    totalBytes + byteSize > maxBytes
  ) {
    const oldest = candidates.shift();
    if (!oldest) return { saved: false, reason: "storage_limit" };
    evictedIds.push(oldest.id);
    totalBytes -= Math.max(0, Number(oldest.byteSize) || 0);
  }

  const previous = summaries.find((entry) => entry.id === normalized.id);
  const summary = {
    ...summarizeMahjongPaipu(normalized, byteSize),
    pinned: previous?.pinned === true || normalized.pinned === true,
  };
  await writeRecords(db, normalized, summary, evictedIds);
  return { saved: true, completed: true, evictedIds };
}

async function listMahjongPaipuSummariesImpl(options = {}) {
  const db = await openPaipuStorage(options);
  try {
    const summaries = await readAll(db, "matches");
    return summaries.sort((left, right) => Number(right.endedAtMs) - Number(left.endedAtMs));
  } finally {
    db.close();
  }
}

async function loadMahjongPaipuImpl(id, options = {}) {
  const db = await openPaipuStorage(options);
  try {
    const record = await readOne(db, "records", id);
    return record ? validateMahjongPaipu(record) : null;
  } finally {
    db.close();
  }
}

async function setMahjongPaipuPinnedImpl(id, pinned, options = {}) {
  const db = await openPaipuStorage(options);
  try {
    if (db.opfs) return await db.setPinned(id, pinned);
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("matches", "readwrite");
      const store = transaction.objectStore("matches");
      const request = store.get(id);
      request.onerror = () => reject(request.error || new Error("Unable to read Mahjong paipu summary"));
      request.onsuccess = () => {
        if (!request.result) {
          resolve(false);
          return;
        }
        request.result.pinned = pinned === true;
        store.put(request.result);
        transaction.oncomplete = () => resolve(true);
      };
      transaction.onerror = () => reject(transaction.error || new Error("Unable to update Mahjong paipu summary"));
    });
  } finally {
    db.close();
  }
}

export function summarizeMahjongPaipu(record, byteSize = encodedByteSize(record)) {
  const players = record.players
    .map((player) => ({
      seat: Number(player.seat),
      id: player.id,
      name: player.name || "",
      score: Number(record.final.scores[Number(player.seat) - 1]) || 0,
    }))
    .sort((left, right) => left.seat - right.seat);
  const localPlayer = players.find((player) => player.id === record.viewerPlayerId);
  const localSeatIndex = Math.max(0, Number(localPlayer?.seat) - 1);
  return {
    id: record.id,
    endedAtMs: record.completedAtMs,
    matchType: record.game.matchType,
    viewerPlayerId: record.viewerPlayerId,
    playerName: localPlayer?.name || "",
    players,
    finalScores: [...record.final.scores],
    rank: Number(record.final.ranks[localSeatIndex]) || 0,
    handCount: record.hands.length,
    byteSize,
    pinned: Boolean(record.pinned),
  };
}

export function validateMahjongPaipu(record) {
  if (!isPlainObject(record)) throw new TypeError("Invalid Mahjong paipu");
  if (record.format !== "longern.riichi.paipu" || record.formatVersion !== 3) {
    throw new TypeError("Unsupported Mahjong paipu format");
  }
  if (typeof record.id !== "string" || !record.id) {
    throw new TypeError("Mahjong paipu requires an id");
  }
  if (record.status !== "completed" || !Number.isSafeInteger(record.completedAtMs)) {
    throw new TypeError("Only completed Mahjong paipu records can be saved");
  }
  if (typeof record.viewerPlayerId !== "string" || !record.viewerPlayerId) {
    throw new TypeError("Mahjong paipu requires a viewer player id");
  }
  if (!isPlainObject(record.game) || !Array.isArray(record.players) || record.players.length !== 4) {
    throw new TypeError("Mahjong paipu requires four players");
  }
  if (!record.players.some((player) => player?.id === record.viewerPlayerId)) {
    throw new TypeError("Mahjong paipu viewer player id is not in the player list");
  }
  if (!Array.isArray(record.hands) || record.hands.length === 0) {
    throw new TypeError("Mahjong paipu requires at least one hand");
  }
  validateCanonicalPlayers(record.players);
  for (const hand of record.hands) validateHand(hand);
  if (record.playerPresentations !== undefined &&
      (!record.playerPresentations || typeof record.playerPresentations !== "object" || Array.isArray(record.playerPresentations))) {
    throw new TypeError("Mahjong paipu has invalid player presentations");
  }
  if (
    !isPlainObject(record.final) ||
    !isScoreArray(record.final.scores) ||
    !isRankArray(record.final.ranks)
  ) {
    throw new TypeError("Mahjong paipu has an invalid final result");
  }
  if ("endReason" in record.final ||
      (record.final.endReasonId !== undefined && typeof record.final.endReasonId !== "string")) {
    throw new TypeError("Mahjong paipu final result must use a reason id");
  }
  return structuredClone(record);
}

function validateHand(hand) {
  if (!isPlainObject(hand) || !isWallEncoding(hand.wall)) {
    throw new TypeError("Mahjong paipu contains an invalid hand wall");
  }
  if (!Array.isArray(hand.commands) || !Array.isArray(hand.events) || !isPlainObject(hand.end)) {
    throw new TypeError("Mahjong paipu contains an incomplete hand");
  }
  validateHandEnd(hand.end);
  for (const event of hand.events) {
    if (!isPlainObject(event) || ("reason" in event) ||
        (event.reasonId !== undefined && typeof event.reasonId !== "string")) {
      throw new TypeError("Mahjong paipu contains a language-dependent event");
    }
  }
  for (const command of hand.commands) validateSemanticCommand(command);
  if (hand.scoreHistoryBefore !== undefined && !isScoreHistoryArray(hand.scoreHistoryBefore)) {
    throw new TypeError("Mahjong paipu contains an invalid score history snapshot");
  }
}

function validateHandEnd(end) {
  for (const key of ["abortiveReason", "matchEndReason", "winType", "draw", "winners", "result"]) {
    if (key in end) throw new TypeError("Mahjong paipu contains a language-dependent hand result");
  }
  const winnerSeats = arrayOrEmptyObject(end.winnerSeats);
  const results = arrayOrEmptyObject(end.results);
  if (!new Set(["ron", "tsumo", "nagashi", "exhaustive_draw", "abortive_draw"]).has(end.kind) ||
      !winnerSeats || !winnerSeats.every((seat) => Number.isInteger(seat) && seat >= 1 && seat <= 4) ||
      !results) {
    throw new TypeError(`Mahjong paipu contains an incomplete hand result: ${JSON.stringify(end)}`);
  }
  if (end.abortiveReasonId !== undefined && typeof end.abortiveReasonId !== "string") {
    throw new TypeError("Mahjong paipu contains an invalid abortive reason id");
  }
  if (end.matchEndReasonId !== undefined && typeof end.matchEndReasonId !== "string") {
    throw new TypeError("Mahjong paipu contains an invalid match end reason id");
  }
  for (const result of results) {
    const payments = arrayOrEmptyObject(result?.payments);
    if (!isPlainObject(result) || !payments || "payment" in result || "paymentEdges" in result) {
      throw new TypeError("Mahjong paipu contains an unstructured payment");
    }
    for (const payment of payments) {
      if (!isPlainObject(payment) || !Number.isInteger(payment.fromSeat) || payment.fromSeat < 0 || payment.fromSeat > 4 ||
          !Number.isInteger(payment.toSeat) || payment.toSeat < 1 || payment.toSeat > 4 ||
          !Number.isFinite(payment.amount) || payment.amount <= 0 || typeof payment.kind !== "string") {
        throw new TypeError("Mahjong paipu contains an invalid payment edge");
      }
    }
    if (result.limit !== undefined &&
        (!isPlainObject(result.limit) || typeof result.limit.id !== "string" ||
         !Number.isFinite(Number(result.limit.yakumanUnits)))) {
      throw new TypeError("Mahjong paipu contains an invalid limit");
    }
    if (result.yaku !== undefined && (!Array.isArray(result.yaku) || result.yaku.some((entry) =>
      !isPlainObject(entry) || typeof entry.id !== "string" || !Number.isFinite(Number(entry.han)) || "name" in entry))) {
      throw new TypeError("Mahjong paipu contains language-dependent yaku data");
    }
    if ("reason" in result || "name" in result) {
      throw new TypeError("Mahjong paipu contains language-dependent result data");
    }
  }
}

function arrayOrEmptyObject(value) {
  if (Array.isArray(value)) return value;
  return isPlainObject(value) && Object.keys(value).length === 0 ? [] : null;
}

function validateCanonicalPlayers(players) {
  const ids = new Set();
  players.forEach((player, index) => {
    if (!isPlainObject(player) || player.seat !== index + 1 || typeof player.id !== "string" || !player.id) {
      throw new TypeError("Mahjong paipu players must use canonical opening seats");
    }
    if (ids.has(player.id)) throw new TypeError("Mahjong paipu player ids must be unique");
    ids.add(player.id);
  });
}

function validateSemanticCommand(command) {
  if (!isPlainObject(command) || !Number.isInteger(command.seat) || command.seat < 1 || command.seat > 4 || !isPlainObject(command.action)) {
    throw new TypeError("Mahjong paipu contains an invalid command");
  }
  const action = command.action;
  const simple = new Set(["pass", "tsumo", "abort_nine"]);
  if (simple.has(action.type)) return;
  if (action.type === "discard" || action.type === "riichi") {
    if (!isTileCode(action.tile) || typeof action.tsumogiri !== "boolean") throw new TypeError("Mahjong paipu contains an invalid semantic discard");
    if ("tileId" in action || "ref" in action || "option" in action) throw new TypeError("Mahjong paipu contains runtime action identity");
    return;
  }
  if (["chi", "pon", "daiminkan"].includes(action.type)) {
    const expected = action.type === "daiminkan" ? 3 : 2;
    if (!Array.isArray(action.tiles) || action.tiles.length !== expected || !action.tiles.every(isTileCode)) {
      throw new TypeError("Mahjong paipu contains an invalid semantic claim");
    }
    if ("option" in action) throw new TypeError("Mahjong paipu contains a runtime claim option");
    return;
  }
  if (action.type === "ron") return;
  if (action.type === "ankan" || action.type === "kakan") {
    if (!isTileCode(action.tile)) throw new TypeError("Mahjong paipu contains an invalid semantic kan");
    return;
  }
  throw new TypeError("Mahjong paipu contains an unsupported semantic action");
}

function isTileCode(value) {
  return typeof value === "string" && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(value);
}

function isWallEncoding(value) {
  if (typeof value !== "string" || value.length !== 272) return false;
  for (let index = 0; index < value.length; index += 2) {
    const tile = value.slice(index, index + 2);
    if (!/^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(tile)) return false;
  }
  return true;
}

function isScoreArray(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
}

function isScoreHistoryArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) =>
    isPlainObject(entry) &&
    Number.isInteger(entry.roundWind) &&
    Number.isInteger(entry.handNumber) &&
    Number.isInteger(entry.honba) &&
    isScoreArray(entry.scores)
  );
}

function isRankArray(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isInteger);
}

function encodedByteSize(value) {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).byteLength;
}

function openMahjongPaipuDatabase(indexedDB = globalThis.indexedDB) {
  if (!indexedDB?.open) throw new Error("Mahjong paipu storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MAHJONG_PAIPU_DB_NAME, MAHJONG_PAIPU_DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Unable to open Mahjong paipu storage"));
    request.onupgradeneeded = () => {
      const db = request.result;
      const matches = db.objectStoreNames.contains("matches")
        ? request.transaction.objectStore("matches")
        : db.createObjectStore("matches", { keyPath: "id" });
      if (!matches.indexNames.contains("endedAtMs")) {
        matches.createIndex("endedAtMs", "endedAtMs");
      }
      if (!db.objectStoreNames.contains("records")) {
        db.createObjectStore("records", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function readAll(db, storeName) {
  if (db.opfs) return db.readAll(storeName);
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

function readOne(db, storeName, id) {
  if (db.opfs) return db.readOne(storeName, id);
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(id));
}

function writeProgressRecord(db, record) {
  if (db.opfs) return db.writeProgress(record);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to save Mahjong room paipu progress"));
    transaction.onabort = () => reject(transaction.error || new Error("Mahjong room paipu progress save was aborted"));
    transaction.objectStore("records").put(record);
  });
}

function writeRecords(db, record, summary, evictedIds) {
  if (db.opfs) return db.writeRecords(record, summary, evictedIds);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["matches", "records"], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to save Mahjong paipu"));
    transaction.onabort = () => reject(transaction.error || new Error("Mahjong paipu save was aborted"));
    const matches = transaction.objectStore("matches");
    const records = transaction.objectStore("records");
    for (const id of evictedIds) {
      matches.delete(id);
      records.delete(id);
    }
    matches.put(summary);
    records.put(record);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Mahjong paipu storage request failed"));
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

let opfsConnection;
let opfsTail = Promise.resolve();
function useOpfs(options) {
  return Boolean(options.opfs) || (options.indexedDB === undefined && usesMahjongOpfs());
}
async function openPaipuStorage(options) {
  if (!useOpfs(options)) return openMahjongPaipuDatabase(options.indexedDB);
  if (options.opfs) return options.opfs;
  if (!opfsConnection) {
    opfsConnection = (async () => {
      const storage = await openMahjongPaipuOpfs();
      await storage.migrate(async () => {
        const db = await openMahjongPaipuDatabase();
        try {
          return { records: await readAll(db, "records"), matches: await readAll(db, "matches") };
        } finally { db.close(); }
      });
      return storage;
    })();
    void opfsConnection.catch(() => { opfsConnection = undefined; });
  }
  return opfsConnection;
}
function runPaipuOperation(action, options) {
  if (!useOpfs(options)) return action();
  // Serialize complete read/modify/write operations, including retention and
  // fragment merging. Web Locks also coordinates multiple same-partition tabs.
  const result = opfsTail.then(() => globalThis.navigator?.locks?.request
    ? navigator.locks.request("mahjong-paipu-opfs", action) : action());
  opfsTail = result.catch(() => {});
  return result;
}
export function saveMahjongPaipu(record, options = {}) {
  return runPaipuOperation(() => saveMahjongPaipuImpl(record, options), options);
}
export function listMahjongPaipuSummaries(options = {}) {
  return runPaipuOperation(() => listMahjongPaipuSummariesImpl(options), options);
}
export function loadMahjongPaipu(id, options = {}) {
  return runPaipuOperation(() => loadMahjongPaipuImpl(id, options), options);
}
export function setMahjongPaipuPinned(id, pinned, options = {}) {
  return runPaipuOperation(() => setMahjongPaipuPinnedImpl(id, pinned, options), options);
}
