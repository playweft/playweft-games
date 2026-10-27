import assert from "node:assert/strict";
import test from "node:test";
import { CAREER_KEYS, CAREER_TIERS, createCareer, createCareerStore, parseCareer, settleCareer, placementTier, careerSummary, hasPendingPlacementResult } from "../games/mahjong/career/career.js";
import { createMahjongSoloSave } from "../games/mahjong/replay/solo-save.js";
import { evaluateCareerDiscard } from "../games/mahjong/career/evaluate-discard.js";

const save = (id) => createMahjongSoloSave({ randomSeed: "0123456789abcdef0123456789abcdef", matchId: id, matchType: "hanchan", rules: {} });
function completed(career, id, scores = [40000, 20000, 20000, 20000]) {
  const current = { ...career, currentMatch: save(id), analysis: { ...career.analysis, matchId: id } };
  return settleCareer(current, { matchEnded: true, players: ["mahjong-player", "a", "b", "c"], scores });
}
function ranked() {
  let career = createCareer();
  for (let index = 0; index < 3; index++) career = completed(career, `placement-${index}`, [30000, 25000, 24000, 21000]);
  return career;
}

test("three completed matches place a career and settlement is idempotent", () => {
  let career = createCareer();
  career = completed(career, "first");
  assert.equal(career.phase, "placement");
  assert.equal(career.placement.length, 1);
  const repeated = settleCareer(career, { matchEnded: true });
  assert.equal(repeated, career);
  career = completed(career, "second");
  assert.equal(career.tier, null);
  career = completed(career, "third");
  assert.equal(career.phase, "ranked");
  assert.equal(career.tier, "C2");
  assert.equal(career.completedMatches, 3);
  assert.equal(career.period.results.length, 0);
  assert.deepEqual(parseCareer(JSON.stringify(career)), career);
});

test("league changes tier only after eight matches and starts a fresh period", () => {
  let career = ranked();
  for (let index = 0; index < 7; index++) career = completed(career, `period-${index}`);
  assert.equal(career.tier, "C3");
  assert.equal(career.period.results.length, 7);
  career = completed(career, "eighth");
  assert.equal(career.tier, "C2");
  assert.equal(career.highestTier, "C2");
  assert.equal(career.lastSettlement.outcome, "promoted");
  assert.equal(career.lastSettlement.total, 360);
  assert.deepEqual(career.period, { number: 2, results: [] });
  for (let index = 0; index < 8; index++) career = completed(career, `loss-${index}`, [10000, 30000, 30000, 30000]);
  assert.equal(career.tier, "C3");
  assert.equal(career.highestTier, "C2");
  assert.equal(career.lastSettlement.outcome, "relegated");
});

test("initial grade stays pending across reload until acknowledged, with compatibility for old slots", () => {
  assert.equal(hasPendingPlacementResult(completed(createCareer(), "first")), false);
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const store = createCareerStore(storage);
  store.write(1, ranked());
  const reloaded = createCareerStore(storage);
  assert.equal(hasPendingPlacementResult(reloaded.activate(1)), true);
  reloaded.clearMatch();
  assert.equal(hasPendingPlacementResult(reloaded.read(1)), true);
  reloaded.acknowledgePlacementResult();
  assert.equal(hasPendingPlacementResult(createCareerStore(storage).read(1)), false);
  const old = ranked();
  delete old.placementResultSeen;
  assert.equal(hasPendingPlacementResult(parseCareer(JSON.stringify(old))), true);
  old.currentMatch = save("league-already-started");
  assert.equal(hasPendingPlacementResult(old), false);
  assert.equal(hasPendingPlacementResult(completed(ranked(), "league-finished")), false);
});

test("E1 and A1 bound the ladder, neutral total retains tier", () => {
  for (const [tier, scores] of [["E1", [10000, 30000, 30000, 30000]], ["A1", [40000, 20000, 20000, 20000]], ["B2", [15000, 70000, 10000, 5000]]]) {
    let career = { ...ranked(), tier, highestTier: tier };
    for (let index = 0; index < 8; index++) career = completed(career, `match-${index}`, scores);
    assert.equal(career.tier, tier);
    assert.equal(career.lastSettlement.outcome, "retained");
  }
  assert.equal(CAREER_TIERS[0], "E1");
  assert.equal(CAREER_TIERS.at(-1), "A1");
});

function placementResults(points, { reviewed = 0, quality = 100, major = 0, agreed = 0 } = {}) {
  const results = ranked().placement.map((result) => ({ ...result, points: 0, analysis: {
    ...result.analysis, eligible: 0, agreed: 0, reviewed: 0, qualityTotal: 0, majorMistakes: 0,
  } }));
  results[0].points = points;
  Object.assign(results[0].analysis, { eligible: Math.max(reviewed, agreed), agreed, reviewed, qualityTotal: Math.round(quality * reviewed), majorMistakes: major });
  return results;
}

test("120 total points grants C2 independently of decision quality and sample size", () => {
  assert.equal(placementTier(placementResults(120)), "C2");
  assert.equal(placementTier(placementResults(119.9)), "C3");
  assert.equal(placementTier(placementResults(120, { reviewed: 30, quality: 0, major: 30 })), "C2");
  assert.equal(placementTier(placementResults(1000)), "C2");
});

test("a saved placement from the previous rule is not recalculated on load or repeated settlement", () => {
  let career = createCareer();
  for (let index = 0; index < 3; index++) career = completed(career, `previous-${index}`);
  career.tier = career.highestTier = "C3";
  career.lastSettlement.nextTier = "C3";
  const loaded = parseCareer(JSON.stringify(career));
  assert.equal(loaded.placement.reduce((sum, result) => sum + result.points, 0), 135);
  assert.equal(loaded.tier, "C3");
  assert.equal(settleCareer(loaded, { matchEnded: true }), loaded);
});

test("90-point decision route uses strict quality >80, inclusive 10% mistakes and at least 30 reviews", () => {
  assert.equal(placementTier(placementResults(90, { reviewed: 30, quality: 81, major: 3 })), "C2");
  assert.equal(placementTier(placementResults(90, { reviewed: 30, quality: 80, major: 3 })), "C3");
  assert.equal(placementTier(placementResults(90, { reviewed: 30, quality: 90, major: 4 })), "C3");
  assert.equal(placementTier(placementResults(90, { reviewed: 29 })), "C3");
  assert.equal(placementTier(placementResults(90, { agreed: 100 })), "C3");
  assert.equal(placementTier(placementResults(89.9, { reviewed: 30 })), "D1");
});

test("decision quality is weighted across the three matches rather than averaging match averages", () => {
  const results = placementResults(90);
  results[0].analysis = { ...results[0].analysis, eligible: 5, reviewed: 5, qualityTotal: 500 };
  results[1].analysis = { ...results[1].analysis, eligible: 25, reviewed: 25, qualityTotal: 1900 };
  assert.equal(placementTier(results), "C3"); // 2400 / 30 = 80, not (100 + 76) / 2.
  results[1].analysis.qualityTotal += 1;
  assert.equal(placementTier(results), "C2");
});

test("other initial grades follow total-point thresholds without a later tier adjustment", () => {
  for (const [points, tier] of [[90, "C3"], [89.9, "D1"], [30, "D1"], [29.9, "D2"], [-30, "D2"], [-30.1, "D3"], [-90, "D3"], [-90.1, "E1"]]) {
    assert.equal(placementTier(placementResults(points)), tier);
    if (points < 90) assert.equal(placementTier(placementResults(points, { reviewed: 30 })), tier);
    assert.equal(placementTier(placementResults(points, { reviewed: 30, quality: 0, major: 30 })), tier);
  }
});

test("near-equivalent alternatives receive placement credit despite low exact agreement", () => {
  const results = ranked().placement.map((entry) => ({ ...entry, analysis: {
    ...entry.analysis, eligible: 20, agreed: 0, reviewed: 20, qualityTotal: 2000, majorMistakes: 0,
  } }));
  assert.equal(placementTier(results), "C2");
  for (const result of results) { result.analysis.qualityTotal = 800; result.analysis.majorMistakes = 10; }
  assert.equal(placementTier(results), "C3");
});

test("career slots isolate games, track decisions and retain a finished checkpoint", () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const store = createCareerStore(storage);
  assert.throws(() => store.activate(4));
  store.activate(1);
  store.persistMatch(save("one"));
  store.persistMatch(save("one"), null, { eligible: true, agreed: false, review: { quality: 80, major: false } });
  assert.equal(store.read(1).analysis.eligible, 1);
  assert.equal(store.read(1).analysis.qualityTotal, 80);
  store.deactivate();
  store.activate(2);
  store.persistMatch(save("two"));
  assert.equal(store.read(1).currentMatch.matchId, "one");
  assert.equal(store.read(2).currentMatch.matchId, "two");
  assert.equal(store.read(3), null);
  assert.equal(entries.size, 2);
  store.activate(1);
  const state = { matchEnded: true, players: ["a", "mahjong-player", "b", "c"], scores: [20000, 40000, 20000, 20000] };
  store.persistMatch(save("one"), state);
  store.persistMatch(save("one"), state);
  assert.equal(store.read(1).placement.length, 1);
  assert.equal(store.read(1).placement[0].rank, 1);
  assert.equal(store.read(1).placement[0].points, 45);
  assert.equal(store.read(1).currentMatch.matchId, "one");
  store.clearMatch();
  assert.equal(store.read(1).currentMatch, null);
  assert.equal(store.read(1).completedMatches, 1);
  assert.ok(CAREER_KEYS.every((key) => key.startsWith("playweft.mahjong.career.")));
});

test("bad saves are rejected without replacing their contents", () => {
  for (const mutation of [
    (c) => { c.schemaVersion = 0; }, (c) => { c.currentMatch = {}; },
    (c) => { c.phase = "ranked"; c.tier = "S"; },
    (c) => { c.analysis.agreed = 1; }, (c) => { c.lastSettlement = {}; },
  ]) {
    const career = createCareer(); mutation(career);
    assert.throws(() => parseCareer(JSON.stringify(career)));
  }
  assert.throws(() => parseCareer("broken"));
  assert.equal(parseCareer(null), null);
});

test("career discard review distinguishes near-equivalence, large loss, red fives and forced turns", () => {
  const state = { phase: "playing", turnIndex: 1, players: ["mahjong-player"], hands: { "mahjong-player": [18, 19, 17, 2] }, drawnTile: 3, riichi: {} };
  let scoreLoss = 10;
  const game = { checkpoint: () => ({ state }), aiAction: () => ({ action: { type: "discard", tileId: 18 } }),
    aiActionReview: () => ({ mode: "push", scoreLoss }) };
  const close = evaluateCareerDiscard(game, { type: "discard", tileId: 2 }, "mahjong-player");
  assert.equal(close.agreed, false);
  assert.equal(close.review.quality, 100);
  assert.equal(evaluateCareerDiscard(game, { type: "discard", tileId: 19 }, "mahjong-player").agreed, true);
  assert.equal(evaluateCareerDiscard(game, { type: "discard", tileId: 17 }, "mahjong-player").agreed, false);
  scoreLoss = 314;
  assert.equal(evaluateCareerDiscard(game, { type: "discard", tileId: 2 }, "mahjong-player").review.quality, 0);
  state.riichi["mahjong-player"] = true;
  assert.equal(evaluateCareerDiscard(game, { type: "discard", tileId: 2 }, "mahjong-player"), null);
  assert.equal(evaluateCareerDiscard(game, { type: "pass" }, "mahjong-player"), null);
});

test("slot summaries identify resumable games and next periods", () => {
  assert.equal(careerSummary(null).action, "开始定段赛");
  assert.equal(careerSummary(createCareer()).action, "开始第 1 场");
  const career = ranked();
  assert.match(careerSummary(career).heading, /C3/);
  assert.equal(careerSummary(career).action, "开始下一场");
  career.currentMatch = save("pending");
  assert.equal(careerSummary(career).action, "继续对局");
});
