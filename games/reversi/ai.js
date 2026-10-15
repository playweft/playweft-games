// A padded board keeps all eight direction scans bounds-free. Search mutates only
// this private copy and undoes each move; the public game state is never cloned.
const DIRECTIONS = [-11, -10, -9, -1, 1, 9, 10, 11];
const CELLS = Array.from(
  { length: 64 },
  (_, i) => 11 + Math.floor(i / 8) * 10 + (i % 8),
);
const CORNERS = [11, 18, 81, 88];
const POSITION = [
  0, 0, 16, 4, 4, 16, 0, 0, 0, 0, -4, -4, -4, -4, 0, 0, 16, -4, 4, 1, 1, 4, -4,
  16, 4, -4, 1, 0, 0, 1, -4, 4, 4, -4, 1, 0, 0, 1, -4, 4, 16, -4, 4, 1, 1, 4,
  -4, 16, 0, 0, -4, -4, -4, -4, 0, 0, 0, 0, 16, 4, 4, 16, 0, 0,
];
const NEAR_SCORE = 8;
const TERMINAL = 100_000;

function padded(board) {
  const cells = new Uint8Array(100).fill(3);
  CELLS.forEach((index, i) => (cells[index] = board[Math.floor(i / 8)][i % 8]));
  return cells;
}

function canPlay(board, index, color) {
  for (const step of DIRECTIONS) {
    let cursor = index + step;
    if (board[cursor] !== 3 - color) continue;
    do {
      cursor += step;
    } while (board[cursor] === 3 - color);
    if (board[cursor] === color) return true;
  }
  return false;
}

function movesFor(board, color) {
  const moves = [];
  for (const index of CELLS) {
    if (board[index]) continue;
    const flips = [];
    for (const step of DIRECTIONS) {
      let cursor = index + step;
      const start = flips.length;
      while (board[cursor] === 3 - color) {
        flips.push(cursor);
        cursor += step;
      }
      if (board[cursor] !== color) flips.length = start;
    }
    if (flips.length) moves.push({ index, flips });
  }
  // Corners first improves pruning; ordering does not discard any legal move.
  moves.sort(
    (a, b) =>
      Number(CORNERS.includes(b.index)) - Number(CORNERS.includes(a.index)),
  );
  return moves;
}

function evaluate(board, color) {
  let empty = 0,
    material = 0,
    mobility = 0,
    frontier = 0,
    position = 0,
    corners = 0,
    danger = 0;
  let ownMoves = 0,
    otherMoves = 0;
  for (let i = 0; i < 64; i++) {
    const index = CELLS[i],
      piece = board[index];
    if (!piece) {
      empty++;
      if (canPlay(board, index, color)) ownMoves++;
      if (canPlay(board, index, 3 - color)) otherMoves++;
      continue;
    }
    const sign = piece === color ? 1 : -1;
    material += sign;
    position += sign * POSITION[i];
    if (DIRECTIONS.some((step) => !board[index + step])) frontier += sign;
  }
  if (!ownMoves && !otherMoves)
    return Math.sign(material) * TERMINAL + material;
  mobility = ownMoves - otherMoves;
  for (const corner of CORNERS) {
    if (board[corner]) {
      corners += board[corner] === color ? 1 : -1;
      continue;
    }
    const dx = corner % 10 === 1 ? 1 : -1,
      dy = corner < 20 ? 10 : -10;
    for (const [index, penalty] of [
      [corner + dx, 35],
      [corner + dy, 35],
      [corner + dx + dy, 90],
    ]) {
      if (board[index]) danger += (board[index] === color ? 1 : -1) * penalty;
    }
  }
  // Early: keep options and avoid exposed discs. Late: actual disc count matters.
  const phase =
    empty > 44 ? [0, 12, 5, 1] : empty > 16 ? [1, 9, 3, 1] : [12, 3, 1, 0];
  return (
    corners * 400 -
    danger +
    material * phase[0] +
    mobility * phase[1] -
    frontier * phase[2] +
    position * phase[3]
  );
}

// Also useful for checking search against an independent, public-rules minimax.
export const scoreReversiBoard = (board, color) =>
  evaluate(padded(board), color);

export function chooseReversiMove(state, { random = Math.random, stats } = {}) {
  if (!state || state.ended || ![1, 2].includes(state.current))
    return undefined;
  const board = padded(state.board),
    root = state.current === state.blackIndex ? 1 : 2;
  if (stats) Object.assign(stats, { nodes: 0, leaves: 0, cutoffs: 0 });

  function search(color, depth, alpha, beta, passed = false) {
    if (stats) stats.nodes++;
    if (!depth) {
      if (stats) stats.leaves++;
      return evaluate(board, root);
    }
    const moves = movesFor(board, color);
    if (!moves.length) {
      if (passed) return evaluate(board, root);
      // A forced pass does not consume one of the two actual placements.
      return search(3 - color, depth, alpha, beta, true);
    }
    let best = color === root ? -Infinity : Infinity;
    for (const move of moves) {
      const score = play(move, color, depth - 1, alpha, beta);
      if (color === root) {
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, score);
        beta = Math.min(beta, best);
      }
      if (alpha >= beta) {
        if (stats) stats.cutoffs++;
        break;
      }
    }
    return best;
  }
  function play(move, color, depth, alpha, beta) {
    board[move.index] = color;
    for (const index of move.flips) board[index] = color;
    const score = search(3 - color, depth, alpha, beta);
    board[move.index] = 0;
    for (const index of move.flips) board[index] = 3 - color;
    return score;
  }

  let best = -Infinity;
  const candidates = [];
  for (const move of movesFor(board, root)) {
    // Keep exact scores for every near-best move. A normal best-score bound
    // could mistake a pruned upper bound for a genuine near tie.
    const score = play(move, root, 1, best - NEAR_SCORE, Infinity);
    best = Math.max(best, score);
    candidates.push({ move, score });
  }
  const nearby = candidates.filter(({ score }) => score > best - NEAR_SCORE);
  if (!nearby.length) return undefined;
  const weights = nearby.map(({ score }) => Math.exp((score - best) / 4));
  let pick =
    Math.max(0, Math.min(1, random())) *
    weights.reduce((sum, weight) => sum + weight, 0);
  let selected = nearby[nearby.length - 1].move;
  for (let i = 0; i < nearby.length; i++) {
    pick -= weights[i];
    if (pick < 0) {
      selected = nearby[i].move;
      break;
    }
  }
  return { row: Math.floor(selected.index / 10), column: selected.index % 10 };
}
