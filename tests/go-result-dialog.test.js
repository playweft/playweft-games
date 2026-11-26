import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Window } from "happy-dom";
import { createGoResultDialog, goResultSummary } from "../games/go/result-dialog.js";

const scoring = {
  phase: "scoring", ended: false, blackIndex: 2, winnerIndex: 0,
  settings: { rules: "chinese", komi: 7, tieBreak: "first-pass" },
  scores: { black: 0, white: 7 }, lastEvent: { kind: "scoring_started" },
};
const finished = {
  ...scoring, phase: "ended", ended: true, winnerIndex: 2,
  scores: { black: 185, white: 183 }, lastEvent: { kind: "scored" },
};

test("Go results distinguish scored wins, tie decisions, resignation and departure", () => {
  assert.equal(goResultSummary(scoring).title, "正在计分…");
  assert.equal(goResultSummary(scoring).white, "—", "do not show unconfirmed placeholder scores");
  assert.equal(goResultSummary(finished).title, "黑方获胜");
  assert.equal(goResultSummary(finished).black, "185");
  assert.equal(goResultSummary(finished).reason, "黑方领先 2 目");
  const tied = { ...finished, scores: { black: 184, white: 184 } };
  assert.match(goResultSummary(tied).reason, /先停着者胜/);
  assert.equal(goResultSummary({ ...tied, winnerIndex: 0 }).title, "和棋");
  const resignation = { ...finished, lastEvent: { kind: "resigned", playerIndex: 1 } };
  assert.equal(goResultSummary(resignation).reason, "白方认输");
  assert.equal(goResultSummary(resignation).black, "—", "resignation does not produce a score");
  assert.equal(goResultSummary({ ...resignation, lastEvent: { kind: "player_left", playerIndex: 1 } }).reason, "白方离开了对局");
});

test("Go scoring updates the same dialog without reopening after dismissal; new rounds and undo reset it", async () => {
  const browser = new Window();
  try {
    const html = await readFile(new URL("../games/go/index.html", import.meta.url), "utf8");
    browser.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ""));
    const root = browser.document.querySelector("#result-panel");
    let opens = 0, isOpen = false, rematches = 0, homes = 0, retries = 0;
    const dialog = {
      get isOpen() { return isOpen; },
      setOpen(open) { if (open && !isOpen) opens++; isOpen = open; },
    };
    const view = createGoResultDialog({ root, dialog,
      onRematch: () => rematches++, onHome: () => homes++,
      onRetryScore: () => retries++,
    });
    const context = { key: "game:1", participant: true, local: true, busy: false };
    const rematch = root.querySelector("#rematch-button");
    view.update(scoring, context);
    assert.equal(opens, 1);
    assert.equal(rematch.hidden, false, "reserve the action during scoring");
    assert.equal(rematch.disabled, true);
    assert.equal(view.showError("计分失败，请重试"), true);
    assert.equal(rematch.textContent, "重新计分");
    rematch.click();
    assert.equal(retries, 1);
    assert.equal(rematch.disabled, true);
    view.update(finished, context);
    assert.equal(opens, 1, "scoring completes inside the existing dialog");
    assert.equal(root.querySelector("#result-headline").textContent, "黑方获胜");
    assert.equal(rematch.disabled, false);
    assert.equal(rematch.textContent, "再来一局");
    rematch.click();
    root.querySelector("#result-home").click();
    assert.equal(rematches, 1);
    assert.equal(homes, 1);
    dialog.setOpen(false);
    view.update(finished, { ...context, busy: true });
    assert.equal(opens, 1);
    assert.equal(rematch.disabled, true);
    view.open();
    assert.equal(opens, 2, "the menu can reopen a dismissed result");
    dialog.setOpen(false);
    view.update(scoring, { ...context, key: "game:2" });
    assert.equal(opens, 3);
    view.update({ ...scoring, phase: "playing" }, { ...context, key: "game:2" });
    assert.equal(isOpen, false, "undoing a finished AI game closes its result");
    view.update(finished, { ...context, key: "game:2" });
    assert.equal(opens, 4);
    view.update(finished, { ...context, key: "game:2", participant: false, local: false });
    assert.equal(rematch.hidden, true, "spectators cannot rematch");
    assert.equal(root.querySelector("#result-home").hidden, true, "room results cannot navigate out as a local game");
    view.update(scoring, { ...context, key: "game:3" });
    dialog.setOpen(false);
    assert.equal(view.showError("计分失败，请重试"), false, "a closed dialog also allows the toast to report the error");
    view.open();
    assert.equal(root.querySelector("#result-reason").textContent, "计分失败，请重试");
    assert.equal(rematch.disabled, false, "scoring can be retried after reopening the result");
  } finally {
    await browser.happyDOM.abort();
  }
});
