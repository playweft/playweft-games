import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LuaFactory } from "wasmoon";
import { createReversiState, applyReversiAction, flippedCells, legalMoves, countPieces } from "../games/reversi/rules.js";

const factory = new LuaFactory(fileURLToPath(new URL("../node_modules/wasmoon/dist/glue.wasm", import.meta.url)));
const source = await readFile(new URL("../games/reversi/game.lua", import.meta.url), "utf8");
const normalize = state => ({ ...state, legalMoves: Array.isArray(state.legalMoves) ? state.legalMoves : [], lastFlipped: Array.isArray(state.lastFlipped) ? state.lastFlipped : [] });
const play = (state, row, column) => {
  const result = applyReversiAction(state, { type: "play", row, column });
  assert.equal(result.accepted, true, result.error?.code);
  return result.state;
};
function fixture(board, blackIndex = 1) {
  const state = createReversiState({ blackIndex });
  state.board = board;
  state.counts = countPieces(board);
  state.legalMoves = legalMoves(board, 1);
  return state;
}
async function withLua(run) {
  const lua = await factory.createEngine({ enableProxy: false });
  try { await lua.doString(source); await run(lua); }
  finally { lua.global.close(); }
}

test("Reversi has the standard opening and flips D4 after D3", () => {
  const state = createReversiState();
  assert.deepEqual(state.counts, { black: 2, white: 2, empty: 60 });
  assert.deepEqual(state.legalMoves.map(({row,column}) => [row,column]), [[3,4],[4,3],[5,6],[6,5]]);
  const next = play(state, 3, 4);
  assert.deepEqual(next.counts, { black: 4, white: 1, empty: 59 });
  assert.equal(next.board[3][3], 1);
  assert.equal(next.current, 2);
  assert.deepEqual(next.lastFlipped, [{ row: 4, column: 4 }]);
  assert.deepEqual(state.counts, { black: 2, white: 2, empty: 60 });
});

test("Reversi flips all eight directions, without chaining through newly flipped discs", () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    for (let step = 1; step <= 3; step++) board[3 + dr * step][3 + dc * step] = step === 3 ? 1 : 2;
  }
  assert.equal(flippedCells(board, 4, 4, 1).length, 16);
  const next = play(fixture(board), 4, 4);
  assert.equal(next.counts.black, 25);
  assert.equal(next.counts.white, 0);
  const noChain = Array.from({ length: 8 }, () => Array(8).fill(0));
  noChain[3][4] = 2; noChain[3][5] = 1;
  noChain[2][4] = 2; noChain[1][4] = 1;
  assert.deepEqual(flippedCells(noChain, 4, 4, 1), [{ row: 4, column: 5 }]);
});

test("Reversi cannot capture across gaps, own discs, edges or occupied squares", () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  board[0] = [0,2,0,1,0,0,0,0];
  assert.deepEqual(flippedCells(board, 1, 1, 1), []);
  board[0] = [0,1,2,1,0,0,0,0];
  assert.deepEqual(flippedCells(board, 1, 1, 1), []);
  board[0] = [0,2,2,2,2,2,2,2];
  assert.deepEqual(flippedCells(board, 1, 1, 1), []);
  assert.deepEqual(flippedCells(board, 1, 2, 1), []);
});

test("Reversi rejects malformed actions, wrong turns, spectators and voluntary passes without mutation", () => {
  const state = createReversiState(), before = structuredClone(state);
  for (const action of [null, [], {type:"pass"}, {type:"unknown"}]) {
    assert.equal(applyReversiAction(state, action).error.code, "INVALID_ACTION");
  }
  for (const [row, column] of [[0,4],[9,4],[3,9],[3,0],[3.5,4],[3,"4"],[NaN,4]]) {
    assert.equal(applyReversiAction(state, {type:"play",row,column}).error.code, "INVALID_COORDINATE");
  }
  assert.equal(applyReversiAction(state, {type:"play",row:3,column:4}, {actorIndex:2}).error.code, "NOT_YOUR_TURN");
  assert.equal(applyReversiAction(state, {type:"play",row:3,column:4}, {actorIndex:0}).error.code, "NOT_A_PLAYER");
  assert.equal(applyReversiAction(state, {type:"play",row:1,column:1}).error.code, "ILLEGAL_MOVE");
  assert.equal(applyReversiAction(state, {type:"play",row:4,column:4}).error.code, "ILLEGAL_MOVE");
  assert.equal(applyReversiAction(state, {type:"rematch"}).error.code, "GAME_NOT_OVER");
  assert.deepEqual(state, before);
});

test("Reversi automatically passes a blocked opponent and then ends on a full board", async () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(1));
  board[0][0] = board[0][3] = 0;
  board[0][1] = board[0][4] = 2;
  const initial = fixture(board);
  const passed = play(initial, 1, 1);
  assert.equal(passed.current, 1);
  assert.equal(passed.passedIndex, 2);
  assert.deepEqual(passed.legalMoves, [{row:1,column:4,flips:1}]);
  assert.deepEqual(passed.counts, {black:62,white:1,empty:1});
  const ended = play(passed, 1, 4);
  assert.equal(ended.ended, true);
  assert.equal(ended.winnerIndex, 1);
  assert.equal(ended.endReason, "full_board");
  await withLua(async lua => {
    const action = lua.global.get("on_action");
    let room = normalize(action(structuredClone(initial), {type:"play",row:1,column:1}, {actor:{id:initial.players[0]}}).state);
    assert.deepEqual(room, passed);
    room = normalize(action(room, {type:"play",row:1,column:4}, {actor:{id:initial.players[0]}}).state);
    assert.deepEqual(room, ended);
  });
});

test("Reversi ends with empty squares when neither color can move", async () => {
  const board = Array.from({length:8}, () => Array(8).fill(0));
  board[0][1] = 2; board[0][2] = 1;
  const initial = fixture(board, 2);
  const ended = play(initial, 1, 1);
  assert.equal(ended.ended, true);
  assert.equal(ended.endReason, "no_moves");
  assert.equal(ended.winnerIndex, 2);
  assert.deepEqual(ended.counts, {black:3,white:0,empty:61});
  assert.equal(applyReversiAction(ended, {type:"play",row:2,column:2}, {actorIndex:1}).error.code, "GAME_OVER");
  await withLua(async lua => assert.deepEqual(normalize(lua.global.get("on_action")(
    initial, {type:"play",row:1,column:1}, {actor:{id:initial.players[1]}}).state), ended));
});

test("Reversi draws at equal counts and rematches swap colors while black still starts", async () => {
  const board = Array.from({length:8}, (_,r) => Array.from({length:8}, (_,c) => r * 8 + c >= 2 && r * 8 + c <= 31 ? 1 : 2));
  board[0][0] = 0;
  const initial = fixture(board);
  const ended = play(initial, 1, 1);
  assert.deepEqual(ended.counts, {black:32,white:32,empty:0});
  assert.equal(ended.draw, true);
  assert.equal(ended.winnerIndex, 0);
  const rematch = applyReversiAction(ended, {type:"rematch"}, {actorIndex:1}).state;
  assert.equal(rematch.blackIndex, 2);
  assert.equal(rematch.current, 2);
  assert.equal(rematch.round, 2);
  assert.deepEqual(rematch.counts, {black:2,white:2,empty:60});
  await withLua(async lua => {
    const action = lua.global.get("on_action");
    const room = normalize(action(initial, {type:"play",row:1,column:1}, {actor:{id:initial.players[0]}}).state);
    assert.deepEqual(room, ended);
    assert.deepEqual(normalize(action(room, {type:"rematch"}, {actor:{id:initial.players[1]}}).state), rematch);
  });
});

test("Reversi local and room rules agree over complete seeded games within the Lua instruction budget", async () => {
  await withLua(async lua => {
    await lua.doString(`peak=0
      function checked_action(s,a,c)
        local n=0
        debug.sethook(function() n=n+100 end,"",100)
        local result=on_action(s,a,c)
        debug.sethook()
        peak=math.max(peak,n)
        return result
      end`);
    const action = lua.global.get("checked_action");
    let random = 76193, passes = 0;
    const nextRandom = () => random = (Math.imul(random,1664525)+1013904223) >>> 0;
    let local = createReversiState();
    let room = normalize(lua.global.get("setup")({players:local.players.map(id=>({id}))}));
    for (let game=0;game<40;game++) {
      assert.deepEqual(room, local);
      while (!local.ended) {
        const move = local.legalMoves[nextRandom() % local.legalMoves.length];
        const result = action(structuredClone(room), {type:"play",row:move.row,column:move.column}, {actor:{id:room.players[room.current-1]}});
        assert.equal(result.accepted,true);
        local = play(local, move.row, move.column);
        room = normalize(result.state);
        assert.deepEqual(room, local);
        assert.equal(local.counts.black+local.counts.white,local.moves+4);
        if (local.passedIndex) passes++;
      }
      assert.equal(local.legalMoves.length,0);
      assert.equal(legalMoves(local.board,1).length,0);
      assert.equal(legalMoves(local.board,2).length,0);
      local = applyReversiAction(local,{type:"rematch"},{actorIndex:1}).state;
      room = normalize(action(room,{type:"rematch"},{actor:{id:room.players[0]}}).state);
    }
    assert.ok(passes > 0);
    assert.ok(lua.global.get("peak") < 50_000, `peak ${lua.global.get("peak")} instructions`);
  });
});

test("Reversi room rejects unauthorized actions and awards a win when a player leaves", async () => {
  await withLua(async lua => {
    const initial = createReversiState();
    const action = lua.global.get("on_action");
    for (const [move,id,code] of [
      [{type:"play",row:3,column:4},"spectator","NOT_A_PLAYER"],
      [{type:"play",row:3,column:4},initial.players[1],"NOT_YOUR_TURN"],
      [{type:"play",row:"3",column:4},initial.players[0],"INVALID_COORDINATE"],
      [{type:"play",row:1,column:1},initial.players[0],"ILLEGAL_MOVE"],
      [{type:"pass"},initial.players[0],"INVALID_ACTION"],
    ]) assert.equal(action(structuredClone(initial),move,{actor:{id}}).error.code,code);
    const leave = lua.global.get("on_player_left");
    assert.deepEqual(normalize(leave(structuredClone(initial),{actor:{id:"spectator"}}).state),initial);
    const ended = normalize(leave(structuredClone(initial),{actor:{id:initial.players[0]}}).state);
    assert.equal(ended.ended,true);
    assert.equal(ended.winnerIndex,2);
    assert.equal(ended.endReason,"player_left");
    assert.equal(ended.legalMoves.length,0);
    assert.deepEqual(normalize(leave(structuredClone(ended),{actor:{id:initial.players[1]}}).state),ended);
  });
});
