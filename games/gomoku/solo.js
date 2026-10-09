const BOARD_SIZE = 15;
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const DEFAULT_SETTINGS = {
  opponent: "ai",
  size: BOARD_SIZE,
  blackMode: "random",
  forbiddenMoves: false,
};

export function createSoloGomokuState() {
  return setupState(1, DEFAULT_SETTINGS);
}

export function applySoloGomokuAction(
  sourceState,
  action,
  { now = Date.now(), random = Math.random, actorIndex } = {},
) {
  const state = structuredClone(sourceState);
  if (!action || typeof action !== "object") return rejected("INVALID_ACTION");

  if (state.phase === "setup") {
    if (action.type !== "start" && action.type !== "update_settings") {
      return rejected("SETUP_REQUIRED");
    }
    if (action.opponent !== undefined && !["ai", "local"].includes(action.opponent)) {
      return rejected("INVALID_OPPONENT");
    }
    const settings = normalizeSettings(action);
    if (!settings) {
      return rejected(
        typeof action.forbiddenMoves === "boolean"
          ? "INVALID_BLACK_MODE"
          : "INVALID_FORBIDDEN_MOVES",
      );
    }
    if (action.type === "update_settings") {
      return accepted(
        setupState(state.round, settings),
        [{ type: "settings_updated", player: state.hostId }],
      );
    }
    return accepted(
      newRound(state.round, settings, now, chooseBlack(settings, random)),
      [{ type: "started", player: state.hostId }],
    );
  }

  if (action.type === "rematch") {
    if (!state.ended) return rejected("GAME_NOT_OVER");
    const nextBlackIndex = (state.blackIndex % state.players.length) + 1;
    return accepted(
      newRound(state.round + 1, state.settings, now, nextBlackIndex),
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

  if (state.ended) return rejected("GAME_OVER");
  if (action.type !== "play") return rejected("INVALID_ACTION");
  if (actorIndex !== undefined && actorIndex !== state.current) {
    return rejected("NOT_YOUR_TURN");
  }

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

  const playerIndex = state.current - 1;
  const actor = state.players[playerIndex];
  const piece = state.current === state.blackIndex ? 1 : 2;
  state.board[row - 1][column - 1] = piece;

  if (piece === 1 && state.settings.forbiddenMoves) {
    const reason = forbiddenReason(state.board, row, column);
    if (reason) return rejected(reason);
  }

  recordTurnTime(state, playerIndex, now);
  state.moves += 1;
  state.lastMove = { row, column };
  state.lastEvent = { kind: "play", playerIndex: playerIndex + 1 };

  const line = winningLine(state.board, row, column, piece);
  if (line) {
    state.phase = "ended";
    state.ended = true;
    state.winner = actor;
    state.winnerIndex = playerIndex + 1;
    state.winningCells = line;
    state.lastEvent = { kind: "won", playerIndex: playerIndex + 1 };
    return accepted(state, [{ type: "won", player: actor }]);
  }

  if (state.moves === BOARD_SIZE * BOARD_SIZE) {
    state.phase = "ended";
    state.ended = true;
    state.draw = true;
    state.lastEvent = { kind: "draw", playerIndex: playerIndex + 1 };
    return accepted(state, [{ type: "draw" }]);
  }

  state.current = (state.current % state.players.length) + 1;
  return accepted(state, [{ type: "played", player: actor, row, column }]);
}

function setupState(round, settings) {
  return {
    players: ["solo-player-1", "solo-player-2"],
    hostId: "solo-player-1",
    phase: "setup",
    settings: { ...settings, size: BOARD_SIZE },
    board: emptyBoard(),
    current: 0,
    blackIndex: 1,
    timeUsed: [0, 0],
    turnStartedAt: 0,
    moves: 0,
    ended: false,
    winner: "",
    winnerIndex: 0,
    draw: false,
    winningCells: [],
    lastMove: { row: 0, column: 0 },
    lastEvent: { kind: "setup", playerIndex: 1 },
    round,
  };
}

function newRound(round, settings, now, blackIndex) {
  return {
    ...setupState(round, settings),
    phase: "playing",
    current: blackIndex,
    blackIndex,
    turnStartedAt: now,
    lastEvent: { kind: "start", playerIndex: blackIndex },
  };
}

function normalizeSettings(action) {
  if (!["random", "player1", "player2"].includes(action.blackMode)) {
    return undefined;
  }
  if (typeof action.forbiddenMoves !== "boolean") return undefined;
  return {
    opponent: action.opponent ?? "ai",
    size: BOARD_SIZE,
    blackMode: action.blackMode,
    forbiddenMoves: action.forbiddenMoves,
  };
}

function chooseBlack(settings, random) {
  if (settings.blackMode === "player1") return 1;
  if (settings.blackMode === "player2") return 2;
  return random() < 0.5 ? 1 : 2;
}

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function inside(board, row, column) {
  return (
    row >= 1 &&
    row <= board.length &&
    column >= 1 &&
    column <= board.length
  );
}

function winningLine(board, row, column, piece) {
  for (const [rowStep, columnStep] of DIRECTIONS) {
    let startRow = row;
    let startColumn = column;
    while (
      inside(board, startRow - rowStep, startColumn - columnStep) &&
      board[startRow - rowStep - 1][startColumn - columnStep - 1] === piece
    ) {
      startRow -= rowStep;
      startColumn -= columnStep;
    }

    const cells = [];
    let checkRow = startRow;
    let checkColumn = startColumn;
    while (
      inside(board, checkRow, checkColumn) &&
      board[checkRow - 1][checkColumn - 1] === piece
    ) {
      cells.push({ row: checkRow, column: checkColumn });
      checkRow += rowStep;
      checkColumn += columnStep;
    }
    if (cells.length >= 5) return cells;
  }
  return undefined;
}

function lineLength(board, row, column, piece, rowStep, columnStep) {
  let count = 1;
  let checkRow = row + rowStep;
  let checkColumn = column + columnStep;
  while (
    inside(board, checkRow, checkColumn) &&
    board[checkRow - 1][checkColumn - 1] === piece
  ) {
    count += 1;
    checkRow += rowStep;
    checkColumn += columnStep;
  }
  checkRow = row - rowStep;
  checkColumn = column - columnStep;
  while (
    inside(board, checkRow, checkColumn) &&
    board[checkRow - 1][checkColumn - 1] === piece
  ) {
    count += 1;
    checkRow -= rowStep;
    checkColumn -= columnStep;
  }
  return count;
}

function createsExactFive(
  board,
  anchorRow,
  anchorColumn,
  row,
  column,
  direction,
) {
  if (!inside(board, row, column) || board[row - 1][column - 1] !== 0) {
    return false;
  }
  board[row - 1][column - 1] = 1;
  const length = lineLength(
    board,
    anchorRow,
    anchorColumn,
    1,
    direction[0],
    direction[1],
  );
  board[row - 1][column - 1] = 0;
  return length === 5;
}

function winningExtensions(board, anchorRow, anchorColumn, direction) {
  let count = 0;
  for (let offset = -5; offset <= 5; offset += 1) {
    const row = anchorRow + direction[0] * offset;
    const column = anchorColumn + direction[1] * offset;
    if (
      createsExactFive(
        board,
        anchorRow,
        anchorColumn,
        row,
        column,
        direction,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

function openThreeInDirection(board, anchorRow, anchorColumn, direction) {
  const originalLength = lineLength(
    board,
    anchorRow,
    anchorColumn,
    1,
    direction[0],
    direction[1],
  );
  if (originalLength >= 4) return false;

  for (let offset = -4; offset <= 4; offset += 1) {
    const row = anchorRow + direction[0] * offset;
    const column = anchorColumn + direction[1] * offset;
    if (inside(board, row, column) && board[row - 1][column - 1] === 0) {
      board[row - 1][column - 1] = 1;
      // A three must become a straight four containing the added stone.
      // Completing a five, or leaving an unrelated four intact, is not a three.
      const length = lineLength(
        board,
        anchorRow,
        anchorColumn,
        1,
        direction[0],
        direction[1],
      );
      const extensions = length === 4
        ? winningExtensions(board, anchorRow, anchorColumn, direction)
        : 0;
      board[row - 1][column - 1] = 0;
      if (extensions >= 2) return true;
    }
  }
  return false;
}

// Shared with the AI so simulated black moves obey the same local rules.
// The stone must already be placed; temporary extensions are restored in place.
export function forbiddenReason(board, row, column) {
  for (const [rowStep, columnStep] of DIRECTIONS) {
    if (lineLength(board, row, column, 1, rowStep, columnStep) > 5) {
      return "FORBIDDEN_OVERLINE";
    }
  }
  for (const [rowStep, columnStep] of DIRECTIONS) {
    if (lineLength(board, row, column, 1, rowStep, columnStep) === 5) {
      return undefined;
    }
  }

  let fours = 0;
  for (const direction of DIRECTIONS) {
    if (winningExtensions(board, row, column, direction) > 0) fours += 1;
  }
  if (fours >= 2) return "FORBIDDEN_DOUBLE_FOUR";

  let threes = 0;
  for (const direction of DIRECTIONS) {
    if (openThreeInDirection(board, row, column, direction)) threes += 1;
  }
  return threes >= 2 ? "FORBIDDEN_DOUBLE_THREE" : undefined;
}

function recordTurnTime(state, playerIndex, now) {
  const startedAt = Number.isFinite(Number(state.turnStartedAt))
    ? Number(state.turnStartedAt)
    : now;
  state.timeUsed[playerIndex] =
    (Number(state.timeUsed[playerIndex]) || 0) + Math.max(0, now - startedAt);
  state.turnStartedAt = now;
}

function accepted(state, events) {
  return { accepted: true, state, events };
}

function rejected(code) {
  return {
    accepted: false,
    error: { code, message: code.toLowerCase().replaceAll("_", " ") },
  };
}
