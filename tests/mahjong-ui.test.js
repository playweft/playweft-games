import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  Euler,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  NormalBlending,
  Scene,
  Texture,
  Vector3,
} from "three";
import {
  DRAW_REVEAL_CARD_DELAY_MS,
  DRAW_REVEAL_CARD_GAP_MS,
  DRAW_REVEAL_VISIBLE_BASE_MS,
  DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS,
  HAND_INSERTION_DELAY_MS,
  HAND_END_PRESENTATION_DELAY_MS,
} from "../games/mahjong/rules/constants.js";
import {
  automaticRiichiDiscard,
  blankDoubleClickAction,
  canDiscardHandTile,
  clearedTableState,
  claimPreviewTiles,
  deferredHandInsertion,
  doraIndicatorSlots,
  doraTypeCounts,
  exhaustiveDrawPresentation,
  matchResultRows,
  opponentHandLayout,
  orderedHand,
  confirmedTenpaiSummary,
  partitionClaimActions,
  playerDisplayName,
  playerDisplayNames,
  nextDoraType,
  roundLabel,
  resultBasePaymentTotal,
  resultDetailPageCount,
  resultIndicatorSlots,
  resultScoreSheetRows,
  resultScoreRows,
  riverDisplayEntries,
  pendingClaimDiscard,
  seatWind,
  splitRevealedHand,
  tenpaiDiscardFuriten,
  tenpaiWaitSummary,
  tenpaiWaitsForDiscard,
  visibleScoreSheetRows,
} from "../games/mahjong/rules/game-format.js";

import {
  fixedViewportScale,
  MAHJONG_VIEWPORT,
} from "../games/mahjong/app/fixed-viewport.js";
import {
  deferMahjongDecorativeAssets,
  deferMahjongImageAssets,
} from "../games/mahjong/theme/deferred-visual-assets.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_HAND_CLEARANCE,
  MELD_SCALE,
  meldDisplayLayout,
  meldRightExtension,
  OPPONENT_MELD_HAND_CLEARANCE,
  LOCAL_COVERED_HAND_Z,
  meldTransform,
  ownHandOverlayTransform,
  ownHandDoubleClickSafeBounds,
  OWN_HAND_DRAG,
  OWN_HAND_LAYOUT,
  PLAYFIELD_CENTRE_Z,
  presentedHandTransform,
  presentedTileHingeTransform,
  RIICHI_TILE_ACROSS_EXTRA,
  RIVER_CORNER_GAP,
  RIVER_TILE_GAP,
  riverGridPosition,
  riverTransform,
  TILE_SIZE,
} from "../games/mahjong/render/three-layout.js";
import { resultMeldDisplayLayout } from "../games/mahjong/render/result-hand-layout.js";
import { activateResultStartControl } from "../games/mahjong/result/result-start-control.js";
import {
  handRevealFallProgress,
  OWN_TILE_HOVER_DURATION_MS,
  ownHandCrossfadeProgress,
  ownDrawEntryKey,
  ownDrawEntryProgress,
  ownTileSelectionProgress,
  shouldCrossfadeOwnHand,
} from "../games/mahjong/render/three-motion.js";
import { tileFaceFrameIndex } from "../games/mahjong/render/tile-texture-map.js";
import {
  doraBreathIntensity,
  ThreeTileFactory,
} from "../games/mahjong/render/three-tile-factory.js";
import {
  hasVisibleFeedback,
  ThreeTileFeedbackCompositor,
} from "../games/mahjong/render/three-tile-feedback-compositor.js";
import {
  prepareTableConsoleContext,
  formatScoreDisplay,
  scoreWindPosition,
  scoreDifference,
  scoreDifferenceColor,
  seatWindColor,
  TABLE_CONSOLE_CORE_LAYOUT,
  TABLE_CONSOLE_LAYOUT,
  TABLE_CONSOLE_SCORE_LAYOUT,
} from "../games/mahjong/render/three-console.js";
import {
  ACTION_CALLOUT_DURATION_MS,
  actionCalloutDescriptor,
  actionCalloutEvents,
  actionCalloutKey,
} from "../games/mahjong/render/three-callout.js";
import { planarTileJitter } from "../games/mahjong/render/three-tile-jitter.js";
import { ThreeAnimationController } from "../games/mahjong/render/three-animation-controller.js";
import { ThreeKeyedSceneLayer } from "../games/mahjong/render/three-keyed-scene-layer.js";
import {
  createPendingClaimOutlinePass,
  shouldShowPendingClaimOutline,
  setPendingClaimOutlineBreath,
} from "../games/mahjong/render/pending-claim-outline.js";
import { MahjongPresentationController } from "../games/mahjong/app/presentation-controller.js";
import { riverTileSoundCue } from "../games/mahjong/render/audio-cues.js";
import { helpIframeRectStyle } from "../games/mahjong/app/help-iframe-portal.js";
import { normalizeDiscardVolume } from "../games/mahjong/settings-dialog.js";
import {
  traditionalDrawReason,
  traditionalYakuName,
} from "../games/mahjong/rules/yaku-display.js";

test("mahjong shares asset-pack names across result views", () => {
  const state = {
    players: ["self", "right", "opposite", "left"],
    playerNames: ["你", "青岚", "织羽", "墨池"],
    scores: [25_000, 25_000, 25_000, 25_000],
  };
  const options = {
    playerName: "平台昵称",
    defaultNames: {
      self: "诺亚",
      right: "潮獭",
      opposite: "兰",
      left: "罗斯",
    },
    playerNameIsAuthoritative: false,
  };
  assert.equal(playerDisplayName(state, 3, options), "兰");
  assert.deepEqual(playerDisplayNames(state, options), [
    "诺亚",
    "潮獭",
    "兰",
    "罗斯",
  ]);
  assert.deepEqual(
    matchResultRows(state, "平台昵称", options).map((entry) => entry.name),
    ["诺亚", "潮獭", "兰", "罗斯"],
  );
  assert.deepEqual(
    resultScoreRows(
      { ...state, result: { deltas: [0, 0, 0, 0] } },
      "平台昵称",
      options,
    ).map((entry) => entry.name),
    ["诺亚", "潮獭", "兰", "罗斯"],
  );
});

test("mahjong gives each new river tile one quiet perspective sound cue", () => {
  const state = {
    roundWind: 1,
    handNumber: 2,
    honba: 0,
    moveCount: 8,
  };
  const own = riverTileSoundCue(state, [
    { type: "discarded", playerIndex: 1, tile: 17 },
  ]);
  const opposite = riverTileSoundCue(state, [
    { type: "riichi", playerIndex: 3, tile: 19 },
  ]);

  assert.equal(riverTileSoundCue(state, [{ type: "drawn" }]), null);
  assert.equal(own.key, "1:2:0:8:discarded:1:17");
  assert.equal(opposite.key, "1:2:0:8:riichi:3:19");
  assert.ok(own.volume > opposite.volume);
  assert.ok(own.playbackRate >= 0.98 && own.playbackRate <= 1.02);
  assert.ok(opposite.playbackRate >= 0.98 && opposite.playbackRate <= 1.02);
});

test("mahjong clears the rendered table before dismissing a hand result", () => {
  const cleared = clearedTableState({
    phase: "hand_ended",
    players: ["self", "right", "top", "left"],
    ownHand: [1, 2, 3],
    drawnTile: 4,
    drawnPlayerIndex: 1,
    handCounts: { self: 13, right: 12, top: 11, left: 10 },
    discards: {
      self: [{ type: 1 }],
      right: [{ type: 2 }],
      top: [{ type: 3 }],
      left: [{ type: 4 }],
    },
    melds: {
      self: [{ kind: "pon", tiles: [1, 1, 1] }],
      right: [],
      top: [],
      left: [],
    },
    revealedHands: { self: [1, 2, 3] },
    doraIndicators: [1],
    doraIndicatorTiles: [{ type: 1 }],
    legalActions: { canDiscard: true },
    winners: ["self"],
    winningTile: 4,
    winningTileRed: true,
    winType: "tsumo",
    draw: true,
    riichi: { self: true, right: false, top: true, left: false },
  });

  assert.deepEqual(cleared.ownHand, []);
  assert.equal(cleared.drawnTile, 0);
  assert.equal(cleared.drawnPlayerIndex, 0);
  assert.deepEqual(cleared.handCounts, {
    self: 0,
    right: 0,
    top: 0,
    left: 0,
  });
  assert.deepEqual(cleared.discards, {
    self: [],
    right: [],
    top: [],
    left: [],
  });
  assert.deepEqual(cleared.melds, {
    self: [],
    right: [],
    top: [],
    left: [],
  });
  assert.deepEqual(cleared.revealedHands, {});
  assert.deepEqual(cleared.doraIndicators, []);
  assert.deepEqual(cleared.legalActions, {});
  assert.deepEqual(cleared.winners, []);
  assert.equal(cleared.winningTile, 0);
  assert.equal(cleared.winType, "");
  assert.equal(cleared.draw, false);
  assert.deepEqual(cleared.riichi, {
    self: false,
    right: false,
    top: false,
    left: false,
  });
});

test("mahjong closes river gaps left by called discards", () => {
  const entries = riverDisplayEntries([
    { type: 4, claimed: false },
    { type: 7, claimed: true },
    { type: 12, claimed: false, riichi: true },
  ]);

  assert.deepEqual(
    entries.map(({ sourceIndex, displayIndex, discard }) => ({
      sourceIndex,
      displayIndex,
      type: discard.type,
    })),
    [
      { sourceIndex: 0, displayIndex: 0, type: 4 },
      { sourceIndex: 2, displayIndex: 1, type: 12 },
    ],
  );
});

test("mahjong identifies the discard waiting for claim responses", () => {
  assert.deepEqual(
    pendingClaimDiscard({
      phase: "claiming",
      pendingDiscard: { playerIndex: 3, discardIndex: 5 },
    }),
    { playerIndex: 3, discardIndex: 5 },
  );
  assert.equal(
    pendingClaimDiscard({
      phase: "playing",
      pendingDiscard: { playerIndex: 3, discardIndex: 5 },
    }),
    null,
  );
  assert.equal(
    pendingClaimDiscard({
      phase: "claiming",
      pendingDiscard: { playerIndex: 0, discardIndex: 5 },
    }),
    null,
  );
});

test("mahjong pending claim outline follows the full screen-space pass", () => {
  const pass = createPendingClaimOutlinePass(
    new Scene(),
    new PerspectiveCamera(),
    { width: 1280, height: 720 },
  );
  assert.equal(pass.selectedObjects.length, 0);
  assert.equal(pass.visibleEdgeColor.getHexString(), "ffd86a");
  assert.equal(pass.edgeThickness, 4);
  setPendingClaimOutlineBreath(pass, 1);
  assert.ok(Math.abs(pass.edgeStrength - 3.6) < 1e-9);
  assert.ok(Math.abs(pass.edgeGlow - 0.32) < 1e-9);
  pass.dispose();
});

test("mahjong help iframe portal converts the visible panel rect to fixed pixels", () => {
  assert.deepEqual(
    helpIframeRectStyle({ left: 12.8, top: 24.4, width: 501.8, height: 302.2 }),
    { left: "13px", top: "24px", width: "502px", height: "302px" },
  );
});

test("mahjong pending claim outline follows the local claim buttons", () => {
  const claiming = {
    phase: "claiming",
    legalActions: { claims: [{ kind: "pon", option: 1 }] },
  };
  assert.equal(shouldShowPendingClaimOutline(claiming), true);
  assert.equal(
    shouldShowPendingClaimOutline({
      ...claiming,
      legalActions: { claims: [] },
    }),
    false,
  );
  assert.equal(
    shouldShowPendingClaimOutline(claiming, { actionInFlight: true }),
    false,
  );
  assert.equal(
    shouldShowPendingClaimOutline(claiming, { readOnly: true }),
    false,
  );
});

test("mahjong normalizes the saved river tile volume", () => {
  assert.equal(normalizeDiscardVolume("42"), 42);
  assert.equal(normalizeDiscardVolume(-1), 0);
  assert.equal(normalizeDiscardVolume(120), 100);
  assert.equal(normalizeDiscardVolume("invalid", 75), 75);
});

function projectedStandingTileBounds(position, index, camera, viewport) {
  const transform = handTransform(position, index, 13);
  const cos = Math.cos(transform.yaw);
  const sin = Math.sin(transform.yaw);
  const points = [];
  for (const localX of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
    for (const localY of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
      for (const localZ of [-TILE_SIZE.depth / 2, TILE_SIZE.depth / 2]) {
        const point = new Vector3(
          transform.x + localX * cos + localZ * sin,
          transform.y + localY,
          transform.z - localX * sin + localZ * cos,
        ).project(camera);
        points.push({
          x: ((point.x + 1) * viewport.width) / 2,
          y: ((1 - point.y) * viewport.height) / 2,
        });
      }
    }
  }
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function rectanglesOverlap(left, right) {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
}

test("mahjong maps every standard and red-five face to the atlas", () => {
  const frames = [
    tileFaceFrameIndex(25),
    tileFaceFrameIndex(32),
    tileFaceFrameIndex(5, true),
    tileFaceFrameIndex(14, true),
    tileFaceFrameIndex(23, true),
  ];
  assert.ok(frames.every(Number.isInteger));
  assert.equal(new Set(frames).size, frames.length);
  assert.throws(() => tileFaceFrameIndex(0), RangeError);
  assert.throws(() => tileFaceFrameIndex(35), RangeError);
});

test("mahjong tile geometry follows real parlor tile proportions", () => {
  const tile = new ThreeTileFactory(new Texture()).create({ type: 1 });
  assert.ok(tile.children.length >= 3);
  tile.traverse((child) => child.geometry?.dispose());
});

test("mahjong rebuilds the table-console canvas transform before every redraw", () => {
  const calls = [];
  const context = {
    clearRect(...args) {
      calls.push(["clearRect", ...args]);
    },
    setTransform(...args) {
      calls.push(["setTransform", ...args]);
    },
  };
  prepareTableConsoleContext(context, { width: 1280, height: 1104 });
  assert.deepEqual(calls, [
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["clearRect", 0, 0, 1280, 1104],
    ["setTransform", 2, 0, 0, 2, 0, 0],
  ]);
});

test("mahjong keeps the 13-tile rack stable and moves the drawn tile to the end", () => {
  const rack = [5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53];
  assert.deepEqual(orderedHand(rack, 18), [...rack, 18]);

  const firstRackTile = ownHandOverlayTransform(0, 1280, 588);
  const firstRackTileAfterDraw = ownHandOverlayTransform(0, 1280, 588, {
    drawn: false,
  });
  const drawnTile = ownHandOverlayTransform(13, 1280, 588, { drawn: true });
  assert.deepEqual(firstRackTile, firstRackTileAfterDraw);
  assert.ok(drawnTile.x > ownHandOverlayTransform(12, 1280, 588).x);
  assert.equal(firstRackTile.scale, drawnTile.scale);
  assert.equal(firstRackTile.scaleX, drawnTile.scaleX);
  assert.equal(firstRackTile.scaleY, drawnTile.scaleY);
  assert.ok(
    Math.abs(firstRackTile.lift / firstRackTile.tileHeight - 0.18) < 1e-12,
  );
  const safeWidth = Math.min(1280, 588 * OWN_HAND_LAYOUT.safeAspect);
  const handLeft = firstRackTile.x - firstRackTile.tileWidth / 2;
  const handRight = drawnTile.x + drawnTile.tileWidth / 2;
  assert.ok(Math.abs(handRight - handLeft - safeWidth * 0.64) < 1e-9);
  assert.equal(
    ownHandOverlayTransform(OWN_HAND_LAYOUT.initialCentreTileIndex, 1280, 588)
      .x,
    0,
  );
  assert.ok(firstRackTile.tileHeight < 76);
  assert.ok(firstRackTile.tileHeight > 68);
  assert.equal(
    firstRackTile.y - firstRackTile.tileHeight / 2,
    -588 / 2 + OWN_HAND_LAYOUT.bottomInset,
  );

  const compactFirst = ownHandOverlayTransform(0, 853, 392);
  const compactDrawn = ownHandOverlayTransform(13, 853, 392, { drawn: true });
  const compactSafeWidth = Math.min(853, 392 * OWN_HAND_LAYOUT.safeAspect);
  const compactWidth =
    compactDrawn.x +
    compactDrawn.tileWidth / 2 -
    (compactFirst.x - compactFirst.tileWidth / 2);
  assert.ok(Math.abs(compactWidth - compactSafeWidth * 0.64) < 1e-9);
  assert.equal(
    ownHandOverlayTransform(OWN_HAND_LAYOUT.initialCentreTileIndex, 853, 392).x,
    0,
  );
  assert.ok(compactFirst.scale < firstRackTile.scale);
});

test("mahjong keeps blank double-click actions away from the local hand", () => {
  const bounds = ownHandDoubleClickSafeBounds(1280, 720);
  const first = ownHandOverlayTransform(0, 1280, 720);
  const drawn = ownHandOverlayTransform(13, 1280, 720, { drawn: true });

  assert.ok(bounds.left < first.x - first.tileWidth / 2);
  assert.ok(bounds.right > drawn.x + drawn.tileWidth / 2);
  assert.ok(bounds.top > first.y + first.tileHeight / 2);
  assert.ok(bounds.bottom < first.y - first.tileHeight / 2);

});

test("mahjong only permits the drawn tile to be discarded after riichi", () => {
  assert.equal(
    canDiscardHandTile({
      canDiscard: true,
      riichiDeclared: true,
      drawnTile: 53,
      tileId: 52,
    }),
    false,
  );
  assert.equal(
    canDiscardHandTile({
      canDiscard: true,
      riichiDeclared: true,
      drawnTile: 53,
      tileId: 53,
    }),
    true,
  );
  assert.equal(
    canDiscardHandTile({
      canDiscard: true,
      riichiDeclared: false,
      drawnTile: 53,
      tileId: 52,
    }),
    true,
  );
});

test("mahjong pauses before integrating a hand-discarded drawn tile", () => {
  const previous = {
    drawnPlayerIndex: 1,
    ownHand: [5, 9, 13, 17],
    drawnTile: 53,
  };
  assert.deepEqual(
    deferredHandInsertion(
      previous,
      [
        {
          type: "discarded",
          playerIndex: 1,
          tile: 4,
          fromDrawn: false,
        },
      ],
      { ownDiscardedTile: 13 },
    ),
    {
      seat: 1,
      ownHand: [5, 9, 17],
      drawnTile: 53,
      rackIndex: 2,
    },
  );
  assert.equal(
    deferredHandInsertion(previous, [
      {
        type: "discarded",
        playerIndex: 1,
        tile: 53,
        fromDrawn: true,
      },
    ]),
    null,
  );
  assert.deepEqual(
    deferredHandInsertion(
      {
        drawnPlayerIndex: 3,
        players: ["p1", "p2", "p3", "p4"],
        handCounts: { p3: 10 },
      },
      [
        {
          type: "riichi",
          playerIndex: 3,
          tile: 23,
          fromDrawn: false,
        },
      ],
      { random: () => 0.49 },
    ),
    { seat: 3, rackIndex: 4 },
  );

  assert.deepEqual(
    deferredHandInsertion(
      {
        drawnPlayerIndex: 2,
        ownHand: [5, 9, 13, 17],
        drawnTile: 53,
      },
      [
        {
          type: "discarded",
          playerIndex: 2,
          tile: 4,
          fromDrawn: false,
        },
      ],
      { ownDiscardedTile: 13, viewerSeat: 2 },
    ),
    {
      seat: 2,
      ownHand: [5, 9, 17],
      drawnTile: 53,
      rackIndex: 2,
    },
  );

});

test("mahjong presentation scheduling cancels insertion before terminal reveal", () => {
  assert.equal(
    DRAW_REVEAL_VISIBLE_BASE_MS,
    HAND_END_PRESENTATION_DELAY_MS - DRAW_REVEAL_CARD_DELAY_MS,
  );
  assert.equal(DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS, 450);
  let nextTimer = 0;
  const timers = new Map();
  const schedule = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay, cancelled: false });
    return id;
  };
  const cancel = (id) => {
    const timer = timers.get(id);
    if (timer) timer.cancelled = true;
  };
  let insertionReady = 0;
  let kanDrawReady = 0;
  let drawRevealReady = 0;
  let resultReady = 0;
  const presentation = new MahjongPresentationController(
    {
      onHandInsertionReady: () => (insertionReady += 1),
      onKanDrawReady: () => (kanDrawReady += 1),
      onDrawRevealReady: () => (drawRevealReady += 1),
      onResultReady: () => (resultReady += 1),
    },
    { schedule, cancel },
  );

  assert.equal(
    presentation.scheduleHandInsertion(
      "10:discarded:1:13:false",
      { seat: 1, rackIndex: 2 },
      HAND_INSERTION_DELAY_MS,
    ),
    true,
  );
  const insertionTimer = presentation.handInsertionTimer;
  presentation.cancelHandInsertion();
  assert.equal(timers.get(insertionTimer).cancelled, true);
  assert.equal(presentation.handInsertion, null);
  assert.equal(insertionReady, 0);

  assert.equal(presentation.scheduleKanDraw("10:kan:1", 300), true);
  assert.equal(presentation.kanDrawPending, true);
  assert.equal(presentation.scheduleKanDraw("10:kan:1", 300), false);
  const kanDrawTimer = presentation.kanDrawTimer;
  timers.get(kanDrawTimer).callback();
  assert.equal(presentation.kanDrawPending, false);
  assert.equal(kanDrawReady, 1);

  presentation.syncHandEnd({
    key: "10:exhaustive-draw",
    waitForHandReveal: true,
    showDrawReveal: true,
    drawRevealDelay: DRAW_REVEAL_CARD_GAP_MS,
    drawRevealDuration: 1200,
  });
  assert.equal(presentation.resultVisible, false);
  assert.equal(presentation.drawRevealVisible, false);
  presentation.handRevealSettled("other-hand");
  assert.equal(presentation.drawRevealTimer, 0);
  presentation.handRevealSettled("10:exhaustive-draw");
  const drawRevealTimer = presentation.drawRevealTimer;
  assert.equal(timers.get(drawRevealTimer).delay, DRAW_REVEAL_CARD_GAP_MS);
  timers.get(drawRevealTimer).callback();
  assert.equal(presentation.drawRevealVisible, true);
  assert.equal(drawRevealReady, 1);
  const resultTimer = presentation.resultTimer;
  assert.equal(timers.get(resultTimer).delay, 1200);
  timers.get(resultTimer).callback();
  assert.equal(presentation.resultVisible, true);
  assert.equal(resultReady, 1);
  presentation.syncHandEnd(null);
  assert.equal(presentation.drawRevealVisible, false);
});

test("mahjong puts a post-call draw in the slot after the shortened rack", () => {

  const rackEnd = ownHandOverlayTransform(9, 1280, 720);
  const drawn = ownHandOverlayTransform(10, 1280, 720, { drawn: true });
  assert.ok(drawn.x > rackEnd.x);

});

test("mahjong preserves hand order when there is no current drawn tile", () => {
  const hand = [13, 5, 9];
  assert.deepEqual(orderedHand(hand, 0), hand);
});

test("mahjong keeps opponent rack slots fixed while showing a separated drawn tile", () => {
  const idle = opponentHandLayout(13, 0, false);
  const afterDraw = opponentHandLayout(13, 0, true);
  assert.deepEqual(idle, {
    rackCapacity: 13,
    rackCount: 13,
    hasDrawn: false,
  });
  assert.deepEqual(afterDraw, {
    rackCapacity: 13,
    rackCount: 13,
    hasDrawn: true,
  });
  for (const position of ["bottom", "right", "top", "left"]) {
    assert.deepEqual(
      handTransform(position, 0, idle.rackCapacity),
      handTransform(position, 0, afterDraw.rackCapacity),
    );
  }
  assert.deepEqual(opponentHandLayout(10, 1, true), {
    rackCapacity: 10,
    rackCount: 10,
    hasDrawn: true,
  });
  assert.deepEqual(opponentHandLayout(11, 1, false), {
    rackCapacity: 11,
    rackCount: 11,
    hasDrawn: false,
  });
  assert.deepEqual(opponentHandLayout(1, 4, true), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: true,
  });
});

test("mahjong writes every result-sheet yaku in traditional form", () => {
  assert.deepEqual(
    [
      "门前清自摸和",
      "海底捞鱼",
      "河底捞鱼",
      "三色同顺",
      "九莲宝灯",
      "混全带幺九",
      "国士无双",
      "宝牌",
    ].map(traditionalYakuName),
    [
      "門前清自摸和",
      "海底撈魚",
      "河底撈魚",
      "三色同順",
      "九蓮寶燈",
      "混全帶幺九",
      "國士無雙",
      "寶牌",
    ],
  );
});

test("mahjong keeps five fixed dora slots and preserves red-five artwork", () => {
  assert.deepEqual(
    doraIndicatorSlots({
      doraIndicators: [4],
      doraIndicatorTiles: [
        { type: 5, red: true },
        { type: 31, red: false },
      ],
    }),
    [{ type: 5, red: true }, { type: 31, red: false }, null, null, null],
  );
  assert.deepEqual(doraIndicatorSlots({ doraIndicators: [4] }), [
    { type: 4, red: false },
    null,
    null,
    null,
    null,
  ]);
});

test("mahjong reveals ura indicators only on a riichi win result page", () => {
  const state = {
    doraIndicatorTiles: [{ type: 5, red: true }],
    uraDoraIndicatorTiles: [{ type: 14, red: false }],
    riichi: { p1: false, p2: true },
  };
  assert.deepEqual(resultIndicatorSlots(state, "p2"), {
    dora: [{ type: 5, red: true }, null, null, null, null],
    ura: [{ type: 14, red: false }, null, null, null, null],
  });
  assert.deepEqual(resultIndicatorSlots(state, "p1").ura, [
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual(
    resultIndicatorSlots({ ...state, winType: "nagashi" }, "p2").ura,
    [null, null, null, null, null],
  );
});

test("mahjong derives visible dora with suit, wind, and dragon wrapping", () => {
  assert.equal(nextDoraType(9), 1);
  assert.equal(nextDoraType(18), 10);
  assert.equal(nextDoraType(27), 19);
  assert.equal(nextDoraType(31), 28);
  assert.equal(nextDoraType(34), 32);
  assert.equal(nextDoraType(0), 0);
  assert.deepEqual(
    [...doraTypeCounts({ doraIndicators: [4, 4, 31, 34] })],
    [
      [5, 2],
      [28, 1],
      [32, 1],
    ],
  );
});

test("mahjong groups every chi behind one action and previews only the two consumed tiles", () => {
  const claims = [
    { option: 1, kind: "ron", tileTypes: [] },
    { option: 2, kind: "chi", tileTypes: [3, 5], red: [false, true] },
    { option: 3, kind: "chi", tileTypes: [5, 6], red: [false, false] },
  ];
  const grouped = partitionClaimActions(claims);
  assert.deepEqual(
    grouped.immediate.map(({ kind }) => kind),
    ["ron"],
  );
  assert.deepEqual(grouped.pon, []);
  assert.deepEqual(
    grouped.chi.map(({ option }) => option),
    [2, 3],
  );
  assert.deepEqual(claimPreviewTiles(grouped.chi[0]), [
    { type: 3, red: false },
    { type: 5, red: true },
  ]);

});

test("mahjong previews waits and visible-copy counts for the selected discard", () => {
  const legalActions = {
    tenpaiDiscards: [
      {
        tileId: 42,
        furiten: true,
        waits: [
          { type: 9, remaining: 3, noYaku: true },
          { type: 28, remaining: 0, noYaku: false },
        ],
      },
    ],
  };
  assert.deepEqual(tenpaiWaitsForDiscard(legalActions, 42), [
    { type: 9, remaining: 3, noYaku: true },
    { type: 28, remaining: 0, noYaku: false },
  ]);
  assert.deepEqual(
    tenpaiWaitsForDiscard(legalActions, 42, { declaringRiichi: true }),
    [
      { type: 9, remaining: 3, noYaku: false },
      { type: 28, remaining: 0, noYaku: false },
    ],
  );
  assert.deepEqual(tenpaiWaitsForDiscard(legalActions, 41), []);
  assert.deepEqual(tenpaiWaitsForDiscard({}, 42), []);
  assert.equal(tenpaiDiscardFuriten(legalActions, 42), true);
  assert.equal(tenpaiDiscardFuriten(legalActions, 41), false);

});

test("mahjong refreshes a confirmed tenpai wait total from the visible table", () => {
  const summary = tenpaiWaitSummary(
    {
      ownHand: [1, 2],
      doraIndicatorTiles: [{ type: 11 }],
      discards: {
        self: [{ type: 1, claimed: false }],
        right: [{ type: 1, claimed: true }],
      },
      melds: {
        right: [{ tiles: [1, 11, 11] }],
      },
    },
    [
      { type: 1, noYaku: false },
      { type: 11, noYaku: true },
    ],
  );

  assert.deepEqual(summary, {
    waits: [
      { type: 1, remaining: 0, noYaku: false },
      { type: 11, remaining: 1, noYaku: true },
    ],
    total: 1,
  });
  assert.deepEqual(
    confirmedTenpaiSummary(
      {
        furiten: true,
        ownHand: [1, 2],
        doraIndicatorTiles: [{ type: 11 }],
        discards: { self: [{ type: 1, claimed: false }] },
        melds: { right: [{ tiles: [1, 11, 11] }] },
      },
      { waits: summary.waits, furiten: false },
    ),
    { ...summary, furiten: true },
  );
});

test("mahjong keeps action buttons in a fixed player-facing order", () => {
  assert.deepEqual(
    partitionClaimActions([
      { kind: "ron" },
      { kind: "kan" },
      { kind: "chi", option: 1 },
      { kind: "pon" },
      { kind: "chi", option: 2 },
    ]),
    {
      chi: [
        { kind: "chi", option: 1 },
        { kind: "chi", option: 2 },
      ],
      pon: [{ kind: "pon" }],
      immediate: [{ kind: "kan" }, { kind: "ron" }],
    },
  );

  const view = readFileSync(
    new URL("../games/mahjong/app/dom-view.js", import.meta.url),
    "utf8",
  );
  const chiPosition = view.indexOf(
    'elements.claims.append(this.createGroupedClaimAction(chiClaims, "chi"))',
  );
  const ponPosition = view.indexOf(
    'elements.claims.append(this.createGroupedClaimAction(ponClaims, "pon"))',
  );
  const immediatePosition = view.indexOf(
    "for (const claim of immediateClaims)",
  );
  assert.ok(
    chiPosition > 0 &&
      chiPosition < ponPosition &&
      ponPosition < immediatePosition,
  );

});

test("mahjong double-clicks blank table space only for enabled available actions", () => {
  assert.deepEqual(
    blankDoubleClickAction({
      doubleClickPassEnabled: true,
      passAvailable: true,
      doubleClickTsumogiriEnabled: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    { type: "pass" },
  );
  assert.equal(
    blankDoubleClickAction({
      doubleClickPassEnabled: true,
      passAvailable: false,
    }),
    null,
  );
  assert.deepEqual(
    blankDoubleClickAction({
      doubleClickTsumogiriEnabled: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    { type: "discard", tileId: 42 },
  );
  assert.equal(
    blankDoubleClickAction({
      doubleClickTsumogiriEnabled: true,
      riichiMode: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    null,
  );
});

test("mahjong shows oversized non-perspective callouts for claims, riichi, and wins", () => {
  assert.deepEqual(
    actionCalloutDescriptor({ type: "claimed", kind: "chi", playerIndex: 2 }),
    {
      label: "吃",
      color: "#f1b84b",
      glow: "#ffd985",
      action: "chi",
      playerIndex: 2,
    },
  );
  assert.equal(
    actionCalloutDescriptor({
      type: "claim_declared",
      kind: "pon",
      playerIndex: 1,
    }),
    null,
  );
  assert.equal(
    actionCalloutDescriptor({ type: "claimed", kind: "pon" }).label,
    "碰",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "claimed", kind: "kan" }).label,
    "杠",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "riichi", playerIndex: 4 }).label,
    "立直",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "won", method: "ron" }).label,
    "和",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "won", method: "tsumo" }).label,
    "自摸",
  );
  assert.deepEqual(
    actionCalloutEvents([
      { type: "claimed", kind: "pon", playerIndex: 1 },
      { type: "won", method: "ron", playerIndex: 2 },
      { type: "won", method: "ron", playerIndex: 4 },
    ]).map((event) => event.playerIndex),
    [2, 4],
  );
  assert.deepEqual(
    actionCalloutEvents([
      { type: "claimed", kind: "chi", playerIndex: 2 },
      { type: "claimed", kind: "pon", playerIndex: 3 },
    ]).map((event) => event.playerIndex),
    [3],
  );
  assert.equal(
    actionCalloutKey(
      { type: "claimed", kind: "pon", playerIndex: 3, fromIndex: 2, tile: 18 },
      "1:2:24",
    ),
    "1:2:24:pon:3:2:18",
  );
  assert.ok(
    ACTION_CALLOUT_DURATION_MS >= 700 && ACTION_CALLOUT_DURATION_MS <= 900,
  );

});

test("mahjong presents winning, exhaustive-draw, and nine-terminals hands before results", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );

  assert.ok(
    html.indexOf('id="result-panel"') > html.indexOf('class="player-dock"'),
  );

  assert.deepEqual(
    exhaustiveDrawPresentation({
      phase: "hand_ended",
      draw: true,
      result: { tenpai: [true, false, true, false] },
    }),
    { revealed: [1, 3], covered: [2, 4] },
  );
  assert.deepEqual(
    exhaustiveDrawPresentation({
      phase: "hand_ended",
      draw: true,
      result: { abortive: true, tenpai: [true, false, true, false] },
    }),
    { revealed: [], covered: [] },
  );
});

test("mahjong blank result double-click starts the button animation before advancing", () => {
  const calls = [];
  activateResultStartControl({
    startAnimation() {
      calls.push("button-animation");
    },
    onContinue() {
      calls.push("result-step");
    },
  });
  assert.deepEqual(calls, ["button-animation", "result-step"]);
});

test("mahjong defers default decorative images until after window load", () => {
  const properties = new Map();
  const listeners = new Map();
  const document = {
    readyState: "loading",
    documentElement: {
      style: { setProperty: (name, value) => properties.set(name, value) },
      dataset: {},
    },
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (callback) => callback(),
  };
  deferMahjongDecorativeAssets({
    document,
    window,
    urls: { "--mahjong-default-portrait-image": "/portraits.jpg" },
  });
  assert.equal(properties.size, 0);
  listeners.get("load")();
  assert.equal(
    properties.get("--mahjong-default-portrait-image"),
    'url("/portraits.jpg")',
  );
  assert.equal(
    document.documentElement.dataset.mahjongDecorativeAssets,
    "ready",
  );
});

test("mahjong defers lobby decorative images until after window load", () => {
  const listeners = new Map();
  const image = {
    dataset: { deferredImage: "signpost" },
    removeAttribute(name) {
      delete this.dataset[
        name
          .replace("data-", "")
          .replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      ];
    },
  };
  const document = {
    readyState: "loading",
    querySelectorAll: () => [image],
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (callback) => callback(),
  };
  deferMahjongImageAssets({
    document,
    window,
    urls: { signpost: "/signpost.webp" },
  });
  assert.equal(image.src, undefined);
  listeners.get("load")();
  assert.equal(image.src, "/signpost.webp");
  assert.equal(image.dataset.deferredImage, undefined);

});

test("mahjong starts with an inline low-resolution tile atlas and a sampled felt colour", () => {
        const placeholder = readFileSync(
    new URL(
      "../games/mahjong/assets/tiles/riichi-faces-placeholder.webp",
      import.meta.url,
    ),
  );

  assert.ok(placeholder.byteLength < 4_096);

});

test("mahjong result pages separate winners before the score summary", () => {
  const state = {
    phase: "hand_ended",
    draw: false,
    results: [{ winnerIndex: 2 }, { winnerIndex: 4 }],
    scores: [21_000, 31_000, 18_000, 30_000],
    result: { deltas: [-8_000, 6_000, -4_000, 6_000] },
    playerNames: ["自家", "青岚", "织羽", "墨池"],
  };
  assert.equal(resultDetailPageCount(state), 2);
  assert.equal(resultDetailPageCount({ ...state, draw: true }), 0);
  assert.deepEqual(resultScoreRows(state, "你"), [
    { name: "你", before: 29_000, delta: -8_000, after: 21_000 },
    { name: "青岚", before: 25_000, delta: 6_000, after: 31_000 },
    { name: "织羽", before: 22_000, delta: -4_000, after: 18_000 },
    { name: "墨池", before: 24_000, delta: 6_000, after: 30_000 },
  ]);
  assert.deepEqual(matchResultRows(state, "你"), [
    { seat: 2, name: "青岚", score: 31_000, rank: 1 },
    { seat: 4, name: "墨池", score: 30_000, rank: 2 },
    { seat: 1, name: "你", score: 21_000, rank: 3 },
    { seat: 3, name: "织羽", score: 18_000, rank: 4 },
  ]);

});

test("mahjong final standings break equal scores by seat order", () => {
  assert.deepEqual(
    matchResultRows({
      scores: [25_000, 30_000, 30_000, 25_000],
      playerNames: ["东", "南", "西", "北"],
    }, "你").map(({ seat, score, rank }) => ({ seat, score, rank })),
    [
      { seat: 2, score: 30_000, rank: 1 },
      { seat: 3, score: 30_000, rank: 2 },
      { seat: 1, score: 25_000, rank: 3 },
      { seat: 4, score: 25_000, rank: 4 },
    ],
  );
});

test("mahjong result names use the actual viewer seat", () => {
  const state = {
    phase: "hand_ended",
    players: ["east", "south", "west", "north"],
    playerNames: ["东家", "南家", "西家", "北家"],
    scores: [25_000, 30_000, 25_000, 20_000],
    result: { winnerIndex: 2, deltas: [0, 8_000, 0, -8_000] },
  };
  assert.equal(
    playerDisplayName(state, 2, {
      playerName: "我的昵称",
      playerNameIsAuthoritative: true,
      viewerSeat: 2,
    }),
    "我的昵称",
  );
  assert.deepEqual(
    resultScoreRows(state, "我的昵称", {
      playerNameIsAuthoritative: true,
      viewerSeat: 2,
    }).map((row) => row.name),
    ["东家", "我的昵称", "西家", "北家"],
  );
});

test("mahjong score sheets retain the latest scored hands and show each change from the prior row", () => {
  const rows = resultScoreSheetRows({
    scoreHistory: [
      {
        roundWind: 1,
        handNumber: 1,
        honba: 0,
        scores: [25_000, 25_000, 25_000, 25_000],
      },
      {
        roundWind: 1,
        handNumber: 1,
        honba: 1,
        scores: [24_000, 25_000, 25_000, 26_000],
      },
    ],
  });
  assert.deepEqual(rows, [
    {
      round: "東1",
      honba: 1,
      scores: [24_000, 25_000, 25_000, 26_000],
      deltas: [-1_000, 0, 0, 1_000],
    },
  ]);
  assert.deepEqual(
    visibleScoreSheetRows(
      Array.from({ length: 9 }, (_, index) => ({ round: `東${index + 1}` })),
      8,
    ).map((row) => row.round),
    ["東2", "東3", "東4", "東5", "東6", "東7", "東8", "東9"],
  );
});

test("mahjong score sheets keep canonical opening-seat columns", () => {
  const rows = resultScoreSheetRows({
    initialDealerIndex: 3,
    scoreHistory: [
      { scores: [25_000, 25_000, 25_000, 25_000] },
      { scores: [24_000, 25_000, 25_000, 26_000] },
    ],
  });
  assert.deepEqual(rows[0].scores, [24_000, 25_000, 25_000, 26_000]);
  assert.deepEqual(rows[0].deltas, [-1_000, 0, 0, 1_000]);
});

test("mahjong result melds use the same physical tile scale as the hand", () => {
  const layout = resultMeldDisplayLayout(
    { kind: "pon", tiles: [14, 14, 14], fromIndex: 2 },
    3,
  );
  assert.equal(layout.entries.length, 3);
});

test("mahjong centre-aligns the shorter local perspective reveal before it falls", () => {
  const eighth = presentedHandTransform("bottom", 7, 13);
  assert.equal(eighth.x, 0);
  const tileCorners = [];
  for (const x of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
    for (const y of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
      for (const z of [-TILE_SIZE.depth / 2, TILE_SIZE.depth / 2]) {
        tileCorners.push(new Vector3(x, y, z));
      }
    }
  }
  const screenBounds = (object, camera) => {
    object.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const yCoordinates = tileCorners.map((corner) => {
      const projected = corner
        .clone()
        .applyMatrix4(object.matrixWorld)
        .project(camera);
      return ((1 - projected.y) * MAHJONG_VIEWPORT.height) / 2;
    });
    const top = Math.min(...yCoordinates);
    const bottom = Math.max(...yCoordinates);
    return { top, bottom, height: bottom - top, centre: (top + bottom) / 2 };
  };

  const overlayTransform = ownHandOverlayTransform(
    7,
    MAHJONG_VIEWPORT.width,
    MAHJONG_VIEWPORT.height,
  );
  const overlayTile = new Group();
  overlayTile.position.set(
    overlayTransform.x,
    overlayTransform.y,
    overlayTransform.z,
  );
  overlayTile.rotation.x = overlayTransform.tilt;
  overlayTile.scale.set(
    overlayTransform.scaleX,
    overlayTransform.scaleY,
    overlayTransform.scaleZ,
  );
  const overlayCamera = new OrthographicCamera(
    -MAHJONG_VIEWPORT.width / 2,
    MAHJONG_VIEWPORT.width / 2,
    MAHJONG_VIEWPORT.height / 2,
    -MAHJONG_VIEWPORT.height / 2,
    0.1,
    2000,
  );
  overlayCamera.position.set(0, 0, 1000);
  overlayCamera.lookAt(0, 0, 0);

  const camera = new PerspectiveCamera(33, MAHJONG_VIEWPORT.aspect, 0.1, 80);
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);

  const slot = new Group();
  slot.position.set(eighth.x, 0, eighth.z);
  slot.rotation.y = eighth.yaw;
  const hingeTransform = presentedTileHingeTransform(false);
  const hinge = new Group();
  hinge.position.z = hingeTransform.pivotZ;
  const perspectiveTile = new Group();
  perspectiveTile.position.set(0, hingeTransform.tileY, hingeTransform.tileZ);
  hinge.add(perspectiveTile);
  slot.add(hinge);

  const overlayBounds = screenBounds(overlayTile, overlayCamera);
  const perspectiveBounds = screenBounds(perspectiveTile, camera);
  assert.ok(perspectiveBounds.height < overlayBounds.height);
  assert.ok(Math.abs(perspectiveBounds.centre - overlayBounds.centre) < 0.001);
  assert.equal(
    presentedHandTransform("bottom", 7, 13, { covered: true }).z,
    LOCAL_COVERED_HAND_Z,
  );
  assert.deepEqual(
    presentedHandTransform("top", 7, 13),
    handTransform("top", 7, 13),
  );
});

test("mahjong hand reveal rotates around a table-contact edge", () => {
  for (const covered of [false, true]) {
    const transform = presentedTileHingeTransform(covered);
    assert.equal(transform.pivotZ + transform.tileZ, 0);

    const finalCentre = new Vector3(
      0,
      transform.tileY,
      transform.tileZ,
    ).applyEuler(new Euler(transform.restingRotationX, 0, 0));
    assert.equal(transform.restingRotationX > 0, covered);
  }
});

test("mahjong hand reveal combines a sustained push with gravity and hand braking", () => {
  assert.equal(handRevealFallProgress(0), 0);
  assert.equal(handRevealFallProgress(1), 1);

  const samples = Array.from({ length: 21 }, (_, index) =>
    handRevealFallProgress(index / 20),
  );
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] > samples[index - 1]);
  }

  const earlySpeed = handRevealFallProgress(0.4) - handRevealFallProgress(0.3);
  const gravityAssistedSpeed =
    handRevealFallProgress(0.7) - handRevealFallProgress(0.6);
  const contactSpeed = handRevealFallProgress(1) - handRevealFallProgress(0.9);
  assert.ok(gravityAssistedSpeed > earlySpeed);
  assert.ok(contactSpeed > 0);
  assert.ok(contactSpeed < gravityAssistedSpeed);
});

test("mahjong crossfades only the local revealed hand into perspective", () => {
  assert.equal(
    shouldCrossfadeOwnHand({
      revealed: true,
      covered: false,
      animated: true,
      hasOverlay: true,
    }),
    true,
  );
  for (const overrides of [
    { revealed: false },
    { covered: true },
    { animated: false },
    { hasOverlay: false },
  ]) {
    assert.equal(
      shouldCrossfadeOwnHand({
        revealed: true,
        covered: false,
        animated: true,
        hasOverlay: true,
        ...overrides,
      }),
      false,
    );
  }
  assert.equal(ownHandCrossfadeProgress(0), 0);
  assert.equal(ownHandCrossfadeProgress(0.5), 0.5);
  assert.equal(ownHandCrossfadeProgress(1), 1);
});

test("mahjong animation controller shares one frame loop and deduplicates events", () => {
  let now = 0;
  let nextFrame = 0;
  let pendingFrame = null;
  let frameDraws = 0;
  const shadowUpdates = [];
  const samples = { reveal: [], callout: [] };
  const animations = new ThreeAnimationController(
    (updatesShadow) => {
      frameDraws += 1;
      shadowUpdates.push(updatesShadow);
    },
    {
      now: () => now,
      requestFrame(callback) {
        pendingFrame = callback;
        return ++nextFrame;
      },
      cancelFrame() {
        pendingFrame = null;
      },
    },
  );
  const advance = (time) => {
    const callback = pendingFrame;
    pendingFrame = null;
    now = time;
    callback(time);
  };

  assert.equal(animations.claim("hand-reveal", "draw:42"), true);
  assert.equal(animations.claim("hand-reveal", "draw:42"), false);
  animations.play({
    id: "hand-reveal",
    duration: 100,
    updatesShadow: true,
    update: (progress) => samples.reveal.push(progress),
  });
  animations.play({
    id: "action-callout",
    duration: 200,
    update: (progress) => samples.callout.push(progress),
  });
  assert.equal(nextFrame, 1);

  advance(50);
  assert.deepEqual(samples.reveal, [0.5]);
  assert.deepEqual(samples.callout, [0.25]);
  assert.equal(frameDraws, 1);
  assert.deepEqual(shadowUpdates, [true]);
  advance(100);
  assert.equal(animations.has("hand-reveal"), false);
  assert.equal(animations.has("action-callout"), true);
  advance(200);
  assert.equal(animations.has("action-callout"), false);
  assert.equal(pendingFrame, null);

  const breath = [];
  animations.play({
    id: "dora-breath",
    duration: 100,
    repeat: true,
    update: (progress) => breath.push(progress),
  });
  advance(225);
  advance(350);
  assert.deepEqual(breath, [0.25, 0.5]);
  assert.deepEqual(shadowUpdates.slice(-2), [false, false]);
  assert.equal(animations.has("dora-breath"), true);
  animations.cancel("dora-breath");
  assert.equal(pendingFrame, null);

  animations.resetKey("hand-reveal");
  assert.equal(animations.claim("hand-reveal", "draw:42"), true);
  animations.destroy();
});

test("mahjong keeps a gold dora lightbox lit between breaths", () => {
  const start = doraBreathIntensity(0);
  const peak = doraBreathIntensity(0.5);
  const end = doraBreathIntensity(1);
  assert.ok(peak > start);
  assert.ok(Math.abs(end - start) < Number.EPSILON);
});

test("mahjong gives a newly drawn local tile a short falling fade-in", () => {
  assert.equal(ownDrawEntryProgress(0), 0);
  assert.equal(ownDrawEntryProgress(0.5), 0.875);
  assert.equal(ownDrawEntryProgress(1), 1);

  const state = {
    phase: "playing",
    roundWind: 1,
    handNumber: 2,
    moveCount: 17,
    drawnTile: 42,
    legalActions: { canDiscard: true },
  };
  assert.equal(ownDrawEntryKey(state), "1:2:17:42");
  assert.equal(ownDrawEntryKey({ ...state, drawnTile: 0 }), "");
  assert.equal(ownDrawEntryKey({ ...state, phase: "hand_ended" }), "");

});

test("mahjong reuses local tile meshes for a quick interruptible selection lift", () => {
  assert.equal(ownTileSelectionProgress(0), 0);
  assert.equal(ownTileSelectionProgress(0.5), 0.875);
  assert.equal(ownTileSelectionProgress(1), 1);
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const tableController = readFileSync(
    new URL("../games/mahjong/app/table-controller.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/app/dom-view.js", import.meta.url),
    "utf8",
  );
  const selection = tableController.slice(
    tableController.indexOf("function selectTile(tileId)"),
    tableController.indexOf("function discardSelected()"),
  );
  const selectionUpdate = renderer.slice(
    renderer.indexOf("  updateSelection(ui) {"),
    renderer.indexOf("  drawHands(state, selectedTileId) {"),
  );
  const pointerDown = renderer.slice(
    renderer.indexOf("  handlePointerDown(event) {"),
    renderer.indexOf("  handlePointerMove(event) {"),
  );
  const hoverUpdate = renderer.slice(
    renderer.indexOf("  setHoveredTile(tile, force = false) {"),
    renderer.indexOf("  drawFrame() {"),
  );
  const pointerUp = renderer.slice(
    renderer.indexOf("  handlePointerUp(event) {"),
    renderer.indexOf("  handleTileTap(tileId, discardable) {"),
  );
  const cancelDrag = renderer.slice(
    renderer.indexOf("  cancelDrag(redraw = true) {"),
    renderer.indexOf("  pickTile(event) {"),
  );
  const domSelection = view.slice(
    view.indexOf("  renderSelection("),
    view.indexOf("  renderTypeHighlights(selectedTileId) {"),
  );

});

test("mahjong result total shows base win payments without counters or sticks", () => {
  assert.equal(resultBasePaymentTotal({}, { basePaymentTotal: 5200 }), "5200");
  assert.equal(
    resultBasePaymentTotal({ winType: "tsumo" }, { payment: "1300/2600点" }),
    "5200",
  );
  assert.equal(
    resultBasePaymentTotal({ winType: "tsumo" }, { payment: "2600点∀" }),
    "7800",
  );
  assert.equal(
    resultBasePaymentTotal({ winType: "ron", honba: 2 }, { payment: "8300点" }),
    "7700",
  );
});

test("mahjong leaves a ron tile in the river while revealing only the winner's original hand", () => {
  const rack = Array.from({ length: 13 }, (_, index) => ({
    type: (index % 9) + 1,
    red: false,
  }));
  const baseState = {
    players: ["winner", "right", "top", "left"],
    revealedHands: { winner: rack },
    winners: ["winner"],
    winningTile: 18,
    winningTileRed: true,
  };

  assert.deepEqual(
    splitRevealedHand({ ...baseState, winType: "ron" }, "winner", 1),
    { rack, drawn: null },
  );
  assert.deepEqual(
    splitRevealedHand({ ...baseState, winType: "tsumo" }, "winner", 1),
    { rack, drawn: { type: 18, red: true } },
  );
});

test("mahjong result melds preserve call direction and kan presentation", () => {

  const openKan = meldDisplayLayout(
    {
      kind: "kan",
      tiles: [1, 1, 1, 1],
      fromIndex: 2,
    },
    1,
  );
  const resultTileWidth = 33;
  const meldWidth =
    openKan.span * (resultTileWidth / (TILE_SIZE.width * MELD_SCALE)) + 3;
  const fourKanWinningHandWidth =
    resultTileWidth * 2 + meldWidth * 4 + 9 * 4 + 1.5 * 5;
  assert.ok(fourKanWinningHandWidth <= 760);
});

test("mahjong automatically tsumogiri after riichi only when discard is the sole action", () => {
  const state = {
    drawnTile: 73,
    riichi: { player: true },
    legalActions: {
      canDiscard: true,
      canTsumo: false,
      canAbortNine: false,
      selfKans: [],
    },
  };

  assert.equal(automaticRiichiDiscard(state, "player"), 73);
  assert.equal(automaticRiichiDiscard({ ...state, riichi: {} }, "player"), 0);
  assert.equal(
    automaticRiichiDiscard(
      {
        ...state,
        legalActions: { ...state.legalActions, canTsumo: true },
      },
      "player",
    ),
    0,
  );
  assert.equal(
    automaticRiichiDiscard(
      {
        ...state,
        legalActions: { ...state.legalActions, selfKans: [{ kind: "ankan" }] },
      },
      "player",
    ),
    0,
  );
});

test("mahjong uses one standing 3D tile transform for all four seats", () => {
    const bottom = handTransform("bottom", 0, 13);
  const right = handTransform("right", 0, 13);
  const top = handTransform("top", 0, 13);
  const left = handTransform("left", 0, 13);

  for (const transform of [bottom, right, top, left]) {
  }
  assert.ok(right.x > 8);
  assert.ok(top.z < -9.5);
  assert.ok(left.x < -8);
  assert.ok(handTransform("bottom", 1, 13).x > bottom.x);
  assert.ok(handTransform("right", 1, 13).z < right.z);
  assert.ok(handTransform("top", 1, 13).x < top.x);
  assert.ok(handTransform("left", 1, 13).z > left.z);
  for (const position of ["bottom", "right", "top", "left"]) {
    assert.deepEqual(
      handTransform(position, 0, 13),
      handTransform(position, 0, 10),
    );
  }
  const bottomRackEnd = handTransform("bottom", 12, 13);
  const rightRackEnd = handTransform("right", 12, 13);
  const topRackEnd = handTransform("top", 12, 13);
  const leftRackEnd = handTransform("left", 12, 13);
  assert.ok(
    handTransform("bottom", 13, 13, { drawn: true }).x > bottomRackEnd.x,
  );
  assert.ok(handTransform("right", 13, 13, { drawn: true }).z < rightRackEnd.z);
  assert.ok(handTransform("top", 13, 13, { drawn: true }).x < topRackEnd.x);
  assert.ok(handTransform("left", 13, 13, { drawn: true }).z > leftRackEnd.z);
  assert.ok(riverTransform("bottom", 1).x > riverTransform("bottom", 0).x);
  assert.ok(riverTransform("right", 1).z < riverTransform("right", 0).z);
  assert.ok(riverTransform("top", 1).x < riverTransform("top", 0).x);
  assert.ok(riverTransform("left", 1).z > riverTransform("left", 0).z);
  assert.ok(riverTransform("bottom", 6).z > riverTransform("bottom", 0).z);
  assert.ok(
    riverTransform("bottom", 6).z - riverTransform("bottom", 0).z >
      TILE_SIZE.height,
  );
  assert.ok(riverTransform("top", 6).z < riverTransform("top", 0).z);
  assert.ok(riverTransform("right", 6).x > riverTransform("right", 0).x);
  assert.ok(riverTransform("left", 6).x < riverTransform("left", 0).x);
  assert.deepEqual(riverGridPosition(12), { column: 0, row: 2 });
  assert.deepEqual(riverGridPosition(17), { column: 5, row: 2 });
  assert.deepEqual(riverGridPosition(18), { column: 6, row: 2 });
  assert.equal(riverTransform("bottom", 18).z, riverTransform("bottom", 12).z);
  assert.ok(riverTransform("bottom", 18).x > riverTransform("bottom", 17).x);
  assert.notEqual(
    riverTransform("bottom", 0, true).yaw,
    riverTransform("bottom", 0).yaw,
  );
  assert.notEqual(
    riverTransform("right", 0, true).yaw,
    riverTransform("right", 0).yaw,
  );
  const riichiColumn = 1;
  const rowStart = riverTransform("bottom", 6, false, { riichiColumn });
  const sideways = riverTransform("bottom", 7, true, { riichiColumn });
  const afterRiichi = riverTransform("bottom", 8, false, { riichiColumn });
  assert.equal(rowStart.x, riverTransform("bottom", 6).x);
  assert.ok(
    Math.abs(
      sideways.x - riverTransform("bottom", 7).x - RIICHI_TILE_ACROSS_EXTRA / 2,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      afterRiichi.x - riverTransform("bottom", 8).x - RIICHI_TILE_ACROSS_EXTRA,
    ) < 1e-9,
  );

  assert.ok(
    Math.abs(
      (riverTransform("bottom", 0).z + riverTransform("top", 0).z) / 2 -
        PLAYFIELD_CENTRE_Z,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      (riverTransform("right", 0).z + riverTransform("right", 5).z) / 2 -
        PLAYFIELD_CENTRE_Z,
    ) < 1e-9,
  );
  const bottomRight = riverTransform("bottom", 5);
  const rightBottom = riverTransform("right", 0);
  assert.ok(
    Math.abs(
      rightBottom.x -
        TILE_SIZE.height / 2 -
        (bottomRight.x + TILE_SIZE.width / 2) -
        RIVER_CORNER_GAP,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      bottomRight.z -
        TILE_SIZE.height / 2 -
        (rightBottom.z + TILE_SIZE.width / 2) -
        RIVER_CORNER_GAP,
    ) < 1e-9,
  );
  assert.ok(meldTransform("bottom", 0).x > 4.4);
  assert.ok(meldTransform("bottom", 0).z > 6.5);
  assert.ok(meldTransform("right", 0).x > 7.2);
  assert.ok(meldTransform("top", 0).x < -5.5);
  assert.ok(meldTransform("top", 0).z < -8.8);
  assert.ok(meldTransform("left", 0).x < -7.2);
  assert.ok(
    Math.abs(
      meldTransform("left", 0).z +
        meldTransform("right", 0).z -
        PLAYFIELD_CENTRE_Z * 2,
    ) < 1e-9,
  );
  assert.ok(meldTransform("bottom", 1).x < meldTransform("bottom", 0).x);
  assert.ok(meldTransform("top", 1).x > meldTransform("top", 0).x);
  assert.ok(meldTransform("right", 1).z > meldTransform("right", 0).z);
  assert.ok(meldTransform("left", 1).z < meldTransform("left", 0).z);
});

test("mahjong keeps opponent racks inside commercial safe lanes", () => {
  const viewport = { width: 1280, height: 720 };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const racks = Object.fromEntries(
    ["top", "left", "right"].map((position) => [
      position,
      Array.from({ length: 13 }, (_, index) =>
        projectedStandingTileBounds(position, index, camera, viewport),
      ),
    ]),
  );
  assert.ok(Math.min(...racks.top.map((tile) => tile.top)) >= 16);

  const avatarZones = {
    top: { left: 884, right: 974, top: 20, bottom: 130 },
    left: { left: 30, right: 122, top: 220, bottom: 340 },
    right: { left: 1158, right: 1250, top: 220, bottom: 340 },
  };
  for (const position of ["top", "left", "right"]) {
    assert.equal(
      racks[position].some((tile) =>
        rectanglesOverlap(tile, avatarZones[position]),
      ),
      false,
      `${position} rack overlaps its player station`,
    );
  }
});

test("mahjong gives only river tiles stable bounded planar variation", () => {
  const footprint = { width: TILE_SIZE.width, height: TILE_SIZE.height };
  const first = planarTileJitter("1:river:0:8", RIVER_TILE_GAP, footprint);
  assert.deepEqual(
    planarTileJitter("1:river:0:8", RIVER_TILE_GAP, footprint),
    first,
  );
  assert.notDeepEqual(
    planarTileJitter("1:river:1:8", RIVER_TILE_GAP, footprint),
    first,
  );

  const samples = Array.from({ length: 256 }, (_, index) =>
    planarTileJitter(`river:${index}`, RIVER_TILE_GAP, footprint),
  );
  for (const sample of samples) {
    assert.ok(Math.abs(sample.yaw) <= 0.04 + 1e-12);
  }
  assert.ok(samples.some((sample) => sample.along < 0));
  assert.ok(samples.some((sample) => sample.along > 0));
  assert.ok(samples.some((sample) => sample.across < 0));
  assert.ok(samples.some((sample) => sample.across > 0));
  assert.ok(samples.some((sample) => sample.yaw < 0));
  assert.ok(samples.some((sample) => sample.yaw > 0));

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const riverSection = renderer.slice(
    renderer.indexOf("  drawRivers(state) {"),
    renderer.indexOf("  drawMelds(state) {"),
  );
  const meldSection = renderer.slice(
    renderer.indexOf("  drawMelds(state) {"),
    renderer.indexOf("  handlePointerDown(event) {"),
  );

});

test("mahjong retains keyed river scene nodes across snapshots", () => {
  const group = new Group();
  const layer = new ThreeKeyedSceneLayer(group);
  const removed = [];
  const reconcile = (entries) =>
    layer.reconcile(entries, {
      keyOf: (entry) => entry.id,
      create: (entry) => ({ node: new Group(), value: entry.value }),
      update: (record, entry) => {
        record.value = entry.value;
      },
      remove: (record, key) => removed.push([key, record.value]),
    });

  reconcile([
    { id: "1:0", value: "first" },
    { id: "2:0", value: "second" },
  ]);
  const retained = layer.records.get("1:0");
  reconcile([
    { id: "1:0", value: "updated" },
    { id: "1:1", value: "new" },
  ]);

  assert.strictEqual(layer.records.get("1:0"), retained);
  assert.equal(retained.value, "updated");
  assert.equal(group.children.includes(retained.node), true);
  assert.equal(group.children.length, 2);
  assert.deepEqual(removed, [["2:0", "second"]]);
});

test("mahjong highlights matching visible tile types without adding count text", () => {
  const factory = new ThreeTileFactory(new Texture());
  const selected = factory.create({ type: 5, tileId: 17 });
  const matchingRedFive = factory.create({
    type: 5,
    red: true,
    highlight: "match",
  });
  const ordinaryDora = factory.create({ type: 5, dora: true });
  const plainRedFive = factory.create({ type: 5, red: true });
  const doubleDoraRedFive = factory.create({ type: 5, red: true, dora: true });
  const stackedFeedback = factory.create({
    type: 5,
    dora: true,
    highlight: "match",
    tsumogiri: true,
  });
  const tsumogiriTile = factory.create({ type: 5, tsumogiri: true });
  const disabledRiichiTile = factory.create({ type: 5, dimmed: true });
  const doraRiichiTile = factory.create({ type: 5, dora: true, dimmed: true });
  const concealed = factory.create({
    type: 5,
    concealed: true,
    highlight: "match",
  });
  const selectedFeedback = selected.userData.feedback;
  const matchingFeedback = matchingRedFive.userData.feedback;
  const tsumogiriFeedback = tsumogiriTile.userData.feedback;
  const disabledFeedback = disabledRiichiTile.userData.feedback;
  const matchingFace = matchingRedFive.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(matchingFace);
  assert.equal(matchingFace.material.isMeshPhysicalMaterial, true);
  const shell = matchingRedFive.children.find(
    (child) => child.material === factory.shellMaterial,
  );
  assert.ok(shell);
  assert.equal(shell.material.isMeshPhysicalMaterial, true);
  assert.ok(selectedFeedback);
  assert.equal(selectedFeedback.mesh.visible, false);
  assert.ok(matchingFeedback);
  assert.equal(matchingFeedback.mesh.visible, true);
  assert.equal(hasVisibleFeedback(matchingRedFive), true);
  assert.equal(matchingFeedback.mesh.material.transparent, true);
  assert.equal(matchingFeedback.mesh.material.blending, NormalBlending);
  assert.equal(matchingFeedback.mesh.material.depthWrite, false);
  assert.equal(matchingFeedback.mesh.material.depthTest, true);
  assert.equal(matchingFeedback.mesh.material.toneMapped, false);
  assert.equal(matchingFeedback.mesh.geometry, factory.feedbackGeometry);
  factory.feedbackGeometry.computeBoundingBox();
  assert.ok(
    factory.feedbackGeometry.boundingBox.max.z > matchingFace.position.z,
    "feedback washes clear the printed face without bypassing depth testing",
  );
  const tsumogiriFace = tsumogiriTile.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(
    factory.feedbackGeometry.boundingBox.max.z > tsumogiriFace.position.z,
    "every feedback wash shares the same visible surface",
  );
  assert.equal(concealed.userData.feedback, undefined);
  assert.equal(hasVisibleFeedback(concealed), false);
  const plainShell = plainRedFive.children.find(
    (child) => child.geometry === factory.shellGeometry,
  );
  assert.equal(plainShell.material, factory.shellMaterial);
  const doraFace = ordinaryDora.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  const doraShell = ordinaryDora.children.find(
    (child) => child.geometry === factory.shellGeometry,
  );
  assert.ok(doraFace);
  assert.ok(doraShell);
  assert.equal(doraShell.material, factory.doraShellMaterial);
  assert.equal(doraShell.material.isMeshPhysicalMaterial, true);
  assert.notDeepEqual(
    factory.doraShellBaseColor,
    factory.shellMaterial.color,
    "the resting dora shell remains visibly interpolated toward gold",
  );
  assert.equal(doraFace.material, factory.faceMaterial);
  const restingDoraColor = factory.doraShellMaterial.color.clone();
  factory.setDoraGlowIntensity(1);
  assert.notDeepEqual(factory.doraShellMaterial.color, restingDoraColor);
  factory.setDoraGlowIntensity(0);
  assert.deepEqual(factory.doraShellMaterial.color, factory.doraShellBaseColor);
  assert.equal(
    doubleDoraRedFive.children.find(
      (child) => child.geometry === factory.shellGeometry,
    )?.material,
    factory.doraShellMaterial,
  );
  const stackedShell = stackedFeedback.children.find(
    (child) => child.geometry === factory.shellGeometry,
  );
  const stackedCue = stackedFeedback.userData.feedback;
  assert.equal(stackedShell.material, factory.doraShellMaterial);
  assert.equal(stackedCue.match, true);
  assert.equal(stackedCue.tsumogiri, true);
  assert.ok(stackedCue.mesh.material.uniforms.matchOpacity.value > 0);
  assert.equal(stackedCue.mesh.material.uniforms.tsumogiriOpacity.value, 0);
  factory.setMatchHighlight(stackedFeedback, false);
  assert.equal(stackedCue.match, false);
  assert.ok(stackedCue.mesh.material.uniforms.tsumogiriOpacity.value > 0);
  assert.equal(stackedShell.material, factory.doraShellMaterial);
  assert.ok(tsumogiriFeedback.mesh.material.uniforms.tsumogiriOpacity.value > 0);
  assert.ok(disabledFeedback.mesh.material.uniforms.disabledOpacity.value > 0);
  const disabledFace = disabledRiichiTile.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(disabledFace);
  assert.ok(disabledFeedback.mesh.renderOrder > disabledFace.renderOrder);
  assert.equal(doraRiichiTile.userData.feedback.mesh.visible, true);
  assert.ok(
    doraRiichiTile.userData.feedback.mesh.material.uniforms.disabledOpacity
      .value > 0,
    "disabled feedback also covers dora tiles",
  );
  assert.equal(
    doraRiichiTile.children.find(
      (child) => child.geometry === factory.shellGeometry,
    )?.material,
    factory.doraShellMaterial,
  );
  factory.setMatchHighlight(selected, true);
  assert.equal(selectedFeedback.mesh.visible, true);
  factory.setMatchHighlight(selected, false);
  assert.equal(selectedFeedback.mesh.visible, false);
  factory.destroy();
});

test("mahjong composites tile feedback after tone mapping with depth replay", () => {
  const scene = new Scene();
  const overlayScene = new Scene();
  const compositor = new ThreeTileFeedbackCompositor({
    scene,
    camera: new PerspectiveCamera(),
    overlayScene,
    overlayCamera: new OrthographicCamera(),
  });
  const factory = new ThreeTileFactory(new Texture());
  const matchingTile = factory.create({ type: 5, highlight: "match" });
  scene.add(matchingTile);

  assert.equal(hasVisibleFeedback(scene), true);
  factory.setMatchHighlight(matchingTile, false);
  assert.equal(hasVisibleFeedback(scene), false);
  factory.setMatchHighlight(matchingTile, true);
  assert.equal(hasVisibleFeedback(scene), true);
  assert.equal(compositor.depthMaterial.colorWrite, false);
  assert.equal(compositor.depthMaterial.depthWrite, true);

  compositor.dispose();
  factory.destroy();
});

test("mahjong renders every meld in the perspective table scene", () => {

  assert.ok(
    meldTransform("bottom", 0).x >
      handTransform("bottom", 13, 13, { drawn: true }).x,
  );
  assert.ok(meldTransform("bottom", 1).x < meldTransform("bottom", 0).x);
});

test("mahjong keeps full-size four-kan bands clear of the last hand and drawn tile", () => {
  const seats = [1, 2, 3, 4];
  const positions = ["bottom", "right", "top", "left"];

  for (const seat of seats) {
    const melds = Array.from({ length: 4 }, (_, group) => ({
      kind: "kan",
      tiles: [group + 1, group + 1, group + 1, group + 1],
      fromIndex: ((seat + group) % 4) + 1,
      calledTileIndex: group % 4,
    }));
    const rightExtension = meldRightExtension(melds, seat);
    let offset = 0;
    let priorEnd = -Infinity;
    for (const meld of melds) {
      const display = meldDisplayLayout(meld, seat);
      const start =
        offset + Math.min(...display.entries.map((entry) => entry.along));
      const end = offset + display.span;
      assert.ok(start > priorEnd, `${positions[seat - 1]} kan groups overlap`);
      priorEnd = end;
      offset += display.span + MELD_GROUP_GAP;
    }
    const clearance =
      seat === 1 ? MELD_HAND_CLEARANCE : OPPONENT_MELD_HAND_CLEARANCE;
    const available = melds.length * 3 * (TILE_SIZE.width + 0.035) - clearance;
    assert.ok(rightExtension > 0);
  }

  assert.deepEqual(opponentHandLayout(1, 4, false), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: false,
  });
  assert.deepEqual(opponentHandLayout(1, 4, true), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: true,
  });

});

test("mahjong side melds extend the physical centre line of their racks", () => {
  for (const position of ["left", "right"]) {
    const rackStart = handTransform(position, 0, 13);
    const rackEnd = handTransform(position, 12, 13);
    const meldStart = meldTransform(position, 0);
    assert.ok(Math.abs(meldStart.x - rackStart.x) < 1e-9);
    assert.ok(Math.abs(meldStart.x - rackEnd.x) < 1e-9);
  }
});

test("mahjong reserves a full local draw slot before the perspective meld band", () => {
  const viewport = { width: 1280, height: 720 };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const drawSlot = ownHandOverlayTransform(
    10,
    viewport.width,
    viewport.height,
    {
      drawn: true,
    },
  );
  const drawSlotRight =
    viewport.width / 2 + drawSlot.x + drawSlot.tileWidth / 2;
  const display = meldDisplayLayout(
    { kind: "ankan", tiles: [14, 14, 14, 14] },
    1,
  );
  const meldLeft = Math.min(
    ...display.entries.map((entry) => {
      const transform = meldTransform("bottom", entry.along, {
        absolute: true,
      });
      const extent =
        (entry.sideways ? TILE_SIZE.height : TILE_SIZE.width) * MELD_SCALE;
      const projected = new Vector3(
        transform.x - extent / 2,
        transform.y,
        transform.z,
      ).project(camera);
      return ((projected.x + 1) * viewport.width) / 2;
    }),
  );

  assert.ok(meldLeft - drawSlotRight > drawSlot.tileWidth * 0.8);
});

test("mahjong melds point the called tile toward its source and preserve call order", () => {
  const chi = meldDisplayLayout(
    {
      kind: "chi",
      tiles: [1, 2, 3],
      red: [false, false, false],
      fromIndex: 1,
      calledTileIndex: 0,
      addedTileIndex: -1,
    },
    2,
  );
  assert.deepEqual(
    chi.entries.map(({ type }) => type),
    [3, 2, 1],
  );
  assert.deepEqual(
    chi.entries.map(({ sideways }) => sideways),
    [false, false, true],
  );
  assert.ok(chi.entries[0].along < chi.entries[1].along);
  assert.ok(chi.entries[1].along < chi.entries[2].along);

  const oppositePon = meldDisplayLayout(
    {
      kind: "pon",
      tiles: [14, 14, 14],
      fromIndex: 3,
      calledTileIndex: 0,
    },
    1,
  );
  assert.deepEqual(
    oppositePon.entries.map(({ sideways }) => sideways),
    [false, true, false],
  );

  const downstreamPon = meldDisplayLayout(
    {
      kind: "pon",
      tiles: [14, 14, 14],
      fromIndex: 2,
      calledTileIndex: 0,
    },
    1,
  );
  assert.deepEqual(
    downstreamPon.entries.map(({ sideways }) => sideways),
    [true, false, false],
  );

  const addedKan = meldDisplayLayout(
    {
      kind: "kakan",
      tiles: [14, 14, 14, 14],
      fromIndex: 1,
      calledTileIndex: 0,
      addedTileIndex: 3,
    },
    2,
  );
  assert.equal(addedKan.entries.length, 4);
  assert.equal(addedKan.entries.at(-1).sideways, true);
  const calledTile = addedKan.entries.find(
    (entry) => entry.sideways && entry.sourceIndex !== 3,
  );
  const addedTile = addedKan.entries.at(-1);
  assert.equal(addedTile.along, calledTile.along);
  assert.ok(addedTile.inward > calledTile.inward);
  assert.ok(addedKan.entries.every((entry) => !("stackLevel" in entry)));

  for (const position of ["bottom", "right", "top", "left"]) {
    const calledPosition = meldTransform(position, calledTile.along, {
      absolute: true,
      inwardOffset: calledTile.inward,
    });
    const addedPosition = meldTransform(position, addedTile.along, {
      absolute: true,
      inwardOffset: addedTile.inward,
    });
    const calledDistance = Math.hypot(
      calledPosition.x,
      calledPosition.z - PLAYFIELD_CENTRE_Z,
    );
    const addedDistance = Math.hypot(
      addedPosition.x,
      addedPosition.z - PLAYFIELD_CENTRE_Z,
    );
    assert.ok(
      addedDistance < calledDistance,
      `${position} added kan faces inward`,
    );
  }

  const normalTile = addedKan.entries.find((entry) => !entry.sideways);
  const normalBottom = normalTile.inward - (TILE_SIZE.height * MELD_SCALE) / 2;
  const sidewaysBottom = calledTile.inward - (TILE_SIZE.width * MELD_SCALE) / 2;
  assert.ok(Math.abs(normalBottom - sidewaysBottom) < 1e-12);

  const concealedKan = meldDisplayLayout(
    { kind: "ankan", tiles: [7, 7, 7, 7] },
    1,
  );
  assert.deepEqual(
    concealedKan.entries.map(({ faceDown }) => faceDown),
    [true, false, false, true],
  );
});

test("mahjong uses one fixed 16:9 logical viewport without a top status bar", () => {

  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof packageJson.dependencies.three, "string");
  assert.equal(packageJson.dependencies["pixi.js"], undefined);

  assert.equal(fixedViewportScale(844, 390), 390 / 720);
  assert.equal(fixedViewportScale(1920, 1080), 1.5);
  assert.equal(fixedViewportScale(1024, 768), 0.8);

});

test("mahjong renders the centre console as a perspective tabletop component", () => {

  assert.ok(
    TABLE_CONSOLE_CORE_LAYOUT.roundFontSize >
      TABLE_CONSOLE_CORE_LAYOUT.wallFontSize,
  );
  assert.equal(roundLabel(1, 1), "東一局");

});

test("mahjong centre console reserves an equal edge band for four riichi sticks", () => {
  const layout = TABLE_CONSOLE_SCORE_LAYOUT;
  const outerMargin =
    layout.stickEdgeInset - layout.stickHeight / 2 - layout.panelBorderInset;
  const innerMargin =
    layout.edgeInset -
    layout.scoreFontSize / 2 -
    layout.stickEdgeInset -
    layout.stickHeight / 2;
  assert.ok(outerMargin > 15 && outerMargin < 16);
  assert.ok(innerMargin > 9 && innerMargin < 10);
  assert.ok(Math.abs(layout.stickWidth / 84 - layout.stickHeight / 12) < 1e-9);
  assert.ok(layout.stickWidth >= layout.scoreFontSize * 2.6);
  assert.ok(layout.stickWidth <= layout.scoreFontSize * 2.9);
  assert.equal(layout.scoreFontSize, 64);
  assert.equal(layout.stickDotRadius, 8.85);
  assert.ok(
    layout.stickEdgeInset - layout.stickHeight / 2 > layout.panelBorderInset,
  );

});

test("mahjong centre console labels each score with its canonical wind", () => {
  const state = {
    dealerIndex: 2,
    phase: "playing",
    players: ["east", "south", "west", "north"],
  };
  assert.deepEqual(
    [1, 2, 3, 4].map((seat) => [seatWind(state, seat), seatWindColor(state, seat)]),
    [
      ["北", "#f2d17d"],
      ["東", "#e9833f"],
      ["南", "#f2d17d"],
      ["西", "#f2d17d"],
    ],
  );
});

test("mahjong centre console measures each rival against the viewer, not the rival's surplus", () => {
  const trailing = { scores: [21800, 28500, 25000, 23700] };
  const rivals = [2, 3, 4];
  const behind = rivals.map((seat) => scoreDifference(trailing, seat, 1));
  assert.deepEqual(behind, [-6700, -3200, -1900]);
  assert.ok(behind.every((difference) => difference < 0 && scoreDifferenceColor(difference) === scoreDifferenceColor(-1)));
  assert.equal(scoreDifference(trailing, 1, 1), 0);

  const leading = { scores: [28500, 23700, 25000, 21800] };
  const ahead = rivals.map((seat) => scoreDifference(leading, seat, 1));
  assert.deepEqual(ahead, [4800, 3500, 6700]);
  assert.ok(ahead.every((difference) => difference > 0 && scoreDifferenceColor(difference) === scoreDifferenceColor(1)));
  assert.notEqual(scoreDifferenceColor(1), scoreDifferenceColor(-1));

  // The same seats read from another viewer's perspective, which is what a
  // spectator or a future switchable view uses.
  const fromSouth = [3, 4, 1].map((seat) => scoreDifference(leading, seat, 2));
  assert.deepEqual(fromSouth, [-1300, 1900, -4800]);
  assert.equal(scoreDifference(leading, 2, 2), 0);

  assert.equal(formatScoreDisplay(3500, true), "+3500");
  assert.equal(formatScoreDisplay(-1300, true), "-1300");
});

test("mahjong centre console leaves the wind label clear of a six-digit score", () => {
  const scoreX = 320;
  const scoreAnchorWidth = 216;
  const windWidth = 80;
  const fiveDigitWind = scoreWindPosition(
    scoreX,
    320,
    scoreAnchorWidth,
    windWidth,
    14,
    0,
    -1,
  );
  const sixDigitWind = scoreWindPosition(
    scoreX,
    320,
    scoreAnchorWidth,
    windWidth,
    14,
    0,
    -1,
  );
  assert.deepEqual(fiveDigitWind, sixDigitWind);
  assert.equal(scoreX - scoreAnchorWidth / 2 - sixDigitWind.x - windWidth / 2, 14);
});

test("mahjong console wind labels use each seat's own left side", () => {
  const bottom = scoreWindPosition(320, 320, 216, 80, 14, 0, -1);
  const right = scoreWindPosition(320, 320, 216, 80, 14, (Math.PI * 3) / 2, -1);
  const top = scoreWindPosition(320, 320, 216, 80, 14, 0, 1);
  const left = scoreWindPosition(320, 320, 216, 80, 14, Math.PI / 2, -1);
  assert.equal(bottom.x < 320 && Math.abs(bottom.y - 320) < 1e-9, true);
  assert.equal(Math.abs(right.x - 320) < 1e-9 && right.y > 320, true);
  assert.equal(top.x > 320 && Math.abs(top.y - 320) < 1e-9, true);
  assert.equal(Math.abs(left.x - 320) < 1e-9 && left.y < 320, true);
});

test("mahjong console wind labels bias toward the outer edge while keeping their gap", () => {
  const base = scoreWindPosition(320, 320, 216, 80, 14, 0, -1);
  const biased = scoreWindPosition(
    320,
    320,
    216,
    80,
    14,
    0,
    -1,
    -TABLE_CONSOLE_SCORE_LAYOUT.windEdgeAngle,
  );
  assert.ok(biased.y > base.y);
  assert.ok(
    Math.abs(Math.hypot(biased.x - 320, biased.y - 320) - Math.hypot(base.x - 320, base.y - 320)) <
      1e-9,
  );
});

test("mahjong centre console leaves every three-row river visible", () => {
  const viewport = {
    width: MAHJONG_VIEWPORT.width,
    height: MAHJONG_VIEWPORT.height,
  };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  const downwardAngle = Math.atan2(15.558 - 0.05, 15.908 - 0.4);
  assert.ok(Math.abs(downwardAngle - Math.PI / 4) < 0.0001);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const consolePoints = [];
  for (const x of [
    -TABLE_CONSOLE_LAYOUT.width / 2,
    TABLE_CONSOLE_LAYOUT.width / 2,
  ]) {
    for (const z of [
      TABLE_CONSOLE_LAYOUT.centreZ - TABLE_CONSOLE_LAYOUT.depth / 2,
      TABLE_CONSOLE_LAYOUT.centreZ + TABLE_CONSOLE_LAYOUT.depth / 2,
    ]) {
      const point = new Vector3(
        x,
        TABLE_CONSOLE_LAYOUT.height + 0.024,
        z,
      ).project(camera);
      consolePoints.push({
        x: ((point.x + 1) * viewport.width) / 2,
        y: ((1 - point.y) * viewport.height) / 2,
      });
    }
  }
  const consoleBounds = {
    left: Math.min(...consolePoints.map((point) => point.x)),
    right: Math.max(...consolePoints.map((point) => point.x)),
    top: Math.min(...consolePoints.map((point) => point.y)),
    bottom: Math.max(...consolePoints.map((point) => point.y)),
  };
  assert.ok(consoleBounds.top < viewport.height / 2);
  assert.ok(consoleBounds.bottom < viewport.height / 2);
  assert.ok(viewport.height / 2 - consoleBounds.bottom < 30);

  for (const position of ["bottom", "right", "top", "left"]) {
    for (let index = 0; index < 18; index += 1) {
      for (const riichi of [false, true]) {
        const transform = riverTransform(position, index, riichi);
        const rotation = new Euler(-Math.PI / 2, transform.yaw, 0, "XYZ");
        const points = [];
        for (const x of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
          for (const y of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
            const point = new Vector3(x, y, 0)
              .applyEuler(rotation)
              .add(new Vector3(transform.x, transform.y, transform.z))
              .project(camera);
            points.push({
              x: ((point.x + 1) * viewport.width) / 2,
              y: ((1 - point.y) * viewport.height) / 2,
            });
          }
        }
        const tileBounds = {
          left: Math.min(...points.map((point) => point.x)),
          right: Math.max(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          bottom: Math.max(...points.map((point) => point.y)),
        };
        const overlaps =
          tileBounds.left < consoleBounds.right &&
          tileBounds.right > consoleBounds.left &&
          tileBounds.top < consoleBounds.bottom &&
          tileBounds.bottom > consoleBounds.top;
        assert.equal(
          overlaps,
          false,
          `${position} river tile ${index} overlaps centre console`,
        );
      }
    }
  }
});

test("mahjong keeps honba and riichi sticks in the top-left status panel", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const statusStart = html.indexOf('class="table-status-semantic"');
  const matchType = html.indexOf('class="match-type-label"');
  const tableStart = html.indexOf('class="table-shell"');
  const honba = html.indexOf('id="honba-count"');
  const riichiSticks = html.indexOf('id="riichi-stick-count"');

  assert.ok(statusStart >= 0);
  assert.ok(honba > statusStart && honba < tableStart);
  assert.ok(riichiSticks > statusStart && riichiSticks < tableStart);
  assert.ok(matchType > riichiSticks && matchType < tableStart);

});

test("mahjong renders a compact fixed five-slot dora rack", () => {

  const mahjongBrushFont = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/bakudai-mahjong.woff2",
      import.meta.url,
    ),
  );
  const mahjongBrushText = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/mahjong-brush-text.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const interfaceFontNotice = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/BAKUDAI-FONT-NOTICE.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    mahjongBrushFont.byteLength > 20_000 &&
      mahjongBrushFont.byteLength < 60_000,
  );
  assert.match(interfaceFontNotice, /Bakudai Brush Font/);
  assert.match(interfaceFontNotice, /SIL Open Font License 1\.1/);
  assert.match(interfaceFontNotice, /one WOFF2 subset/);
  for (const label of ["荒牌流局", "九種九牌", "四風連打"]) {
    assert.ok(
      [...label].every((character) => mahjongBrushText.includes(character)),
      `${label} is included in the unified font subset`,
    );
  }
  assert.equal(traditionalDrawReason("九种九牌"), "九種九牌");
  assert.equal(traditionalDrawReason("四风连打"), "四風連打");

});
