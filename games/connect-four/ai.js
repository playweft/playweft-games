import { ROWS, COLUMNS, COLUMN_ORDER, WINNING_WINDOWS, CELL_WINDOWS } from "./rules.js";

const WIN = 100_000;
const WEIGHTS = [0, 2, 12, 90, WIN];
const STOP = Symbol("search budget exhausted");

// Tactical checks always finish; only the additional search has a time budget.
export function chooseConnectFourMove(state, {
  timeBudgetMs = 1,
  maxNodes = 768,
  maxDepth = 4,
  now = () => performance.now(),
} = {}) {
  if (!state || state.winner || state.draw || ![1, 2].includes(state.current)) return null;
  const board = state.board;
  if (!Array.isArray(board) || board.length !== ROWS || board.some(row => !Array.isArray(row) || row.length !== COLUMNS)) return null;
  const deadline = now() + Math.max(0, timeBudgetMs);
  const flat = Uint8Array.from(board.flat());
  const heights = new Uint8Array(COLUMNS);
  const counts = [null, new Uint8Array(WINNING_WINDOWS.length), new Uint8Array(WINNING_WINDOWS.length)];
  let occupied = 0;
  let score = 0;
  let nodes = 0;
  for (let column = 0; column < COLUMNS; column += 1) {
    for (let row = ROWS - 1; row >= 0 && flat[row * COLUMNS + column]; row -= 1) heights[column] += 1;
  }
  for (let cell = 0; cell < flat.length; cell += 1) {
    const piece = flat[cell];
    if (!piece) continue;
    if (piece !== 1 && piece !== 2) return null;
    occupied += 1;
    for (const window of CELL_WINDOWS[cell]) counts[piece][window] += 1;
    if (cell % COLUMNS === 3) score += piece === 1 ? 3 : -3;
  }
  for (let window = 0; window < WINNING_WINDOWS.length; window += 1) score += windowScore(window);
  const legal = COLUMN_ORDER.filter(column => heights[column] < ROWS);
  if (!legal.length) return null;
  const own = state.current;
  const result = (column, depth = 0) => ({ column: column + 1, depth, nodes });
  const wins = winningColumns(own);
  if (wins.length) return result(wins[0]);
  const threats = winningColumns(3 - own);
  if (threats.length === 1) return result(threats[0]);
  if (occupied === 0) return result(3);

  // Never give away an immediate win if a safe move exists, even on timeout.
  const safe = [];
  let best = legal[0];
  let bestScore = -Infinity;
  for (const column of legal) {
    play(column, own);
    const losing = winningColumns(3 - own).length > 0;
    if (!losing) {
      safe.push(column);
      if (winningColumns(own).length >= 2) {
        undo(column, own);
        return result(column);
      }
      const value = own === 1 ? score : -score;
      if (value > bestScore) { best = column; bestScore = value; }
    }
    undo(column, own);
  }
  if (!safe.length) return result(best);
  let completedDepth = 0;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    if (nodes >= maxNodes || now() >= deadline) break;
    let alpha = -WIN;
    let iterationBest = best;
    // The last completed iteration's choice is searched before other columns.
    const ordered = [best, ...safe.filter(column => column !== best)];
    try {
      for (const column of ordered) {
        play(column, own);
        let value;
        try { value = -search(depth - 1, -WIN, -alpha, 3 - own, 1); }
        finally { undo(column, own); }
        if (value > alpha) { alpha = value; iterationBest = column; }
      }
    } catch (error) {
      if (error !== STOP) throw error;
      break;
    }
    best = iterationBest;
    completedDepth = depth;
    if (Math.abs(alpha) > WIN / 2) break;
  }
  return result(best, completedDepth);

  function windowScore(window) {
    const red = counts[1][window];
    const yellow = counts[2][window];
    return red && yellow ? 0 : WEIGHTS[red] - WEIGHTS[yellow];
  }
  function play(column, piece) {
    const cell = (ROWS - 1 - heights[column]) * COLUMNS + column;
    flat[cell] = piece;
    heights[column] += 1;
    occupied += 1;
    for (const window of CELL_WINDOWS[cell]) {
      score -= windowScore(window);
      counts[piece][window] += 1;
      score += windowScore(window);
    }
    if (column === 3) score += piece === 1 ? 3 : -3;
  }
  function undo(column, piece) {
    heights[column] -= 1;
    occupied -= 1;
    const cell = (ROWS - 1 - heights[column]) * COLUMNS + column;
    flat[cell] = 0;
    for (const window of CELL_WINDOWS[cell]) {
      score -= windowScore(window);
      counts[piece][window] -= 1;
      score += windowScore(window);
    }
    if (column === 3) score -= piece === 1 ? 3 : -3;
  }
  function winningColumns(piece) {
    const wins = [];
    for (const column of COLUMN_ORDER) {
      if (heights[column] === ROWS) continue;
      const cell = (ROWS - 1 - heights[column]) * COLUMNS + column;
      if (CELL_WINDOWS[cell].some(window => counts[piece][window] === 3 && counts[3 - piece][window] === 0)) wins.push(column);
    }
    return wins;
  }
  function search(depth, alpha, beta, piece, ply) {
    if (nodes >= maxNodes || (nodes % 32 === 0 && now() >= deadline)) throw STOP;
    nodes += 1;
    if (occupied === ROWS * COLUMNS) return 0;
    if (winningColumns(piece).length) return WIN - ply;
    const threats = winningColumns(3 - piece);
    if (threats.length > 1) return -WIN + ply + 1;
    // Forced blocks extend the leaf so a shallow evaluation cannot overlook them.
    if (depth <= 0 && !threats.length) return piece === 1 ? score : -score;
    const choices = threats.length ? threats : COLUMN_ORDER;
    let bestValue = -WIN;
    for (const column of choices) {
      if (heights[column] === ROWS) continue;
      play(column, piece);
      let value;
      try { value = -search(depth - 1, -beta, -alpha, 3 - piece, ply + 1); }
      finally { undo(column, piece); }
      bestValue = Math.max(bestValue, value);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return bestValue;
  }
}
