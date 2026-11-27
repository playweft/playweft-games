import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { createGoViewGesture } from "../games/go/view-gesture.js";
import { createGoStoneDrag } from "../games/go/stone-drag.js";
import { GO_VIEW_ANGLE } from "../games/go/scene-geometry.js";

function harness(initialAngle = GO_VIEW_ANGLE) {
  const browser = new Window(), document = browser.document;
  document.body.innerHTML = '<main><div class="board-space"><div id="source" data-color="1"></div><div id="board"><button id="point"></button></div></div><button id="actions">Menu</button></main><span id="stone" hidden></span>';
  const root = document.querySelector("main"), surface = root.querySelector(".board-space");
  const point = root.querySelector("#point"), source = root.querySelector("#source"), board = root.querySelector("#board");
  const stone = document.querySelector("#stone"), actions = root.querySelector("#actions");
  point.dataset.piece = "0";
  const reduced = new browser.EventTarget(), portrait = new browser.EventTarget();
  reduced.matches = false; portrait.matches = true;
  let angle = initialAngle, enabled = true, now = 0, sequence = 0, starts = 0, timer, drag;
  const frames = new Map(), changes = [], clicks = [], plays = [];
  const view = { innerHeight: 800, performance: { now: () => now },
    matchMedia: query => query.includes("reduced-motion") ? reduced : portrait,
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback) { timer = callback; return 1; }, clearTimeout() { timer = undefined; },
    addEventListener: browser.addEventListener.bind(browser), removeEventListener: browser.removeEventListener.bind(browser),
  };
  const gesture = createGoViewGesture({ root, surface, view,
    getEnabled: () => enabled, getAngle: () => angle,
    onStart() { starts++; drag?.cancel(); }, onChange(value) { angle = value; changes.push(value); },
  });
  point.addEventListener("click", event => clicks.push(event.detail));
  function pointer(type, id, x, y, target = point, pointerType = "touch") {
    target.dispatchEvent(new browser.PointerEvent(type, { bubbles: true, cancelable: true,
      pointerId: id, pointerType, isPrimary: id === 1, clientX: x, clientY: y }));
  }
  function begin(target = point) {
    pointer("pointerdown", 1, 100, 200, target); pointer("pointerdown", 2, 200, 200);
  }
  function slide(dy) {
    pointer("pointermove", 1, 100, 200 + dy); pointer("pointermove", 2, 200, 200 + dy);
  }
  function end() { pointer("pointerup", 1, 100, 300); pointer("pointerup", 2, 200, 300); }
  return { browser, document, gesture, point, source, actions, reduced, changes, clicks, plays,
    begin, slide, end, pointer,
    click(detail = 1, target = point) { target.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true, detail })); },
    tick(ms) { now += ms; const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback(now)); },
    get angle() { return angle; }, get starts() { return starts; }, get frameCount() { return frames.size; },
    setEnabled(value) { enabled = value; },
    enablePickup() {
      board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
      drag = createGoStoneDrag({ sources: [source], board, stone, view, getPoint: () => point,
        getIntersection: () => ({ row: 1, column: 1 }), onPickup() {}, onPlay: p => plays.push(p) });
      drag.update({ enabled: true, currentColor: 1, size: 19, key: "one" });
    },
    hold() { const callback = timer; timer = undefined; callback?.(); }, stone,
    async close() { gesture.dispose(); await browser.happyDOM.abort(); },
  };
}

test("two touch fingers drag continuously and snap to the nearer camera stop without idle frames", async () => {
  const h = harness();
  try {
    h.begin(); h.slide(70);
    assert.equal(h.starts, 1);
    assert.ok(h.angle > GO_VIEW_ANGLE / 2 && h.angle < GO_VIEW_ANGLE);
    const released = h.angle;
    h.end(); assert.equal(h.angle, released, "releasing must not jump to the endpoint");
    h.tick(110); assert.ok(h.angle > released && h.angle < GO_VIEW_ANGLE);
    h.tick(110); assert.equal(h.angle, GO_VIEW_ANGLE); assert.equal(h.frameCount, 0);
    h.begin(); h.slide(100); h.end(); h.tick(220);
    assert.equal(h.angle, 0);
    h.begin(); h.slide(-100); h.end(); h.tick(220);
    assert.equal(h.angle, GO_VIEW_ANGLE, "upward drag returns to the angled view");
    h.begin(); h.slide(1000); assert.equal(h.angle, 0); h.end();
    assert.equal(h.frameCount, 0, "already at the stop needs no animation");
  } finally { await h.close(); }
});

test("gestures suppress both releases and compatibility clicks; a fresh tap and keyboard still work", async () => {
  const h = harness();
  try {
    h.begin(); h.slide(100);
    h.pointer("pointerup", 1, 100, 300); h.click();
    h.pointer("pointermove", 2, 220, 310); h.pointer("pointerup", 2, 220, 310); h.click();
    assert.deepEqual(h.clicks, []);
    h.click(0); assert.deepEqual(h.clicks, [0], "keyboard activation stays available");
    h.pointer("pointerdown", 1, 100, 200); h.pointer("pointerup", 1, 100, 200); h.click();
    assert.deepEqual(h.clicks, [0, 1], "no timeout delaying the next intentional tap");
  } finally { await h.close(); }
});

test("pinching, sideways drags, mouse input, controls and unavailable scenes never tilt", async () => {
  const h = harness();
  try {
    h.begin(); h.pointer("pointermove", 1, 100, 170); h.pointer("pointermove", 2, 200, 230); h.end();
    h.begin(); h.pointer("pointermove", 1, 130, 203); h.pointer("pointermove", 2, 230, 203); h.end();
    h.pointer("pointerdown", 1, 100, 200, h.point, "mouse");
    h.pointer("pointermove", 1, 100, 350, h.point, "mouse"); h.pointer("pointerup", 1, 100, 350, h.point, "mouse");
    h.pointer("pointerdown", 1, 100, 200, h.actions); h.pointer("pointerdown", 2, 200, 200, h.actions);
    h.setEnabled(false); h.begin(); h.slide(100); h.end();
    assert.deepEqual(h.changes, []);
    assert.equal(h.frameCount, 0);
  } finally { await h.close(); }
});

test("a new two-finger gesture interrupts settling at its current angle, and reduced motion snaps immediately", async () => {
  const h = harness();
  try {
    h.begin(); h.slide(100); h.end(); h.tick(50);
    const intermediate = h.angle;
    h.begin(); assert.equal(h.frameCount, 0); assert.equal(h.angle, intermediate);
    h.slide(-5); assert.ok(h.angle > intermediate);
    h.end(); h.reduced.matches = true; h.reduced.dispatchEvent(new h.browser.Event("change"));
    assert.equal(h.frameCount, 0);
    h.begin(); h.slide(-100); h.end();
    assert.equal(h.angle, GO_VIEW_ANGLE);
    h.begin(); h.slide(100); h.end(); assert.equal(h.angle, 0);
  } finally { await h.close(); }
});

test("lifting extra fingers or interrupting a snap without dragging still settles to an endpoint", async () => {
  const h = harness();
  try {
    h.begin(); h.slide(100);
    h.pointer("pointerdown", 3, 300, 200);
    h.pointer("pointerup", 3, 300, 200);
    h.end(); h.tick(220); assert.equal(h.angle, 0);
    h.begin(); h.slide(-100); h.end(); h.tick(50);
    const intermediate = h.angle;
    assert.ok(intermediate > 0 && intermediate < GO_VIEW_ANGLE);
    h.begin(); h.end(); h.tick(220);
    assert.equal(h.angle, GO_VIEW_ANGLE, "a second gesture cannot strand the camera between stops");
  } finally { await h.close(); }
});

test("resize, blur, cancellation and extra fingers do not leave stale gestures or late camera changes", async () => {
  const h = harness();
  try {
    for (const event of ["resize", "blur"]) {
      h.begin(); h.slide(100); h.browser.dispatchEvent(new h.browser.Event(event));
      const angle = h.angle; h.end(); h.tick(300); assert.equal(h.angle, angle);
    }
    h.begin(); h.pointer("pointerdown", 3, 300, 200); h.slide(100);
    const angle = h.angle;
    h.pointer("pointercancel", 3, 300, 200); h.end(); h.tick(300);
    assert.equal(h.angle, angle);
    h.begin(); h.slide(-50); h.end(); h.gesture.dispose();
    const disposed = h.angle; h.tick(300); assert.equal(h.angle, disposed);
  } finally { await h.close(); }
});

test("adding a second finger cancels a held bowl stone instead of dropping it", async () => {
  const h = harness();
  try {
    h.enablePickup(); h.pointer("pointerdown", 1, 100, 200, h.source); h.hold();
    assert.equal(h.stone.hidden, false);
    h.pointer("pointerdown", 2, 200, 200);
    assert.equal(h.stone.hidden, true);
    h.slide(100); h.end(); h.tick(220);
    assert.deepEqual(h.plays, []);
  } finally { await h.close(); }
});
