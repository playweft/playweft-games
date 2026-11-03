import { DEFAULT_GO_SETTINGS, GO_TIE_BREAKS, goWinnerIndex } from "./rules.js";

const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function createSoloGoState() {
  return setupState(1, DEFAULT_GO_SETTINGS);
}

export function applySoloGoAction(
  sourceState,
  action,
  { now = Date.now(), random = Math.random } = {},
) {
  const state = structuredClone(sourceState);
  if (!action || typeof action !== "object") return rejected("INVALID_ACTION");

  if (state.phase === "setup") {
    if (action.type !== "start" && action.type !== "update_settings") {
      return rejected("SETUP_REQUIRED");
    }
    const settings = normalizeSettings(action);
    if (!settings) return rejected("INVALID_SETTINGS");
    if (action.type === "update_settings") {
      return accepted(
        setupState(state.round, settings),
        [{ type: "settings_updated", player: state.hostId }],
      );
    }
    return accepted(
      newRound(state.round, settings, now, random),
      [{ type: "started", player: state.hostId }],
    );
  }

  if (action.type === "rematch") {
    if (!state.ended) return rejected("GAME_NOT_OVER");
    return accepted(
      newRound(state.round + 1, state.settings, now, random),
      [{ type: "rematched", player: state.players[0] }],
    );
  }

  if (action.type === "configure") {
    if (!state.ended) return rejected("GAME_NOT_OVER");
    return accepted(
      setupState(state.round + 1, state.settings),
      [{ type: "configuration_opened", player: state.players[0] }],
    );
  }

  if (action.type === "resign") {
    if (state.ended || state.phase !== "playing") return rejected("GAME_OVER");
    const playerIndex = state.current - 1;
    const actor = state.players[playerIndex];
    recordTurnTime(state, playerIndex, now);
    state.ended = true;
    state.phase = "ended";
    state.current = 0;
    state.winnerIndex = ((playerIndex + 1) % state.players.length) + 1;
    state.winner = state.players[state.winnerIndex - 1];
    state.lastEvent = {
      kind: "resigned",
      playerIndex: playerIndex + 1,
      captured: 0,
    };
    return accepted(state, [{
      type: "resigned",
      player: actor,
      winner: state.winner,
    }]);
  }

  if (action.type === "undo") {
    if (state.ended || !state.undoAvailable || !state.undoSnapshot) {
      return rejected("NO_MOVE_TO_UNDO");
    }
    restoreUndoSnapshot(state, state.undoSnapshot, now);
    return accepted(state, [{ type: "undo_accepted", player: state.players[0] }]);
  }

  if (state.phase === "scoring") {
    if (action.type !== "score") return rejected("SCORING_REQUIRED");
    const scores = calculateGoScore(state);
    state.scores = scores;
    state.scoreSubmitted = [true, true];
    state.ended = true;
    state.phase = "ended";
    state.winnerIndex = goWinnerIndex(state, scores);
    state.winner = state.players[state.winnerIndex - 1] ?? "";
    state.lastEvent = { kind: "scored", playerIndex: 0, captured: 0 };
    return accepted(state, [{ type: "scored", winner: state.winner }]);
  }

  if (state.ended) return rejected("GAME_OVER");
  const playerIndex = state.current - 1;
  const actor = state.players[playerIndex];

  if (action.type === "pass") {
    state.undoSnapshot = createUndoSnapshot(state);
    state.undoAvailable = true;
    recordTurnTime(state, playerIndex, now);
    state.moves += 1;
    state.consecutivePasses += 1;
    if (!state.firstPassIndex) state.firstPassIndex = playerIndex + 1;
    state.lastMove = { row: 0, column: 0 };
    state.lastEvent = {
      kind: "pass",
      playerIndex: playerIndex + 1,
      captured: 0,
    };
    if (state.consecutivePasses >= 2) {
      state.phase = "scoring";
      state.current = 0;
      state.scoreRound += 1;
      state.scoreSubmitted = [false, false];
      return accepted(state, [{ type: "scoring_started", player: actor }]);
    }
    state.previousBoard = boardSignature(state.board);
    state.current = (state.current % state.players.length) + 1;
    return accepted(state, [{ type: "passed", player: actor }]);
  }

  if (action.type !== "play") return rejected("INVALID_ACTION");
  const row = Number(action.row);
  const column = Number(action.column);
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    !inside(state.board, row, column)
  ) {
    return rejected("INVALID_POINT");
  }
  if (state.board[row - 1][column - 1] !== 0) return rejected("OCCUPIED");

  const color = playerIndex + 1 === state.blackIndex ? 1 : 2;
  const opponent = color === 1 ? 2 : 1;
  const candidate = state.board.map((boardRow) => [...boardRow]);
  candidate[row - 1][column - 1] = color;
  const checked = new Set();
  let captured = 0;

  for (const [rowOffset, columnOffset] of DIRECTIONS) {
    const nextRow = row + rowOffset;
    const nextColumn = column + columnOffset;
    const key = pointKey(nextRow, nextColumn);
    if (
      inside(candidate, nextRow, nextColumn) &&
      candidate[nextRow - 1][nextColumn - 1] === opponent &&
      !checked.has(key)
    ) {
      const group = collectGroup(candidate, nextRow, nextColumn);
      for (const point of group.points) checked.add(pointKey(point.row, point.column));
      if (group.liberties === 0) {
        captured += group.points.length;
        for (const point of group.points) {
          candidate[point.row - 1][point.column - 1] = 0;
        }
      }
    }
  }

  if (collectGroup(candidate, row, column).liberties === 0) {
    return rejected("SUICIDE");
  }
  const signature = boardSignature(candidate);
  if (state.previousBoard && signature === state.previousBoard) {
    return rejected("KO");
  }

  state.undoSnapshot = createUndoSnapshot(state);
  state.undoAvailable = true;
  recordTurnTime(state, playerIndex, now);
  state.previousBoard = boardSignature(state.board);
  state.board = candidate;
  state.captures[playerIndex] += captured;
  state.consecutivePasses = 0;
  state.moves += 1;
  state.lastMove = { row, column };
  state.lastEvent = {
    kind: "play",
    playerIndex: playerIndex + 1,
    captured,
  };
  state.current = (state.current % state.players.length) + 1;
  return accepted(state, [{
    type: "played",
    player: actor,
    row,
    column,
    captured,
  }]);
}

export function calculateGoScore(state) {
  const board = state.board;
  const size = board.length;
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let neutral = 0;
  const visited = new Set();

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = Number(board[row]?.[column]) || 0;
      if (value === 1) {
        blackStones += 1;
        continue;
      }
      if (value === 2) {
        whiteStones += 1;
        continue;
      }

      const startKey = `${row}:${column}`;
      if (visited.has(startKey)) continue;
      const stack = [[row, column]];
      let regionSize = 0;
      const borders = new Set();
      visited.add(startKey);

      while (stack.length > 0) {
        const [regionRow, regionColumn] = stack.pop();
        regionSize += 1;
        for (const [rowOffset, columnOffset] of DIRECTIONS) {
          const nextRow = regionRow + rowOffset;
          const nextColumn = regionColumn + columnOffset;
          if (
            nextRow < 0 ||
            nextRow >= size ||
            nextColumn < 0 ||
            nextColumn >= size
          ) {
            continue;
          }
          const neighbor = Number(board[nextRow]?.[nextColumn]) || 0;
          if (neighbor !== 0) {
            borders.add(neighbor);
            continue;
          }
          const key = `${nextRow}:${nextColumn}`;
          if (!visited.has(key)) {
            visited.add(key);
            stack.push([nextRow, nextColumn]);
          }
        }
      }

      if (borders.has(1) && !borders.has(2)) {
        blackTerritory += regionSize;
      } else if (borders.has(2) && !borders.has(1)) {
        whiteTerritory += regionSize;
      } else {
        neutral += regionSize;
      }
    }
  }

  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const whiteIndex = blackIndex === 0 ? 1 : 0;
  const komi = Number(state.settings?.komi) || 0;
  const rules = state.settings?.rules ?? "chinese";
  const black = rules === "japanese"
    ? blackTerritory + (Number(state.captures?.[blackIndex]) || 0)
    : blackStones + blackTerritory;
  const white = rules === "japanese"
    ? whiteTerritory + (Number(state.captures?.[whiteIndex]) || 0) + komi
    : whiteStones + whiteTerritory + komi;

  return {
    black,
    white,
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    neutral,
    komi,
    rules,
  };
}

function setupState(round, settings) {
  return {
    players: ["solo-player-1", "solo-player-2"],
    hostId: "solo-player-1",
    phase: "setup",
    settings: { ...settings },
    board: emptyBoard(settings.size),
    current: 0,
    blackIndex: 1,
    captures: [0, 0],
    timeUsed: [0, 0],
    turnStartedAt: 0,
    scoreRound: 0,
    scoreSubmitted: [false, false],
    consecutivePasses: 0,
    firstPassIndex: 0,
    moves: 0,
    ended: false,
    winner: "",
    winnerIndex: 0,
    scores: {
      black: 0,
      white: 0,
      komi: settings.komi,
      rules: settings.rules,
    },
    previousBoard: "",
    undoAvailable: false,
    undoSnapshot: null,
    lastMove: { row: 0, column: 0 },
    lastEvent: { kind: "setup", playerIndex: 1, captured: 0 },
    round,
  };
}

function newRound(round, settings, now, random) {
  const blackIndex = settings.blackMode === "player1"
    ? 1
    : settings.blackMode === "player2"
      ? 2
      : random() < 0.5 ? 1 : 2;
  const board = emptyBoard(settings.size);
  placeHandicap(board, settings.handicap);
  const whiteIndex = (blackIndex % 2) + 1;
  return {
    ...setupState(round, settings),
    phase: "playing",
    board,
    current: settings.handicap > 0 ? whiteIndex : blackIndex,
    blackIndex,
    turnStartedAt: now,
    scores: {
      black: 0,
      white: 0,
      blackStones: settings.handicap,
      whiteStones: 0,
      blackTerritory: 0,
      whiteTerritory: 0,
      neutral: 0,
      komi: settings.komi,
      rules: settings.rules,
    },
    lastEvent: {
      kind: settings.handicap > 0 ? "handicap" : "start",
      playerIndex: blackIndex,
      captured: 0,
    },
  };
}

function normalizeSettings(action) {
  const size = Number(action.size);
  const komi = Number(action.komi);
  const handicap = Number(action.handicap);
  const tieBreak = action.tieBreak ?? "first-pass";
  if (![9, 13, 19].includes(size)) return undefined;
  if (!["chinese", "japanese"].includes(action.rules)) return undefined;
  if (!GO_TIE_BREAKS.includes(tieBreak)) return undefined;
  if (!Number.isFinite(komi) || komi < 0 || komi > 20) return undefined;
  if (handicap !== 0 && (!Number.isInteger(handicap) || handicap < 2 || handicap > 9)) {
    return undefined;
  }
  if (!["random", "player1", "player2"].includes(action.blackMode)) {
    return undefined;
  }
  if (handicap > 0 && action.blackMode === "random") return undefined;
  return {
    size,
    rules: action.rules,
    komi,
    tieBreak,
    handicap,
    blackMode: action.blackMode,
  };
}

function collectGroup(board, startRow, startColumn) {
  const color = board[startRow - 1][startColumn - 1];
  const points = [];
  const liberties = new Set();
  const visited = new Set([pointKey(startRow, startColumn)]);
  const stack = [{ row: startRow, column: startColumn }];

  while (stack.length > 0) {
    const point = stack.pop();
    points.push(point);
    for (const [rowOffset, columnOffset] of DIRECTIONS) {
      const row = point.row + rowOffset;
      const column = point.column + columnOffset;
      if (!inside(board, row, column)) continue;
      const value = board[row - 1][column - 1];
      const key = pointKey(row, column);
      if (value === 0) {
        liberties.add(key);
      } else if (value === color && !visited.has(key)) {
        visited.add(key);
        stack.push({ row, column });
      }
    }
  }
  return { points, liberties: liberties.size };
}

function placeHandicap(board, count) {
  if (count <= 0) return;
  const size = board.length;
  const low = size === 9 ? 3 : 4;
  const high = size - low + 1;
  const center = (size + 1) / 2;
  const points = [
    [low, high],
    [high, low],
    [high, high],
    [low, low],
    [center, center],
    [low, center],
    [high, center],
    [center, low],
    [center, high],
  ];
  const indexes = count <= 4
    ? Array.from({ length: count }, (_, index) => index)
    : count === 5 ? [0, 1, 2, 3, 4]
      : count === 6 ? [0, 1, 2, 3, 5, 6]
        : count === 7 ? [0, 1, 2, 3, 5, 6, 4]
          : count === 8 ? [0, 1, 2, 3, 5, 6, 7, 8]
            : [0, 1, 2, 3, 5, 6, 7, 8, 4];
  for (const index of indexes) {
    const [row, column] = points[index];
    board[row - 1][column - 1] = 1;
  }
}

function recordTurnTime(state, playerIndex, now) {
  state.timeUsed[playerIndex] += Math.max(0, now - state.turnStartedAt);
  state.turnStartedAt = now;
}

function createUndoSnapshot(state) {
  return {
    phase: state.phase,
    board: state.board.map((row) => [...row]),
    current: state.current,
    captures: [...state.captures],
    timeUsed: [...state.timeUsed],
    scoreRound: state.scoreRound,
    scoreSubmitted: [...state.scoreSubmitted],
    consecutivePasses: state.consecutivePasses,
    firstPassIndex: state.firstPassIndex || 0,
    moves: state.moves,
    previousBoard: state.previousBoard,
    lastMove: { ...state.lastMove },
    lastEvent: { ...state.lastEvent },
  };
}

function restoreUndoSnapshot(state, snapshot, now) {
  state.phase = snapshot.phase;
  state.board = snapshot.board.map((row) => [...row]);
  state.current = snapshot.current;
  state.captures = [...snapshot.captures];
  state.timeUsed = [...snapshot.timeUsed];
  state.turnStartedAt = now;
  state.scoreRound = snapshot.scoreRound;
  state.scoreSubmitted = [...snapshot.scoreSubmitted];
  state.consecutivePasses = snapshot.consecutivePasses;
  state.firstPassIndex = snapshot.firstPassIndex || 0;
  state.moves = snapshot.moves;
  state.previousBoard = snapshot.previousBoard;
  state.lastMove = { ...snapshot.lastMove };
  state.lastEvent = { ...snapshot.lastEvent };
  state.undoAvailable = false;
  state.undoSnapshot = null;
}

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function boardSignature(board) {
  return board.flat().join("");
}

function inside(board, row, column) {
  return row >= 1 && row <= board.length && column >= 1 && column <= board.length;
}

function pointKey(row, column) {
  return `${row}:${column}`;
}

function accepted(state, events) {
  return { accepted: true, state, events };
}

function rejected(code) {
  return { accepted: false, error: { code, message: code.toLowerCase() } };
}
