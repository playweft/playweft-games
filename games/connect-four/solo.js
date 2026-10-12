import { ROWS, COLUMNS, winningCells } from "./rules.js";

export function createSoloConnectFourState() {
  return newRound(1, 1);
}

export function applySoloConnectFourAction(sourceState, action, { actorIndex = 1 } = {}) {
  if (!action || typeof action !== "object") return rejected("INVALID_ACTION");
  if (![1, 2].includes(actorIndex)) return rejected("NOT_A_PLAYER");
  const ended = Boolean(sourceState.winner || sourceState.draw);
  if (action.type === "rematch") {
    if (!ended) return rejected("GAME_NOT_OVER");
    return accepted(newRound(sourceState.round + 1, sourceState.starter % 2 + 1));
  }
  if (action.type !== "drop") return rejected("INVALID_ACTION");
  if (ended) return rejected("GAME_OVER");
  if (actorIndex !== sourceState.current) return rejected("NOT_YOUR_TURN");
  const column = action.column;
  if (!Number.isInteger(column) || column < 1 || column > COLUMNS) return rejected("INVALID_COLUMN");
  let row = ROWS - 1;
  while (row >= 0 && sourceState.board[row][column - 1] !== 0) row -= 1;
  if (row < 0) return rejected("COLUMN_FULL");

  const state = structuredClone(sourceState);
  state.board[row][column - 1] = actorIndex;
  state.moves += 1;
  state.lastMove = { row: row + 1, column };
  state.winningCells = winningCells(state.board, row, column - 1, actorIndex);
  if (state.winningCells.length) {
    state.winner = state.players[actorIndex - 1];
    state.winnerIndex = actorIndex;
  } else if (state.moves === ROWS * COLUMNS) {
    state.draw = true;
  } else {
    state.current = actorIndex % 2 + 1;
  }
  return accepted(state);
}

function newRound(round, starter) {
  return {
    players: ["local-player", "local-ai"],
    board: Array.from({ length: ROWS }, () => Array(COLUMNS).fill(0)),
    current: starter,
    moves: 0,
    winner: "",
    winnerIndex: 0,
    draw: false,
    lastMove: { row: 0, column: 0 },
    winningCells: [],
    round,
    starter,
  };
}

function accepted(state) {
  return { accepted: true, state };
}

function rejected(code) {
  return { accepted: false, error: { code } };
}
