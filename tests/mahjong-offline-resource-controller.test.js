import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongOfflineResourceController } from "../games/mahjong/app/offline-resource-controller.js";

function fakeButton() {
  const classes = new Set();
  return {
    classes,
    classList: {
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
}

test("mahjong offline resource button scopes lucide rendering to itself", () => {
  const button = fakeButton();
  const calls = [];
  createMahjongOfflineResourceController({
    button,
    createIconsImpl: (options) => calls.push(options),
  });

  assert.match(button.innerHTML, /离线资源包/);
  assert.match(button.innerHTML, /data-lucide="download"/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].root, button);
  assert.deepEqual(Object.keys(calls[0].icons), ["Download", "LoaderCircle", "Trash2"]);
});
