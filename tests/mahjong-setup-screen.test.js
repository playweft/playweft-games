import assert from "node:assert/strict";
import test from "node:test";
import { createMahjongSetupScreenController } from "../games/mahjong/app/setup-screen-controller.js";

function fixture(initialSave = null) {
  let save = initialSave;
  const menu = new EventTarget();
  const buttons = ["east", "hanchan"].map((matchType) => ({
    disabled: true, dataset: { matchType },
  }));
  const classes = new Set();
  const classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
  };
  const setup = {
    hidden: true, inert: true, classList,
    querySelector: (selector) => selector === ".setup-menu" ? menu : null,
    querySelectorAll: () => buttons,
  };
  let fallback;
  const loading = { hidden: false, classList };
  const controller = createMahjongSetupScreenController({
    elements: { setup, loading },
    window: { setTimeout(callback) { fallback = callback; return 1; }, clearTimeout() {} },
    closePaipuPanel() {}, transientNotice: { show() {} },
    getSoloSave: () => save,
  });
  return { controller, setup, loading, buttons, menu, fallback: () => fallback(),
    clearSave: () => { save = null; },
  };
}

test("Mahjong lobby restores controls for solo and room entry", () => {
  const f = fixture();
  f.controller.show();
  assert.equal(f.setup.inert, false);
  assert.equal(f.setup.hidden, false);
  assert.ok(f.buttons.every((button) => !button.disabled));
  f.controller.showRoom();
  assert.equal(f.loading.hidden, true);
});

test("Mahjong waits for menu fade-out and blocks keyboard input while entering a match", async () => {
  const f = fixture();
  f.controller.show();
  let finished = false;
  const exit = f.controller.beginExit().then(() => { finished = true; });
  assert.equal(f.setup.inert, true);
  assert.ok(f.buttons.every((button) => button.disabled));
  const transform = new Event("transitionend");
  Object.defineProperty(transform, "propertyName", { value: "transform" });
  f.menu.dispatchEvent(transform);
  await Promise.resolve();
  assert.equal(finished, false);
  const opacity = new Event("transitionend");
  Object.defineProperty(opacity, "propertyName", { value: "opacity" });
  f.menu.dispatchEvent(opacity);
  await exit;
  assert.equal(finished, true);
});

test("Mahjong's lobby exit also completes when reduced motion omits transition events", async () => {
  const f = fixture();
  const exit = f.controller.beginExit();
  f.fallback();
  await exit;
  f.controller.show();
  assert.equal(f.setup.inert, false);
});

for (const matchType of ["east", "hanchan"]) {
  test(`Mahjong lobby keeps ${matchType} save pending and disables the other match type`, async () => {
    const f = fixture({ matchType });
    f.controller.show();
    assert.equal(f.setup.hidden, false);
    assert.deepEqual(f.buttons.map((button) => button.disabled),
      ["east", "hanchan"].map((type) => type !== matchType));
    const exit = f.controller.beginExit();
    f.fallback();
    await exit;
    // Returning after a failed restore must preserve the restriction.
    f.controller.show();
    assert.equal(f.buttons.filter((button) => !button.disabled).length, 1);
    f.controller.showRoom();
    assert.ok(f.buttons.every((button) => !button.disabled));
    f.controller.show();
    assert.equal(f.buttons.filter((button) => !button.disabled).length, 1);
    f.clearSave();
    f.controller.show();
    assert.ok(f.buttons.every((button) => !button.disabled));
  });
}
