import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Window } from "happy-dom";
import { initializeGoStorage } from "../games/go/storage.js";
import { GO_HISTORY_KEY } from "../games/go/history.js";

const previous = { window: globalThis.window, document: globalThis.document,
  indexedDB: Object.getOwnPropertyDescriptor(globalThis, "indexedDB") };
let browser;
const archive = records => JSON.stringify({ format: "playweft-go-history", formatVersion: 1, records });
function mount(embedded) {
  browser = new Window();
  const local = browser.localStorage;
  const host = { localStorage: local };
  host.parent = embedded ? {} : host;
  globalThis.window = host;
  globalThis.document = browser.document;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true,
    get() { throw new Error("Go must never access IndexedDB"); } });
  return local;
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Expected storage state was not reached");
}
afterEach(async () => {
  await browser?.happyDOM.abort();
  globalThis.window = previous.window;
  globalThis.document = previous.document;
  if (previous.indexedDB) Object.defineProperty(globalThis, "indexedDB", previous.indexedDB);
  else delete globalThis.indexedDB;
});

test("standalone Go keeps its existing localStorage archive and never opens IndexedDB", async () => {
  const local = mount(false), saved = archive([]);
  local.setItem(GO_HISTORY_KEY, saved);
  const storage = await initializeGoStorage();
  assert.equal(storage.getItem(GO_HISTORY_KEY), saved);
  const next = archive([{ id: "new-local" }]);
  storage.setItem(GO_HISTORY_KEY, next);
  await storage.flush();
  assert.equal(local.getItem(GO_HISTORY_KEY), next);
  assert.equal(local.length, 1, "No migration markers or second database are created");
});

test("embedded Go uses only the platform archive, even when it is empty", async () => {
  for (const platformValue of [null, archive([])]) {
    const local = mount(true), old = archive([{ id: "old-iframe" }]);
    local.setItem(GO_HISTORY_KEY, old);
    const calls = [];
    let value = platformValue;
    const bridge = { localStorage: {
      async getItem(key) { calls.push(["get", key]); return value; },
      async setItem(key, next) { calls.push(["set", key]); value = next; },
      async removeItem() { assert.fail("No automatic migration or deletion"); },
    } };
    const storage = await initializeGoStorage(bridge);
    assert.equal(storage.getItem(GO_HISTORY_KEY), platformValue);
    assert.deepEqual(calls, [["get", GO_HISTORY_KEY]]);
    storage.setItem(GO_HISTORY_KEY, archive([{ id: "platform-new" }]));
    await storage.flush();
    assert.deepEqual(calls.at(-1), ["set", GO_HISTORY_KEY]);
    assert.equal(local.getItem(GO_HISTORY_KEY), old, "The old iframe archive is neither imported nor removed");
    await browser.happyDOM.abort();
  }
});

test("Go platform read and save failures require retry without falling back to localStorage", async () => {
  const local = mount(true), old = archive([{ id: "old-local" }]);
  local.setItem(GO_HISTORY_KEY, old);
  let failRead = true, failWrite = true, value = archive([]);
  const opening = initializeGoStorage({ localStorage: {
    async getItem() { if (failRead) throw new Error("offline"); return value; },
    async setItem(_key, next) { if (failWrite) throw new Error("save failed"); value = next; },
  } });
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert.match(document.body.textContent, /存档读取失败/);
  failRead = false;
  document.querySelector("button").click();
  const storage = await opening;
  const next = archive([{ id: "latest-progress" }]);
  storage.setItem(GO_HISTORY_KEY, next);
  await until(() => document.querySelector('[role="alertdialog"]'));
  assert.match(document.body.textContent, /存档保存失败/);
  assert.equal(storage.getItem(GO_HISTORY_KEY), next);
  assert.equal(value, archive([]));
  assert.equal(local.getItem(GO_HISTORY_KEY), old);
  failWrite = false;
  document.querySelector("button").click();
  await until(() => !document.querySelector('[role="alertdialog"]'));
  assert.equal(value, next);
});
