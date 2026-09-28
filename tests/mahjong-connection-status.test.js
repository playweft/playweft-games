import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMahjongConnectionStatus,
  formatMahjongLatency,
  mahjongConnectionLevel,
} from "../games/mahjong/app/connection-status.js";

function fakeElement() {
  const classes = new Set();
  return {
    hidden: false,
    textContent: "",
    attributes: new Map(),
    classes,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    toggleAttribute(name, force) {
      const active = force ?? !this.attributes.has(name);
      if (active) this.attributes.set(name, "");
      else this.attributes.delete(name);
      return active;
    },
  };
}

function createHarness() {
  const element = fakeElement();
  const latencyElement = fakeElement();
  // The document owns the icons: `createIcons` can replace them at any time, so
  // the controller must ask for the current element instead of caching one.
  const icons = {
    strong: fakeElement(),
    medium: fakeElement(),
    weak: fakeElement(),
  };
  const status = createMahjongConnectionStatus({
    element,
    latencyElement,
    resolveIcon: (level) => icons[level],
  });
  const visibleIcons = () =>
    Object.entries(icons)
      .filter(([, icon]) => !icon.attributes.has("hidden"))
      .map(([level]) => level);
  return { status, element, latencyElement, icons, visibleIcons };
}

test("mahjong latency buckets cover the boundary between signal levels", () => {
  assert.equal(mahjongConnectionLevel(0), "strong");
  assert.equal(mahjongConnectionLevel(100), "strong");
  assert.equal(mahjongConnectionLevel(101), "medium");
  assert.equal(mahjongConnectionLevel(220), "medium");
  assert.equal(mahjongConnectionLevel(221), "weak");
  assert.equal(mahjongConnectionLevel(4000), "weak");
  for (const invalid of [-1, NaN, Infinity, "", "slow", null, undefined]) {
    assert.equal(mahjongConnectionLevel(invalid), "");
  }
});

test("mahjong latency text rounds to whole milliseconds", () => {
  assert.equal(formatMahjongLatency(86.4), "86ms");
  assert.equal(formatMahjongLatency(0), "0ms");
  assert.equal(formatMahjongLatency("128"), "128ms");
  assert.equal(formatMahjongLatency(NaN), "");
});

test("mahjong connection status only shows while a room reports latency", () => {
  const { status, element, latencyElement, visibleIcons } = createHarness();

  assert.equal(element.hidden, true, "hidden before the first sample");

  status.setLatency(72);
  assert.equal(element.hidden, true, "solo play must not show the indicator");

  status.setRoomActive(true);
  assert.equal(element.hidden, false);
  assert.equal(latencyElement.textContent, "72ms");
  assert.deepEqual(visibleIcons(), ["strong"]);
  assert.equal(element.classes.has("is-strong"), true);
  assert.equal(element.attributes.get("aria-label"), "网络延时 72 毫秒，信号强");

  status.setLatency(180);
  assert.equal(latencyElement.textContent, "180ms");
  assert.deepEqual(visibleIcons(), ["medium"]);
  assert.equal(element.classes.has("is-strong"), false);
  assert.equal(element.classes.has("is-medium"), true);

  status.setLatency(320);
  assert.equal(latencyElement.textContent, "320ms");
  assert.deepEqual(visibleIcons(), ["weak"]);
  assert.equal(element.classes.has("is-medium"), false);
  assert.equal(element.classes.has("is-weak"), true);
  assert.equal(element.attributes.get("aria-label"), "网络延时 320 毫秒，信号弱");

  status.setLatency("nonsense");
  assert.equal(latencyElement.textContent, "320ms", "an invalid sample keeps the last one");

  status.setRoomActive(false);
  assert.equal(element.hidden, true);
  status.setRoomActive(true);
  assert.equal(latencyElement.textContent, "320ms", "a reconnect keeps the last sample");
  assert.equal(element.classes.has("is-weak"), true);
});

test("mahjong connection status follows icons replaced after the first render", () => {
  const { status, icons, visibleIcons } = createHarness();
  status.setRoomActive(true);
  status.setLatency(120);
  assert.deepEqual(visibleIcons(), ["medium"]);

  // An unscoped createIcons() call swaps every icon element in the document.
  icons.strong = fakeElement();
  icons.medium = fakeElement();
  icons.weak = fakeElement();

  status.setLatency(60);
  assert.deepEqual(
    visibleIcons(),
    ["strong"],
    "the replaced elements must receive the level, not the detached originals",
  );
  assert.equal(icons.strong.attributes.has("hidden"), false);
  assert.equal(icons.medium.attributes.has("hidden"), true);
  assert.equal(icons.weak.attributes.has("hidden"), true);
});
