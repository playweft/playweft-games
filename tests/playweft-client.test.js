import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayweftClient } from "../src/playweft-client.js";
import { createPlayweftSoloClient } from "../src/playweft-solo-client.js";

function createEmbeddedHarness() {
  const windowListeners = new Map();
  const parentMessages = [];
  const portMessages = [];
  const fakePort = {
    onmessage: undefined,
    closed: false,
    close() {
      this.closed = true;
    },
    start() {},
    postMessage(message) {
      portMessages.push(message);
    },
  };
  const fakeWindow = {
    parent: {
      postMessage(message, target) {
        parentMessages.push({ message, target });
      },
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type) {
      windowListeners.delete(type);
    },
  };

  return {
    fakePort,
    fakeWindow,
    parentMessages,
    portMessages,
    connect() {
      windowListeners.get("message")({
        source: fakeWindow.parent,
        data: { type: "playweft:bridge", version: 1 },
        ports: [fakePort],
      });
    },
  };
}

function respond(port, id, result) {
  port.onmessage({
    data: { jsonrpc: "2.0", id, result },
  });
}

function notify(port, method, params) {
  port.onmessage({
    data: { jsonrpc: "2.0", method, params },
  });
}

test("Playweft room client uses bridge v1 and Manifest-owned initialization", async () => {
  const harness = createEmbeddedHarness();
  const results = [];
  const errors = [];
  const states = [];
  const contexts = [];
  const readyMessages = [];
  const profileChanges = [];
  const ids = [
    "initialize-123",
    "action-123",
    "action-456",
    "clipboard-123",
    "confirm-123",
    "avatar-123",
    "profile-123",
  ];
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = harness.fakeWindow;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => ids.shift() },
  });

  try {
    const client = createPlayweftClient({
      onActionResult: (result) => results.push(result),
      onState: (state) => states.push(state),
      onContext: (context) => contexts.push(context),
      onReady: (message) => readyMessages.push(message),
      onPlayerProfileChanged: (change) => profileChanges.push(change),
      onError: (error, code, requestId) =>
        errors.push({ error, code, requestId }),
    });

    assert.deepEqual(harness.parentMessages[0], {
      message: { type: "playweft:bridge-ready", version: 1 },
      target: "*",
    });
    harness.connect();
    assert.deepEqual(harness.portMessages, [
      {
        jsonrpc: "2.0",
        id: "initialize-123",
        method: "game.initialize",
      },
    ]);

    respond(harness.fakePort, "initialize-123", {
      mode: "room",
      protocolVersion: 1,
      capabilities: ["navigator.clipboard.readText"],
      phase: "lobby",
      player: { id: "player-one", name: "牌友" },
      playerId: "player-one",
    });
    await Promise.resolve();

    const requestId = client.sendAction({ type: "move", column: 4 });
    assert.equal(requestId, "action-123");
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "action-123",
      method: "room.action",
      params: { action: { type: "move", column: 4 } },
    });
    respond(harness.fakePort, "action-123", {
      accepted: true,
      matchId: "match-one",
      version: 8,
    });
    await Promise.resolve();

    const rejectedId = client.sendAction({ type: "move", column: 5 });
    assert.equal(rejectedId, "action-456");
    respond(harness.fakePort, "action-456", {
      accepted: false,
      matchId: "match-one",
      version: 8,
      error: {
        code: "NOT_YOUR_TURN",
        message: "Move rejected",
      },
    });
    await Promise.resolve();

    notify(harness.fakePort, "platform.error", {
      error: {
        code: "ROOM_ERROR",
        message: "Connection interrupted",
        retryable: true,
      },
    });
    notify(harness.fakePort, "room.players.profileChanged", {
      playerId: "player-two",
      fields: ["avatar"],
    });
    notify(harness.fakePort, "game.state", {
      phase: "playing",
      state: { round: 1 },
      events: [],
      matchId: "match-one",
      version: 8,
      serverTime: 100,
    });
    notify(harness.fakePort, "game.state", {
      phase: "playing",
      state: { round: "stale" },
      events: [],
      matchId: "match-one",
      version: 7,
      serverTime: 101,
    });
    notify(harness.fakePort, "game.state", {
      phase: "playing",
      state: { round: 2 },
      events: [],
      matchId: "match-two",
      version: 0,
      serverTime: 200,
    });

    const clipboard = client.readClipboardText();
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "clipboard-123",
      method: "navigator.clipboard.readText",
    });
    respond(harness.fakePort, "clipboard-123", "copied text");
    assert.equal(await clipboard, "copied text");

    const confirmation = client.confirm("确定删除吗？");
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "confirm-123",
      method: "window.confirm",
      params: { message: "确定删除吗？" },
    });
    respond(harness.fakePort, "confirm-123", true);
    assert.equal(await confirmation, true);

    const roomProfile = client.getRoomPlayerProfile({
      playerId: "player-two",
      fields: ["name", "avatar"],
    });
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "avatar-123",
      method: "room.players.getProfile",
      params: {
        playerId: "player-two",
        fields: ["name", "avatar"],
      },
    });
    respond(harness.fakePort, "avatar-123", {
      name: "牌友二",
      avatar: { src: "https://play.example/avatar/player-two" },
    });
    assert.deepEqual(await roomProfile, {
      name: "牌友二",
      avatar: { src: "https://play.example/avatar/player-two" },
    });

    const profile = client.getUserProfile({ fields: ["name", "avatar"] });
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "profile-123",
      method: "user.getProfile",
      params: { fields: ["name", "avatar"] },
    });
    respond(harness.fakePort, "profile-123", {
      name: "牌友",
      avatar: { src: "https://play.example/avatar/self" },
    });
    assert.deepEqual(await profile, {
      name: "牌友",
      avatar: { src: "https://play.example/avatar/self" },
    });

    assert.deepEqual(results, [
      {
        requestId: "action-123",
        accepted: true,
        matchId: "match-one",
        version: 8,
      },
    ]);
    assert.deepEqual(errors, [
      {
        error: "Move rejected",
        code: "NOT_YOUR_TURN",
        requestId: "action-456",
      },
      {
        error: "Connection interrupted",
        code: "ROOM_ERROR",
        requestId: undefined,
      },
    ]);
    assert.deepEqual(profileChanges, [
      { playerId: "player-two", fields: ["avatar"] },
    ]);
    assert.deepEqual(contexts, [
      {
        mode: "room",
        protocolVersion: 1,
        capabilities: ["navigator.clipboard.readText"],
        phase: "lobby",
        player: { id: "player-one", name: "牌友" },
        playerId: "player-one",
      },
    ]);
    assert.deepEqual(readyMessages, [
      {
        mode: "room",
        protocolVersion: 1,
        capabilities: ["navigator.clipboard.readText"],
        phase: "lobby",
        player: { id: "player-one", name: "牌友" },
        playerId: "player-one",
      },
    ]);
    assert.deepEqual(
      states.map(({ state, matchId, version, serverTime, playerId }) => ({
        state,
        matchId,
        version,
        serverTime,
        playerId,
      })),
      [
        {
          state: { round: 1 },
          matchId: "match-one",
          version: 8,
          serverTime: 100,
          playerId: "player-one",
        },
        {
          state: { round: 2 },
          matchId: "match-two",
          version: 0,
          serverTime: 200,
          playerId: "player-one",
        },
      ],
    );
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("Playweft client reports platform latency samples and ignores invalid ones", async () => {
  const harness = createEmbeddedHarness();
  const samples = [];
  const ids = ["initialize-123"];
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = harness.fakeWindow;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => ids.shift() },
  });

  try {
    const client = createPlayweftClient({
      onLatency: (rttMs) => samples.push(rttMs),
    });
    harness.connect();
    respond(harness.fakePort, "initialize-123", {
      mode: "room",
      protocolVersion: 1,
      capabilities: [],
      phase: "playing",
      playerId: "player-one",
    });
    await Promise.resolve();

    notify(harness.fakePort, "platform.latency", { rttMs: 96 });
    notify(harness.fakePort, "platform.latency", { rttMs: 0 });
    notify(harness.fakePort, "platform.latency", {});
    notify(harness.fakePort, "platform.latency", { rttMs: -5 });
    notify(harness.fakePort, "platform.latency", { rttMs: "slow" });
    assert.deepEqual(samples, [96, 0]);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("Playweft client maps JSON-RPC failures to the originating action", async () => {
  const harness = createEmbeddedHarness();
  const errors = [];
  const ids = ["initialize-123", "action-123"];
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = harness.fakeWindow;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => ids.shift() },
  });

  try {
    const client = createPlayweftClient({
      onError: (error, code, requestId) =>
        errors.push({ error, code, requestId }),
    });
    harness.connect();
    respond(harness.fakePort, "initialize-123", {
      mode: "room",
      protocolVersion: 1,
      capabilities: [],
      phase: "lobby",
      playerId: "player-one",
    });
    await Promise.resolve();

    assert.equal(client.sendAction({ type: "move" }), "action-123");
    harness.fakePort.onmessage({
      data: {
        jsonrpc: "2.0",
        id: "action-123",
        error: {
          code: -32000,
          message: "Room request failed",
          data: { code: "ROOM_ERROR", retryable: true },
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, [
      {
        error: "Room request failed",
        code: "ROOM_ERROR",
        requestId: "action-123",
      },
    ]);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("Playweft client does not create an action request before connecting", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    const client = createPlayweftClient();
    assert.equal(client.sendAction({ type: "move" }), undefined);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Solo client initializes from its Manifest contract", async () => {
  const harness = createEmbeddedHarness();
  const contexts = [];
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = harness.fakeWindow;
  const ids = ["solo-initialize", "solo-profile", "solo-confirm"];
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => ids.shift() },
  });

  try {
    const client = createPlayweftSoloClient({
      onContext: (context) => contexts.push(context),
    });
    assert.deepEqual(harness.parentMessages, [
      {
        message: { type: "playweft:bridge-ready", version: 1 },
        target: "*",
      },
    ]);

    harness.connect();
    assert.deepEqual(harness.portMessages, [
      {
        jsonrpc: "2.0",
        id: "solo-initialize",
        method: "game.initialize",
      },
    ]);
    respond(harness.fakePort, "solo-initialize", {
      mode: "solo",
      protocolVersion: 1,
      capabilities: [],
    });
    await Promise.resolve();
    assert.deepEqual(contexts, [
      {
        mode: "solo",
        protocolVersion: 1,
        capabilities: [],
      },
    ]);

    const profile = client.getUserProfile({ fields: ["avatar"] });
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "solo-profile",
      method: "user.getProfile",
      params: { fields: ["avatar"] },
    });
    respond(harness.fakePort, "solo-profile", {
      avatar: { src: "https://play.example/avatar/self" },
    });
    assert.deepEqual(await profile, {
      avatar: { src: "https://play.example/avatar/self" },
    });

    const confirmation = client.confirm("结束本局？");
    assert.deepEqual(harness.portMessages.at(-1), {
      jsonrpc: "2.0",
      id: "solo-confirm",
      method: "window.confirm",
      params: { message: "结束本局？" },
    });
    respond(harness.fakePort, "solo-confirm", true);
    assert.equal(await confirmation, true);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("Solo client is inert when the game opens directly", async () => {
  const sent = [];
  const fakeWindow = {
    postMessage(message) {
      sent.push(message);
    },
    setInterval() {
      throw new Error("standalone games must not wait for a bridge");
    },
    addEventListener() {
      throw new Error("standalone games must not register bridge listeners");
    },
  };
  fakeWindow.parent = fakeWindow;
  const originalWindow = globalThis.window;
  globalThis.window = fakeWindow;

  try {
    const client = createPlayweftSoloClient();
    assert.deepEqual(sent, []);
    await assert.rejects(
      client.getUserProfile({ fields: ["avatar"] }),
      /not running inside Playweft/,
    );
    await assert.rejects(client.confirm("结束本局？"), /not running inside Playweft/);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});
