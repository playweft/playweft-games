import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";
import { createMahjongCareerResult } from "../games/mahjong/app/career-result-controller.js";
import { createCareerStore, hasPendingPlacementResult } from "../games/mahjong/career/career.js";
import { createMahjongSoloSave } from "../games/mahjong/replay/solo-save.js";

async function fixture({ flush = async () => {}, onStartLeague = async () => {}, onReturnToLobby = async () => {}, showError = assert.fail } = {}) {
  const window = new Window();
  const html = await readFile("games/mahjong/index.html", "utf8");
  window.document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const data = new Map();
  const store = createCareerStore({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  store.activate(2);
  const finishMatch = (id, scores) => {
    const save = createMahjongSoloSave({ randomSeed: "0123456789abcdef0123456789abcdef", matchId: id, matchType: "hanchan", rules: {} });
    store.persistMatch(save, { matchEnded: true, players: ["mahjong-player", "a", "b", "c"], scores });
    return store.read(2);
  };
  const page = createMahjongCareerResult({ document: window.document, careerStore: store, flush, onStartLeague, onReturnToLobby, showError });
  const panel = window.document.querySelector("#career-result");
  return { window, store, page, panel, finishMatch, async close() { page.destroy(); await window.happyDOM.close(); } };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function place(f) {
  f.finishMatch("first", [41000, 24000, 19000, 16000]); f.store.clearMatch();
  f.finishMatch("second", [33000, 35000, 17000, 15000]); f.store.clearMatch();
  return f.finishMatch("third", [47000, 22000, 18000, 13000]);
}

test("third placement reveals the persisted grade and three real results, without decision evaluation", async () => {
  const f = await fixture();
  try {
    assert.equal(f.page.show(f.finishMatch("first", [40000, 30000, 20000, 10000])), false);
    f.store.clearMatch();
    f.finishMatch("second", [33000, 35000, 17000, 15000]); f.store.clearMatch();
    const career = f.finishMatch("third", [47000, 22000, 18000, 13000]);
    assert.equal(f.page.show(career), true);
    assert.equal(f.panel.hidden, false);
    assert.equal(f.panel.querySelector("#career-result-grade").textContent, career.tier);
    assert.deepEqual([...f.panel.querySelectorAll("tbody tr")].map((row) => row.textContent), ["第一场1位40000+45.0", "第二场2位33000+18.0", "第三场1位47000+52.0"]);
    assert.equal(f.panel.querySelector("#career-result-total").textContent, "+115.0 pt");
    assert.doesNotMatch(f.panel.textContent, /决策|一致率|AI|评价|%/);
    assert.equal(f.window.document.activeElement.id, "career-result-start");
    assert.equal(hasPendingPlacementResult(f.store.read(2)), true);
  } finally { await f.close(); }
});

for (const [button, action] of [["start", "league"], ["back", "lobby"]]) {
  test(`${action} waits for storage, acknowledges only this slot and prevents double activation`, async () => {
    let flushed;
    const calls = [];
    const f = await fixture({ flush: () => new Promise((resolve) => { flushed = resolve; }),
      onStartLeague: async (slot) => calls.push(["league", slot]), onReturnToLobby: async (slot) => calls.push(["lobby", slot]) });
    try {
      f.page.show(place(f));
      const target = f.panel.querySelector(`#career-result-${button}`);
      target.click(); target.click();
      assert.deepEqual(calls, []);
      assert.equal(target.disabled, true);
      flushed(); await tick();
      assert.deepEqual(calls, [[action, 2]]);
      assert.equal(f.panel.hidden, true);
      assert.equal(hasPendingPlacementResult(f.store.read(2)), false);
      assert.equal(f.store.read(1), null);
    } finally { await f.close(); }
  });
}

test("storage failure keeps the result visible and allows retry before starting a league", async () => {
  let fail = true;
  const errors = [], starts = [];
  const f = await fixture({ flush: async () => { if (fail) throw new Error("offline"); }, showError: (message) => errors.push(message), onStartLeague: async (slot) => starts.push(slot) });
  try {
    f.page.show(place(f));
    const start = f.panel.querySelector("#career-result-start");
    start.click(); await tick();
    assert.deepEqual(errors, ["offline"]);
    assert.deepEqual(starts, []);
    assert.equal(f.panel.hidden, false);
    assert.equal(start.disabled, false);
    fail = false; start.click(); await tick();
    assert.deepEqual(starts, [2]);
  } finally { await f.close(); }
});
