import assert from "node:assert/strict";
import test from "node:test";
import { resolveChessView } from "../games/chess/view.js";

test("Chess facing players retain opposing piece orientations across turns", () => {
  for (const current of [1, 2]) {
    assert.deepEqual(
      resolveChessView("head-to-head", { current, whiteIndex: 1 }),
      {
        flipped: false,
        bottomSide: "w",
        topSide: "b",
        upsideDownSide: "b",
      },
    );
  }
});

test("Chess follows the moving color with upright pieces, including after seats swap", () => {
  for (const whiteIndex of [1, 2]) {
    for (const current of [1, 2]) {
      const state = { current, whiteIndex };
      const snapshot = structuredClone(state);
      const view = resolveChessView("turn", state);
      assert.equal(view.flipped, current !== whiteIndex);
      assert.equal(view.bottomSide, current === whiteIndex ? "w" : "b");
      assert.equal(view.upsideDownSide, undefined);
      assert.deepEqual(state, snapshot);
    }
  }
});

test("Chess fixed white perspective ignores the turn", () => {
  for (const whiteIndex of [1, 2]) {
    for (const current of [1, 2]) {
      assert.deepEqual(resolveChessView("white", { current, whiteIndex }), {
        flipped: false,
        bottomSide: "w",
        topSide: "b",
        upsideDownSide: undefined,
      });
    }
  }
  assert.equal(resolveChessView("turn", undefined).flipped, false);
});
