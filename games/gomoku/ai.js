import { forbiddenReason } from "./solo.js";

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const WEIGHTS = [0, 2, 24, 350, 8_000, 10_000_000];
const WIN = 100_000_000;
const geometryCache = new Map();

function geometry(size) {
  if (geometryCache.has(size)) return geometryCache.get(size);
  const windows = [];
  const through = Array.from({ length: size * size }, () => []);
  const index = (r, c) => r >= 0 && c >= 0 && r < size && c < size ? r * size + c : -1;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      for (const [dr, dc] of DIRECTIONS) {
        if (index(r + dr * 4, c + dc * 4) < 0) continue;
        const cells = Array.from({ length: 5 }, (_, n) => index(r + dr * n, c + dc * n));
        const window = { cells, before: index(r - dr, c - dc), after: index(r + dr * 5, c + dc * 5) };
        windows.push(window);
        for (const cell of cells) through[cell].push(window);
      }
    }
  }
  const result = { windows, through };
  geometryCache.set(size, result);
  return result;
}

// A small, fixed two-ply search. No models, transposition table or pondering.
// Caller state is never mutated; only one board copy is made for all simulations.
export function chooseGomokuMove(state, { now = () => performance.now(), timeBudgetMs = 25 } = {}) {
  if (state.phase !== "playing" || state.ended) return null;
  const size = state.board.length;
  const board = state.board.map((row) => row.slice());
  const flat = Int8Array.from(board.flat());
  const own = state.current === state.blackIndex ? 1 : 2;
  const enemy = 3 - own;
  const forbidden = Boolean(state.settings.forbiddenMoves);
  const { windows, through } = geometry(size);
  const deadline = now() + Math.max(0, Math.min(30, timeBudgetMs));
  let nodes = 0;
  const rowOf = (point) => Math.floor(point / size);
  const columnOf = (point) => point % size;
  const result = (point) => ({ row: rowOf(point) + 1, column: columnOf(point) + 1, nodes });
  function put(point, piece) {
    flat[point] = piece;
    board[rowOf(point)][columnOf(point)] = piece;
  }
  function legalPlaced(point, piece) {
    return piece !== 1 || !forbidden || !forbiddenReason(board, rowOf(point) + 1, columnOf(point) + 1);
  }
  function legal(point, piece) {
    if (flat[point] !== 0) return false;
    put(point, piece);
    const allowed = legalPlaced(point, piece);
    put(point, 0);
    return allowed;
  }
  function winsPlaced(point, piece) {
    return through[point].some(({ cells }) => cells.every((cell) => flat[cell] === piece));
  }
  function winningMoves(piece) {
    const wins = [];
    for (let point = 0; point < flat.length; point += 1) {
      if (flat[point]) continue;
      put(point, piece);
      if (winsPlaced(point, piece) && legalPlaced(point, piece)) wins.push(point);
      put(point, 0);
    }
    return wins;
  }
  function windowScore(window, piece) {
    let count = 0;
    for (const cell of window.cells) {
      if (flat[cell] === 3 - piece) return 0;
      if (flat[cell] === piece) count += 1;
    }
    if (!count) return 0;
    // Open ends matter, including the empty end within the five-cell window.
    const open = Number(window.before >= 0 && flat[window.before] === 0) +
      Number(window.after >= 0 && flat[window.after] === 0);
    return WEIGHTS[count] * (1 + open * 0.5);
  }
  function pointScore(point, piece) {
    put(point, piece);
    if (!legalPlaced(point, piece)) { put(point, 0); return -Infinity; }
    let score = 0;
    const extensions = new Set();
    for (const window of through[point]) {
      score += windowScore(window, piece);
      let count = 0;
      let empty = -1;
      for (const cell of window.cells) {
        if (flat[cell] === piece) count += 1;
        else if (!flat[cell]) empty = cell;
      }
      if (count === 4 && empty >= 0) extensions.add(empty);
    }
    // A fork deserves attention even if its two winning endpoints are on different axes.
    if (extensions.size >= 2) score += 200_000;
    put(point, 0);
    return score;
  }
  function candidates(piece, limit) {
    const nearby = new Uint8Array(flat.length);
    for (let point = 0; point < flat.length; point += 1) {
      if (!flat[point]) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const r = rowOf(point) + dr;
          const c = columnOf(point) + dc;
          if (r >= 0 && c >= 0 && r < size && c < size && !flat[r * size + c]) nearby[r * size + c] = 1;
        }
      }
    }
    const ranked = [];
    for (let point = 0; point < flat.length; point += 1) {
      if (!nearby[point]) continue;
      const attack = pointScore(point, piece);
      if (!Number.isFinite(attack)) continue;
      const defense = pointScore(point, 3 - piece);
      const centerDistance = Math.abs(rowOf(point) - (size - 1) / 2) + Math.abs(columnOf(point) - (size - 1) / 2);
      ranked.push({ point, score: attack + Math.max(0, defense) * 0.9 - centerDistance * 0.01 });
    }
    ranked.sort((a, b) => b.score - a.score || a.point - b.point);
    return ranked.slice(0, limit).map(({ point }) => point);
  }
  function evaluate() {
    let score = 0;
    for (const window of windows) score += windowScore(window, own) - windowScore(window, enemy);
    return score;
  }

  if (!flat.some(Boolean)) return result(Math.floor(size / 2) * size + Math.floor(size / 2));
  const wins = winningMoves(own);
  if (wins.length) return result(wins[0]);
  // Mandatory wins/blocks scan all empty cells and are never discarded by candidate pruning.
  const threats = winningMoves(enemy);
  const blocks = threats.filter((point) => legal(point, own));
  if (blocks.length) return result(blocks[0]);
  const roots = candidates(own, 8);
  if (!roots.length) {
    for (let point = 0; point < flat.length; point += 1) if (legal(point, own)) return result(point);
    return null;
  }
  let best = roots[0];
  let bestScore = -Infinity;
  for (const point of roots) {
    if (nodes >= 48 || now() >= deadline) break;
    put(point, own);
    let score;
    if (winningMoves(enemy).length) score = -WIN;
    else {
      const followups = winningMoves(own);
      if (followups.length >= 2) score = WIN;
      else {
        // An immediate own win forces the reply; inspect it even outside the top six.
        const replies = followups.length && legal(followups[0], enemy)
          ? [followups[0]] : candidates(enemy, 6);
        score = replies.length ? Infinity : evaluate();
        let complete = true;
        for (const reply of replies) {
          if (nodes >= 48 || now() >= deadline) { complete = false; break; }
          put(reply, enemy);
          nodes += 1;
          const value = winsPlaced(reply, enemy) ? -WIN : evaluate();
          put(reply, 0);
          score = Math.min(score, value);
        }
        // Never compare a partially searched branch with completed branches.
        if (!complete) { put(point, 0); break; }
      }
    }
    put(point, 0);
    if (score > bestScore) { bestScore = score; best = point; }
    if (score === WIN) break;
  }
  return result(best);
}
