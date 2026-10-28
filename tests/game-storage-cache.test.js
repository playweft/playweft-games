import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGameStorage,
  createStandaloneStorage,
} from "../src/game-storage.js";
import {
  getGameStorage,
  loadGameStorageCache,
} from "../src/game-storage-cache.js";
import { IDBFactory } from "fake-indexeddb";
import {
  SUDOKU_PROGRESS_KEY,
  validateSudokuProgress,
} from "../games/sudoku/storage.js";

test("failed writes retain the newest snapshot and deletion for explicit retry, without stale overwrite", async () => {
  const disk = new Map([
    ["save", "old"],
    ["setting", "on"],
  ]);
  let commit,
    fail = false,
    attempts = 0,
    failure;
  const gate = new Promise((resolve) => {
    commit = resolve;
  });
  const backend = {
    getItem: async (key) => disk.get(key) ?? null,
    async setItem(key, value) {
      if (++attempts === 1) await gate;
      if (fail) throw new Error("Quota exceeded");
      disk.set(key, value);
    },
    async removeItem(key) {
      if (fail) throw new Error("Quota exceeded");
      disk.delete(key);
    },
  };
  const cache = await loadGameStorageCache({
    gameId: "failure-test",
    keys: ["save", "setting"],
    backend,
    onError: (error) => {
      failure = error;
    },
  });
  cache.setItem("save", "first");
  await new Promise((resolve) => setImmediate(resolve));
  cache.setItem("save", "latest");
  cache.removeItem("setting");
  fail = true;
  commit();
  await assert.rejects(cache.flush(), /Quota exceeded/);
  assert.match(failure.message, /Quota exceeded/);
  assert.equal(cache.getItem("save"), "latest");
  assert.equal(disk.get("save"), "old");
  cache.setItem("save", "newest");
  assert.equal(attempts, 1, "retry is explicit after a failed commit");
  fail = false;
  await cache.retry();
  assert.equal(disk.get("save"), "newest");
  assert.equal(disk.has("setting"), false);
  assert.throws(() => cache.setItem("other-game", "bad"), /Unregistered/);
});

test("updates during a successful in-flight write commit in order and coalesce redundant snapshots", async () => {
  const writes = [];
  let commit;
  const gate = new Promise((resolve) => {
    commit = resolve;
  });
  const backend = {
    getItem: async () => null,
    async setItem(key, value) {
      writes.push(value);
      if (writes.length === 1) await gate;
    },
  };
  const cache = await loadGameStorageCache({
    gameId: "ordering-test",
    keys: ["save"],
    backend,
  });
  cache.setItem("save", "1");
  await new Promise((resolve) => setImmediate(resolve));
  cache.setItem("save", "2");
  cache.setItem("save", "3");
  commit();
  await cache.flush();
  cache.setItem("save", "3");
  await cache.flush();
  assert.deepEqual(writes, ["1", "3"]);
});

test("invalid Sudoku data and read failures prevent registering an empty replacement store", async () => {
  const backend = {
    getItem: async () => "{broken",
    setItem() {
      assert.fail("must not overwrite");
    },
  };
  await assert.rejects(
    loadGameStorageCache({
      gameId: "bad-sudoku",
      keys: [SUDOKU_PROGRESS_KEY],
      backend,
      validate: validateSudokuProgress,
    }),
    (error) => error.code === "INVALID_SUDOKU_SAVE",
  );
  assert.equal(getGameStorage("bad-sudoku"), undefined);
  backend.getItem = async () => {
    throw new Error("Read failed");
  };
  await assert.rejects(
    loadGameStorageCache({
      gameId: "bad-read",
      keys: [SUDOKU_PROGRESS_KEY],
      backend,
    }),
    /Read failed/,
  );
  assert.equal(getGameStorage("bad-read"), undefined);
});

test("a partial settings migration never deletes any legacy keys before the migration marker commits", async () => {
  const old = new Map([
    ["save", "match"],
    ["volume", "50"],
  ]);
  const remote = new Map();
  let fail = true;
  const backend = {
    getItem: async (key) => remote.get(key) ?? null,
    async setItem(key, value) {
      if (key === "migrated" && fail) throw new Error("Commit failed");
      remote.set(key, value);
    },
  };
  const bridge = {
    ready: async () => ({
      capabilities: [
        "localStorage.getItem",
        "localStorage.setItem",
        "localStorage.removeItem",
      ],
    }),
    localStorage: backend,
  };
  const storage = createGameStorage(bridge, {
    embedded: true,
    legacyKeys: ["save", "volume"],
    migrationKey: "migrated",
    legacyStorage: () => ({
      getItem: (key) => old.get(key) ?? null,
      removeItem: (key) => old.delete(key),
    }),
  });
  await assert.rejects(storage.getItem("save"), /Commit failed/);
  assert.equal(old.size, 2);
  remote.set("save", "newer match");
  fail = false;
  assert.equal(await storage.getItem("save"), "newer match");
  assert.equal(old.size, 0);
  assert.equal(remote.get("volume"), "50");
});
