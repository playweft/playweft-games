export const SIZE = 8;
const DIRECTIONS = [-1, 0, 1].flatMap(row =>
  [-1, 0, 1].filter(column => row || column).map(column => [row, column]),
);
const inside = (row, column) => row >= 0 && row < SIZE && column >= 0 && column < SIZE;

export function flippedCells(board, row, column, color) {
  if (!Number.isInteger(row) || !Number.isInteger(column) ||
      row < 1 || row > SIZE || column < 1 || column > SIZE || board[row - 1][column - 1]) return [];
  const flips = [];
  for (const [dr, dc] of DIRECTIONS) {
    let r = row - 1 + dr, c = column - 1 + dc;
    const line = [];
    while (inside(r, c) && board[r][c] === 3 - color) {
      line.push({ row: r + 1, column: c + 1 });
      r += dr; c += dc;
    }
    if (line.length && inside(r, c) && board[r][c] === color) flips.push(...line);
  }
  return flips;
}

export function legalMoves(board, color) {
  const moves = [];
  for (let row = 1; row <= SIZE; row++) {
    for (let column = 1; column <= SIZE; column++) {
      const flips = flippedCells(board, row, column, color).length;
      if (flips) moves.push({ row, column, flips });
    }
  }
  return moves;
}

export function countPieces(board) {
  const counts = { black: 0, white: 0, empty: 0 };
  for (const cell of board.flat()) counts[cell === 1 ? "black" : cell === 2 ? "white" : "empty"]++;
  return counts;
}

export function createReversiState({ players = ["solo-player-1", "solo-player-2"], blackIndex = 1, round = 1 } = {}) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  board[3][3] = board[4][4] = 2;
  board[3][4] = board[4][3] = 1;
  return {
    players: [...players], board, blackIndex, current: blackIndex, round, moves: 0,
    counts: countPieces(board), legalMoves: legalMoves(board, 1),
    ended: false, winner: "", winnerIndex: 0, draw: false, endReason: "",
    passedIndex: 0, lastMove: { row: 0, column: 0 }, lastFlipped: [],
  };
}

const rejected = code => ({ accepted: false, error: { code, message: code } });

export function applyReversiAction(source, action, { actorIndex = source.current } = {}) {
  if (![1, 2].includes(actorIndex)) return rejected("NOT_A_PLAYER");
  if (!action || typeof action !== "object" || Array.isArray(action)) return rejected("INVALID_ACTION");
  if (action.type === "rematch") {
    if (!source.ended) return rejected("GAME_NOT_OVER");
    return { accepted: true, state: createReversiState({ players: source.players,
      blackIndex: 3 - source.blackIndex, round: source.round + 1 }),
    events: [{ type: "rematched", player: source.players[actorIndex - 1] }] };
  }
  if (action.type !== "play") return rejected("INVALID_ACTION");
  if (source.ended) return rejected("GAME_OVER");
  if (actorIndex !== source.current) return rejected("NOT_YOUR_TURN");
  const { row, column } = action;
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || row > SIZE || column < 1 || column > SIZE) {
    return rejected("INVALID_COORDINATE");
  }
  const color = actorIndex === source.blackIndex ? 1 : 2;
  const flips = flippedCells(source.board, row, column, color);
  if (!flips.length) return rejected("ILLEGAL_MOVE");
  const state = structuredClone(source);
  state.board[row - 1][column - 1] = color;
  for (const cell of flips) state.board[cell.row - 1][cell.column - 1] = color;
  state.moves++;
  state.lastMove = { row, column };
  state.lastFlipped = flips;
  state.counts = countPieces(state.board);
  state.passedIndex = 0;
  const events = [{ type: "played", player: state.players[actorIndex - 1], row, column, flipped: flips.length }];
  state.current = 3 - actorIndex;
  state.legalMoves = legalMoves(state.board, 3 - color);
  if (!state.legalMoves.length) {
    state.legalMoves = legalMoves(state.board, color);
    if (state.legalMoves.length) {
      state.passedIndex = state.current;
      events.push({ type: "passed", player: state.players[state.current - 1] });
      state.current = actorIndex;
    } else {
      state.ended = true;
      state.current = 0;
      state.endReason = state.counts.empty ? "no_moves" : "full_board";
      state.draw = state.counts.black === state.counts.white;
      state.winnerIndex = state.draw ? 0 : state.counts.black > state.counts.white ? state.blackIndex : 3 - state.blackIndex;
      state.winner = state.winnerIndex ? state.players[state.winnerIndex - 1] : "";
      events.push({ type: state.draw ? "draw" : "won", player: state.winner });
    }
  }
  return { accepted: true, state, events };
}
