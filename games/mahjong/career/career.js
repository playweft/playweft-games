import { HUMAN_ID } from "../rules/constants.js";
import { getGameStorage } from "../../../src/game-storage-cache.js";
import { readMahjongSoloSave } from "../replay/solo-save.js";

export const CAREER_KEYS = [1, 2, 3].map((slot) => `playweft.mahjong.career.slot-${slot}.v1`);
export const CAREER_TIERS = ["E1", "D3", "D2", "D1", "C3", "C2", "C1", "B2", "B1", "A2", "A1"];
export const PLACEMENT_MATCHES = 3;
export const PLACEMENT_C2_POINTS = 120;
export const PLACEMENT_MIN_REVIEWS = 30;
export const LEAGUE_MATCHES = 8;
export const PROMOTION_POINTS = 80;
export const RELEGATION_POINTS = -80;
export const CAREER_AI_VERSION = "discard-policy-v1";
const round = (value) => Math.round(value * 10) / 10;

export function createCareer({ id = crypto.randomUUID(), now = Date.now() } = {}) {
  return {
    schemaVersion: 1, rulesVersion: 1, careerId: id,
    createdAt: now, updatedAt: now, revision: 0,
    phase: "placement", tier: null, highestTier: null,
    placement: [], period: { number: 1, results: [] },
    completedMatches: 0, history: [], lastSettlement: null,
    placementResultSeen: false,
    analysis: { matchId: null, eligible: 0, agreed: 0, unavailable: 0, reviewed: 0, qualityTotal: 0, majorMistakes: 0, version: CAREER_AI_VERSION },
    currentMatch: null,
  };
}

const validAnalysis = (value) => value && value.version === CAREER_AI_VERSION &&
  [value.eligible, value.agreed, value.unavailable].every((n) => Number.isSafeInteger(n) && n >= 0) &&
  [value.reviewed, value.qualityTotal, value.majorMistakes].every((n) => Number.isSafeInteger(n) && n >= 0) &&
  value.reviewed <= value.eligible && value.qualityTotal <= value.reviewed * 100 && value.majorMistakes <= value.reviewed &&
  value.agreed <= value.eligible && (value.matchId === null || typeof value.matchId === "string");
const validResult = (value) => value && typeof value.matchId === "string" &&
  Number.isFinite(value.points) && Number.isFinite(value.score) &&
  Number.isInteger(value.rank) && value.rank >= 1 && value.rank <= 4 && validAnalysis(value.analysis);

export function parseCareer(raw) {
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || value.schemaVersion !== 1 || value.rulesVersion !== 1 ||
      typeof value.careerId !== "string" || !value.careerId ||
      !["placement", "ranked"].includes(value.phase) ||
      (value.phase === "placement" ? value.tier !== null : !CAREER_TIERS.includes(value.tier)) ||
      (value.highestTier !== null && !CAREER_TIERS.includes(value.highestTier)) ||
      !Array.isArray(value.placement) || value.placement.length > PLACEMENT_MATCHES ||
      !value.placement.every(validResult) ||
      (value.phase === "ranked" && value.placement.length !== PLACEMENT_MATCHES) ||
      (value.phase === "placement" && value.placement.length >= PLACEMENT_MATCHES) ||
      !Number.isSafeInteger(value.period?.number) || value.period.number < 1 ||
      !Array.isArray(value.period.results) || value.period.results.length >= LEAGUE_MATCHES ||
      !value.period.results.every(validResult) ||
      !Number.isSafeInteger(value.completedMatches) || value.completedMatches < 0 ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      (value.placementResultSeen !== undefined && typeof value.placementResultSeen !== "boolean") ||
      ![value.createdAt, value.updatedAt].every(Number.isFinite) ||
      !Array.isArray(value.history) || value.history.length > 32 ||
      !validAnalysis(value.analysis) ||
      (value.lastSettlement !== null && (!validResult(value.lastSettlement) ||
        !["recorded", "placed", "promoted", "relegated", "retained"].includes(value.lastSettlement.outcome))) ||
      (value.currentMatch !== null && !readMahjongSoloSave({ getItem: () => JSON.stringify(value.currentMatch) }))) {
    throw new Error("生涯存档格式无效，原始数据已保留。");
  }
  return value;
}

export function placementTier(results) {
  const points = round(results.reduce((total, result) => total + result.points, 0));
  if (points >= PLACEMENT_C2_POINTS) return "C2";
  const reviewed = results.reduce((total, result) => total + result.analysis.reviewed, 0);
  const quality = results.reduce((total, result) => total + result.analysis.qualityTotal, 0);
  const major = results.reduce((total, result) => total + result.analysis.majorMistakes, 0);
  // A second C2 route rewards reviewed choices, including near-equivalent
  // alternatives. Exact agreement alone is not a quality estimate.
  if (points >= 90 && reviewed >= PLACEMENT_MIN_REVIEWS &&
      quality > 80 * reviewed && major * 10 <= reviewed) return "C2";
  return points >= 90 ? "C3" : points >= 30 ? "D1" : points >= -30 ? "D2" : points >= -90 ? "D3" : "E1";
}

// Old saves can reveal their initial grade once, unless league play has already begun.
export function hasPendingPlacementResult(career) {
  return Boolean(career?.phase === "ranked" && !career.placementResultSeen &&
    career.completedMatches === PLACEMENT_MATCHES && career.lastSettlement?.outcome === "placed" &&
    (!career.currentMatch || career.currentMatch.matchId === career.lastSettlement.matchId));
}

export function settleCareer(career, state, humanId = HUMAN_ID, now = Date.now()) {
  const matchId = career.currentMatch?.matchId;
  if (!matchId || !state?.matchEnded || career.lastSettlement?.matchId === matchId) return career;
  const seat = state.players.indexOf(humanId);
  if (seat < 0 || state.scores.length !== 4 || !state.scores.every(Number.isFinite))
    throw new Error("生涯结算缺少有效成绩");
  const score = state.scores[seat];
  const rank = 1 + state.scores.filter((other, index) => other > score || (other === score && index < seat)).length;
  // 25,000 starting/return points, +30/+10/-10/-30 placement bonus. This is
  // our game progression rule, not an assertion of official league scoring.
  const result = { matchId, rank, score, points: round((score - 25000) / 1000 + [30, 10, -10, -30][rank - 1]),
    analysis: { ...career.analysis }, endedAt: now };
  const next = structuredClone(career);
  const previousTier = career.tier;
  let outcome = "recorded";
  let total = result.points;
  if (next.phase === "placement") {
    next.placement.push(result);
    total = round(next.placement.reduce((sum, entry) => sum + entry.points, 0));
    if (next.placement.length === PLACEMENT_MATCHES) {
      next.phase = "ranked";
      next.tier = placementTier(next.placement);
      next.highestTier = next.tier;
      outcome = "placed";
    }
  } else {
    next.period.results.push(result);
    total = round(next.period.results.reduce((sum, entry) => sum + entry.points, 0));
    if (next.period.results.length === LEAGUE_MATCHES) {
      const index = CAREER_TIERS.indexOf(next.tier);
      const direction = total >= PROMOTION_POINTS ? 1 : total <= RELEGATION_POINTS ? -1 : 0;
      const nextIndex = Math.max(0, Math.min(CAREER_TIERS.length - 1, index + direction));
      next.tier = CAREER_TIERS[nextIndex];
      outcome = nextIndex > index ? "promoted" : nextIndex < index ? "relegated" : "retained";
      next.history = [...next.history, { number: next.period.number, tier: previousTier, nextTier: next.tier, points: total, outcome }].slice(-32);
      next.period = { number: next.period.number + 1, results: [] };
      if (nextIndex > CAREER_TIERS.indexOf(next.highestTier)) next.highestTier = next.tier;
    }
  }
  next.completedMatches += 1;
  next.lastSettlement = { ...result, outcome, previousTier, nextTier: next.tier, total };
  next.updatedAt = now;
  return next;
}

export function createCareerStore(storage = getGameStorage("mahjong")) {
  let activeSlot = null;
  function key(slot) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new RangeError("Invalid career slot");
    return CAREER_KEYS[slot - 1];
  }
  function read(slot) { return parseCareer(storage.getItem(key(slot))); }
  function write(slot, career) {
    const next = { ...career, revision: career.revision + 1, updatedAt: Date.now() };
    storage.setItem(key(slot), JSON.stringify(next));
    return next;
  }
  return {
    read, write,
    get activeSlot() { return activeSlot; },
    activate(slot) {
      key(slot);
      let career = read(slot);
      if (!career) career = write(slot, createCareer());
      activeSlot = slot;
      return career;
    },
    deactivate() { activeSlot = null; },
    acknowledgePlacementResult() {
      if (!activeSlot) throw new Error("No active career");
      const career = read(activeSlot);
      if (hasPendingPlacementResult(career)) write(activeSlot, { ...career, placementResultSeen: true });
    },
    persistMatch(save, state, evaluation) {
      if (!activeSlot) throw new Error("No active career");
      let career = read(activeSlot);
      if (career.currentMatch && career.currentMatch.matchId !== save.matchId)
        throw new Error("生涯对局与存档不匹配");
      if (career.analysis.matchId !== save.matchId) {
        career.analysis = { matchId: save.matchId, eligible: 0, agreed: 0, unavailable: 0, reviewed: 0, qualityTotal: 0, majorMistakes: 0, version: CAREER_AI_VERSION };
      }
      career.currentMatch = save;
      if (evaluation?.eligible) {
        career.analysis.eligible += 1;
        career.analysis.agreed += evaluation.agreed ? 1 : 0;
        if (evaluation.review) {
          career.analysis.reviewed += 1;
          career.analysis.qualityTotal += evaluation.review.quality;
          career.analysis.majorMistakes += evaluation.review.major ? 1 : 0;
        }
      } else if (evaluation?.unavailable) career.analysis.unavailable += 1;
      career = settleCareer(career, state);
      write(activeSlot, career);
      return true;
    },
    clearMatch() {
      if (!activeSlot) return;
      const career = read(activeSlot);
      write(activeSlot, { ...career, currentMatch: null });
    },
  };
}

export function careerSummary(career) {
  if (!career) return { heading: "尚未开始", progress: "三场南风战，开启定段", action: "开始定段赛" };
  const pending = career.currentMatch && career.lastSettlement?.matchId !== career.currentMatch.matchId;
  if (career.phase === "placement") return {
    heading: "定段赛", progress: `已完成 ${career.placement.length} / ${PLACEMENT_MATCHES} 场`,
    action: pending ? "继续对局" : `开始第 ${career.placement.length + 1} 场`,
  };
  const total = round(career.period.results.reduce((sum, result) => sum + result.points, 0));
  return { heading: `${career.tier} 级`, progress: `第 ${career.period.number} 期 · ${career.period.results.length} / ${LEAGUE_MATCHES} 场 · ${total > 0 ? "+" : ""}${total.toFixed(1)} pt`,
    action: pending ? "继续对局" : "开始下一场" };
}
