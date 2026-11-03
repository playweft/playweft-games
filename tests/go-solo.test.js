import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySoloGoAction,
  createSoloGoState,
} from "../games/go/solo.js";

function startSolo(settings = {}) {
  return applySoloGoAction(
    createSoloGoState(),
    {
      type: "start",
      size: 9,
      rules: "chinese",
      komi: 6.5,
      handicap: 0,
      blackMode: "player1",
      ...settings,
    },
    { now: 1000, random: () => 0 },
  ).state;
}

test("Go solo mode alternates black and white on one client", () => {
  let state = startSolo();
  const black = applySoloGoAction(
    state,
    { type: "play", row: 4, column: 4 },
    { now: 3500 },
  );
  state = black.state;
  const white = applySoloGoAction(
    state,
    { type: "play", row: 4, column: 5 },
    { now: 6000 },
  );

  assert.equal(black.accepted, true);
  assert.equal(black.state.board[3][3], 1);
  assert.equal(black.state.current, 2);
  assert.equal(black.state.timeUsed[0], 2500);
  assert.equal(white.accepted, true);
  assert.equal(white.state.board[3][4], 2);
  assert.equal(white.state.current, 1);
  assert.equal(white.state.timeUsed[1], 2500);
});

test("Go solo mode applies captures locally", () => {
  const state = startSolo();
  state.board[0][1] = 1;
  state.board[1][0] = 1;
  state.board[1][1] = 2;
  state.board[1][2] = 1;
  state.current = 1;

  const result = applySoloGoAction(
    state,
    { type: "play", row: 3, column: 2 },
    { now: 2000 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.board[1][1], 0);
  assert.equal(result.state.captures[0], 1);
});

test("Go solo mode scores after two passes on the same terminal", () => {
  let state = startSolo();
  state = applySoloGoAction(
    state,
    { type: "pass" },
    { now: 2000 },
  ).state;
  state = applySoloGoAction(
    state,
    { type: "pass" },
    { now: 3000 },
  ).state;

  assert.equal(state.phase, "scoring");
  assert.equal(state.moves, 2);
  const result = applySoloGoAction(
    state,
    { type: "score", scoreRound: state.scoreRound },
    { now: 3000 },
  );

  assert.equal(result.state.ended, true);
  assert.equal(result.state.scores.black, 0);
  assert.equal(result.state.scores.white, 6.5);
  assert.equal(result.state.winnerIndex, 2);
});

test("Go solo mode lets the current color resign", () => {
  const state = startSolo();
  const result = applySoloGoAction(
    state,
    { type: "resign" },
    { now: 3500 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.ended, true);
  assert.equal(result.state.phase, "ended");
  assert.equal(result.state.current, 0);
  assert.equal(result.state.winnerIndex, 2);
  assert.equal(result.state.lastEvent.kind, "resigned");
  assert.equal(result.state.lastEvent.playerIndex, 1);
  assert.equal(result.state.timeUsed[0], 2500);
  assert.equal(result.events[0].type, "resigned");
});

test("Go solo mode keeps settings for rematches and returns them to setup", () => {
  let state = startSolo({
    size: 13,
    rules: "japanese",
    komi: 5.5,
    handicap: 4,
    blackMode: "player2",
  });

  assert.equal(state.blackIndex, 2);
  assert.equal(state.current, 1);
  assert.equal(state.board.flat().filter((point) => point === 1).length, 4);

  state.ended = true;
  state.phase = "ended";
  const rematch = applySoloGoAction(
    state,
    { type: "rematch" },
    { now: 5000 },
  );
  assert.equal(rematch.accepted, true);
  assert.deepEqual(rematch.state.settings, state.settings);
  assert.equal(rematch.state.round, 2);
  assert.equal(rematch.state.board.flat().filter((point) => point === 1).length, 4);

  rematch.state.ended = true;
  rematch.state.phase = "ended";
  const configure = applySoloGoAction(
    rematch.state,
    { type: "configure" },
  );
  assert.equal(configure.accepted, true);
  assert.equal(configure.state.phase, "setup");
  assert.deepEqual(configure.state.settings, state.settings);
  assert.equal(configure.state.round, 3);
});

test("Go solo mode immediately undoes the last move", () => {
  let state = startSolo();
  state = applySoloGoAction(
    state,
    { type: "play", row: 4, column: 4 },
    { now: 2500 },
  ).state;

  const result = applySoloGoAction(state, { type: "undo" }, { now: 3000 });

  assert.equal(result.accepted, true);
  assert.equal(result.events[0].type, "undo_accepted");
  assert.equal(result.state.moves, 0);
  assert.equal(result.state.current, 1);
  assert.equal(result.state.board[3][3], 0);
  assert.equal(result.state.undoAvailable, false);
  assert.equal(result.state.undoSnapshot, null);
  assert.equal(
    applySoloGoAction(result.state, { type: "undo" }).error.code,
    "NO_MOVE_TO_UNDO",
  );
});

test("Chinese Go defaults to seven-point komi and first-pass tiebreak", () => {
  assert.equal(createSoloGoState().settings.komi, 7);
  assert.equal(createSoloGoState().settings.tieBreak, "first-pass");
  assert.equal(startSolo().settings.tieBreak, "first-pass");
});

for (const tieBreak of ["draw", "white", "first-pass"]) {
  for (const blackMode of ["player1", "player2"]) {
    for (const firstColor of [1, 2]) {
      test(`solo tied score: ${tieBreak}, ${blackMode}, color ${firstColor} passes first`, () => {
        let state = startSolo({ tieBreak, komi: 7, blackMode });
        // Eight black stones and one white stone share a neutral outside region.
        state.board[0].fill(1, 0, 8);
        state.board[8][8] = 2;
        const whiteIndex = (state.blackIndex % 2) + 1;
        state.current = firstColor === 1 ? state.blackIndex : whiteIndex;
        const first = state.current;
        state = applySoloGoAction(state, { type: "pass" }).state;
        state = applySoloGoAction(state, { type: "pass" }).state;
        state = applySoloGoAction(state, { type: "score" }).state;
        assert.equal(state.scores.black, 8);
        assert.equal(state.scores.white, 8);
        const expected = tieBreak === "draw" ? 0 : tieBreak === "white" ? whiteIndex : first;
        assert.equal(state.winnerIndex, expected);
        assert.equal(state.winner, state.players[expected - 1] ?? "");
        assert.equal(state.firstPassIndex, first);
      });
    }
  }
}

test("first-pass tiebreak records the earliest effective pass and undo restores it", () => {
  let state = startSolo({ tieBreak: "first-pass" });
  state = applySoloGoAction(state, { type: "pass" }).state;
  assert.equal(state.firstPassIndex, 1);
  state = applySoloGoAction(state, { type: "undo" }).state;
  assert.equal(state.firstPassIndex, 0);
  state = applySoloGoAction(state, { type: "play", row: 4, column: 4 }).state;
  state = applySoloGoAction(state, { type: "pass" }).state;
  assert.equal(state.firstPassIndex, 2);
  state = applySoloGoAction(state, { type: "play", row: 5, column: 5 }).state;
  assert.equal(state.firstPassIndex, 2);
  state = applySoloGoAction(state, { type: "undo" }).state;
  assert.equal(state.firstPassIndex, 2);
  state = applySoloGoAction(state, { type: "pass" }).state;
  assert.equal(state.phase, "scoring");
  state = applySoloGoAction(state, { type: "score" }).state;
  assert.equal(state.winnerIndex, 1, "higher score still wins, independent of tiebreak");
  state = applySoloGoAction(state, { type: "rematch" }).state;
  assert.equal(state.firstPassIndex, 0);
  assert.equal(state.settings.tieBreak, "first-pass");
});

test("solo Go rejects unsupported tiebreak settings", () => {
  for (const tieBreak of ["black", false, 0, {}]) {
    assert.equal(applySoloGoAction(createSoloGoState(), {
      type: "start", size: 9, rules: "chinese", komi: 7,
      handicap: 0, blackMode: "player1", tieBreak,
    }).accepted, false);
  }
});
