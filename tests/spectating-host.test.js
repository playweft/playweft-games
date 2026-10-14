import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

function literal(value) {
  if (value == null) return "nil";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(literal).join(",")}}`;
  return `{${Object.entries(value)
    .map(([key, item]) => `[${JSON.stringify(key)}]=${literal(item)}`)
    .join(",")}}`;
}

async function runtime(name) {
  const manifest = JSON.parse(
    await readFile(`games/${name}/playweft.json`, "utf8"),
  );
  const lua = await new LuaFactory().createEngine();
  await lua.doString(await readFile(`games/${name}/game.lua`, "utf8"));
  const players = Array.from(
    { length: manifest.modes.room.players.min },
    (_, i) => ({ id: `p${i + 1}`, seat: i + 1, name: `P${i + 1}` }),
  );
  const context = {
    protocolVersion: 1,
    serverTime: 0,
    players,
    match: {
      id: "match",
      ownerId: "observer",
      startedAt: 0,
      randomSeed: "00000000000000000000000000000001",
    },
  };
  async function call(name, ...args) {
    await lua.doString(`result = ${name}(${args.map(literal).join(",")})`);
    return lua.global.get("result");
  }
  const raw = await call("setup", context);
  return {
    lua,
    players,
    state: raw.state ?? raw,
    call,
    close: () => lua.global.close(),
  };
}
const actor = (id, isOwner, role = "spectator") => ({
  protocolVersion: 1,
  matchId: "match",
  version: 0,
  actionId: "action",
  actionAt: 0,
  serverTime: 0,
  actor: { id, role, isOwner },
});
const viewer = (isOwner) => ({
  protocolVersion: 1,
  matchId: "match",
  version: 0,
  serverTime: 0,
  viewer: { id: "observer", role: "spectator", isOwner },
});
const gameNames = [];
for (const entry of await readdir("games", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    await readFile(`games/${entry.name}/game.lua`);
    gameNames.push(entry.name);
  } catch {}
}
for (const name of gameNames) {
  test(`${name}: owner outside the player roster starts and sees ordinary spectator information`, async () => {
    const r = await runtime(name);
    try {
      assert.ok(r.state);
      const ownerView = await r.call("view", r.state, [], viewer(true));
      const normalView = await r.call("view", r.state, [], viewer(false));
      delete ownerView.state.canConfigure;
      delete normalView.state.canConfigure;
      assert.deepEqual(
        ownerView,
        normalView,
        "host status does not reveal extra game information",
      );
      const action = await r.call(
        "on_action",
        r.state,
        { type: "play", row: 1, column: 1 },
        actor("observer", true),
      );
      assert.equal(
        action.accepted,
        false,
        "spectating host cannot make player moves",
      );
      const left = await r.call(
        "on_player_left",
        r.state,
        actor("observer", true),
      );
      assert.deepEqual(
        left.state,
        r.state,
        "spectating host leaving does not forfeit a player",
      );
    } finally {
      r.close();
    }
  });
}
for (const name of ["go", "gomoku"]) {
  test(`${name}: spectating host configures and starts; ownership changes update configuration permissions`, async () => {
    const r = await runtime(name);
    try {
      const configured = await r.call(
        "on_action",
        r.state,
        {
          type: "update_settings",
          size: name === "go" ? 9 : 15,
          blackMode: "player1",
          forbiddenMoves: false,
          komi: 6.5,
          handicap: 0,
          rules: "chinese",
        },
        actor("observer", true),
      );
      assert.equal(configured.accepted, true);
      const denied = await r.call(
        "on_action",
        configured.state,
        { type: "start" },
        actor("observer", false),
      );
      assert.equal(denied.accepted, false);
      const started = await r.call(
        "on_action",
        configured.state,
        {
          type: "start",
          size: name === "go" ? 9 : 15,
          blackMode: "player1",
          forbiddenMoves: false,
          komi: 6.5,
          handicap: 0,
          rules: "chinese",
        },
        actor("observer", true),
      );
      assert.equal(started.accepted, true);
      const illegal = await r.call(
        "on_action",
        started.state,
        { type: "play", row: 1, column: 1 },
        actor("observer", true),
      );
      assert.equal(illegal.accepted, false);
      const legal = await r.call(
        "on_action",
        started.state,
        { type: "play", row: 1, column: 1 },
        actor("p1", false, "player"),
      );
      assert.equal(legal.accepted, true);
      const newOwner = await r.call("view", configured.state, [], {
        ...viewer(true),
        viewer: { id: "new-observer", role: "spectator", isOwner: true },
      });
      assert.equal(newOwner.state.canConfigure, true);
    } finally {
      r.close();
    }
  });
}
test("werewolf-dealer: spectating host deals, sees no private roles and cannot vote as a player", async () => {
  const r = await runtime("werewolf-dealer");
  try {
    const config = {
      name: "Test",
      roles: [{ id: "villager", name: "村民", count: r.players.length }],
    };
    const dealt = await r.call(
      "on_action",
      r.state,
      { type: "deal", config },
      actor("observer", true),
    );
    assert.equal(dealt.accepted, true);
    const visible = await r.call("view", dealt.state, [], viewer(true));
    assert.equal(Object.keys(visible.state.roles).length, 0);
    const voted = await r.call(
      "on_action",
      dealt.state,
      { type: "vote", target: "p1" },
      actor("observer", true),
    );
    assert.equal(voted.accepted, false);
  } finally {
    r.close();
  }
});
