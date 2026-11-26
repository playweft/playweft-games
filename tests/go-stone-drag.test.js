import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { createGoStoneDrag, projectStoneDrag, stoneDragPoint } from "../games/go/stone-drag.js";

function harness() {
  const browser = new Window();
  const document = browser.document;
  document.body.innerHTML = '<div id="source" data-color="1"></div><div id="white" data-color="2"></div><div id="board"></div><span id="stone" hidden></span>';
  const source = document.querySelector("#source"), whiteSource = document.querySelector("#white"), board = document.querySelector("#board"), stone = document.querySelector("#stone");
  const media = new browser.EventTarget();
  media.matches = true;
  let timer, sequence = 0, pickups = 0;
  const frames = new Map(), points = new Map(), plays = [];
  board.getBoundingClientRect = () => ({ left: 10, top: 100, width: 360, height: 360 });
  function getPoint(row, column) {
    const key = `${row}:${column}`;
    if (!points.has(key)) {
      const point = document.createElement("button");
      point.dataset.piece = "0";
      board.append(point);
      points.set(key, point);
    }
    return points.get(key);
  }
  const view = {
    matchMedia: () => media,
    setTimeout(callback) { timer = callback; return 1; },
    clearTimeout() { timer = undefined; },
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener: browser.addEventListener.bind(browser),
  };
  const drag = createGoStoneDrag({ sources: [source, whiteSource], board, stone, view, getPoint,
    onPickup: () => pickups++, onPlay: point => plays.push(point) });
  const context = { enabled: true, currentColor: 1, size: 19, key: "round1:0:black" };
  drag.update(context);
  function pointer(type, x = 300, y = 500, id = 1, target = source) {
    target.dispatchEvent(new browser.PointerEvent(type, {
      pointerId: id, pointerType: "touch", isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
  }
  return { browser, document, source, whiteSource, stone, drag, plays, context, media, points, getPoint,
    pointer, get pickups() { return pickups; },
    hold() { const callback = timer; timer = undefined; callback?.(); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    close() { return browser.happyDOM.abort(); },
  };
}

test("Go stone drag lifts above the finger and amplifies motion consistently across board sizes", () => {
  const anchor = { x: 300, y: 500 };
  assert.deepEqual(projectStoneDrag(anchor, anchor), { x: 300, y: 436 });
  assert.deepEqual(projectStoneDrag(anchor, { x: 210, y: 400 }), { x: 120, y: 236 });
  const rect = { left: 10, top: 100, width: 360, height: 360 };
  for (const size of [9, 13, 19]) {
    for (const row of [1, size]) for (const column of [1, size]) {
      assert.deepEqual(stoneDragPoint({ x: 10 + (column - .5) * 360 / size, y: 100 + (row - .5) * 360 / size }, rect, size), { row, column });
    }
    assert.equal(stoneDragPoint({ x: 371, y: 400 }, rect, size), undefined);
  }
});

test("quick taps never pick up or place; holding shows a stone and release places exactly once", async () => {
  const h = harness();
  try {
    h.pointer("pointerdown"); h.pointer("pointerup"); h.hold();
    assert.equal(h.pickups, 0);
    assert.equal(h.stone.hidden, true);
    h.pointer("pointerdown"); h.hold();
    assert.equal(h.pickups, 1);
    assert.equal(h.stone.hidden, false);
    assert.equal(h.stone.classList.contains("go-stone--black"),true);
    h.pointer("pointermove", 210, 400);
    // Release must use its final position even when the next frame has not run.
    h.pointer("pointerup", 210, 400);
    h.pointer("pointerup", 210, 400);
    h.frame();
    assert.deepEqual(h.plays, [{ row: 8, column: 6 }]);
    assert.equal(h.stone.hidden, true);
    assert.equal([...h.points.values()].some(point => point.classList.contains("is-drag-target")), false);
  } finally { await h.close(); }
});

test("occupied intersections and releasing outside the board cancel without placing", async () => {
  const h = harness();
  try {
    h.getPoint(8, 6).dataset.piece = "1";
    h.pointer("pointerdown"); h.hold(); h.pointer("pointermove", 210, 400); h.frame();
    assert.equal(h.stone.dataset.valid, "false");
    h.pointer("pointerup", 210, 400);
    h.pointer("pointerdown"); h.hold(); h.pointer("pointerup", 500, 650);
    assert.deepEqual(h.plays, []);
  } finally { await h.close(); }
});

test("turn changes and rotation cancel a drag; same-turn renders keep it; white uses white stones", async () => {
  const h = harness();
  try {
    h.pointer("pointerdown"); h.hold(); h.drag.update({ ...h.context });
    assert.equal(h.stone.hidden, false);
    h.drag.update({ ...h.context, key: "round1:1:white", currentColor: 2 });
    h.pointer("pointerup", 210, 400);
    assert.deepEqual(h.plays, []);
    h.pointer("pointerdown", 300, 500, 1, h.whiteSource); h.hold();
    assert.equal(h.stone.classList.contains("go-stone--white"), true);
    h.media.matches = false;
    h.media.dispatchEvent(new h.browser.Event("change"));
    h.pointer("pointerup", 210, 400);
    assert.equal(h.stone.hidden, true);
    assert.deepEqual(h.plays, []);
  } finally { await h.close(); }
});

test("system cancellation, a second finger, scrolling and disabled play never drop a stone", async () => {
  const h = harness();
  try {
    for (const interrupt of [
      () => h.pointer("pointercancel"),
      () => h.pointer("pointerdown", 200, 300, 2, h.document.body),
      () => h.browser.dispatchEvent(new h.browser.Event("scroll")),
      () => h.drag.update({ ...h.context, enabled: false }),
    ]) {
      h.drag.update(h.context);
      h.pointer("pointerdown"); h.hold(); interrupt(); h.pointer("pointerup", 210, 400);
      assert.equal(h.stone.hidden, true);
    }
    h.pointer("pointerdown"); h.hold(); h.pointer("pointerup", 210, 400);
    assert.deepEqual(h.plays, []);
  } finally { await h.close(); }
});

test("both fixed-color bowls support pickup, but only the permitted current color can start", async () => {
  const h=harness();
  try {
    h.pointer("pointerdown",300,500,1,h.whiteSource); h.hold();
    assert.equal(h.pickups,0);
    assert.ok(h.source.classList.contains("can-pick-up"));
    assert.equal(h.whiteSource.classList.contains("can-pick-up"),false);
    h.drag.update({...h.context,currentColor:2,key:"round1:1:white"});
    h.pointer("pointerdown"); h.hold();
    assert.equal(h.pickups,0);
    h.pointer("pointerdown",300,500,1,h.whiteSource); h.hold();
    assert.equal(h.pickups,1);
    h.pointer("pointerup",210,400);
    assert.deepEqual(h.plays,[{row:8,column:6}]);
    assert.equal(h.source.dataset.color,"1");
    assert.equal(h.whiteSource.dataset.color,"2");
    h.drag.update({...h.context,enabled:false});
    h.pointer("pointerdown"); h.hold();
    h.pointer("pointerdown",300,500,1,h.whiteSource); h.hold();
    assert.equal(h.pickups,1);
    assert.equal(h.document.querySelector(".can-pick-up"),null);
  } finally { await h.close(); }
});
