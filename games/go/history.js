import { goTieBreakLabel } from "./rules.js";
import { applySoloGoAction, createSoloGoState } from "./solo.js";

const STORAGE_KEY = "playweft:go-history:v1";
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
        const value = storage.getItem(STORAGE_KEY);
        if (value) {
          const parsed = JSON.parse(value);
          const sourceRecords =
            parsed?.format === ARCHIVE_FORMAT &&
            Number(parsed.formatVersion) === ARCHIVE_VERSION &&
            Array.isArray(parsed.records)
              ? parsed.records
              : [];
          memory = nonEmptyHistoryRecords(sourceRecords);
          if (memory.length !== sourceRecords.length) {
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
  );
}

function writeArchive(storage, records) {
  storage.setItem(
    STORAGE_KEY,
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
    moves: [...(record.moves ?? [])],
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
      createdAt: recordedAt,
      updatedAt: recordedAt,
      status: state.phase,
      settings: { ...state.settings },
      blackPlayer: `玩家 ${blackIndex + 1}`,
      whitePlayer: `玩家 ${whiteIndex + 1}`,
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
  state.turnStartedAt = state.phase === "playing" ? resumedAt : 0;
  return state;
}

function firstPassIndex(moves = [], blackIndex) {
  const move = moves.find((entry) => entry.pass);
  return !move ? 0 : move.color === "B" ? blackIndex : (blackIndex % 2) + 1;
}

export function goRecordToReplayFrames(record) {
  if (!Array.isArray(record?.moves) || !record.settings) return [];
  const blackIndex = Number(record.resume?.state?.blackIndex);
  if (blackIndex !== 1 && blackIndex !== 2) return [];

  const setup = createSoloGoState();
  setup.round = Number(record.round) || 1;
  const started = applySoloGoAction(
    setup,
    { type: "start", ...record.settings },
    {
      now: Number(record.createdAt) || 0,
      random: () => (blackIndex === 1 ? 0 : 1),
    },
  );
  if (!started.accepted) return [];

  let replayState = started.state;
  const frames = [createReplayFrame(replayState)];
  for (const [index, move] of record.moves.entries()) {
    const currentIndex = Number(replayState.current) - 1;
    const currentColor = currentIndex + 1 === blackIndex ? "B" : "W";
    if (move.color !== currentColor) return [];
    const result = applySoloGoAction(
      replayState,
      move.pass
        ? { type: "pass" }
        : { type: "play", row: move.row, column: move.column },
      { now: Number(record.createdAt) || 0 },
    );
    if (!result.accepted) return [];
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
  return frames;
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
    moveNumber: Math.max(0, Number(state.moves) || 0),
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
  const cumulativeMs = Math.max(
    0,
    Number(state.timeUsed?.[playerIndex]) || 0,
  );
  const previous = [...record.moves]
    .reverse()
    .find((move) => move.color === color);
  record.moves.push({
    color,
    pass: event.type === "passed",
    row: Number(event.row) || 0,
    column: Number(event.column) || 0,
    elapsedMs: Math.max(0, cumulativeMs - (previous?.cumulativeMs ?? 0)),
    cumulativeMs,
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
