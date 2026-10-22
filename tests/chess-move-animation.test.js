import assert from "node:assert/strict";
import test from "node:test";
import { createChessMoveAnimator } from "../games/chess/move-animation.js";

function fixture({ flipped = false, upsideDown = false, reduced = false } = {}) {
  const ownerDocument = {
    defaultView: { matchMedia: () => ({ matches: reduced }) },
  };
  const animations = [];
  const squares = Array.from({ length: 64 }, (_, index) => {
    const classes = new Set(upsideDown ? ["is-upside-down"] : []);
    const piece = {};
    const square = {
      ownerDocument,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      querySelector: (selector) => selector === ".piece" ? piece : null,
    };
    const position = flipped ? 63 - index : index;
    square.getBoundingClientRect = () => ({
      x: (position % 8) * 64,
      y: Math.floor(position / 8) * 64,
      width: 64,
      height: 64,
    });
    piece.animate = (keyframes, options) => {
      const animation = new EventTarget();
      animation.cancel = () => animation.dispatchEvent(new Event("cancel"));
      animations.push({ keyframes, options, animation, square });
      return animation;
    };
    return square;
  });
  const previous = {
    round: 1,
    moves: 0,
    board: Array.from({ length: 8 }, () => Array(8).fill("")),
  };
  function move(piece, fromRow, fromColumn, toRow, toColumn, extra = {}) {
    previous.board[fromRow - 1][fromColumn - 1] = piece;
    const next = structuredClone(previous);
    next.moves++;
    next.board[fromRow - 1][fromColumn - 1] = "";
    next.board[toRow - 1][toColumn - 1] = piece;
    next.lastMove = { fromRow, fromColumn, toRow, toColumn, ...extra };
    return next;
  }
  return { squares, animations, previous, move, animator: createChessMoveAnimator(squares) };
}

test("Chess moves slide from the source cell in either board orientation", () => {
  for (const flipped of [false, true]) {
    const { animator, previous, move, animations } = fixture({ flipped });
    animator.play(previous, move("wP", 7, 5, 5, 5));
    assert.equal(animations.length, 1);
    assert.equal(animations[0].keyframes[0].transform,
      `translate(0px, ${flipped ? -128 : 128}px) rotate(0deg)`);
    assert.equal(animations[0].options.duration, 200);
    assert.equal(animations[0].square.classList.contains("is-moving"), true);
    animations[0].animation.dispatchEvent(new Event("finish"));
    assert.equal(animations[0].square.classList.contains("is-moving"), false);
  }
});

test("Chess animates king and rook simultaneously for either castling wing", () => {
  for (const column of [3, 7]) {
    const { animator, previous, move, animations } = fixture();
    previous.board[7][column === 7 ? 7 : 0] = "wR";
    const next = move("wK", 8, 5, 8, column, { special: "castle" });
    next.board[7][column === 7 ? 7 : 0] = "";
    next.board[7][column === 7 ? 5 : 3] = "wR";
    animator.play(previous, next);
    assert.equal(animations.length, 2);
    assert.equal(animations[0].keyframes[0].transform,
      `translate(${column === 7 ? -128 : 128}px, 0px) rotate(0deg)`);
    assert.equal(animations[1].keyframes[0].transform,
      `translate(${column === 7 ? 128 : -192}px, 0px) rotate(0deg)`);
  }
});

test("Chess captures, en passant and promotion animate only the moving piece", () => {
  for (const kind of ["capture", "en_passant", "promotion"]) {
    const { animator, previous, move, animations } = fixture();
    if (kind === "capture") previous.board[2][5] = "bN";
    if (kind === "en_passant") previous.board[3][5] = "bP";
    const fromRow = kind === "promotion" ? 2 : 4;
    const toRow = fromRow - 1;
    const next = move("wP", fromRow, 5, toRow, 6, { special: kind });
    if (kind === "en_passant") next.board[3][5] = "";
    if (kind === "promotion") next.board[0][5] = "wQ";
    const snapshot = structuredClone(next);
    animator.play(previous, next);
    assert.equal(animations.length, 1);
    assert.equal(animations[0].keyframes[0].transform, "translate(-64px, 64px) rotate(0deg)");
    assert.deepEqual(next, snapshot);
  }
});

test("Chess head-to-head animation preserves the black piece rotation", () => {
  const { animator, previous, move, animations } = fixture({ upsideDown: true });
  animator.play(previous, move("bP", 2, 4, 4, 4));
  assert.equal(animations[0].keyframes[0].transform, "translate(0px, -128px) rotate(180deg)");
  assert.equal(animations[0].keyframes[1].transform, "translate(0, 0) rotate(180deg)");
});

test("Chess does not animate initial sync, repeated updates, skipped moves or a new round", () => {
  const { animator, previous, move, animations } = fixture();
  const next = move("wP", 7, 5, 5, 5);
  animator.play(undefined, next);
  animator.play(next, structuredClone(next));
  animator.play(previous, { ...next, moves: 2 });
  animator.play(previous, { ...next, round: 2 });
  assert.equal(animations.length, 0);
});

test("Chess honors reduced motion and can cancel interrupted animations without stale styles", () => {
  const reduced = fixture({ reduced: true });
  reduced.animator.play(reduced.previous, reduced.move("wP", 7, 5, 5, 5));
  assert.equal(reduced.animations.length, 0);

  const { animator, previous, move, animations, squares } = fixture();
  const next = move("wP", 7, 5, 5, 5);
  animator.play(previous, next);
  animator.cancel();
  assert.equal(squares.some((square) => square.classList.contains("is-moving")), false);
  animator.play(previous, next);
  // A delayed callback from an interrupted animation cannot clear the next one.
  animations[0].animation.dispatchEvent(new Event("finish"));
  assert.equal(animations[1].square.classList.contains("is-moving"), true);
  animator.cancel();
  assert.equal(squares.some((square) => square.classList.contains("is-moving")), false);
});
