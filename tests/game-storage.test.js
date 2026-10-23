import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  createGameStorage,
  createStandaloneStorage,
} from "../src/game-storage.js";

const methods = ["getItem", "setItem", "removeItem", "clear", "key", "length"];
function memory(initial = []) {
  const values = new Map(initial);
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
    async clear() {
      values.clear();
    },
    async key(index) {
      return [...values.keys()].sort()[index] ?? null;
    },
    async length() {
      return values.size;
    },
  };
}
const remote = (storage) => ({
  ready: async () => ({
    capabilities: methods.map((method) => `localStorage.${method}`),
  }),
  localStorage: storage,
});
const legacy = (values) => ({
  getItem: (key) => values.get(key) ?? null,
  removeItem: (key) => values.delete(key),
});
const options = (values) => ({
  embedded: true,
  legacyKeys: ["save", "old-save"],
  migrationKey: "migrated",
  legacyStorage: () => legacy(values),
});

test("legacy saves migrate after commit, resume interrupted imports, and never replace current platform progress", async () => {
  const old = new Map([
    ["save", "level 256"],
    ["old-save", "level 29"],
  ]);
  const target = memory();
  let fail = true;
  const put = target.setItem;
  target.setItem = async (key, value) => {
    if (key === "old-save" && fail) throw new Error("Disk full");
    await put(key, value);
  };
  const storage = createGameStorage(remote(target), options(old));
  await assert.rejects(storage.getItem("save"), /Disk full/);
  assert.equal(old.get("save"), "level 256");
  assert.equal(target.values.has("migrated"), false);
  fail = false;
  assert.equal(await storage.getItem("save"), "level 256");
  assert.equal(await storage.getItem("old-save"), "level 29");
  assert.equal(old.size, 0);
  await storage.setItem("save", "level 257");
  const stale = new Map([["save", "level 1"]]);
  const reopened = createGameStorage(remote(target), options(stale));
  assert.equal(await reopened.getItem("save"), "level 257");
  assert.equal(
    stale.get("save"),
    "level 1",
    "completed migration never consults another legacy partition",
  );
});

test("platform errors and missing capabilities never fall back to iframe localStorage", async () => {
  let legacyReads = 0;
  const opt = {
    ...options(new Map()),
    legacyStorage() {
      legacyReads++;
      throw new Error("must not fall back");
    },
  };
  const unsupported = createGameStorage(
    { ready: async () => ({ capabilities: [] }) },
    opt,
  );
  await assert.rejects(
    unsupported.getItem("save"),
    (error) => error.code === "STORAGE_UNSUPPORTED",
  );
  const target = memory();
  target.getItem = async () => {
    throw new Error("Database broken");
  };
  await assert.rejects(
    createGameStorage(remote(target), opt).getItem("save"),
    /Database broken/,
  );
  assert.equal(legacyReads, 0);
});

test("an inaccessible legacy store cannot erase an existing platform save or silently start a new game", async () => {
  const blocked = () => {
    throw new DOMException("Legacy storage denied", "SecurityError");
  };
  const current = createGameStorage(
    remote(
      memory([
        ["save", "256"],
        ["old-save", "29"],
      ]),
    ),
    {
      ...options(new Map()),
      legacyStorage: blocked,
    },
  );
  assert.equal(await current.getItem("save"), "256");
  const empty = createGameStorage(remote(memory()), {
    ...options(new Map()),
    legacyStorage: blocked,
  });
  await assert.rejects(empty.getItem("save"), { name: "SecurityError" });
});

test("standalone IndexedDB persists through new instances and preserves empty values and deletion", async () => {
  const factory = new IDBFactory();
  let backend = createStandaloneStorage({ factory });
  let storage = createGameStorage(null, {
    embedded: false,
    standalone: backend,
  });
  await storage.setItem("", "");
  await storage.setItem("save", "256");
  assert.equal(await storage.length(), 2);
  assert.equal(await storage.key(0), "");
  assert.equal(await storage.key(2), null);
  await backend.close();
  backend = createStandaloneStorage({ factory });
  storage = createGameStorage(null, { embedded: false, standalone: backend });
  assert.equal(await storage.getItem("save"), "256");
  assert.equal(await storage.getItem(""), "");
  await storage.removeItem("save");
  assert.equal(await storage.getItem("save"), null);
  await storage.clear();
  assert.equal(await storage.length(), 0);
  await backend.close();
});

test("standalone read and write failures reject instead of pretending storage is empty", async () => {
  const backend = createStandaloneStorage({ factory: null });
  await assert.rejects(backend.getItem("save"), /unavailable/);
  await assert.rejects(backend.setItem("save", "256"), /unavailable/);
});

test("queued operations cannot overtake an uncommitted write", async () => {
  let commit;
  const gate = new Promise((resolve) => {
    commit = resolve;
  });
  const target = memory(),
    calls = [];
  const put = target.setItem;
  target.setItem = async (key, value) => {
    calls.push(value);
    if (value === "first") await gate;
    await put(key, value);
  };
  const storage = createGameStorage(remote(target), { embedded: true });
  const first = storage.setItem("save", "first"),
    second = storage.setItem("save", "second"),
    read = storage.getItem("save");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["first"]);
  commit();
  await Promise.all([first, second]);
  assert.equal(await read, "second");
});
