import assert from "node:assert/strict";
import test from "node:test";
import { createMahjongSoloMatchController } from "../games/mahjong/app/solo-match-controller.js";
import { createMahjongSoloSave } from "../games/mahjong/replay/solo-save.js";

function fixture(matchType, { failReplay = false } = {}) {
  const save = createMahjongSoloSave({
    randomSeed: "0123456789abcdef0123456789abcdef",
    matchId: "saved-match",
    matchType,
    rules: { kuitan: true },
    playerName: "存档玩家",
    actions: [{ actorId: "human", action: { type: "discard", tileId: "saved-tile" } }],
  });
  const calls = [];
  let game;
  let initializing = false;
  const projection = { state: { phase: "playing" } };
  const restored = {
    async replayActions(actions) {
      calls.push(["replay", actions]);
      if (failReplay) throw new Error("restore failed");
      return { projection };
    },
    close() { calls.push(["close"]); },
  };
  const elements = {
    loading: { classList: { remove() {} }, hidden: true },
    loadingMessage: {}, loadingSpinner: {}, setup: { hidden: false },
    app: { setAttribute() {} },
  };
  const controller = createMahjongSoloMatchController({
    elements,
    getGame: () => game, setGame: (next) => { game = next; },
    getGameInitializing: () => initializing,
    setGameInitializing: (next) => { initializing = next; },
    getSoloSave: () => save,
    setSoloSave: () => assert.fail("must not replace saved match"),
    getPlayerName: () => "新玩家",
    setPlayerName: (name) => calls.push(["name", name]),
    setAutoActions() {}, syncAutoActionControls() {},
    tableController: {
      async refresh(value) { calls.push(["refresh", value]); },
      syncMatchMusic() {}, reset() {},
    },
    themeController: { async applyMatchPortraits() {} },
    settingsDialog: { setSoloMatchActive() {}, setEndMatchLabel() {} },
    visualRendererReady: Promise.resolve(),
    beginSetupExit: async () => { calls.push(["exit"]); },
    selectedMatchRules: () => assert.fail("must use saved rules"),
    scheduleAi: () => calls.push(["ai"]),
    showSetup: () => { elements.setup.hidden = false; },
    showSetupRecoveryError: (message) => calls.push(["error", message]),
    async createGame(options) { calls.push(["create", options]); return restored; },
  });
  return { controller, calls, save, elements, restored, getGame: () => game,
    isInitializing: () => initializing, projection };
}

for (const matchType of ["east", "hanchan"]) {
  test(`Mahjong waits for the ${matchType} lobby button before resuming its save`, async () => {
    const f = fixture(matchType);
    assert.equal(f.save.matchType, matchType);
    assert.deepEqual(f.calls, []);
    await f.controller.initialize(matchType === "east" ? "hanchan" : "east");
    assert.deepEqual(f.calls, []);
    await f.controller.initialize(matchType);
    const options = f.calls.find(([name]) => name === "create")[1];
    assert.equal(options.matchId, f.save.matchId);
    assert.equal(options.randomSeed, f.save.randomSeed);
    assert.equal(options.settings.matchType, matchType);
    assert.deepEqual(options.settings.rules, f.save.rules);
    assert.deepEqual(f.calls.find(([name]) => name === "replay")[1], f.save.actions);
    assert.deepEqual(f.calls.find(([name]) => name === "refresh")[1], f.projection);
    assert.equal(f.getGame(), f.restored);
    assert.equal(f.elements.setup.hidden, true);
    const count = f.calls.length;
    await f.controller.initialize(matchType);
    assert.equal(f.calls.length, count);
  });
}

test("a failed Mahjong restore returns to the lobby and keeps the save for retry", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture("east", { failReplay: true });
  await f.controller.initialize("east");
  assert.equal(f.getGame(), undefined);
  assert.equal(f.isInitializing(), false);
  assert.equal(f.elements.setup.hidden, false);
  assert.ok(f.calls.some(([name]) => name === "close"));
  assert.ok(f.calls.some(([name, message]) => name === "error" && message === "restore failed"));
  await f.controller.initialize("east");
  assert.equal(f.calls.filter(([name]) => name === "create").length, 2);
});
