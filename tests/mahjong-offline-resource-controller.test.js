import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongOfflineResourceController } from "../games/mahjong/app/offline-resource-controller.js";

function fakeButton() {
  const classes = new Set();
  return {
    innerHTML: "",
    classes,
    classList: {
      toggle: (name, active) => (active ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
}

test("mahjong offline resource button replaces only the icon it renders", () => {
  const button = fakeButton();
  const roots = [];
  createMahjongOfflineResourceController({
    button,
    icons: { Download: [] },
    createIconsImpl: ({ root }) => roots.push(root),
  });

  assert.match(button.innerHTML, /data-lucide="download"/);
  assert.equal(roots.length, 1, "the first render draws the button icon once");
  assert.equal(
    roots[0],
    button,
    "scanning the whole document again would replace every other icon in it",
  );
});
