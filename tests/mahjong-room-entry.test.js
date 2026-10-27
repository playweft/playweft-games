import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createMahjongRoomEntry } from "../games/mahjong/app/room-entry.js";
import { createPlayweftClient } from "../src/playweft-client.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const context = { mode: "solo", capabilities: ["room.create"] };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ flush, create = async () => ({ roomId: "room-1" }) } = {}) {
  const button = new EventTarget();
  button.setAttribute = (name, value) => { button[name] = value; };
  const errors = [];
  const entry = createMahjongRoomEntry({
    button, getClient: () => ({ createRoom: create }), beforeCreate: flush,
    showError: (message) => errors.push(message),
  });
  return { button, entry, errors, click: () => button.dispatchEvent(new Event("click")) };
}

test("Mahjong defaults to solo while retaining room play", async () => {
  const manifest = JSON.parse(await readFile(new URL("../games/mahjong/playweft.json", import.meta.url)));
  assert.equal(manifest.launch_mode, "solo");
  assert.ok(manifest.modes.solo);
  assert.ok(manifest.modes.room);
});

test("Mahjong only offers room creation to solo hosts advertising room.create", async () => {
  let calls = 0;
  const f = fixture({ create: async () => { calls++; } });
  assert.equal(f.button.hidden, true);
  for (const value of [undefined, { mode: "solo" }, { mode: "room", capabilities: ["room.create"] }]) {
    f.entry.setContext(value);
    assert.equal(f.button.hidden, true);
    f.click();
  }
  await tick();
  assert.equal(calls, 0);
  f.entry.setContext(context);
  assert.equal(f.button.hidden, false);
  f.entry.destroy();
});

test("Mahjong flushes progress before creating once, and lets the platform navigate", async () => {
  const saved = deferred(), created = deferred();
  const actions = [];
  const f = fixture({
    flush: () => { actions.push("save"); return saved.promise; },
    create: () => { actions.push("create"); return created.promise; },
  });
  f.entry.setContext(context);
  f.click(); f.click();
  assert.equal(f.button.disabled, true);
  assert.equal(f.button["aria-busy"], "true");
  assert.deepEqual(actions, ["save"]);
  saved.resolve();
  await tick();
  assert.deepEqual(actions, ["save", "create"]);
  f.click();
  created.resolve({ roomId: "room-1" });
  await tick();
  assert.deepEqual(actions, ["save", "create"]);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, "友人戦");
  assert.deepEqual(f.errors, []);
  f.entry.destroy();
});

test("Mahjong keeps the solo entry usable after save or creation failures and permits retry", async () => {
  for (const failure of ["save", "create"]) {
    let fail = true, calls = 0;
    const f = fixture({
      flush: async () => { if (failure === "save" && fail) throw new Error("保存失败"); },
      create: async () => {
        calls++;
        if (fail) throw new Error("网络不可用");
        return { roomId: "room-1" };
      },
    });
    f.entry.setContext(context);
    f.click(); await tick();
    assert.equal(f.errors.length, 1);
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.hidden, false);
    assert.equal(calls, failure === "save" ? 0 : 1);
    fail = false;
    f.click(); await tick();
    assert.equal(calls, failure === "save" ? 1 : 2);
    f.entry.destroy();
  }
});

test("Mahjong cancels a pending transition after teardown or loss of capability", async () => {
  for (const destroy of [true, false]) {
    const saved = deferred();
    let calls = 0;
    const f = fixture({ flush: () => saved.promise, create: async () => { calls++; } });
    f.entry.setContext(context);
    f.click();
    if (destroy) f.entry.destroy();
    else f.entry.setContext({ mode: "room" });
    saved.resolve(); await tick();
    assert.equal(calls, 0);
    assert.deepEqual(f.errors, []);
    f.entry.destroy();
  }
});

test("The shared bridge sends room.create without params and preserves platform errors", async () => {
  const originalWindow = globalThis.window;
  let receive;
  const messages = [];
  const port = { start() {}, close() {}, postMessage(message) { messages.push(message); } };
  globalThis.window = {
    parent: { postMessage() {} }, setInterval() { return 1; }, clearInterval() {},
    addEventListener(_, listener) { receive = listener; }, removeEventListener() {},
  };
  let client;
  try {
    client = createPlayweftClient();
    receive({ source: window.parent, data: { type: "playweft:bridge", version: 1 }, ports: [port] });
    port.onmessage({ data: { jsonrpc: "2.0", id: messages[0].id, result: context } });
    await tick();
    const result = client.createRoom();
    const request = messages.at(-1);
    assert.equal(request.method, "room.create");
    assert.equal(Object.hasOwn(request, "params"), false);
    port.onmessage({ data: { jsonrpc: "2.0", id: request.id, result: { roomId: "new-room" } } });
    assert.deepEqual(await result, { roomId: "new-room" });
    const failed = client.createRoom();
    const rejected = assert.rejects(failed, { code: "ROOM_CREATION_FAILED", retryable: true });
    port.onmessage({ data: { jsonrpc: "2.0", id: messages.at(-1).id, error: {
      code: -32000, message: "Network unavailable", data: { code: "ROOM_CREATION_FAILED", retryable: true },
    } } });
    await rejected;
  } finally {
    client?.destroy();
    globalThis.window = originalWindow;
  }
});

test("Mahjong room entry updates its label without removing the icon", async () => {
  const { promise, resolve } = deferred();
  const label = {};
  const button = new EventTarget();
  button.querySelector = () => label;
  button.setAttribute = () => {};
  const entry = createMahjongRoomEntry({
    button, getClient: () => ({ createRoom: () => promise }),
    beforeCreate: async () => {}, showError: assert.fail,
  });
  entry.setContext(context);
  assert.equal(label.textContent, "友人戦");
  button.dispatchEvent(new Event("click"));
  assert.equal(label.textContent, "创建中");
  assert.equal(button.textContent, undefined);
  resolve({ roomId: "room-1" });
  await tick();
  assert.equal(label.textContent, "友人戦");
  entry.destroy();
});


test("the home friend-battle sign uses the room entry controller and keeps other menus separate", async () => {
  const html = await readFile(new URL("../games/mahjong/index.html", import.meta.url), "utf8");
  const window = new Window();
  window.document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const button = window.document.querySelector("#create-room-button");
  assert.equal(button.closest("[data-lobby-page]").dataset.lobbyPage, "home");
  assert.equal(window.document.querySelectorAll("#create-room-button").length, 1);
  let requests = 0;
  const entry = createMahjongRoomEntry({ button,
    getClient: () => ({ createRoom: async () => { requests++; return { roomId: "test-room" }; } }),
    beforeCreate: async () => {}, showError: assert.fail,
  });
  entry.setContext(context);
  assert.equal(button.hidden, false);
  assert.equal(button.querySelector("[data-room-entry-label]").textContent, "友人戦");
  button.click(); await tick();
  assert.equal(requests, 1);
  entry.setContext({ mode: "room" });
  assert.equal(button.hidden, true);
  entry.destroy();
  await window.happyDOM.close();
});
