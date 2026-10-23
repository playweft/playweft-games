import assert from "node:assert/strict";
import { test } from "node:test";

import { Window } from "happy-dom";
import { readFile } from "node:fs/promises";
import { installOfflineCache } from "./helpers/offline-cache.js";
import { loadGameStorageCache } from "../src/game-storage-cache.js";
import { gameOfflineCacheName, gameOfflineSettingsKeys, readGameOfflineSettings } from "../src/game-offline-cache.js";
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

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected download to start");
}

async function fixture(t) {
  const { caches, setGlobal } = installOfflineCache(t);
  const browser = new Window({ url: "https://game.example/mahjong/" });
  const html = await readFile(new URL("../games/mahjong/index.html", import.meta.url), "utf8");
  browser.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ""));
  t.after(() => browser.happyDOM.abort());
  setGlobal("document", browser.document);
  const entries = new Map([["playweft.mahjong.offline-cache-policy", "local-first"]]);
  const storage = await loadGameStorageCache({ gameId: "mahjong",
    keys: Object.values(gameOfflineSettingsKeys("mahjong")),
    backend: { getItem: async (key) => entries.get(key) ?? null,
      setItem: async (key, value) => entries.set(key, value),
      removeItem: async (key) => entries.delete(key) },
  });
  const button = document.querySelector("#mahjong-offline-action-button");
  const policyRow = document.querySelector("#mahjong-offline-policy-row");
  const select = policyRow.querySelector("select");
  setGlobal("fetch", async () => new Response("test resource"));
  const options = { button, policyRow, feedback: document.querySelector("#mahjong-offline-feedback"),
    createIconsImpl() {}, confirm: async () => true };
  const controller = createMahjongOfflineResourceController(options);
  await controller.ready;
  return { controller, caches, button, policyRow, select, options, storage, setGlobal };
}

test("resource policy expands with its divider only after success and collapses accessibly on deletion", async (t) => {
  const f = await fixture(t);
  assert.equal(f.controller.state, "idle");
  assert.equal(f.policyRow.inert, true);
  assert.equal(f.select.disabled, true);
  assert.equal(f.policyRow.classList.contains("is-expanded"), false);
  assert.equal(f.policyRow.classList.contains("is-animated"), false);
  assert.ok(f.policyRow.querySelector("hr"));
  let resolveFetch;
  f.setGlobal("fetch", () => resolveFetch
    ? Promise.resolve(new Response("test resource"))
    : new Promise((resolve) => { resolveFetch = resolve; }));
  const downloading = f.controller.download();
  await until(() => resolveFetch);
  assert.equal(f.controller.state, "downloading");
  assert.equal(f.select.disabled, true);
  f.setGlobal("fetch", async () => new Response("test resource"));
  resolveFetch(new Response("test resource"));
  await downloading;
  assert.equal(f.controller.state, "complete");
  assert.equal(f.policyRow.inert, false);
  assert.equal(f.select.disabled, false);
  assert.equal(f.policyRow.classList.contains("is-expanded"), true);
  assert.equal(f.policyRow.classList.contains("is-animated"), true);
  const restored = createMahjongOfflineResourceController(f.options);
  await restored.ready;
  assert.equal(restored.state, "complete");
  assert.equal(f.policyRow.classList.contains("is-animated"), false, "initial restoration must not animate");
  f.select.focus();
  await restored.handleAction();
  assert.equal(restored.state, "idle");
  assert.equal(f.select.disabled, true);
  assert.equal(f.policyRow.inert, true);
  assert.equal(f.policyRow.getAttribute("aria-hidden"), "true");
  assert.equal(document.activeElement, f.button);
  assert.equal(f.policyRow.classList.contains("is-expanded"), false);
  assert.equal(f.policyRow.classList.contains("is-animated"), true);
  assert.equal(readGameOfflineSettings("mahjong").policy, "local-first");
  await restored.download();
  assert.equal(restored.state, "complete");
  assert.equal(readGameOfflineSettings("mahjong").policy, "local-first");
});

test("failed and cancelled downloads never expose the resource policy", async (t) => {
  const f = await fixture(t);
  f.setGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
  await f.controller.download();
  assert.equal(f.controller.state, "idle");
  assert.equal(f.select.disabled, true);
  assert.equal(f.policyRow.classList.contains("is-expanded"), false);
  let started = false;
  f.setGlobal("fetch", (request) => new Promise((resolve, reject) => {
    started = true;
    request.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
  }));
  const downloading = f.controller.download();
  await until(() => started);
  await f.controller.handleAction();
  await downloading;
  assert.equal(f.controller.state, "idle");
  assert.equal(f.policyRow.inert, true);
  assert.equal(f.policyRow.classList.contains("is-expanded"), false);
  assert.equal(await f.caches.has(gameOfflineCacheName("mahjong", "development")), false);
});

test("evicted packages are detected when returning to the resource tab", async (t) => {
  const f = await fixture(t);
  await f.controller.download();
  await f.caches.delete(gameOfflineCacheName("mahjong", "development"));
  await f.controller.refresh();
  assert.equal(f.controller.state, "idle");
  assert.equal(f.select.disabled, true);
  assert.equal(readGameOfflineSettings("mahjong").mode, "none");
  assert.equal(readGameOfflineSettings("mahjong").policy, "local-first");
});
