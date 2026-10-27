import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import { createMahjongEffectRunner } from "../games/mahjong/app/effect-runner.js";
import { createMahjongTableController } from "../games/mahjong/app/table-controller.js";
import { confirmedTenpaiSummary } from "../games/mahjong/rules/game-format.js";

function createController({
  onDispatch = () => {},
  matchMusicUrl = "",
  riichiMusicUrl = "",
  matchMusicController,
  activeGame = false,
  mode = "solo",
  humanId = "human",
  elements = {},
  onShowMatchSummary,
} = {}) {
  const calls = [];
  const domOptions = [];
  const selectionOptions = [];
  const tenpaiPreviewCalls = [];
  const game = activeGame ? {} : undefined;
  const music = matchMusicController ?? {
    gain: 1,
    sync() {},
    applyVolume() {},
    suspend() {},
  };
  const controller = createMahjongTableController({
    document: { baseURI: "https://example.com/mahjong/" },
    window: {
      setTimeout,
      clearTimeout,
      requestAnimationFrame(callback) {
        callback();
      },
    },
    elements,
    domView: {
      visualUi(_playerName, selectedTileId) {
        return selectedTileId ? { selectedTileId } : {};
      },
      render(state, _events, _selectedTileId, _playerName, options) {
        domOptions.push(options);
        calls.push(["dom", state.moveCount]);
      },
      renderSelection(_state, tileId, _playerName, options) {
        calls.push(["selection", tileId]);
        selectionOptions.push(options);
        return {};
      },
      renderTenpaiPreview(_state, tenpai) {
        tenpaiPreviewCalls.push({ tenpai });
      },
    },
    visualRenderer: {
      render(state, _events, ui) {
        calls.push(["scene", state.moveCount, ui]);
      },
      updateSelection() {},
      resume() {},
    },
    resultHandRenderer: {
      render() {},
      resume() {},
      hide() {},
    },
    presentation: {
      kanDrawPending: false,
      handInsertion: null,
      resultVisible: true,
      drawRevealVisible: false,
      syncHandEnd() {},
      cancelHandInsertion() {},
      scheduleKanDraw() {},
      scheduleHandInsertion() {},
      handRevealSettled() {},
      suspend() {},
      destroy() {},
    },
    effectRunner: createMahjongEffectRunner({ onError() {} }),
    settingsDialog: { gameHintsEnabled: true, discardVolumeScale: 1 },
    matchMusicController: music,
    riverTileSound: { pause() {} },
    humanId,
    getGame: () => game,
    getGameInitializing: () => false,
    getMode: () => mode,
    getPlayerName: () => "你",
    playerNameIsAuthoritative: () => false,
    getThemeAssetUrl: () => "",
    getThemeDefaultNames: () => [],
    getThemeMatchMusicUrl: () => matchMusicUrl,
    getThemeRiichiMusicUrl: () => riichiMusicUrl,
    dispatch: onDispatch,
    onShowMatchSummary,
  });
  return {
    controller,
    calls,
    domOptions,
    selectionOptions,
    tenpaiPreviewCalls,
    music,
  };
}

test("finished-match summary can open a career grade reveal before rendering the ordinary ranking", async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<section id="result"><div id="track"></div><button id="continue"></button><section id="summary" hidden></section><button id="setup"></button></section>';
  const elements = { result: document.querySelector("#result"), resultTrack: document.querySelector("#track"), rematch: document.querySelector("#continue"), matchSummary: document.querySelector("#summary"), matchSummarySetup: document.querySelector("#setup") };
  const summaries = [];
  const { controller } = createController({ elements, onShowMatchSummary: (state) => { summaries.push(state); return true; } });
  try {
    await controller.refresh({ state: { phase: "hand_ended", matchEnded: true, draw: true, moveCount: 5, ownHand: [], players: ["human", "a", "b", "c"], legalActions: {} }, events: [] });
    assert.equal(summaries.length, 0);
    await controller.continueResult();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].matchEnded, true);
    assert.equal(elements.matchSummary.hidden, true);
  } finally { await window.happyDOM.close(); }
});

test("mahjong room spectator gets a fixed read-only table projection", async () => {
  const dispatched = [];
  const { controller, domOptions, calls } = createController({
    mode: "room",
    humanId: "watcher",
    onDispatch: (action) => {
      dispatched.push(action);
      return true;
    },
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      players: ["east", "south", "west", "north"],
      ownHand: [],
      handCounts: { east: 13, south: 13, west: 13, north: 13 },
      legalActions: { canDiscard: true },
    },
    events: [],
    viewer: { playerId: "watcher", role: "spectator" },
  });

  assert.equal(domOptions[0].readOnly, true);
  assert.equal(domOptions[0].isSpectator, true);
  assert.equal(domOptions[0].viewerSeat, 1);
  assert.deepEqual(calls.map(([kind]) => kind), ["dom", "scene"]);
  assert.equal(controller.discardOwnTile(41), false);
  assert.deepEqual(dispatched, []);
});

test("mahjong table controller publishes a projection before rendering it", async () => {
  const { controller, calls } = createController();
  const projection = {
    state: {
      phase: "playing",
      moveCount: 17,
      ownHand: [41],
      legalActions: {},
    },
    events: [],
  };

  await controller.refresh(projection);

  assert.equal(controller.getState(), projection.state);
  assert.deepEqual(calls, [
    ["dom", 17],
    ["scene", 17, {
      riichiMode: false,
      riichiCandidateTiles: [],
      showGameHints: true,
      revealPlayerIndices: [],
      coveredPlayerIndices: [],
      handRevealKey: "",
      animateHandReveal: false,
      handRevealDelay: 0,
      delayHandRevealForCallout: false,
      deferredHandInsertionSeat: 0,
      deferredHandInsertionIndex: 0,
      dealInKey: "",
      animateDealIn: false,
      readOnly: false,
      actionInFlight: false,
    }],
  ]);
});

test("mahjong replay mode keeps table actions read-only", async () => {
  const dispatched = [];
  const { controller, calls, domOptions } = createController({
    mode: "replay",
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      ownHand: [41],
      drawnTile: 42,
      legalActions: { canDiscard: true, canRiichi: true, riichiTiles: [42] },
    },
    events: [],
  });

  assert.equal(domOptions.at(-1).readOnly, true);
  assert.equal(calls.at(-1)[2].readOnly, true);
  assert.equal(controller.discardOwnTile(42), false);
  assert.equal(controller.enterRiichiMode(), false);
  assert.deepEqual(dispatched, []);
});

test("mahjong replay reveals every opponent hand relative to a non-East viewer", async () => {
  const { controller, calls } = createController({ mode: "replay" });
  await controller.refresh({
    state: {
      phase: "hand_ended",
      players: ["east", "south", "west", "north"],
      revealAllHands: true,
      viewerPlayerId: "west",
      viewerSeat: 3,
      ownHand: [],
      legalActions: {},
      scores: [25_000, 25_000, 25_000, 25_000],
    },
    viewer: { playerId: "west", seat: 3 },
    events: [],
  });

  const scene = calls.filter(([kind]) => kind === "scene").at(-1)[2];
  assert.deepEqual(scene.revealPlayerIndices, [1, 2, 4]);
  assert.equal(scene.revealPlayerIndices.includes(3), false);
});

test("mahjong table controller allows hand inspection without dispatching a turn action", async () => {
  const dispatched = [];
  const { controller, calls } = createController({
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [41],
      legalActions: { canDiscard: false },
    },
    events: [],
  });

  controller.selectTile(41);

  assert.deepEqual(dispatched, []);
  assert.deepEqual(calls.at(-1), ["selection", 41]);
});

test("mahjong clears a selected discard when an authoritative room projection removes it", async () => {
  const { controller, calls } = createController({ mode: "room" });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [41, 42],
      legalActions: { canDiscard: true },
    },
    events: [],
  });
  controller.selectTile(41);

  await controller.refresh({
    state: {
      phase: "claiming",
      moveCount: 3,
      ownHand: [42],
      legalActions: {},
    },
    events: [{ type: "discarded", playerIndex: 1, tile: 41 }],
  });

  const latestScene = calls.filter(([kind]) => kind === "scene").at(-1);
  assert.equal(latestScene[2].selectedTileId, undefined);
  calls.length = 0;
  controller.clearSelectedTile();
  assert.deepEqual(calls, []);
});

test("mahjong table controller submits the selected riichi tile", async () => {
  const dispatched = [];
  const { controller } = createController({
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [41],
      drawnTile: 42,
      legalActions: { canDiscard: true, canRiichi: true, riichiTiles: [42] },
    },
    events: [],
  });

  controller.enterRiichiMode();
  controller.discardOwnTile(42);

  assert.deepEqual(dispatched, [{ type: "riichi", tileId: 42 }]);
});

test("mahjong keeps the riichi wait visible while the room action is pending", async () => {
  const { controller, domOptions } = createController({ mode: "room" });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      turnIndex: 1,
      players: ["human"],
      ownHand: [41],
      drawnTile: 42,
      legalActions: {
        canDiscard: true,
        canRiichi: true,
        riichiTiles: [42],
        tenpaiDiscards: [
          {
            tileId: 42,
            furiten: false,
            waits: [{ type: 9, remaining: 4, noYaku: false }],
          },
        ],
      },
      discards: { human: [] },
      melds: { human: [] },
      doraIndicatorTiles: [],
    },
    events: [],
  });

  controller.enterRiichiMode();
  controller.discardOwnTile(42);

  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    waits: [{ type: 9, remaining: 4, noYaku: false }],
    furiten: false,
  });
});

test("mahjong hides room claim actions while a local claim decision is in flight", async () => {
  let resolveDispatch;
  const dispatched = [];
  const { controller, domOptions } = createController({
    mode: "room",
    onDispatch: (action) => {
      dispatched.push(action);
      return new Promise((resolve) => {
        resolveDispatch = resolve;
      });
    },
  });
  const state = {
    phase: "claiming",
    moveCount: 2,
    claimIndex: 1,
    players: ["human"],
    legalActions: { claims: [{ kind: "pon", option: 1 }] },
  };

  await controller.refresh({ state, events: [] });
  controller.submitAction({ type: "claim", option: 1 });
  assert.equal(domOptions.at(-1).actionInFlight, true);
  assert.deepEqual(dispatched, [{ type: "claim", option: 1 }]);

  await controller.refresh({ state: { ...state }, events: [] });
  assert.equal(domOptions.at(-1).actionInFlight, true);

  await controller.refresh({
    state: { ...state, phase: "playing", moveCount: 3, turnIndex: 1 },
    events: [],
  });
  assert.equal(domOptions.at(-1).actionInFlight, false);
  resolveDispatch?.(true);
});

test("mahjong restores room claim actions when the optimistic submission fails", async () => {
  const { controller, domOptions } = createController({
    mode: "room",
    onDispatch: () => false,
  });
  const state = {
    phase: "claiming",
    moveCount: 2,
    claimIndex: 1,
    players: ["human"],
    legalActions: { claims: [{ kind: "pon", option: 1 }] },
  };

  await controller.refresh({ state, events: [] });
  controller.submitAction({ type: "pass" });
  assert.equal(domOptions.at(-1).actionInFlight, false);
});

test("mahjong hides the room abort-nine action while its submission is in flight", async () => {
  let resolveDispatch;
  const { controller, domOptions } = createController({
    mode: "room",
    onDispatch: () =>
      new Promise((resolve) => {
        resolveDispatch = resolve;
      }),
  });
  const state = {
    phase: "playing",
    moveCount: 2,
    turnIndex: 1,
    players: ["human"],
    legalActions: { canAbortNine: true },
  };

  await controller.refresh({ state, events: [] });
  controller.submitAction({ type: "abort_nine" });
  assert.equal(domOptions.at(-1).actionInFlight, true);

  await controller.refresh({
    state: { ...state, phase: "hand_ended", moveCount: 3 },
    events: [],
  });
  assert.equal(domOptions.at(-1).actionInFlight, false);
  resolveDispatch?.(true);
});

test("mahjong keeps the optimistic riichi wait across a pre-confirmation state refresh", async () => {
  const dispatched = [];
  const { controller, domOptions, selectionOptions } = createController({
    mode: "room",
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      turnIndex: 1,
      players: ["human"],
      ownHand: [41],
      drawnTile: 42,
      riichi: { human: false },
      legalActions: {
        canDiscard: true,
        canRiichi: true,
        riichiTiles: [42],
        tenpaiDiscards: [
          {
            tileId: 42,
            furiten: false,
            waits: [{ type: 9, remaining: 4, noYaku: false }],
          },
        ],
      },
      discards: { human: [] },
      melds: { human: [] },
      doraIndicatorTiles: [],
    },
    events: [],
  });

  controller.enterRiichiMode();
  controller.discardOwnTile(42);
  await controller.refresh({
    state: {
      phase: "claiming",
      moveCount: 3,
      turnIndex: 2,
      players: ["human"],
      ownHand: [41],
      riichi: { human: false },
      legalActions: {},
      discards: { human: [{ type: 11, riichi: true }] },
      melds: { human: [] },
      doraIndicatorTiles: [],
    },
    events: [],
  });
  controller.beginConfirmedTenpaiPreview(3);

  assert.deepEqual(dispatched, [{ type: "riichi", tileId: 42 }]);
  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    waits: [{ type: 9, remaining: 4, noYaku: false }],
    furiten: false,
  });
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, {
    waits: [{ type: 9, remaining: 4, noYaku: false }],
    furiten: false,
  });
});

test("mahjong removes the optimistic riichi wait when the room rejects the action", async () => {
  const { controller, domOptions } = createController({ mode: "room" });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      turnIndex: 1,
      players: ["human"],
      ownHand: [41],
      drawnTile: 42,
      riichi: { human: false },
      legalActions: {
        canDiscard: true,
        canRiichi: true,
        riichiTiles: [42],
        tenpaiDiscards: [
          { tileId: 42, waits: [{ type: 9, remaining: 4, noYaku: false }] },
        ],
      },
      discards: { human: [] },
      melds: { human: [] },
      doraIndicatorTiles: [],
    },
    events: [],
  });

  controller.enterRiichiMode();
  controller.discardOwnTile(42);
  controller.rollbackPendingDiscard();

  assert.equal(domOptions.at(-1).confirmedTenpai, null);
});

test("mahjong keeps confirmed tenpai through remote draws and clears it on the next local turn", async () => {
  const dispatched = [];
  const { controller, domOptions, selectionOptions } = createController({
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      turnIndex: 1,
      players: ["human"],
      roundWind: 1,
      handNumber: 1,
      ownHand: [41],
      legalActions: {
        canDiscard: true,
        tenpaiDiscards: [
          {
            tileId: 41,
            furiten: false,
            waits: [{ type: 9, remaining: 3, noYaku: true }],
          },
        ],
      },
    },
    events: [],
  });

  controller.discardOwnTile(41);
  assert.deepEqual(dispatched, [{ type: "discard", tileId: 41 }]);
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 5,
      turnIndex: 2,
      ownHand: [],
      legalActions: {},
      discards: { self: [{ type: 11, claimed: false }] },
      melds: {},
      doraIndicatorTiles: [],
    },
    events: [],
  });

  assert.deepEqual(domOptions.at(-1).tenpaiPreview, null);
  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    waits: [{ type: 9, remaining: 3, noYaku: true }],
    furiten: false,
  });
  controller.beginConfirmedTenpaiPreview(7);
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, {
    waits: [{ type: 9, remaining: 3, noYaku: true }],
    furiten: false,
  });
  controller.endConfirmedTenpaiPreview(7);
  assert.equal(selectionOptions.at(-1).tenpaiPreview, null);

  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 6,
      turnIndex: 2,
      ownHand: [],
      legalActions: {},
      discards: { self: [{ type: 11, claimed: false }] },
      melds: {},
      doraIndicatorTiles: [],
    },
    events: [{ type: "drew", playerIndex: 2 }],
  });
  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    waits: [{ type: 9, remaining: 3, noYaku: true }],
    furiten: false,
  });

  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 7,
      turnIndex: 1,
      ownHand: [],
      drawnTile: 45,
      legalActions: { canDiscard: true },
    },
    events: [],
  });
  assert.equal(domOptions.at(-1).confirmedTenpai, null);
});

test("mahjong keeps a held riichi status through an automatic discard refresh", async () => {
  const { controller, domOptions, selectionOptions } = createController();
  const riichiTenpai = {
    waits: [{ type: 9, remaining: 3, noYaku: false }],
    furiten: false,
  };
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 5,
      turnIndex: 1,
      players: ["human"],
      riichi: { human: true },
      ownHand: [41],
      legalActions: { canDiscard: true },
    },
    events: [],
  });

  controller.applyRiichiTenpai(riichiTenpai);
  const expectedRiichiTenpai = {
    waits: [{ type: 9, noYaku: false }],
    furiten: false,
  };
  assert.deepEqual(domOptions.at(-1).confirmedTenpai, expectedRiichiTenpai);
  controller.beginConfirmedTenpaiPreview(17);
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, expectedRiichiTenpai);

  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 6,
      turnIndex: 2,
      players: ["human"],
      riichi: { human: true },
      ownHand: [41],
      legalActions: {},
    },
    events: [],
  });
  assert.deepEqual(domOptions.at(-1).tenpaiPreview, expectedRiichiTenpai);
  assert.equal(controller.endConfirmedTenpaiPreview(18), false);
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, expectedRiichiTenpai);
  assert.equal(controller.endConfirmedTenpaiPreview(17), true);
  assert.equal(selectionOptions.at(-1).tenpaiPreview, null);

  controller.applyRiichiTenpai({ ...riichiTenpai, furiten: true });
  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    ...expectedRiichiTenpai,
    furiten: true,
  });
});

test("mahjong keeps a locked riichi wait when a later worker report is temporarily empty", async () => {
  const { controller, domOptions, selectionOptions } = createController();
  const riichiTenpai = {
    tenpai: true,
    waits: [{ type: 9, noYaku: false }],
    furiten: false,
  };
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 5,
      turnIndex: 2,
      players: ["human"],
      riichi: { human: true },
      ownHand: [41],
      legalActions: {},
      discards: { human: [] },
      melds: { human: [] },
      doraIndicatorTiles: [],
    },
    events: [],
  });

  controller.applyRiichiTenpai(riichiTenpai);
  controller.beginConfirmedTenpaiPreview(9);
  controller.applyRiichiTenpai(null);

  assert.deepEqual(domOptions.at(-1).confirmedTenpai, {
    waits: [{ type: 9, noYaku: false }],
    furiten: false,
  });
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, {
    waits: [{ type: 9, noYaku: false }],
    furiten: false,
  });
});

test("mahjong clears a locked riichi wait at the hand boundary", async () => {
  const { controller, domOptions } = createController();
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 8,
      turnIndex: 2,
      players: ["human"],
      roundWind: 1,
      handNumber: 1,
      riichi: { human: true },
      ownHand: [41],
      legalActions: {},
    },
    events: [],
  });
  controller.applyRiichiTenpai({
    tenpai: true,
    waits: [{ type: 9, noYaku: false }],
  });

  await controller.refresh({
    state: {
      phase: "hand_ended",
      moveCount: 30,
      turnIndex: 1,
      players: ["human"],
      roundWind: 1,
      handNumber: 1,
      riichi: { human: true },
      ownHand: [],
      legalActions: {},
    },
    events: [{ type: "draw_game" }],
  });

  assert.equal(domOptions.at(-1).confirmedTenpai, null);
});

test("mahjong derives a riichi furiten badge from the private flag and public river", () => {
  const confirmedTenpai = { waits: [{ type: 9, noYaku: false }] };
  const baseState = {
    players: ["human"],
    ownHand: [],
    discards: { human: [] },
    melds: {},
    doraIndicatorTiles: [],
  };

  assert.equal(
    confirmedTenpaiSummary(
      { ...baseState, selfRiichiFuriten: true },
      confirmedTenpai,
    ).furiten,
    true,
  );
  assert.equal(
    confirmedTenpaiSummary(
      {
        ...baseState,
        discards: { human: [{ type: 9, claimed: true }] },
      },
      confirmedTenpai,
    ).furiten,
    true,
  );
  assert.equal(confirmedTenpaiSummary(baseState, confirmedTenpai).furiten, false);
});

test("mahjong keeps the selected discard's tenpai preview alongside the held status preview", async () => {
  const { controller, selectionOptions, domOptions } = createController();
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      turnIndex: 1,
      ownHand: [41, 42],
      legalActions: {
        canDiscard: true,
        tenpaiDiscards: [
          {
            tileId: 42,
            furiten: true,
            waits: [{ type: 9, remaining: 3, noYaku: true }],
          },
        ],
      },
    },
    events: [],
  });

  controller.selectTile(42);
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, {
    waits: [{ type: 9, remaining: 3, noYaku: true }],
    furiten: true,
  });
  controller.clearSelectedTile();
  assert.equal(selectionOptions.at(-1).tenpaiPreview, null);
  assert.equal(domOptions.at(-1).tenpaiPreview, null);
});

test("mahjong restores the selected preview after dragging another discard", async () => {
  const { controller, selectionOptions } = createController();
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      turnIndex: 1,
      ownHand: [41, 42],
      legalActions: {
        canDiscard: true,
        tenpaiDiscards: [
          {
            tileId: 41,
            furiten: false,
            waits: [{ type: 9, remaining: 3, noYaku: true }],
          },
          {
            tileId: 42,
            furiten: true,
            waits: [{ type: 28, remaining: 2, noYaku: false }],
          },
        ],
      },
    },
    events: [],
  });

  controller.selectTile(42);
  controller.beginDraggedTilePreview(41);
  controller.endDraggedTilePreview();

  assert.deepEqual(selectionOptions.at(-2).tenpaiPreview, {
    waits: [{ type: 9, remaining: 3, noYaku: true }],
    furiten: false,
  });
  assert.deepEqual(selectionOptions.at(-1).tenpaiPreview, {
    waits: [{ type: 28, remaining: 2, noYaku: false }],
    furiten: true,
  });
});

test("mahjong clears a dragged discard preview while waiting for room confirmation", async () => {
  const { controller, domOptions } = createController({ mode: "room" });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 4,
      turnIndex: 1,
      players: ["human"],
      roundWind: 1,
      handNumber: 1,
      ownHand: [41],
      legalActions: {
        canDiscard: true,
        tenpaiDiscards: [
          {
            tileId: 41,
            furiten: false,
            waits: [{ type: 9, remaining: 3, noYaku: true }],
          },
        ],
      },
    },
    events: [],
  });

  controller.beginDraggedTilePreview(41);
  controller.discardOwnTile(41);

  assert.equal(domOptions.at(-1).tenpaiPreview, null);
  assert.equal(domOptions.at(-1).hideCountdown, true);
});

test("mahjong keeps the current match track unchanged when riichi music is not configured", async () => {
  const musicCalls = [];
  const { controller } = createController({
    matchMusicUrl: "match.mp3",
    activeGame: true,
    matchMusicController: {
      gain: 1,
      sync(target, options) {
        musicCalls.push([target, options]);
      },
      applyVolume() {},
      suspend() {},
    },
  });
  await controller.refresh({
    state: { phase: "playing", moveCount: 1, ownHand: [], legalActions: {} },
    events: [],
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [],
      legalActions: {},
      riichi: { opponent: true },
    },
    events: [{ type: "riichi" }],
  });

  assert.deepEqual(musicCalls, [
    [
      { mode: "playing", source: "https://example.com/mahjong/match.mp3" },
      { fadeIn: false, fadeOut: false },
    ],
    [
      { mode: "playing", source: "https://example.com/mahjong/match.mp3" },
      { fadeIn: true, fadeOut: false, fadeOutBeforeSource: true },
    ],
  ]);
});
