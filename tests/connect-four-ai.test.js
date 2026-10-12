import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseConnectFourMove } from "../games/connect-four/ai.js";
import { createConnectFourAiController } from "../games/connect-four/ai-controller.js";
import { createSoloConnectFourState, applySoloConnectFourAction } from "../games/connect-four/solo.js";

const boundedSearch = { now: () => 0 };
function fixture(piece = 2) {
  const state = createSoloConnectFourState();
  state.current = piece;
  return state;
}
function setCell(state, row, column, piece) {
  state.board[row][column] = piece;
  state.moves = state.board.flat().filter(Boolean).length;
}
function drop(state, column, actorIndex = state.current) {
  const result = applySoloConnectFourAction(state, { type: "drop", column }, { actorIndex });
  assert.equal(result.accepted, true, result.error?.code);
  return result.state;
}
function winningMoves(state, piece) {
  return Array.from({ length: 7 }, (_, column) => column + 1).filter(column => {
    const result = applySoloConnectFourAction({ ...state, current: piece }, { type: "drop", column }, { actorIndex: piece });
    return result.accepted && result.state.winnerIndex === piece;
  });
}

test("Connect Four AI opens in the center and does not mutate its input", () => {
  const state = fixture();
  assert.equal(chooseConnectFourMove(state).column, 4);
  setCell(state, 5, 3, 1);
  const before = structuredClone(state);
  const move = chooseConnectFourMove(state, boundedSearch);
  assert.ok(move.nodes <= 768);
  assert.ok(move.depth <= 4);
  drop(state, move.column);
  assert.deepEqual(state, before);
});

test("Connect Four AI takes wins in all four directions for either color", () => {
  for (const piece of [1, 2]) {
    for (const [dr, dc] of [[0, 1], [-1, 0], [-1, 1], [-1, -1]]) {
      const state = fixture(piece);
      const startColumn = dc < 0 ? 6 : 0;
      for (let n = 0; n < 4; n += 1) {
        const row = 5 + dr * n;
        const column = startColumn + dc * n;
        for (let support = row + 1; support < 6; support += 1) {
          if (!state.board[support][column]) setCell(state, support, column, 3 - piece);
        }
        if (n < 3) setCell(state, row, column, piece);
      }
      const move = chooseConnectFourMove(state, { timeBudgetMs: 0, maxNodes: 0 });
      assert.equal(drop(state, move.column).winnerIndex, piece);
    }
  }
});

test("Connect Four AI blocks immediate horizontal and vertical losses", () => {
  for (const horizontal of [false, true]) {
    const state = fixture();
    for (let n = 0; n < 3; n += 1) setCell(state, horizontal ? 5 : 5 - n, horizontal ? n : 0, 1);
    setCell(state, 5, 5, 2);
    const move = chooseConnectFourMove(state, { timeBudgetMs: 0 });
    assert.equal(move.column, horizontal ? 4 : 1);
    assert.deepEqual(winningMoves(drop(state, move.column), 1), []);
  }
});

test("Connect Four AI takes its win before blocking an opponent's win", () => {
  const state = fixture();
  for (let row = 3; row < 6; row += 1) {
    setCell(state, row, 0, 1);
    setCell(state, row, 6, 2);
  }
  assert.equal(chooseConnectFourMove(state).column, 7);
});

test("Connect Four AI avoids supporting an opponent's winning square even without search", () => {
  const state = fixture();
  state.board[5] = [0, 2, 1, 2, 0, 0, 0];
  state.board[4] = [0, 1, 1, 1, 0, 0, 0];
  state.moves = 6;
  assert.deepEqual(winningMoves(state, 1), []);
  const move = chooseConnectFourMove(state, { timeBudgetMs: 0, maxNodes: 0 });
  assert.ok(![1, 5].includes(move.column));
  assert.deepEqual(winningMoves(drop(state, move.column), 1), []);
});

test("Connect Four AI creates a double threat that no one move can defend", () => {
  const state = fixture();
  state.board[5] = [1, 0, 2, 2, 0, 0, 1];
  state.moves = 4;
  const move = chooseConnectFourMove(state, { timeBudgetMs: 0, maxNodes: 0 });
  assert.equal(move.column, 5);
  const fork = drop(state, move.column);
  assert.deepEqual(winningMoves(fork, 2), [2, 6]);
  for (let reply = 1; reply <= 7; reply += 1) {
    const next = drop(fork, reply);
    assert.ok(winningMoves(next, 2).length > 0);
  }
});

test("Connect Four AI shallow search prevents an opponent's double threat", () => {
  const state = fixture();
  state.board[5] = [2, 0, 1, 1, 0, 0, 2];
  state.moves = 4;
  const move = chooseConnectFourMove(state, boundedSearch);
  assert.ok([2, 5].includes(move.column));
});

test("Connect Four AI skips full columns, obeys node/time limits and ignores ended games", () => {
  const state = fixture();
  for (let row = 0; row < 6; row += 1) setCell(state, row, 3, row % 2 + 1);
  const before = structuredClone(state);
  const capped = chooseConnectFourMove(state, { now: () => 0, maxNodes: 10 });
  assert.ok(capped.nodes <= 10);
  assert.notEqual(capped.column, 4);
  drop(state, capped.column);
  let clock = 0;
  const timed = chooseConnectFourMove(state, { now: () => clock++, timeBudgetMs: 1 });
  assert.equal(timed.nodes, 0);
  drop(state, timed.column);
  assert.deepEqual(state, before);
  assert.equal(chooseConnectFourMove({ ...state, winner: state.players[0] }), null);
  assert.equal(chooseConnectFourMove({ ...state, draw: true }), null);
});

test("Connect Four AI completes bounded legal self-play with either starter", () => {
  for (const starter of [1, 2]) {
    let state = { ...fixture(starter), starter };
    while (!state.winner && !state.draw) {
      const before = structuredClone(state);
      const move = chooseConnectFourMove(state, boundedSearch);
      assert.ok(move.nodes <= 768);
      assert.deepEqual(state, before);
      state = drop(state, move.column);
    }
    assert.ok(state.moves >= 7 && state.moves <= 42);
    assert.equal(chooseConnectFourMove(state), null);
  }
});

function harness({ fail = false } = {}) {
  const workers = [], moves = [], errors = [], tasks = new Map();
  let taskId = 0;
  const controller = createConnectFourAiController({
    onMove: move => moves.push(move), onError: error => errors.push(error),
    createWorker() {
      if (fail) throw new Error("Worker unavailable");
      const worker = { requests: [], terminated: false,
        postMessage(data) { this.requests.push(data); }, terminate() { this.terminated = true; } };
      workers.push(worker);
      return worker;
    },
    schedule(callback, delay = 0) { tasks.set(++taskId, { callback, delay }); return taskId; },
    unschedule(id) { tasks.delete(id); },
  });
  const flush = delay => {
    for (const [id, task] of [...tasks]) {
      if (task.delay !== delay) continue;
      tasks.delete(id); task.callback();
    }
  };
  return { controller, workers, moves, errors, tasks, flush };
}

test("Connect Four controller computes only local computer turns and reuses the worker", () => {
  const h = harness();
  h.controller.update(fixture(), "room", false);
  h.controller.update(fixture(1), "human", true);
  assert.equal(h.workers.length, 0);
  h.controller.update(fixture(), "first", true);
  h.controller.update(fixture(), "first", true);
  const worker = h.workers[0];
  assert.equal(worker.requests.length, 1);
  worker.onmessage({ data: { requestId: worker.requests[0].requestId, move: { column: 4 } } });
  assert.deepEqual(h.moves, [{ type: "drop", column: 4 }]);
  h.controller.update(fixture(), "next", true);
  assert.equal(h.workers.length, 1);
  assert.equal(worker.requests.length, 2);
  h.controller.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(h.tasks.size, 0);
});

test("Connect Four controller cancels old turns, hidden pages and late worker replies", () => {
  const h = harness();
  h.controller.update(fixture(), "old", true);
  const old = h.workers[0];
  h.controller.update(fixture(), "new", true);
  assert.equal(old.terminated, true);
  old.onmessage({ data: { requestId: old.requests[0].requestId, move: { column: 7 } } });
  old.onerror();
  assert.deepEqual(h.moves, []);
  assert.equal(h.workers[1].terminated, false);
  h.controller.update(fixture(), "new", false);
  assert.equal(h.workers[1].terminated, true);
  h.controller.dispose();
  assert.equal(h.tasks.size, 0);
});

test("Connect Four controller has a tactical fallback on worker failures and cancels it", () => {
  for (const fail of [false, true]) {
    const h = harness({ fail });
    h.controller.update(fixture(), "first", true);
    if (!fail) h.flush(3000);
    h.flush(0);
    assert.deepEqual(h.moves, [{ type: "drop", column: 4 }]);
    assert.deepEqual(h.errors, []);
    h.controller.update(fixture(), "next", true);
    h.controller.dispose();
    h.flush(0);
    assert.equal(h.moves.length, 1);
  }
});
