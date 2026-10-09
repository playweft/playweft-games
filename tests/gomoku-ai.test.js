import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseGomokuMove } from "../games/gomoku/ai.js";
import { createGomokuAiController } from "../games/gomoku/ai-controller.js";
import { applySoloGomokuAction, createSoloGomokuState } from "../games/gomoku/solo.js";

function fixture(piece = 2, forbiddenMoves = false) {
  const state = applySoloGomokuAction(createSoloGomokuState(), {
    type: "start", blackMode: piece === 1 ? "player2" : "player1", forbiddenMoves,
  }, { now: 0 }).state;
  state.current = 2;
  return state;
}
function place(state, piece, cells) {
  for (const [r, c] of cells) state.board[r - 1][c - 1] = piece;
  state.moves = state.board.flat().filter(Boolean).length;
}
const fullSearch = { now: () => 0 };
function acceptedMove(state, move) {
  assert.ok(move);
  const next = applySoloGomokuAction(state, { type: "play", row: move.row, column: move.column }, { actorIndex: state.current });
  assert.equal(next.accepted, true, next.error?.code);
  return next.state;
}

test("Gomoku AI opens at center and never mutates caller state", () => {
  const state = fixture(1, true);
  const before = structuredClone(state);
  const move = chooseGomokuMove(state);
  assert.deepEqual([move.row, move.column], [8, 8]);
  acceptedMove(state, move);
  assert.deepEqual(state, before);
  place(state, 2, [[8, 9], [9, 8]]);
  const occupied = structuredClone(state);
  const searched = chooseGomokuMove(state, fullSearch);
  acceptedMove(state, searched);
  assert.ok(searched.nodes <= 48);
  assert.deepEqual(state, occupied);
});

test("Gomoku AI takes immediate wins in every direction, including edges and a gap", () => {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (const piece of [1, 2]) {
      const state = fixture(piece, true);
      const c = dc < 0 ? 15 : 1;
      place(state, piece, [0, 1, 3, 4].map((n) => [1 + dr * n, c + dc * n]));
      const next = acceptedMove(state, chooseGomokuMove(state, fullSearch));
      assert.equal(next.winnerIndex, 2);
    }
  }
});

test("Gomoku AI blocks a mandatory win instead of playing its preferred attack", () => {
  for (const piece of [1, 2]) {
    const state = fixture(piece);
    place(state, 3 - piece, [[1, 1], [1, 2], [1, 3], [1, 4]]);
    place(state, piece, [[8, 7], [8, 8], [8, 9]]);
    const move = chooseGomokuMove(state, fullSearch);
    assert.deepEqual([move.row, move.column], [1, 5]);
    acceptedMove(state, move);
  }
});

test("Gomoku AI wins immediately even when the opponent also threatens to win", () => {
  const state = fixture();
  place(state, 1, [[1, 1], [1, 2], [1, 3], [1, 4]]);
  place(state, 2, [[15, 1], [15, 2], [15, 3], [15, 4]]);
  assert.equal(acceptedMove(state, chooseGomokuMove(state)).winnerIndex, 2);
});

test("Gomoku AI creates a two-endpoint winning threat from an open three", () => {
  const state = fixture();
  place(state, 2, [[8, 7], [8, 8], [8, 9]]);
  place(state, 1, [[5, 5], [6, 5]]);
  const move = chooseGomokuMove(state, fullSearch);
  assert.equal(move.row, 8);
  assert.ok([6, 10].includes(move.column));
  acceptedMove(state, move);
});

test("Gomoku AI rejects black overlines and double-three forks", () => {
  const state = fixture(1, true);
  place(state, 1, [[8, 3], [8, 4], [8, 6], [8, 7], [8, 8]]);
  place(state, 2, [[7, 5]]);
  const move = chooseGomokuMove(state, fullSearch);
  assert.notDeepEqual([move.row, move.column], [8, 5]);
  acceptedMove(state, move);
  const fork = fixture(1, true);
  place(fork, 1, [[8, 7], [8, 9], [7, 8], [9, 8]]);
  const before = structuredClone(fork);
  const forkMove = chooseGomokuMove(fork, fullSearch);
  assert.notDeepEqual([forkMove.row, forkMove.column], [8, 8]);
  acceptedMove(fork, forkMove);
  assert.deepEqual(fork, before);
});

test("Gomoku AI does not defend an opponent's illegal black overline", () => {
  const state = fixture(2, true);
  place(state, 1, [[8, 3], [8, 4], [8, 6], [8, 7], [8, 8]]);
  place(state, 2, [[11, 6], [11, 7], [11, 8]]);
  const move = chooseGomokuMove(state, fullSearch);
  assert.equal(move.row, 11);
  assert.ok([5, 9].includes(move.column));
  const unrestricted = structuredClone(state);
  unrestricted.settings.forbiddenMoves = false;
  const block = chooseGomokuMove(unrestricted);
  assert.deepEqual([block.row, block.column], [8, 5]);
});

test("Gomoku AI returns a legal fallback at its deadline and skips ended games", () => {
  const state = fixture(1, true);
  place(state, 2, [[8, 8]]);
  const move = chooseGomokuMove(state, { timeBudgetMs: 0, now: () => 0 });
  assert.equal(move.nodes, 0);
  acceptedMove(state, move);
  state.ended = true;
  assert.equal(chooseGomokuMove(state), null);
});

test("Gomoku AI plays repeated legal bounded turns with both rule settings", () => {
  for (const forbidden of [false, true]) {
    let state = fixture(1, forbidden);
    for (let n = 0; n < 45 && !state.ended; n += 1) {
      const move = chooseGomokuMove(state, fullSearch);
      assert.ok(move.nodes <= 48);
      state = acceptedMove(state, move);
    }
    assert.ok(state.moves >= 9);
  }
});

function harness({ fail = false } = {}) {
  const workers = [], moves = [], errors = [], tasks = new Map();
  let taskId = 0;
  const controller = createGomokuAiController({
    onMove: (move) => moves.push(move), onError: (error) => errors.push(error),
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
  const flush = (delay) => {
    for (const [id, task] of [...tasks]) {
      if (task.delay !== delay) continue;
      tasks.delete(id); task.callback();
    }
  };
  return { controller, workers, moves, errors, tasks, flush };
}

test("Gomoku controller only searches the AI's solo turn and reuses an idle worker", () => {
  const h = harness();
  const state = fixture();
  h.controller.update(state, "room", false);
  h.controller.update({ ...state, current: 1 }, "human", true);
  assert.equal(h.workers.length, 0);
  h.controller.update(state, "ai-1", true);
  h.controller.update(state, "ai-1", true);
  const worker = h.workers[0];
  assert.equal(worker.requests.length, 1);
  worker.onmessage({ data: { requestId: worker.requests[0].requestId, move: { row: 8, column: 8 } } });
  assert.deepEqual(h.moves, [{ type: "play", row: 8, column: 8 }]);
  assert.equal(h.tasks.size, 0);
  h.controller.update(state, "ai-2", true);
  assert.equal(h.workers.length, 1);
  assert.equal(worker.requests.length, 2);
  h.controller.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(h.tasks.size, 0);
});

test("Gomoku controller cancels old rounds, errors and delayed moves", () => {
  const h = harness();
  const state = fixture();
  h.controller.update(state, "old", true);
  const old = h.workers[0];
  h.controller.update(state, "new", true);
  assert.equal(old.terminated, true);
  old.onmessage({ data: { requestId: old.requests[0].requestId, move: { row: 8, column: 8 } } });
  old.onerror();
  assert.equal(h.moves.length, 0);
  assert.equal(h.workers[1].terminated, false);
  h.controller.update({ ...state, ended: true }, "ended", true);
  assert.equal(h.workers[1].terminated, true);
  h.controller.dispose();
  assert.equal(h.tasks.size, 0);
});

test("Gomoku controller never computes in local two-player mode and cancels stale AI moves", () => {
  const h = harness();
  const state = fixture();
  const local = { ...state, settings: { ...state.settings, opponent: "local" } };
  h.controller.update(local, "local-first", true);
  assert.equal(h.workers.length, 0);
  h.controller.update(state, "ai", true);
  const old = h.workers[0];
  h.controller.update(local, "local-second", true);
  assert.equal(old.terminated, true);
  old.onmessage({ data: { requestId: old.requests[0].requestId, move: { row: 8, column: 8 } } });
  assert.deepEqual(h.moves, []);
  assert.equal(h.tasks.size, 0);
});

test("Gomoku controller falls back when workers fail or time out, and cancels fallback", () => {
  for (const fail of [true, false]) {
    const h = harness({ fail });
    h.controller.update(fixture(1), "first", true);
    if (!fail) h.flush(3000);
    h.flush(0);
    assert.deepEqual(h.moves, [{ type: "play", row: 8, column: 8 }]);
    assert.deepEqual(h.errors, []);
    h.controller.update(fixture(1), "second", true);
    h.controller.dispose();
    h.flush(0);
    assert.equal(h.moves.length, 1);
  }
});

test("Solo Gomoku rejects a human action during the computer's turn", () => {
  const state = fixture();
  const before = structuredClone(state);
  const result = applySoloGomokuAction(state, { type: "play", row: 8, column: 8 }, { actorIndex: 1 });
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "NOT_YOUR_TURN");
  assert.deepEqual(state, before);
});
