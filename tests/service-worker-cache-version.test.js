import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("service worker follows build manifest changes without changing its script", async () => {
  const handlers = new Map();
  const openedCaches = [];
  const cacheEntries = new Map();
  let version = "0123456789abcdef";
  const caches = {
    async open(name) {
      openedCaches.push(name);
      const entries = cacheEntries.get(name) ?? new Map();
      cacheEntries.set(name, entries);
      return {
        async match(request) {
          return entries.get(String(request))?.clone();
        },
        async put(request, response) {
          entries.set(String(request), response.clone());
        },
      };
    },
    async keys() {
      return [...cacheEntries.keys()];
    },
    async delete(name) {
      return cacheEntries.delete(name);
    },
  };
  const self = {
    location: { origin: "https://play.example" },
    clients: {
      async claim() {},
      async get() {
        return null;
      },
    },
    skipWaiting() {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
  };
  const fetch = async (request) => {
    if (request === "/build-version.json") {
      return Response.json({ version });
    }
    return new Response(
      `<!doctype html><head><meta name="playweft-build-version" content="${version}" /></head>`,
    );
  };
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    caches,
    console,
    fetch,
    Map,
    Promise,
    Request,
    Response,
    self,
    URL,
  });

  async function navigate() {
    let response;
    const backgroundWork = [];
    handlers.get("fetch")({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://play.example/sudoku/",
      },
      clientId: "",
      respondWith(value) {
        response = value;
      },
      waitUntil(value) {
        backgroundWork.push(value);
      },
    });
    await response;
    await Promise.all(backgroundWork);
  }

  await navigate();
  assert.ok(openedCaches.includes(`playweft-offline:sudoku:${version}`));

  version = "fedcba9876543210";
  await navigate();
  assert.ok(openedCaches.includes(`playweft-offline:sudoku:${version}`));
});
