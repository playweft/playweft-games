import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheGameOfflineResources,
  fetchGameResource,
  gameOfflineCacheName,
  gameOfflineSettingsKeys,
  hasGameOfflineResources,
  notifyGameOfflineSettings,
  readBuildContentVersion,
  readGameOfflineSettings,
  writeGameOfflineSettings,
} from "../src/game-offline-cache.js";

import { installOfflineCache } from "./helpers/offline-cache.js";
import { loadGameStorageCache } from "../src/game-storage-cache.js";

function buildDocument(version) {
  return {
    querySelector(selector) {
      assert.equal(selector, 'meta[name="playweft-build-version"]');
      return { getAttribute: () => version };
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("offline cache names follow the current build content version", () => {
  const version = "0123456789abcdef";
  assert.equal(readBuildContentVersion(buildDocument(version)), version);
  assert.equal(
    gameOfflineCacheName("sudoku", version),
    `playweft-offline:sudoku:${version}`,
  );
});

test("offline download settings retain the cached build version", () => {
  const storage = memoryStorage();
  const version = "fedcba9876543210";
  assert.deepEqual(
    writeGameOfflineSettings(
      "sudoku",
      { mode: "download", policy: "local-first", version },
      storage,
    ),
    { mode: "download", policy: "local-first", version },
  );
  assert.deepEqual(readGameOfflineSettings("sudoku", storage), {
    mode: "download",
    policy: "local-first",
    version,
  });
});


const version = "0123456789abcdef";
const urls = ["https://game.example/sudoku/", "https://game.example/sudoku/game.lua"];
const settings = { mode: "download", policy: "local-first", version };

test("offline packages become usable only after a complete download and remain version-specific", async (t) => {
  const { caches } = installOfflineCache(t);
  const available = (next = settings) => hasGameOfflineResources("sudoku", { settings: next, buildVersion: version });
  assert.equal(await available(), false);
  await cacheGameOfflineResources("sudoku", urls, { buildVersion: version,
    fetchImpl: async (request) => new Response("resource", { status: request.url.endsWith("game.lua") ? 503 : 200 }),
  });
  assert.equal(await available(), false, "partial download has no completion record");
  await cacheGameOfflineResources("sudoku", urls, { buildVersion: version,
    fetchImpl: async () => new Response("resource"),
  });
  assert.equal(await available(), true);
  assert.equal(await available({ ...settings, version: "fedcba9876543210" }), false);
  assert.equal(await available({ ...settings, mode: "none" }), false);
  const cache = await caches.open(gameOfflineCacheName("sudoku", version));
  await cache.delete(urls[1]);
  assert.equal(await available(), false, "evicted resources invalidate the package");
});

test("resource requests and service-worker policy ignore an unavailable package but retain the preference", async (t) => {
  const { caches, setGlobal } = installOfflineCache(t);
  const storage = memoryStorage();
  const keys = gameOfflineSettingsKeys("sudoku");
  writeGameOfflineSettings("sudoku", settings, storage);
  await loadGameStorageCache({ gameId: "sudoku", keys: Object.values(keys), backend: storage });
  setGlobal("document", buildDocument(version));
  const messages = [];
  setGlobal("navigator", { serviceWorker: { controller: { postMessage: (message) => messages.push(message) } } });
  const cache = await caches.open(gameOfflineCacheName("sudoku", version));
  await cache.put(urls[1], new Response("partial cache"));
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response("network"); };
  const options = { gameId: "sudoku", buildVersion: version, fetchImpl };
  assert.equal(await (await fetchGameResource(urls[1], options)).text(), "network");
  await notifyGameOfflineSettings("sudoku");
  assert.equal(messages.at(-1).mode, "none");
  assert.equal(messages.at(-1).policy, "network-first");
  await cacheGameOfflineResources("sudoku", urls, { buildVersion: version,
    fetchImpl: async () => new Response("complete cache"),
  });
  assert.equal(await (await fetchGameResource(urls[1], options)).text(), "complete cache");
  // Workers pass mode and build version explicitly rather than hydrating browser preferences.
  assert.equal(await (await fetchGameResource(urls[1], { ...options, mode: "download", policy: "local-first" })).text(), "complete cache");
  assert.equal(requests, 1);
  await notifyGameOfflineSettings("sudoku");
  assert.equal(messages.at(-1).mode, "download");
  assert.equal(messages.at(-1).policy, "local-first");
  await caches.delete(gameOfflineCacheName("sudoku", version));
  assert.equal(await (await fetchGameResource(urls[1], options)).text(), "network");
  await notifyGameOfflineSettings("sudoku");
  assert.equal(messages.at(-1).mode, "none");
  assert.equal(readGameOfflineSettings("sudoku", storage).policy, "local-first");
});

test("workers can use a verified package without a hydrated settings store", async (t) => {
  installOfflineCache(t);
  const gameId = "worker-test";
  await cacheGameOfflineResources(gameId, urls, { buildVersion: version,
    fetchImpl: async () => new Response("cached worker rules"),
  });
  const response = await fetchGameResource(urls[1], {
    gameId, mode: "download", policy: "local-first", buildVersion: version,
    fetchImpl: () => assert.fail("worker should read the available package"),
  });
  assert.equal(await response.text(), "cached worker rules");
});
