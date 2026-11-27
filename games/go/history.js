import { goAiPlayerName, goTieBreakLabel } from "./rules.js";
import { applySoloGoAction, createSoloGoState } from "./solo.js";

export const GO_HISTORY_KEY = "playweft:go-history:v1";
const ARCHIVE_FORMAT = "playweft-go-history";
const ARCHIVE_VERSION = 1;
const RECORD_FORMAT = "playweft-go-record";
const HISTORY_LIMIT = 50;

export function createGoHistoryStore(getStorage = () => window.localStorage) {
  let memory = [];
  let persistent = true;

  return {
    load() {
      try {
        const storage = getStorage();
        const value = storage.getItem(GO_HISTORY_KEY);
        if (value) {
          const parsed = JSON.parse(value);
          const sourceRecords =
            parsed?.format === ARCHIVE_FORMAT &&
            Number(parsed.formatVersion) === ARCHIVE_VERSION &&
            Array.isArray(parsed.records)
              ? parsed.records
              : [];
          memory = nonEmptyHistoryRecords(sourceRecords);
          if (memory.length !== sourceRecords.length ||
              memory.some(record => !sourceRecords.includes(record))) {
            writeArchive(storage, memory);
          }
        }
      } catch {
        persistent = false;
      }
      return memory;
    },
    save(records) {
      memory = nonEmptyHistoryRecords(records);
      try {
        writeArchive(getStorage(), memory);
      } catch {
        persistent = false;
      }
    },
    get persistent() {
      return persistent;
    },
  };
}

function nonEmptyHistoryRecords(records) {
  return records.filter(
    (record) =>
      record?.format === RECORD_FORMAT &&
      Number(record.formatVersion) === ARCHIVE_VERSION &&
      Array.isArray(record.moves) &&
      record.moves.length > 0,
  ).map(record => {
    const moves = normalizeMoveTimes(record.moves);
    return moves === record.moves ? record : { ...record, moves };
  });
}

// Older archives stored each turn's duration and that colour's total clock.
// Reading an archive upgrades these fields once through the same storage backend.
function normalizeMoveTimes(moves = []) {
  let elapsed = 0;
  let changed = false;
  const clocks = { B: 0, W: 0 };
  const normalized = moves.map(original => {
    const { elapsedMs, cumulativeMs, ...move } = original;
    const duration = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs)
      : Number.isFinite(cumulativeMs) ? Math.max(0, cumulativeMs - clocks[move.color]) : 0;
    const next = Number.isFinite(move.elapsedFromStartMs)
      ? Math.max(elapsed, move.elapsedFromStartMs) : elapsed + duration;
    clocks[move.color] = (clocks[move.color] ?? 0) + next - elapsed;
    elapsed = next;
    if (!("elapsedMs" in original) && !("cumulativeMs" in original) &&
        move.elapsedFromStartMs === elapsed) return original;
    changed = true;
    return { ...move, elapsedFromStartMs: elapsed };
  });
  return changed ? normalized : moves;
}

// Include only inputs that affect analysis. Clock, status and save revisions
// must not invalidate results; changing the model or the position must.
export function goRecordAnalysisKey(record, modelUrl) {
  const settings = record.settings ?? {};
  return JSON.stringify([1, modelUrl, settings.size, settings.rules,
    settings.komi, settings.handicap, record.initialBlack ?? [],
    record.moves.map(move => [move.color, Boolean(move.pass),
      move.pass ? 0 : move.row, move.pass ? 0 : move.column])]);
}

export function updateGoRecordAnalysis(records, recordId, modelUrl, analysis) {
  const record = records.find(entry => entry.id === recordId);
  if (!record || !modelUrl || analysis?.formatVersion !== 1 || !Array.isArray(analysis.results) ||
      analysis.key !== goRecordAnalysisKey(record, modelUrl) ||
      analysis.results.length !== record.moves.length + 1) return records;
  return records.map(entry => entry === record ? { ...entry,
    analysis: { ...structuredClone(analysis), modelUrl },
  } : entry);
}

function writeArchive(storage, records) {
  storage.setItem(
    GO_HISTORY_KEY,
    JSON.stringify({
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_VERSION,
      savedAt: Date.now(),
      records,
    }),
  );
}

export function updateGoHistory(records, snapshot, recordedAt = Date.now()) {
  const { matchId, version, state, events = [] } = snapshot;
  if (!matchId || !state || state.phase === "setup") return records;

  const id = `${matchId}:${state.round ?? 1}`;
  const nextRecords = records.map((record) => ({
    ...record,
    settings: { ...record.settings },
    initialBlack: [...(record.initialBlack ?? [])],
    moves: [...normalizeMoveTimes(record.moves)],
    captures: [...(record.captures ?? [])],
    timeUsed: [...(record.timeUsed ?? [])],
    resume: record.resume ? structuredClone(record.resume) : null,
  }));
  let record = nextRecords.find((entry) => entry.id === id);
  const moveCount = Math.max(0, Number(state.moves) || 0);
  const versionNumber = Number(version);
  const hasVersion = Number.isFinite(versionNumber);
  if (
    record &&
    hasVersion &&
    Number.isFinite(Number(record.lastVersion)) &&
    versionNumber <= Number(record.lastVersion)
  ) {
    return records;
  }

  if (!record && moveCount === 0) return records;

  if (!record) {
    const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
    const whiteIndex = blackIndex === 0 ? 1 : 0;
    record = {
      format: RECORD_FORMAT,
      formatVersion: ARCHIVE_VERSION,
      id,
      matchId,
      mode: snapshot.mode ?? "room",
      round: Number(state.round) || 1,
      blackIndex: Number(state.blackIndex),
      createdAt: recordedAt,
      updatedAt: recordedAt,
      status: state.phase,
      settings: { ...state.settings },
      blackPlayer: state.playerNames?.[blackIndex] || `玩家 ${blackIndex + 1}`,
      whitePlayer: state.playerNames?.[whiteIndex] || `玩家 ${whiteIndex + 1}`,
      initialBlack:
        moveCount === 1 ? collectInitialBlackBeforeFirstMove(state) : [],
      partial: moveCount > 1,
      moves: [],
      timeUsed: [0, 0],
    };
    nextRecords.push(record);
  }

  const undoAccepted = events.some((event) => event?.type === "undo_accepted");
  if (undoAccepted) {
    record.moves = record.moves.slice(0, Math.max(0, Number(state.moves) || 0));
    if (!state.ended) {
      delete record.result;
      delete record.endedAt;
    }
  }

  const moveEvents = events.filter(
    (event) => event?.type === "played" || event?.type === "passed",
  );
  if (
    !undoAccepted &&
    moveEvents.length === 0 &&
    (Number(state.moves) || 0) > record.moves.length
  ) {
    const fallback = fallbackMoveEvent(state);
    if (fallback) moveEvents.push(fallback);
  }
  for (const event of moveEvents) {
    appendMove(record, event, state, hasVersion ? versionNumber : undefined);
  }

  record.updatedAt = recordedAt;
  record.mode = snapshot.mode ?? record.mode ?? "room";
  record.status = state.ended ? "ended" : state.phase;
  record.settings = { ...state.settings };
  if (record.analysis && record.analysis.key !== goRecordAnalysisKey(record, record.analysis.modelUrl)) {
    delete record.analysis;
  }
  record.blackIndex = Number(state.blackIndex);
  if (record.mode === "solo" && state.settings?.opponent === "ai") {
    const blackIsHuman = Number(state.blackIndex) === 1;
    const aiName = goAiPlayerName(state.settings);
    record.blackPlayer = blackIsHuman ? "你" : aiName;
    record.whitePlayer = blackIsHuman ? aiName : "你";
  }
  record.captures = [...(state.captures ?? [0, 0])];
  record.timeUsed = [...(state.timeUsed ?? [0, 0])];
  if (hasVersion) record.lastVersion = versionNumber;
  record.resume =
    record.mode === "solo" && !state.ended
      ? createResumeSnapshot(state, recordedAt)
      : null;
  if (state.ended) {
    const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
    record.endedAt ??= recordedAt;
    record.result = {
      winnerColor: Number(state.winnerIndex) > 0
        ? Number(state.winnerIndex) - 1 === blackIndex ? "B" : "W"
        : "",
      black: Number(state.scores?.black) || 0,
      white: Number(state.scores?.white) || 0,
      reason:
        state.lastEvent?.kind === "player_left" ||
        state.lastEvent?.kind === "resigned"
          ? "resign"
          : "score",
    };
  }

  if (moveCount === 0 && record.moves.length === 0) {
    return nextRecords.filter((entry) => entry.id !== id);
  }

  return nextRecords
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, HISTORY_LIMIT);
}

export function updateGoResumeSnapshot(
  records,
  matchId,
  state,
  savedAt = Date.now(),
) {
  if (!matchId || !state || state.ended || (Number(state.moves) || 0) <= 0) {
    return records;
  }
  const id = `${matchId}:${state.round ?? 1}`;
  const record = records.find((entry) => entry.id === id);
  if (!record || record.mode !== "solo") return records;
  const resume = createResumeSnapshot(state, savedAt);
  const nextRecords = records.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          updatedAt: savedAt,
          timeUsed: [...resume.state.timeUsed],
          resume,
        }
      : entry,
  );
  return nextRecords.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function restoreGoResumeState(record, resumedAt = Date.now()) {
  if (!canResumeGoRecord(record)) return undefined;
  const state = structuredClone(record.resume.state);
  state.settings.tieBreak ??= "white";
  state.firstPassIndex ??= firstPassIndex(record.moves, state.blackIndex);
  if (state.undoSnapshot) {
    state.undoSnapshot.firstPassIndex ??= firstPassIndex(
      record.moves.slice(0, state.undoSnapshot.moves), state.blackIndex,
    );
  }
  if (state.settings.opponent === "ai" && !Array.isArray(state.undoHistory)) {
    const replayed = replayGoRecord({ ...record, settings: state.settings });
    if (replayed) {
      state.undoHistory = replayed.state.undoHistory;
      // Keep the latest saved snapshot, which also contains the actual clocks.
      if (state.undoSnapshot && state.undoHistory.length) {
        state.undoHistory[state.undoHistory.length - 1] = state.undoSnapshot;
      }
      state.undoSnapshot = state.undoHistory.at(-1) ?? state.undoSnapshot;
      state.undoAvailable = Boolean(state.undoSnapshot);
    }
  }
  state.turnStartedAt = state.phase === "playing" ? resumedAt : 0;
  return state;
}

function firstPassIndex(moves = [], blackIndex) {
  const move = moves.find((entry) => entry.pass);
  return !move ? 0 : move.color === "B" ? blackIndex : (blackIndex % 2) + 1;
}

export function goRecordToReplayFrames(record) {
  return replayGoRecord(record)?.frames ?? [];
}

export function goRecordToReview(record) {
  if (!record || record.partial) return;
  return replayGoRecord(record);
}

function replayGoRecord(record) {
  if (!Array.isArray(record?.moves) || !record.settings) return;
  const blackIndex = Number(record.blackIndex ?? record.resume?.state?.blackIndex ??
    (record.settings.blackMode === "player2" ? 2 : 1));
  if (blackIndex !== 1 && blackIndex !== 2) return;

  const setup = createSoloGoState();
  setup.round = Number(record.round) || 1;
  const started = applySoloGoAction(
    setup,
    { type: "start", ...record.settings, blackMode: blackIndex === 1 ? "player1" : "player2" },
    {
      now: Number(record.createdAt) || 0,
      random: () => (blackIndex === 1 ? 0 : 1),
    },
  );
  if (!started.accepted) return;

  let replayState = started.state;
  const frames = [createReplayFrame(replayState)];
  for (const [index, move] of normalizeMoveTimes(record.moves).entries()) {
    const currentIndex = Number(replayState.current) - 1;
    const currentColor = currentIndex + 1 === blackIndex ? "B" : "W";
    if (move.color !== currentColor) return;
    const result = applySoloGoAction(
      replayState,
      move.pass
        ? { type: "pass" }
        : { type: "play", row: move.row, column: move.column },
      { now: (Number(record.createdAt) || 0) + move.elapsedFromStartMs },
    );
    if (!result.accepted) return;
    replayState = result.state;
    frames.push(
      createReplayFrame(replayState, {
        number: index + 1,
        color: move.color === "B" ? 1 : 2,
        pass: Boolean(move.pass),
        row: Number(move.row) || 0,
        column: Number(move.column) || 0,
      }),
    );
  }
  return { frames, state: replayState };
}

export function canResumeGoRecord(record) {
  return Boolean(
    record?.format === RECORD_FORMAT &&
      Number(record.formatVersion) === ARCHIVE_VERSION &&
      record.mode === "solo" &&
      Number(record.resume?.formatVersion) === 1 &&
      record.resume?.state &&
      !record.resume.state.ended,
  );
}

export function latestGoResumeRecord(records) {
  return records.reduce((latest, record) => {
    if (!canResumeGoRecord(record) || record.result ||
        !["playing", "scoring"].includes(record.resume.state.phase)) return latest;
    return !latest || (Number(record.updatedAt) || 0) > (Number(latest.updatedAt) || 0) ? record : latest;
  }, undefined);
}

export function goResumeModeLabel(record) {
  const settings = record.resume.state.settings;
  return settings.opponent !== "ai" ? "本地双人"
    : settings.aiModel === "b18" ? "困难人机" : "普通人机";
}

function createResumeSnapshot(state, savedAt) {
  const resumeState = structuredClone(state);
  const activePlayerIndex =
    resumeState.phase === "playing" ? Number(resumeState.current) - 1 : -1;
  if (
    activePlayerIndex >= 0 &&
    Number.isFinite(Number(resumeState.turnStartedAt)) &&
    Number(resumeState.turnStartedAt) > 0
  ) {
    resumeState.timeUsed = [...(resumeState.timeUsed ?? [0, 0])];
    resumeState.timeUsed[activePlayerIndex] =
      (Number(resumeState.timeUsed[activePlayerIndex]) || 0) +
      Math.max(0, savedAt - Number(resumeState.turnStartedAt));
  }
  resumeState.turnStartedAt = 0;
  return {
    formatVersion: 1,
    savedAt,
    state: resumeState,
  };
}

function createReplayFrame(state, move) {
  return {
    current: state.current || (state.lastEvent?.playerIndex === 1 ? 2 : 1),
    captures: [...state.captures],
    moveNumber: Math.max(0, Number(state.moves) || 0),
    elapsedFromStartMs: (state.timeUsed ?? []).reduce((sum, value) => sum + value, 0),
    board: (state.board ?? []).map((row) => [...row]),
    lastMove: { ...state.lastMove },
    lastEvent: { ...state.lastEvent },
    move,
  };
}

export function goRecordToSgf(record) {
  const settings = record.settings ?? {};
  const properties = [
    "GM[1]",
    "FF[4]",
    "CA[UTF-8]",
    "AP[Playweft]",
    `SZ[${settings.size ?? 19}]`,
    `KM[${settings.komi ?? 0}]`,
    `RU[${settings.rules === "japanese" ? "Japanese" : "Chinese"}]`,
    `PB[${escapeSgf(record.blackPlayer ?? "黑方")}]`,
    `PW[${escapeSgf(record.whitePlayer ?? "白方")}]`,
    `DT[${new Date(record.createdAt).toISOString().slice(0, 10)}]`,
  ];
  const handicap = Number(settings.handicap) || 0;
  if (handicap > 0) properties.push(`HA[${handicap}]`);
  if (record.initialBlack?.length) {
    properties.push(
      `AB${record.initialBlack.map((point) => `[${toSgfPoint(point)}]`).join("")}`,
    );
  }
  if (settings.tieBreak) properties.push(`C[平分判定：${escapeSgf(goTieBreakLabel(settings.tieBreak))}]`);
  const result = formatSgfResult(record.result);
  if (result) properties.push(`RE[${result}]`);

  const moves = (record.moves ?? []).map((move) => {
    const point = move.pass ? "" : toSgfPoint(move);
    return `;${move.color}[${point}]`;
  });
  return `(;${properties.join("")}${moves.join("")})`;
}

export function historyResultLabel(record) {
  if (record.status === "scoring") return "计分确认中";
  if (!record.result) return "进行中";
  if (!record.result.winnerColor) return "和棋";
  if (record.result.reason === "resign") {
    return `${record.result.winnerColor === "B" ? "黑方" : "白方"}胜`;
  }
  const difference = Math.abs(record.result.black - record.result.white);
  const winner = record.result.winnerColor === "B" ? "黑方" : "白方";
  return difference === 0 ? `${winner}胜（平分判定）`
    : `${winner}胜 ${formatNumber(difference)} 目`;
}

function appendMove(record, event, state, version) {
  if (
    version !== undefined &&
    record.moves.some((move) => move.version === version)
  ) {
    return;
  }
  const playerIndex = state.players?.indexOf(event.player) ?? -1;
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const color = playerIndex === blackIndex ? "B" : "W";
  const elapsedFromStartMs = (state.timeUsed ?? []).reduce(
    (sum, value) => sum + Math.max(0, Number(value) || 0), 0,
  );
  record.moves.push({
    color,
    pass: event.type === "passed",
    row: Number(event.row) || 0,
    column: Number(event.column) || 0,
    elapsedFromStartMs: Math.max(record.moves.at(-1)?.elapsedFromStartMs ?? 0, elapsedFromStartMs),
    ...(version === undefined ? {} : { version }),
  });
}

function fallbackMoveEvent(state) {
  const kind = state.lastEvent?.kind;
  if (kind !== "play" && kind !== "pass" && kind !== "scoring_started") return undefined;
  const playerIndex = Number(state.lastEvent.playerIndex) - 1;
  return {
    type: kind === "play" ? "played" : "passed",
    player: state.players?.[playerIndex],
    row: state.lastMove?.row,
    column: state.lastMove?.column,
  };
}

function collectInitialBlack(board = []) {
  const points = [];
  board.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (Number(value) === 1) {
        points.push({ row: rowIndex + 1, column: columnIndex + 1 });
      }
    });
  });
  return points;
}

function collectInitialBlackBeforeFirstMove(state) {
  const points = collectInitialBlack(state.board);
  if (state.lastEvent?.kind !== "play") return points;
  const playerIndex = Number(state.lastEvent.playerIndex) - 1;
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  if (playerIndex !== blackIndex) return points;
  const lastRow = Number(state.lastMove?.row);
  const lastColumn = Number(state.lastMove?.column);
  return points.filter(
    (point) => point.row !== lastRow || point.column !== lastColumn,
  );
}

function toSgfPoint(point) {
  return `${String.fromCharCode(96 + point.column)}${String.fromCharCode(96 + point.row)}`;
}

function formatSgfResult(result) {
  if (!result) return "";
  if (!result.winnerColor) return "0";
  if (result.reason === "resign") return `${result.winnerColor}+R`;
  const difference = Math.abs(result.black - result.white);
  return `${result.winnerColor}+${difference === 0 ? "" : formatNumber(difference)}`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeSgf(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}
