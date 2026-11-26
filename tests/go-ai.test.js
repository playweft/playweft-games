import assert from "node:assert/strict";
import test from "node:test";
import { createGoAiController } from "../games/go/ai-controller.js";
import { goAiPosition, isGoAiTurn } from "../games/go/ai-position.js";
import { applySoloGoAction, createSoloGoState } from "../games/go/solo.js";
import { updateGoHistory, restoreGoResumeState, goRecordToReplayFrames } from "../games/go/history.js";

function start(blackMode = "player1") {
  return applySoloGoAction(createSoloGoState(), {
    type: "start", size: 9, rules: "chinese", komi: 7, handicap: 0,
    blackMode, opponent: "ai", tieBreak: "first-pass",
  }, { now: 1000 }).state;
}
function play(state, row, column) {
  const result = applySoloGoAction(state, { type: "play", row, column }, { now: 2000 });
  assert.equal(result.accepted, true);
  return result.state;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const messages = [], moves = [], statuses = [];
  const worker = {
    postMessage(message) { messages.push(message); },
    terminate() {},
    reply(data) { this.onmessage({ data }); },
  };
  const controller = createGoAiController({
    onMove: move => moves.push(move), onStatus: status => statuses.push(status),
    createWorker: () => worker,
  });
  return { controller, worker, messages, moves, statuses };
}

test("AI undo returns to the human decision, including the AI response and pass", () => {
  const initial = start();
  const human = play(initial, 3, 3);
  const reply = play(human, 7, 7);
  const undo = applySoloGoAction(reply, { type: "undo" }, { now: 3000 }).state;
  assert.deepEqual(undo.board, initial.board);
  assert.equal(undo.current, 1);
  assert.equal(undo.moves, 0);
  const pass = applySoloGoAction(initial, { type: "pass" }).state;
  const answered = play(pass, 4, 4);
  const beforePass = applySoloGoAction(answered, { type: "undo" }).state;
  assert.equal(beforePass.moves, 0);
  assert.equal(beforePass.firstPassIndex, 0);
});

test("AI can open as black, and resignation during thinking resigns the human", () => {
  const state = start("player2");
  assert.equal(isGoAiTurn(state), true);
  const opening = play(state, 3, 3);
  assert.equal(opening.board[2][2], 1);
  assert.equal(opening.current, 1);
  assert.equal(opening.undoAvailable, false);
  const thinking = play(opening, 7, 7);
  const resigned = applySoloGoAction(thinking, { type: "resign" }).state;
  assert.equal(resigned.winnerIndex, 2);
  assert.equal(resigned.lastEvent.playerIndex, 1);
  assert.equal(isGoAiTurn(resigned), false);
});

test("AI games can undo every human decision and restore captures, clocks and ko state", () => {
  let state = start();
  const decisions = [];
  for (const [human, ai] of [[[1, 2], [1, 1]], [[2, 1], [7, 7]], [[3, 3], [8, 8]]]) {
    decisions.push(state);
    state = play(play(state, ...human), ...ai);
  }
  assert.equal(state.captures[0], 1);
  assert.equal(state.undoHistory.length, 3);
  assert.equal(state.undoHistory.some(snapshot => "undoHistory" in snapshot || "undoSnapshot" in snapshot), false);
  const original = structuredClone(state);
  for (const expected of decisions.reverse()) {
    const result = applySoloGoAction(state, { type: "undo" }, { now: 4000 });
    assert.equal(result.accepted, true);
    state = result.state;
    for (const key of ["board", "current", "captures", "scores", "timeUsed", "moves", "previousBoard", "firstPassIndex", "lastMove", "lastEvent"]) {
      assert.deepEqual(state[key], expected[key], key);
    }
    assert.equal(state.turnStartedAt, 4000);
    assert.equal(state.undoAvailable, state.moves > 0);
  }
  assert.equal(state.undoHistory.length, 0);
  assert.equal(applySoloGoAction(state, { type: "undo" }).error.code, "NO_MOVE_TO_UNDO");
  assert.equal(original.moves, 6);
  assert.equal(original.undoHistory.length, 3);
});

test("repeated AI undo while thinking preserves the AI opening and discards the abandoned branch", () => {
  const opening = play(start("player2"), 3, 3);
  const firstReply = play(play(opening, 7, 7), 4, 4);
  const thinking = play(firstReply, 7, 8);
  let state = applySoloGoAction(thinking, { type: "undo" }).state;
  assert.deepEqual(state.board, firstReply.board);
  assert.equal(state.undoAvailable, true);
  state = applySoloGoAction(state, { type: "undo" }).state;
  assert.deepEqual(state.board, opening.board);
  assert.equal(state.moves, 1);
  assert.equal(state.current, 1);
  assert.equal(state.undoAvailable, false);
  state = play(play(state, 8, 8), 4, 5);
  assert.equal(state.undoHistory.length, 1);
  state = applySoloGoAction(state, { type: "undo" }).state;
  assert.deepEqual(state.board, opening.board);
  assert.equal(state.board[6][6], 0);
});

test("AI undo history survives JSON saves and is rebuilt for older complete records", () => {
  let state = start(), records = [], version = 0;
  for (const [row, column] of [[3, 3], [7, 7], [3, 4], [7, 8]]) {
    const result = applySoloGoAction(state, { type: "play", row, column });
    state = result.state;
    records = updateGoHistory(records, { matchId: "undo-save", mode: "solo", version: ++version,
      state, events: result.events });
  }
  const saved = JSON.parse(JSON.stringify(records[0]));
  const legacy = structuredClone(saved);
  delete legacy.resume.state.undoHistory;
  for (const record of [saved, legacy]) {
    let resumed = restoreGoResumeState(record, 5000);
    assert.equal(resumed.undoHistory.length, 2);
    resumed = applySoloGoAction(resumed, { type: "undo" }).state;
    assert.equal(resumed.moves, 2);
    assert.equal(resumed.undoAvailable, true);
    resumed = applySoloGoAction(resumed, { type: "undo" }).state;
    assert.equal(resumed.moves, 0);
    assert.deepEqual(resumed.board, start().board);
  }
});

test("AI undo reopens finished games and clears the saved result", () => {
  let state = play(play(play(play(start(), 3, 3), 7, 7), 3, 4), 7, 8);
  let records = updateGoHistory([], { matchId: "undo-ended", mode: "solo", version: 1, state });
  const resign = applySoloGoAction(state, { type: "resign" });
  records = updateGoHistory(records, { matchId: "undo-ended", mode: "solo", version: 2,
    state: resign.state, events: resign.events });
  assert.ok(records[0].result);
  const undo = applySoloGoAction(resign.state, { type: "undo" });
  assert.equal(undo.accepted, true);
  assert.equal(undo.state.ended, false);
  assert.equal(undo.state.phase, "playing");
  assert.equal(undo.state.current, 1);
  assert.equal(undo.state.winnerIndex, 0);
  records = updateGoHistory(records, { matchId: "undo-ended", mode: "solo", version: 3,
    state: undo.state, events: undo.events });
  assert.equal(records[0].result, undefined);
  assert.equal(records[0].endedAt, undefined);
  assert.ok(records[0].resume);

  state = applySoloGoAction(state, { type: "pass" }).state;
  state = applySoloGoAction(state, { type: "pass" }).state;
  const scoringUndo = applySoloGoAction(state, { type: "undo" });
  assert.equal(scoringUndo.accepted, true);
  assert.equal(scoringUndo.state.phase, "playing");
  state = applySoloGoAction(state, { type: "score" }).state;
  const scoredUndo = applySoloGoAction(state, { type: "undo" });
  assert.equal(scoredUndo.accepted, true);
  assert.equal(scoredUndo.state.moves, 4);
  assert.deepEqual(scoredUndo.state.scores, start().scores);
});

test("saved AI games preserve opponent, human undo point, pass history and ko inputs", () => {
  let records = [];
  let state = start();
  let version = 0;
  function record(action) {
    const result = applySoloGoAction(state, action);
    state = result.state;
    records = updateGoHistory(records, {
      matchId: "ai-game", mode: "solo", version: ++version, state, events: result.events,
    });
  }
  record({ type: "play", row: 3, column: 3 });
  record({ type: "play", row: 7, column: 7 });
  record({ type: "pass" });
  const saved = records[0];
  assert.equal(saved.blackPlayer, "你");
  assert.equal(saved.whitePlayer, "普通 AI");
  const resumed = restoreGoResumeState(saved);
  assert.equal(resumed.settings.opponent, "ai");
  assert.equal(resumed.undoSnapshot.moves, 2);
  const frames = goRecordToReplayFrames(saved);
  const position = goAiPosition(resumed, frames);
  assert.equal(position.currentPlayer, "white");
  assert.equal(position.komi, 7);
  assert.deepEqual(position.moveHistory, [
    { x: 2, y: 2, player: "black" },
    { x: 6, y: 6, player: "white" },
    { x: -1, y: -1, player: "black" },
  ]);
  assert.deepEqual(position.previousBoard, position.board); // A pass leaves stones unchanged.
  assert.equal(position.previousPreviousBoard[6][6], null);
});

test("controller prewarms once and filters engine moves through the game's legality", async () => {
  const h = harness();
  const ready1 = h.controller.prepare(9);
  const ready2 = h.controller.prepare(9);
  assert.equal(h.messages.length, 1);
  h.worker.reply({ id: h.messages[0].id, type: "ready", backend: "webgpu" });
  await Promise.all([ready1, ready2]);
  const state = play(start(), 3, 3);
  h.controller.update(state, [], true);
  h.controller.update(state, [], true);
  assert.equal(h.messages.length, 2);
  h.worker.reply({ id: h.messages[1].id, type: "move", backend: "webgpu", moves: [
    { type: "play", row: 3, column: 3 }, // Occupied, rejected by the real rules.
    { type: "play", row: 7, column: 7 },
  ] });
  await tick();
  assert.deepEqual(h.moves, [{ type: "play", row: 7, column: 7 }]);
});

test("undo, replay, leaving the page and new games cannot apply a stale AI move", async () => {
  const h = harness();
  const thinking = play(start(), 3, 3);
  h.controller.update(thinking, [], true);
  const oldId = h.messages[0].id;
  h.controller.update(thinking, [], false);
  assert.equal(h.messages[1].type, "cancel");
  h.controller.update(thinking, [], true);
  const nextId = h.messages.at(-1).id;
  h.worker.reply({ id: oldId, type: "move", moves: [{ type: "pass" }] });
  await tick();
  assert.equal(h.moves.length, 0);
  h.worker.reply({ id: nextId, type: "move", moves: [{ type: "play", row: 7, column: 7 }] });
  await tick();
  assert.equal(h.moves.length, 1);
  h.controller.update(start(), [], true);
  assert.equal(h.messages.filter(message => message.type === "choose").length, 2);
});

test("engine failure is visible and only retries after the player requests it", async () => {
  const h = harness(), thinking = play(start(), 3, 3);
  h.controller.update(thinking, [], true);
  h.worker.reply({ id: h.messages[0].id, type: "error", message: "GPU lost" });
  await tick();
  assert.equal(h.statuses.at(-1).phase, "error");
  h.controller.update(thinking, [], true);
  assert.equal(h.messages.length, 1);
  h.controller.retry();
  h.controller.update(thinking, [], true);
  assert.equal(h.messages.length, 2);
});

test("worker construction failure is reported, and prewarming can be retried", async () => {
  const statuses = [];
  const controller = createGoAiController({
    onMove() {}, onStatus: status => statuses.push(status),
    createWorker() { throw new Error("Worker unavailable"); },
  });
  await assert.rejects(controller.prepare(9), /Worker unavailable/);
  assert.equal(statuses.at(-1).phase, "error");
  await assert.rejects(controller.prepare(9), /Worker unavailable/);
});

test("changing difficulty cancels the old download and ignores its initialization result", async () => {
  const workers = [], statuses = [];
  const controller = createGoAiController({
    onMove() {}, onStatus: status => statuses.push(status),
    createWorker() {
      const worker = {
        messages: [], terminated: false,
        postMessage(message) { this.messages.push(message); },
        terminate() { this.terminated = true; },
        reply(data) { this.onmessage({ data }); },
      };
      workers.push(worker);
      return worker;
    },
  });
  const enhanced = controller.prepare(19, "b18");
  const cancelled = assert.rejects(enhanced, /取消/);
  const light = controller.prepare(19, "b6");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].messages[0].modelId, "b6");
  workers[0].reply({ id: workers[0].messages[0].id, type: "ready", backend: "webgpu" });
  workers[1].reply({ id: workers[1].messages[0].id, type: "ready", backend: "wasm" });
  await cancelled;
  await light;
  assert.equal(statuses.at(-1).backend, "wasm");
});

test("AI difficulty is retained by rematches and saved games", () => {
  let state = applySoloGoAction(createSoloGoState(), {
    ...start().settings, type: "start", opponent: "ai", aiModel: "b18",
  }).state;
  assert.equal(state.settings.aiModel, "b18");
  assert.deepEqual(state.playerNames, ["你", "困难 AI"]);
  const result = applySoloGoAction(state, { type: "play", row: 3, column: 3 });
  const records = updateGoHistory([], {
    matchId: "enhanced-game", mode: "solo", version: 1, state: result.state, events: result.events,
  });
  assert.equal(restoreGoResumeState(records[0]).settings.aiModel, "b18");
  assert.equal(records[0].whitePlayer, "困难 AI");
  state = applySoloGoAction(result.state, { type: "resign" }).state;
  state = applySoloGoAction(state, { type: "rematch" }).state;
  assert.equal(state.settings.aiModel, "b18");
  assert.deepEqual(state.playerNames, ["你", "困难 AI"]);
});
