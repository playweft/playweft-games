import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";
import {
  applySoloGomokuAction,
  createSoloGomokuState,
  forbiddenReason,
} from "../games/gomoku/solo.js";

const screenshot = {
  name: "reported four-three position",
  target: [10, 8],
  black: [
    [4, 11], [5, 9], [6, 8], [7, 6], [7, 10], [8, 8], [9, 6],
    [9, 7], [9, 8], [10, 7], [10, 9], [11, 3], [11, 8],
  ],
  white: [
    [5, 10], [6, 9], [7, 7], [7, 8], [7, 9], [7, 11], [8, 5],
    [8, 6], [8, 7], [8, 9], [9, 5], [9, 9], [10, 4],
  ],
};

// Check the reported position under every rotation and reflection.
const cases = [];
for (const reflected of [false, true]) {
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const transform = ([row, column]) => {
      if (reflected) column = 16 - column;
      for (let n = 0; n < rotation; n += 1) {
        [row, column] = [column, 16 - row];
      }
      return [row, column];
    };
    cases.push({
      name: `${screenshot.name}, rotation ${rotation}, reflected ${reflected}`,
      target: transform(screenshot.target),
      black: screenshot.black.map(transform),
      white: screenshot.white.map(transform),
    });
  }
}
cases.push(
  {
    name: "open four plus open three",
    target: [8, 8],
    black: [[8, 5], [8, 6], [8, 7], [7, 8], [9, 8]],
  },
  {
    name: "closed four plus open three",
    target: [8, 8],
    black: [[8, 5], [8, 6], [8, 7], [7, 8], [9, 8]],
    white: [[8, 4]],
  },
  {
    name: "diagonal four plus diagonal open three",
    target: [8, 8],
    black: [[5, 5], [6, 6], [7, 7], [7, 9], [9, 7]],
  },
  {
    name: "broken four plus open three",
    target: [8, 8],
    black: [[8, 5], [8, 6], [8, 9], [7, 8], [9, 8]],
  },
  {
    name: "edge-blocked three plus open three",
    target: [2, 8],
    black: [[1, 8], [3, 8], [2, 7], [2, 9]],
  },
  {
    name: "genuine straight double-three",
    target: [8, 8],
    black: [[8, 7], [8, 9], [7, 8], [9, 8]],
    reason: "FORBIDDEN_DOUBLE_THREE",
  },
  {
    name: "genuine broken double-three",
    target: [8, 8],
    black: [[8, 6], [8, 9], [7, 8], [9, 8]],
    reason: "FORBIDDEN_DOUBLE_THREE",
  },
  {
    name: "genuine double-four",
    target: [8, 8],
    black: [[8, 5], [8, 6], [8, 7], [5, 8], [6, 8], [7, 8]],
    reason: "FORBIDDEN_DOUBLE_FOUR",
  },
);

test("Solo and AI forbidden checks distinguish four-three from double-three", () => {
  for (const fixture of cases) {
    const state = applySoloGomokuAction(createSoloGomokuState(), {
      type: "start", blackMode: "player1", forbiddenMoves: true,
    }, { now: 0 }).state;
    for (const [piece, cells] of [[1, fixture.black], [2, fixture.white ?? []]]) {
      for (const [row, column] of cells) state.board[row - 1][column - 1] = piece;
    }
    state.moves = state.board.flat().filter(Boolean).length;
    const before = structuredClone(state);
    const [row, column] = fixture.target;
    const simulated = structuredClone(state.board);
    simulated[row - 1][column - 1] = 1;
    const placed = structuredClone(simulated);
    assert.equal(forbiddenReason(simulated, row, column), fixture.reason, fixture.name);
    assert.deepEqual(simulated, placed, `${fixture.name}: simulations restore board`);

    const result = applySoloGomokuAction(state, { type: "play", row, column });
    assert.equal(result.accepted, !fixture.reason, fixture.name);
    assert.deepEqual(state, before, `${fixture.name}: original state unchanged`);
    if (fixture.reason) {
      assert.equal(result.error.code, fixture.reason, fixture.name);
    } else {
      assert.deepEqual(result.state.board, placed, fixture.name);
      assert.equal(result.state.current, 2, fixture.name);
      assert.equal(result.state.ended, false, fixture.name);
    }
  }
});

test("Room Lua rules use the same four-three and genuine forbidden classifications", async () => {
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(await readFile("games/gomoku/game.lua", "utf8"));
    for (const fixture of cases) {
      const placements = [
        ...fixture.black.map(([r, c]) => `state.board[${r}][${c}] = 1`),
        ...(fixture.white ?? []).map(([r, c]) => `state.board[${r}][${c}] = 2`),
      ].join("\n");
      const [row, column] = fixture.target;
      await lua.doString(`
        local context = {
          actor = { id = "black", role = "player", isOwner = true }, actionAt = 0,
        }
        state = setup({
          players = { { id = "black", seat = 1 }, { id = "white", seat = 2 } },
          match = { ownerId = "black", randomSeed = "00000000000000000000000000000001" },
        })
        state = on_action(state, {
          type = "start", blackMode = "player1", forbiddenMoves = true,
        }, context).state
        ${placements}
        state.moves = ${fixture.black.length + (fixture.white?.length ?? 0)}
        local before = {}
        for r = 1, 15 do
          before[r] = {}
          for c = 1, 15 do before[r][c] = state.board[r][c] end
        end
        local played = on_action(state, { type = "play", row = ${row}, column = ${column} }, context)
        local restored = true
        for r = 1, 15 do
          for c = 1, 15 do
            local expected = before[r][c]
            if played.accepted and r == ${row} and c == ${column} then expected = 1 end
            if state.board[r][c] ~= expected then restored = false end
          end
        end
        result = {
          accepted = played.accepted,
          code = played.error and played.error.code or "",
          restored = restored,
        }
      `);
      assert.deepEqual(lua.global.get("result"), {
        accepted: !fixture.reason, code: fixture.reason ?? "", restored: true,
      }, fixture.name);
    }
  } finally {
    lua.global.close();
  }
});
