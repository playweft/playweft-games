import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";
import { createSoloConnectFourState, applySoloConnectFourAction } from "../games/connect-four/solo.js";

function drop(state, column) {
  const result = applySoloConnectFourAction(state, { type: "drop", column }, { actorIndex: state.current });
  assert.equal(result.accepted, true, result.error?.code);
  return result.state;
}

test("Solo Connect Four validates turns and columns without mutating rejected state", () => {
  let state = createSoloConnectFourState();
  for (const column of [0, 8, 1.5, "4", null]) {
    const before = structuredClone(state);
    const result = applySoloConnectFourAction(state, { type: "drop", column });
    assert.equal(result.error.code, "INVALID_COLUMN");
    assert.deepEqual(state, before);
  }
  state = drop(state, 4);
  const before = structuredClone(state);
  assert.equal(applySoloConnectFourAction(state, { type: "drop", column: 4 }).error.code, "NOT_YOUR_TURN");
  assert.deepEqual(state, before);
  assert.equal(applySoloConnectFourAction(state, { type: "rematch" }).error.code, "GAME_NOT_OVER");
  state = createSoloConnectFourState();
  for (let n = 0; n < 6; n += 1) state = drop(state, 1);
  assert.equal(applySoloConnectFourAction(state, { type: "drop", column: 1 }).error.code, "COLUMN_FULL");
});

test("Solo Connect Four records wins and rotates the starter on rematches", () => {
  let state = createSoloConnectFourState();
  for (const column of [1, 2, 1, 2, 1, 2, 1]) state = drop(state, column);
  assert.equal(state.winnerIndex, 1);
  assert.deepEqual(state.winningCells, [3, 4, 5, 6].map(row => ({ row, column: 1 })));
  assert.equal(applySoloConnectFourAction(state, { type: "drop", column: 3 }).error.code, "GAME_OVER");
  const rematch = applySoloConnectFourAction(state, { type: "rematch" }).state;
  assert.equal(rematch.current, 2);
  assert.equal(rematch.starter, 2);
  assert.equal(rematch.round, 2);
  assert.equal(rematch.moves, 0);
  assert.ok(rematch.board.flat().every(cell => cell === 0));
});

test("Solo Connect Four draws on a full board and rejects further drops", () => {
  const sequence = [2,3,4,6,4,5,4,4,7,3,1,4,7,4,3,2,1,5,1,5,3,2,5,2,5,3,7,3,2,1,5,7,1,7,2,7,6,6,6,6,6,1];
  let state = createSoloConnectFourState();
  for (const column of sequence) state = drop(state, column);
  assert.equal(state.draw, true);
  assert.equal(state.winner, "");
  assert.equal(state.moves, 42);
  assert.equal(applySoloConnectFourAction(state, { type: "drop", column: 1 }).error.code, "GAME_OVER");
  assert.equal(applySoloConnectFourAction(state, { type: "rematch" }).state.current, 2);
});

test("Solo Connect Four matches room Lua through seeded games and rematches", async () => {
  const lua = await new LuaFactory().createEngine({ enableProxy: false });
  try {
    await lua.doString(await readFile("games/connect-four/game.lua", "utf8"));
    const setup = lua.global.get("setup");
    const action = lua.global.get("on_action");
    let random = 123456;
    const nextRandom = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
    let local = createSoloConnectFourState();
    const normalize = state => ({ ...state, winningCells: Array.isArray(state.winningCells) ? state.winningCells : [] });
    let room = normalize(setup({ players: local.players.map(id => ({ id })) }));
    for (let game = 0; game < 100; game += 1) {
      assert.deepEqual(local, room);
      while (!local.winner && !local.draw) {
        const legal = local.board[0].map((cell, column) => cell === 0 ? column + 1 : 0).filter(Boolean);
        const column = legal[nextRandom() % legal.length];
        const result = action(structuredClone(room), { type: "drop", column }, { actor: { id: room.players[room.current - 1] } });
        assert.equal(result.accepted, true);
        local = drop(local, column);
        room = normalize(result.state);
        assert.deepEqual(local, room);
      }
      local = applySoloConnectFourAction(local, { type: "rematch" }).state;
      room = normalize(action(room, { type: "rematch" }, { actor: { id: room.players[0] } }).state);
    }
  } finally {
    lua.global.close();
  }
});
