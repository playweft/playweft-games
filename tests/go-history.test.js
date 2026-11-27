import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canResumeGoRecord,
  createGoHistoryStore,
  goRecordAnalysisKey,
  goRecordToReplayFrames,
  goRecordToReview,
  goRecordToSgf,
  historyResultLabel,
  latestGoResumeRecord,
  goResumeModeLabel,
  restoreGoResumeState,
  updateGoResumeSnapshot,
  updateGoHistory,
  updateGoRecordAnalysis,
} from "../games/go/history.js";
import { applySoloGoAction, createSoloGoState } from "../games/go/solo.js";

function gameState(overrides = {}) {
  return {
    players: ["black", "white"],
    phase: "playing",
    settings: {
      size: 9,
      rules: "chinese",
      komi: 6.5,
      handicap: 0,
      blackMode: "player1",
    },
    board: Array.from({ length: 9 }, () => Array(9).fill(0)),
    current: 1,
    blackIndex: 1,
    captures: [0, 0],
    timeUsed: [0, 0],
    moves: 0,
    ended: false,
    lastMove: { row: 0, column: 0 },
    lastEvent: { kind: "start", playerIndex: 1 },
    round: 1,
    ...overrides,
  };
}

test("completed and legacy records can be reviewed without a resume snapshot or changing the archive",()=>{
  const record={settings:gameState().settings,moves:[{color:"B",row:1,column:1},
    {color:"W",pass:true},{color:"B",row:2,column:1}],resume:null,
    status:"ended",result:{winnerColor:"B"}};
  const before=structuredClone(record);
  const review=goRecordToReview(record);
  assert.equal(review.frames.length,4);
  assert.equal(review.frames[0].board[0][0],0);
  assert.equal(review.frames[1].board[0][0],1);
  assert.equal(review.frames[2].move.pass,true);
  assert.equal(review.frames[3].current,2);
  assert.deepEqual(record,before,"review is read-only");
  assert.equal(goRecordToReview({...record,partial:true}),undefined);
  assert.equal(goRecordToReview({...record,moves:[{color:"W",row:1,column:1}]}),undefined,
    "do not invent a position when the initial move is missing");
});

test("home resume chooses the newest unfinished local game and labels only its mode", () => {
  const local = settings => updateGoHistory([], {
    matchId: settings.aiModel ?? settings.opponent, mode: "solo", version: 1,
    state: gameState({ moves: 1, settings: { ...gameState().settings, ...settings } }),
  }, 100)[0];
  const ordinary = local({ opponent: "ai", aiModel: "b6" });
  const hard = local({ opponent: "ai", aiModel: "b18" });
  const twoPlayers = local({ opponent: "local" });
  assert.equal(goResumeModeLabel(ordinary), "普通人机");
  assert.equal(goResumeModeLabel(hard), "困难人机");
  assert.equal(goResumeModeLabel(twoPlayers), "本地双人");
  hard.updatedAt = 200;
  const room = { ...twoPlayers, mode: "room", updatedAt: 999 };
  const ended = { ...ordinary, result: { winnerColor: "B" }, updatedAt: 1000 };
  assert.equal(latestGoResumeRecord([room, ordinary, ended, hard, twoPlayers]), hard);
  assert.equal(latestGoResumeRecord([room, ended, { ...hard, resume: null }]), undefined);
  assert.equal(latestGoResumeRecord([]), undefined);
});

test("Go history records moves once and exports SGF", () => {
  let records = updateGoHistory([], {
    matchId: "match-one",
    version: 1,
    state: gameState(),
    events: [{ type: "started", player: "black" }],
  }, Date.UTC(2026, 6, 28, 10));
  assert.equal(records.length, 0);

  const board = gameState().board;
  board[3][3] = 1;
  const played = {
    matchId: "match-one",
    version: 2,
    state: gameState({
      board,
      current: 2,
      moves: 1,
      timeUsed: [3500, 0],
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  };
  records = updateGoHistory(records, played, Date.UTC(2026, 6, 28, 10, 1));
  records = updateGoHistory(records, played, Date.UTC(2026, 6, 28, 10, 2));

  assert.equal(records.length, 1);
  assert.equal(records[0].partial, false);
  assert.equal(records[0].moves.length, 1);
  assert.deepEqual(records[0].moves[0], {
    color: "B",
    pass: false,
    row: 4,
    column: 4,
    elapsedFromStartMs: 3500,
    version: 2,
  });
  assert.match(goRecordToSgf(records[0]), /SZ\[9\].*KM\[6.5\].*;B\[dd\]/);
});

test("Go move times are cumulative active time across saving, resuming and passes", () => {
  let state = applySoloGoAction(createSoloGoState(), {
    type: "start", ...gameState().settings, blackMode: "player1",
  }, { now: 1000 }).state;
  let records = [], version = 0;
  function act(action, now) {
    const result = applySoloGoAction(state, action, { now });
    assert.equal(result.accepted, true);
    state = result.state;
    records = updateGoHistory(records, { matchId: "timed", mode: "solo",
      version: ++version, state, events: result.events }, now);
  }
  act({ type: "play", row: 1, column: 1 }, 1100);
  records = updateGoResumeSnapshot(records, "timed", state, 2000);
  state = restoreGoResumeState(records[0], 100_000);
  act({ type: "play", row: 2, column: 1 }, 100_250);
  act({ type: "pass" }, 101_000);
  assert.deepEqual(records[0].moves.map(move => move.elapsedFromStartMs), [100, 1250, 2000]);
  const review = goRecordToReview(records[0]);
  assert.deepEqual(review.frames.map(frame => frame.elapsedFromStartMs), [0, 100, 1250, 2000]);
  assert.deepEqual(review.state.timeUsed, [850, 1150], "review reconstructs the actual clocks");
  act({ type: "undo" }, 102_000);
  act({ type: "play", row: 3, column: 1 }, 102_500);
  assert.deepEqual(records[0].moves.map(move => move.elapsedFromStartMs), [100, 1250, 1750]);
});

test("reading old archives converts move times once and preserves the rest of the record", () => {
  const record = { format: "playweft-go-record", formatVersion: 1, id: "old",
    settings: gameState().settings, updatedAt: 123, resume: { state: gameState() },
    result: { winnerColor: "B" }, moves: [
      { color: "B", row: 1, column: 1, elapsedMs: 3500, cumulativeMs: 3500 },
      { color: "W", row: 2, column: 1, cumulativeMs: 1000 },
      { color: "B", pass: true, cumulativeMs: 6000 },
      { color: "W", row: 3, column: 1, elapsedFromStartMs: 8000 },
      { color: "B", pass: true, elapsedMs: 500, cumulativeMs: 6500 },
    ] };
  let raw = JSON.stringify({ format: "playweft-go-history", formatVersion: 1, records: [record] });
  let writes = 0;
  const store = createGoHistoryStore(() => ({ getItem: () => raw,
    setItem(_key, value) { raw = value; writes++; } }));
  const converted = store.load()[0];
  assert.deepEqual(converted.moves.map(move => move.elapsedFromStartMs), [3500, 4500, 7000, 8000, 8500]);
  assert.deepEqual(converted.resume, record.resume);
  assert.deepEqual(converted.result, record.result);
  assert.equal(converted.updatedAt, record.updatedAt);
  assert.ok(converted.moves.every(move => !("elapsedMs" in move) && !("cumulativeMs" in move)));
  assert.deepEqual(JSON.parse(raw).records[0], converted, "conversion is saved automatically");
  store.load();
  assert.equal(writes, 1, "already converted archives are not rewritten");
});

test("analysis saves round-trip without changing history order and reject stale positions", () => {
  let records = updateGoHistory([], { matchId: "analyzed", version: 1,
    state: gameState({ moves: 1, current: 2, lastMove: { row: 1, column: 1 },
      lastEvent: { kind: "play", playerIndex: 1 } }),
  }, 100);
  const key = goRecordAnalysisKey(records[0], "/model-a.gz");
  const analysis = { formatVersion: 1, key,
    results: [{ blackWinRate: .5, scoreLead: -7, visits: 32, candidates: [
      { type: "play", row: 2, column: 2, blackWinRate: .55, scoreLead: 1, visits: 20 },
      { type: "pass", blackWinRate: .4, scoreLead: -2, visits: 11 },
    ] }, null] };
  records = updateGoRecordAnalysis(records, records[0].id, "/model-a.gz", analysis);
  let raw;
  const store = createGoHistoryStore(() => ({ getItem: () => raw, setItem(_key, value) { raw = value; } }));
  store.save(records);
  assert.deepEqual(store.load()[0].analysis, { ...analysis, modelUrl: "/model-a.gz" });
  assert.equal(store.load()[0].updatedAt, 100);
  assert.equal(updateGoRecordAnalysis(records, records[0].id, "/model-b.gz", analysis), records);
  assert.equal(goRecordAnalysisKey({ ...records[0], lastVersion: 99, timeUsed: [9999, 8888] }, "/model-a.gz"), key);
  assert.notEqual(goRecordAnalysisKey({ ...records[0], settings: { ...records[0].settings, komi: 7 } }, "/model-a.gz"), key);
  const previous = structuredClone(records);
  const original = records;
  records = updateGoHistory(records, { matchId: "analyzed", version: 2,
    state: gameState({ moves: 2, current: 1, lastMove: { row: 2, column: 1 },
      lastEvent: { kind: "play", playerIndex: 2 } }),
  }, 200);
  assert.deepEqual(original, previous, "recording a move must not mutate previous snapshots");
  assert.equal(records[0].analysis, undefined, "a changed line never displays obsolete results");
  assert.equal(updateGoRecordAnalysis(records, records[0].id, "/model-a.gz", analysis), records);
});

test("Go history stores the confirmed result", () => {
  let records = updateGoHistory([], {
    matchId: "match-two",
    version: 7,
    state: gameState({
      moves: 1,
      current: 2,
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  });
  records = updateGoHistory(records, {
    matchId: "match-two",
    version: 8,
    state: gameState({
      phase: "ended",
      ended: true,
      moves: 1,
      winner: "white",
      winnerIndex: 2,
      scores: { black: 1, white: 7.5 },
      lastEvent: { kind: "scored", playerIndex: 2 },
    }),
    events: [{ type: "scored", winner: "white" }],
  });

  assert.equal(historyResultLabel(records[0]), "白方胜 6.5 目");
  assert.match(goRecordToSgf(records[0]), /RE\[W\+6.5\]/);
});

test("Go history stores resignation as an SGF resignation result", () => {
  let records = updateGoHistory([], {
    matchId: "match-resigned",
    version: 2,
    state: gameState({
      moves: 1,
      current: 2,
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  });
  records = updateGoHistory(records, {
    matchId: "match-resigned",
    version: 3,
    state: gameState({
      phase: "ended",
      ended: true,
      moves: 1,
      winner: "white",
      winnerIndex: 2,
      lastEvent: { kind: "resigned", playerIndex: 1 },
    }),
    events: [{ type: "resigned", player: "black", winner: "white" }],
  });

  assert.equal(historyResultLabel(records[0]), "白方胜");
  assert.match(goRecordToSgf(records[0]), /RE\[W\+R\]/);
});

test("Go history removes a game when its only move is undone", () => {
  let records = updateGoHistory([], {
    matchId: "match-undo",
    version: 1,
    state: gameState(),
    events: [{ type: "started", player: "black" }],
  });
  records = updateGoHistory(records, {
    matchId: "match-undo",
    version: 2,
    state: gameState({
      moves: 1,
      current: 2,
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  });
  records = updateGoHistory(records, {
    matchId: "match-undo",
    version: 3,
    state: gameState(),
    events: [{ type: "undo_accepted", player: "white" }],
  });

  assert.equal(records.length, 0);
});

test("Go history does not store a game that ends before the first move", () => {
  const started = updateGoHistory([], {
    matchId: "match-empty",
    version: 1,
    state: gameState(),
    events: [{ type: "started", player: "black" }],
  });
  const resigned = updateGoHistory(started, {
    matchId: "match-empty",
    version: 2,
    state: gameState({
      phase: "ended",
      ended: true,
      winner: "white",
      winnerIndex: 2,
      lastEvent: { kind: "resigned", playerIndex: 1 },
    }),
    events: [{ type: "resigned", player: "black", winner: "white" }],
  });

  assert.equal(resigned.length, 0);
});

test("Go history keeps handicap stones when recording starts on the first move", () => {
  const board = gameState().board;
  board[2][6] = 1;
  board[6][2] = 1;
  const records = updateGoHistory([], {
    matchId: "match-handicap",
    version: 2,
    state: gameState({
      board,
      moves: 1,
      current: 1,
      blackIndex: 1,
      settings: { ...gameState().settings, handicap: 2 },
      lastMove: { row: 5, column: 5 },
      lastEvent: { kind: "play", playerIndex: 2 },
    }),
    events: [{ type: "played", player: "white", row: 5, column: 5 }],
  });

  assert.deepEqual(records[0].initialBlack, [
    { row: 3, column: 7 },
    { row: 7, column: 3 },
  ]);
  assert.match(goRecordToSgf(records[0]), /HA\[2\].*AB\[gc\]\[cg\].*;W\[ee\]/);
});

test("Go history storage removes existing and newly saved empty records", () => {
  let storedValue = JSON.stringify({
    format: "playweft-go-history",
    formatVersion: 1,
    savedAt: 1,
    records: [
      {
        format: "playweft-go-record",
        formatVersion: 1,
        id: "empty",
        moves: [],
      },
      {
        format: "playweft-go-record",
        formatVersion: 1,
        id: "played",
        moves: [{ color: "B", row: 4, column: 4 }],
      },
    ],
  });
  const storage = {
    getItem() {
      return storedValue;
    },
    setItem(_key, value) {
      storedValue = value;
    },
  };
  const store = createGoHistoryStore(() => storage);

  assert.deepEqual(store.load().map((record) => record.id), ["played"]);
  store.save([
    {
      format: "playweft-go-record",
      formatVersion: 1,
      id: "another-empty",
      moves: [],
    },
    {
      format: "playweft-go-record",
      formatVersion: 1,
      id: "played",
      moves: [{ color: "B", row: 4, column: 4 }],
    },
  ]);
  const archive = JSON.parse(storedValue);
  assert.equal(archive.format, "playweft-go-history");
  assert.equal(archive.formatVersion, 1);
  assert.deepEqual(archive.records.map((record) => record.id), ["played"]);
});

test("Go history stores a versioned solo resume snapshot with clock state", () => {
  const savedAt = 10_000;
  let records = updateGoHistory([], {
    mode: "solo",
    matchId: "match-resume",
    version: 2,
    state: gameState({
      moves: 1,
      current: 2,
      timeUsed: [3500, 1000],
      turnStartedAt: 8000,
      previousBoard: "position-before-last-move",
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  }, savedAt);

  assert.equal(records[0].format, "playweft-go-record");
  assert.equal(records[0].formatVersion, 1);
  assert.equal(records[0].mode, "solo");
  assert.equal(records[0].resume.formatVersion, 1);
  assert.equal(records[0].resume.savedAt, savedAt);
  assert.deepEqual(records[0].resume.state.timeUsed, [3500, 3000]);
  assert.equal(records[0].resume.state.turnStartedAt, 0);
  assert.equal(canResumeGoRecord(records[0]), true);
  assert.equal(
    records[0].resume.state.previousBoard,
    "position-before-last-move",
  );

  records = updateGoResumeSnapshot(
    records,
    "match-resume",
    gameState({
      moves: 1,
      current: 2,
      timeUsed: [3500, 1000],
      turnStartedAt: 8000,
      previousBoard: "position-before-last-move",
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    13_000,
  );
  assert.deepEqual(records[0].resume.state.timeUsed, [3500, 6000]);
  const restored = restoreGoResumeState(records[0], 20_000);
  assert.deepEqual(restored.timeUsed, [3500, 6000]);
  assert.equal(restored.turnStartedAt, 20_000);

  records = updateGoHistory(records, {
    mode: "solo",
    matchId: "match-resume",
    version: 3,
    state: gameState({
      phase: "ended",
      ended: true,
      moves: 1,
      winnerIndex: 2,
      lastEvent: { kind: "resigned", playerIndex: 1 },
    }),
    events: [{ type: "resigned", player: "black", winner: "white" }],
  }, 14_000);
  assert.equal(records[0].resume, null);
  assert.equal(canResumeGoRecord(records[0]), false);
  assert.equal(restoreGoResumeState(records[0], 20_000), undefined);
});

test("Go history rebuilds every replay frame when resuming a solo game", () => {
  const moves = [
    { color: "B", row: 1, column: 2 },
    { color: "W", row: 2, column: 2 },
    { color: "B", row: 2, column: 1 },
    { color: "W", pass: true },
    { color: "B", row: 2, column: 3 },
    { color: "W", pass: true },
    { color: "B", row: 3, column: 2 },
  ];
  const frames = goRecordToReplayFrames({
    round: 1,
    createdAt: 1,
    settings: gameState().settings,
    moves,
    resume: { state: { blackIndex: 1 } },
  });

  assert.deepEqual(
    frames.map((frame) => frame.moveNumber),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.move),
    moves.map((move, index) => ({
      number: index + 1,
      color: move.color === "B" ? 1 : 2,
      pass: Boolean(move.pass),
      row: Number(move.row) || 0,
      column: Number(move.column) || 0,
    })),
  );
  assert.equal(frames[2].board[1][1], 2);
  assert.equal(frames.at(-1).board[1][1], 0);
});

for (const tieBreak of ["draw", "white", "first-pass"]) {
  test(`Go history and SGF preserve a ${tieBreak} tied result`, () => {
    let records = updateGoHistory([], {
      matchId: "tied", version: 1,
      state: gameState({ moves: 1, current: 2, lastEvent: { kind: "pass", playerIndex: 1 } }),
      events: [{ type: "passed", player: "black" }],
    });
    records = updateGoHistory(records, {
      matchId: "tied", version: 2,
      state: gameState({
        moves: 2, current: 0, phase: "scoring",
        lastEvent: { kind: "scoring_started", playerIndex: 2 },
      }),
      events: [{ type: "scoring_started", player: "white" }],
    });
    assert.equal(records[0].moves.length, 2);
    const winnerIndex = tieBreak === "draw" ? 0 : tieBreak === "white" ? 2 : 1;
    records = updateGoHistory(records, {
      matchId: "tied", version: 3,
      state: gameState({
        settings: { ...gameState().settings, komi: 7, tieBreak },
        moves: 2, current: 0, phase: "ended", ended: true,
        firstPassIndex: 1, winnerIndex, scores: { black: 8, white: 8 },
        lastEvent: { kind: "scored", playerIndex: 2 },
      }),
    });
    const record = records[0];
    const winner = winnerIndex === 1 ? "B" : winnerIndex === 2 ? "W" : "";
    assert.equal(record.result.winnerColor, winner);
    assert.equal(historyResultLabel(record), !winner ? "和棋" : `${winner === "B" ? "黑方" : "白方"}胜（平分判定）`);
    const sgf = goRecordToSgf(record);
    assert.ok(sgf.includes(`RE[${winner ? winner + "+" : "0"}]`));
    assert.ok(sgf.includes("C[平分判定："));
    assert.ok(sgf.includes("KM[7]"));
  });
}

test("Go resume keeps tiebreak and first-pass history, including undo", () => {
  const settings = { ...gameState().settings, komi: 7, tieBreak: "first-pass" };
  const state = gameState({ settings, moves: 1, firstPassIndex: 1, current: 2,
    lastEvent: { kind: "pass", playerIndex: 1 },
    undoSnapshot: { moves: 0, firstPassIndex: 0 },
  });
  const records = updateGoHistory([], { mode: "solo", matchId: "resume-pass", version: 1,
    state, events: [{ type: "passed", player: "black" }],
  });
  const restored = restoreGoResumeState(records[0]);
  assert.equal(restored.settings.komi, 7);
  assert.equal(restored.settings.tieBreak, "first-pass");
  assert.equal(restored.firstPassIndex, 1);
  assert.equal(restored.undoSnapshot.firstPassIndex, 0);
  assert.equal(restored.current, 2);
});

test("legacy Go saves keep their old komi and white-wins tiebreak", () => {
  const records = updateGoHistory([], { mode: "solo", matchId: "legacy", version: 1,
    state: gameState({ moves: 1, current: 2, blackIndex: 2,
      lastEvent: { kind: "pass", playerIndex: 1 }, undoSnapshot: { moves: 0 },
    }),
    events: [{ type: "passed", player: "black" }],
  });
  const original = structuredClone(records[0]);
  const restored = restoreGoResumeState(records[0]);
  assert.equal(restored.settings.komi, 6.5);
  assert.equal(restored.settings.tieBreak, "white");
  assert.equal(restored.firstPassIndex, 1);
  assert.equal(restored.undoSnapshot.firstPassIndex, 0);
  assert.deepEqual(records[0], original, "migration must not mutate the saved record");
});
