import assert from "node:assert/strict";
import test from "node:test";
import { chooseReversiMove, scoreReversiBoard } from "../games/reversi/ai.js";
import { createReversiAiController } from "../games/reversi/ai-controller.js";
import { createReversiState, applyReversiAction, legalMoves, countPieces } from "../games/reversi/rules.js";

const play = (state, move) => {
  const result = applyReversiAction(state, { type: "play", ...move });
  assert.equal(result.accepted, true);
  return result.state;
};
function oracle(state, root, depth) {
  const color = root === state.blackIndex ? 1 : 2;
  if (state.ended || !depth) return scoreReversiBoard(state.board, color);
  const scores = state.legalMoves.map(move => oracle(play(state, move), root, depth - 1));
  return state.current === root ? Math.max(...scores) : Math.min(...scores);
}
function positions(seed, count = 60) {
  const states = [];
  let state = createReversiState({ blackIndex: seed % 2 + 1 });
  while (!state.ended && states.length < count) {
    states.push(state);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    state = play(state, state.legalMoves[seed % state.legalMoves.length]);
  }
  return states;
}

test("Reversi AI makes only legal, near-best two-ply moves without mutating input", () => {
  let cutoffs = 0, differsFromGreedy = 0;
  for (const state of [...positions(91), ...positions(712)]) {
    const before = structuredClone(state), root = state.current, stats = {};
    const scores = state.legalMoves.map(move => oracle(play(state, move), root, 1));
    const best = Math.max(...scores);
    for (const random of [() => 0, () => .37, () => .999999]) {
      const choice = chooseReversiMove(state, { random, stats });
      const index = state.legalMoves.findIndex(move => move.row === choice.row && move.column === choice.column);
      assert.ok(index >= 0);
      assert.ok(scores[index] > best - 8, `selected ${scores[index]}, best ${best}`);
      assert.ok(stats.nodes < 5000, "two placements bound the search tree");
      cutoffs += stats.cutoffs;
    }
    const greedy = state.legalMoves.map(move => scoreReversiBoard(play(state, move).board, root === state.blackIndex ? 1 : 2));
    if (scores[greedy.indexOf(Math.max(...greedy))] <= best - 8) differsFromGreedy++;
    assert.deepEqual(state, before);
  }
  assert.ok(cutoffs > 0, "alpha-beta should prune inferior replies");
  assert.ok(differsFromGreedy > 0, "fixtures must distinguish two-ply search from single-ply scoring");
});

test("Reversi AI varies equal opening moves and does not randomize clearly inferior corner alternatives", () => {
  const state = createReversiState();
  const selected = new Set([0, .25, .5, .75, .999999].map(value => JSON.stringify(chooseReversiMove(state, { random: () => value }))));
  assert.equal(selected.size, 4);
  state.board[0][1] = 2; state.board[0][2] = 1;
  state.legalMoves = legalMoves(state.board, 1);
  state.counts = countPieces(state.board);
  for (const value of [0, .5, 1]) assert.deepEqual(chooseReversiMove(state, { random: () => value }), { row: 1, column: 1 });
});

test("Reversi AI handles forced passes, terminal boards and swapped seats", () => {
  const state = createReversiState({ blackIndex: 2 });
  state.board = Array.from({ length: 8 }, () => Array(8).fill(1));
  state.board[0][0] = state.board[0][3] = 0;
  state.board[0][1] = state.board[0][4] = 2;
  state.counts = countPieces(state.board);
  state.legalMoves = legalMoves(state.board, 1);
  let next = play(state, chooseReversiMove(state));
  assert.equal(next.current, 2);
  assert.equal(next.passedIndex, 1);
  next = play(next, chooseReversiMove(next));
  assert.equal(next.ended, true);
  assert.equal(next.winnerIndex, 2);
  assert.ok(scoreReversiBoard(next.board, 1) > 100_000);
  assert.equal(scoreReversiBoard(next.board, 1), -scoreReversiBoard(next.board, 2));
  assert.equal(chooseReversiMove(next), undefined);
  assert.equal(chooseReversiMove(undefined), undefined);
  assert.equal(chooseReversiMove({ ...state, board: Array.from({ length: 8 }, () => Array(8).fill(0)) }), undefined);
  const drawn = Array.from({ length: 8 }, (_, r) => Array(8).fill(r < 4 ? 1 : 2));
  assert.equal(scoreReversiBoard(drawn, 1), 0);
});

test("Reversi AI controller schedules once, cancels stale tasks, and chains after a human pass", () => {
  const tasks = new Map(), actions = [];
  let serial = 0, choices = 0;
  const ai = createReversiAiController({
    onMove: action => actions.push(action),
    choose: () => { choices++; return { row: 3, column: 4 }; },
    schedule: callback => { tasks.set(++serial, callback); return serial; },
    unschedule: timer => tasks.delete(timer),
  });
  const state = createReversiState({ blackIndex: 2 });
  ai.update(state, false); assert.equal(tasks.size, 0);
  ai.update(state, true); ai.update(state, true); assert.equal(tasks.size, 1);
  const stale = [...tasks.values()][0];
  ai.update({ ...state, current: 1 }, true); stale(); assert.equal(choices, 0);
  ai.update(state, true); const replaced = [...tasks.values()][0];
  const next = { ...state, moves: 1 };
  ai.update(next, true); replaced(); assert.equal(choices, 0);
  const run = () => { const pending = [...tasks.values()]; tasks.clear(); pending.forEach(callback => callback()); };
  run(); assert.equal(choices, 1); assert.equal(actions.length, 1);
  ai.update({ ...next, moves: 2 }, true); run(); assert.equal(actions.length, 2);
  ai.update(state, true); ai.cancel(); assert.equal(tasks.size, 0);
  ai.update({ ...state, ended: true }, true); assert.equal(tasks.size, 0);
});
