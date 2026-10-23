import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { IDBFactory, IDBDatabase } from "fake-indexeddb";
import { getGameStorage } from "../src/game-storage-cache.js";
import { SUDOKU_PROGRESS_KEY as key } from "../games/sudoku/storage.js";

// Run the actual browser entry in a DOM; CSS is verified by the production build.
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".css"))
      return { format: "module", source: "", shortCircuit: true };
    return next(url, context);
  },
});
let browser;
let sequence = 0;
const originalTransaction = IDBDatabase.prototype.transaction;
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Expected UI state was not reached");
}
async function mount(factory, old) {
  browser = new Window({ url: "https://game.example/sudoku/" });
  globalThis.window = browser;
  globalThis.document = browser.document;
  globalThis.localStorage = browser.localStorage;
  globalThis.indexedDB = factory;
  globalThis.Element = browser.Element;
  globalThis.SVGElement = browser.SVGElement;
  const html = await readFile(
    new URL("../games/sudoku/index.html", import.meta.url),
    "utf8",
  );
  browser.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ""));
  if (old !== undefined) browser.localStorage.setItem(key, old);
  await import(`../games/sudoku/main.js?storage-test=${++sequence}`);
}
async function unmount() {
  await browser?.happyDOM.abort();
  browser = undefined;
}
afterEach(async () => {
  IDBDatabase.prototype.transaction = originalTransaction;
  await unmount();
});
function profile() {
  const solution = Array.from({ length: 9 }, (_, r) =>
    Array.from(
      { length: 9 },
      (_, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1,
    ),
  );
  const initial = solution.map((row) => [...row]);
  initial[0][0] = initial[0][1] = initial[1][0] = 0;
  return {
    initial,
    solution,
    values: initial.map((row) => [...row]),
    notes: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => [])),
    selected: { row: 0, column: 0 },
    history: [],
    elapsedMilliseconds: 42000,
    difficulty: "hard",
  };
}

test("Sudoku migrates progress, saves edits and restores them after the legacy partition disappears", async () => {
  const factory = new IDBFactory();
  const old = profile();
  old.notes[0][1] = [2, 3];
  await mount(factory, JSON.stringify(old));
  await until(
    () => document.querySelectorAll(".sudoku-cell[aria-label]").length === 81,
  );
  assert.equal(document.querySelector("#timer").textContent, "00:42");
  assert.equal(
    document.querySelector('[data-row="0"][data-column="1"] .cell-notes')
      .textContent,
    "23",
  );
  assert.equal(localStorage.getItem(key), null);
  document.querySelector('[data-digit="1"]').click();
  await getGameStorage("sudoku").flush();
  const edited = JSON.parse(getGameStorage("sudoku").getItem(key));
  assert.equal(edited.values[0][0], 1);
  assert.equal(edited.history.length, 1);
  await unmount();
  await mount(factory);
  await until(
    () => document.querySelectorAll(".sudoku-cell[aria-label]").length === 81,
  );
  assert.equal(
    document.querySelector('[data-row="0"][data-column="0"] .cell-value')
      .textContent,
    "1",
  );
  assert.equal(document.querySelector("#undo-button").disabled, false);
  assert.equal(
    document.querySelector("#difficulty-overlay").getAttribute("aria-hidden"),
    "true",
  );
});

test("a failed Sudoku commit shows the actual cause and retries the latest progress", async () => {
  await mount(new IDBFactory(), JSON.stringify(profile()));
  await until(
    () => document.querySelectorAll(".sudoku-cell[aria-label]").length === 81,
  );
  await getGameStorage("sudoku").flush();
  let fail = true;
  IDBDatabase.prototype.transaction = function (names, mode, options) {
    if (fail && mode === "readwrite")
      throw new DOMException("Disk quota exceeded", "QuotaExceededError");
    return originalTransaction.call(this, names, mode, options);
  };
  document.querySelector('[data-digit="1"]').click();
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert.match(
    document.querySelector('[role="alertdialog"]').textContent,
    /保存失败.*Disk quota exceeded/s,
  );
  assert.equal(
    JSON.parse(getGameStorage("sudoku").getItem(key)).values[0][0],
    1,
  );
  fail = false;
  document.querySelector(".game-storage-error button").click();
  await until(() => !document.querySelector('[role="alertdialog"]'));
  assert.equal(
    document.querySelector('[data-row="0"][data-column="0"] .cell-value')
      .textContent,
    "1",
  );
});

test("invalid Sudoku progress stays preserved and blocks starting a replacement puzzle", async () => {
  await mount(new IDBFactory(), "{broken");
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert.match(
    document.querySelector('[role="alertdialog"]').textContent,
    /INVALID_SUDOKU_SAVE/,
  );
  assert.equal(document.querySelectorAll(".sudoku-cell").length, 0);
  assert.equal(
    document.querySelector("#difficulty-overlay").getAttribute("aria-hidden"),
    "true",
  );
  document.querySelector(".game-storage-error button").click();
  await until(
    () => !document.querySelector(".game-storage-error button").disabled,
  );
  assert.match(
    document.querySelector('[role="alertdialog"]').textContent,
    /INVALID_SUDOKU_SAVE/,
  );
});

test("an unavailable database blocks Sudoku startup, preserves legacy progress and retries reading", async () => {
  const factory = new IDBFactory();
  const open = factory.open.bind(factory);
  let blocked = true;
  factory.open = (...args) => {
    if (blocked)
      throw new DOMException("Database access denied", "SecurityError");
    return open(...args);
  };
  const raw = JSON.stringify(profile());
  await mount(factory, raw);
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert.match(
    document.querySelector('[role="alertdialog"]').textContent,
    /读取失败.*Database access denied/s,
  );
  assert.equal(localStorage.getItem(key), raw);
  assert.equal(document.querySelectorAll(".sudoku-cell").length, 0);
  blocked = false;
  document.querySelector(".game-storage-error button").click();
  await until(
    () => document.querySelectorAll(".sudoku-cell[aria-label]").length === 81,
  );
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.equal(document.querySelector("#timer").textContent, "00:42");
});
