import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createGoRecordReview } from "../games/go/record-review.js";

function harness(enabled = true) {
  const view = new Window();
  view.document.write(readFileSync(new URL("../games/go/index.html", import.meta.url), "utf8"));
  const root = view.document.querySelector("#game-screen");
  root.hidden=false;
  const find = id => root.querySelector(`#${id}`);
  const portrait = new view.EventTarget();
  portrait.matches = true;
  const headerBack = new view.EventTarget();
  headerBack.matches = true;
  view.matchMedia = query => query.includes("1200px") ? portrait : headerBack;
  for (const icon of root.querySelectorAll("[data-play-icon], [data-pause-icon]")) {
    const svg = view.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const attr of icon.attributes) svg.setAttribute(attr.name, attr.value);
    icon.replaceWith(svg);
  }
  const timers = new Map(), selections = [];
  let sequence = 0;
  view.setInterval = callback => { timers.set(++sequence, callback); return sequence; };
  view.clearInterval = id => timers.delete(id);
  const review = createGoRecordReview({ root, enabled, beforeAnalysis() {}, onSelect(index) {
    selections.push(index); review.select(index);
  } });
  return { view, root, find, review, selections, timers,
    open(count = 4, saved, position = () => ({ board: [[0]] })) { review.open("record", count, position, saved); },
    setPortrait(value) { portrait.matches=value; portrait.dispatchEvent(new view.Event("change")); },
    setHeaderBack(value) { headerBack.matches=value; headerBack.dispatchEvent(new view.Event("change")); },
    tick() { for (const callback of [...timers.values()]) callback(); },
    async close() { review.close(); await view.happyDOM.abort(); },
  };
}

test("record review uses one bottom control group and restores live replay controls on exit", async () => {
  const h = harness();
  try {
    const controls = h.find("replay-controls"), home = controls.parentElement;
    h.open();
    assert.equal(controls.parentElement, h.root);
    assert.deepEqual([...controls.querySelectorAll(".replay-buttons button")].map(button => button.id),
      ["replay-first", "replay-previous", "record-replay-play", "replay-next", "replay-last", "record-winrate-toggle"]);
    assert.equal(controls.querySelector(".replay-scrubber").lastElementChild.id, "replay-slider-field");
    assert.equal(h.find("record-replay-play").hidden, false);
    assert.equal(h.find("record-winrate-toggle").hidden, false);
    assert.equal(h.find("record-winrate").getAttribute("aria-hidden"), "true", "opening a record does not expand analysis");
    h.review.close();
    assert.equal(controls.parentElement, home);
    assert.equal(h.find("record-replay-play").hidden, true);
    assert.equal(h.find("record-winrate-toggle").hidden, true);
    h.open(); h.review.close();
    assert.equal(h.root.querySelectorAll("#replay-controls").length, 1);
  } finally { await h.close(); }
});

test("review reuses one back icon in the visible header and restores it when leaving", async () => {
  const h=harness();
  try {
    const back=h.view.document.getElementById("game-back"), home=back.parentElement;
    assert.equal(h.view.document.getElementById("record-review-back"),null);
    h.setHeaderBack(false); h.open();
    assert.equal(back.parentElement.id,"record-review-panel");
    assert.equal(h.find("record-review-panel").hidden,false);
    h.setHeaderBack(true);
    assert.equal(back.parentElement,home);
    assert.equal(h.find("record-review-panel").hidden,true,"empty review navigation takes no layout space");
    h.setHeaderBack(false);
    assert.equal(back.parentElement.id,"record-review-panel");
    assert.equal(h.view.document.querySelectorAll("#game-back").length,1);
    h.review.close();
    assert.equal(back.parentElement,home);
    h.setHeaderBack(true); h.setHeaderBack(false);
    assert.equal(back.parentElement,home,"closed reviews do not move normal game navigation");
  } finally { await h.close(); }
});

test("portrait analysis expands above playback; wider layouts move the same panel ahead of the move log", async () => {
  const h=harness();
  try {
    const saved={formatVersion:1,key:"record",results:Array.from({length:4},(_,i)=>({blackWinRate:i/4,...(i<3?{candidates:[]}:{})}))};
    h.open(4,saved);
    const panel=h.find("record-winrate"), controls=h.find("replay-controls"), toggle=h.find("record-winrate-toggle");
    assert.equal(controls.firstElementChild,panel);
    assert.equal(panel.inert,true);
    toggle.click();
    assert.equal(panel.classList.contains("is-open"),true);
    assert.equal(panel.inert,false);
    assert.equal(panel.getAttribute("aria-hidden"),"false");
    const path=h.find("record-winrate-line").getAttribute("d");
    h.setPortrait(false);
    assert.equal(panel.parentElement,h.root.querySelector(".action-panel"));
    assert.equal(panel.nextElementSibling,h.root.querySelector(".move-log"));
    assert.equal(toggle.getAttribute("aria-expanded"),"true");
    assert.equal(h.find("record-winrate-line").getAttribute("d"),path,"rotation preserves analysis");
    h.setPortrait(true);
    assert.equal(controls.firstElementChild,panel);
    h.find("record-winrate-start").focus();
    toggle.click();
    assert.equal(panel.inert,true);
    assert.equal(h.view.document.activeElement.id,toggle.id,"collapsed content never keeps keyboard focus");
    toggle.click(); toggle.click(); toggle.click();
    assert.equal(panel.classList.contains("is-open"),true,"rapid toggles reflect the latest action");
    h.review.close();
    assert.equal(panel.hidden,true);
    assert.equal(panel.classList.contains("is-open"),false);
    h.setPortrait(false); h.open();
    assert.equal(panel.parentElement,h.root.querySelector(".action-panel"));
    assert.equal(toggle.getAttribute("aria-expanded"),"false");
  } finally { await h.close(); }
});

test("only the current position's first recommendation appears while analysis is expanded", async () => {
  const h=harness();
  try {
    const board=h.find("board");
    for(let i=0;i<361;i++) {
      const point=h.view.document.createElement("button");point.dataset.piece="0";board.append(point);
    }
    const candidate=(row,column)=>({type:"play",row,column,blackWinRate:.6,scoreLead:2,visits:20});
    const first=candidate(4,16), second=candidate(10,10), next=candidate(16,4);
    const saved={formatVersion:1,key:"record",results:[
      {blackWinRate:.6,candidates:[first,second]},
      {blackWinRate:.5,candidates:[next]},
      {blackWinRate:.4,candidates:[{type:"pass",blackWinRate:.4,scoreLead:-2,visits:20}]},
      {blackWinRate:.3},
    ]};
    const position={board:Array.from({length:19},()=>Array(19).fill(null))};
    h.open(4,saved,()=>position);
    h.review.select(0);
    assert.equal(board.querySelector(".is-ai-first"),null,"analysis is opt-in even with saved recommendations");
    const toggle=h.find("record-winrate-toggle");toggle.click();
    assert.equal(board.querySelectorAll(".is-ai-first").length,1);
    assert.ok(board.children[3*19+15].classList.contains("is-ai-first"));
    assert.equal(board.children[3*19+15].getAttribute("aria-description"),"AI 一选：Q16");
    assert.match(h.find("record-winrate-status").textContent,/一选：Q16/);
    h.review.select(1);
    assert.ok(board.children[15*19+3].classList.contains("is-ai-first"));
    assert.equal(board.children[3*19+15].hasAttribute("aria-description"),false);
    h.review.select(2);
    assert.equal(board.querySelector(".is-ai-first"),null,"a pass never falls back to a different move");
    assert.match(h.find("record-winrate-status").textContent,/一选：停一手/);
    h.review.select(3);
    assert.equal(board.querySelector(".is-ai-first"),null,"old win-rate-only analysis has no invented recommendation");
    h.review.select(0);toggle.click();
    assert.equal(board.querySelector(".is-ai-first"),null);
    toggle.click();
    assert.equal(board.querySelectorAll(".is-ai-first").length,1);
    position.board[3][15]="black";h.review.select(0);
    assert.equal(board.querySelector(".is-ai-first"),null,"occupied recommendations are ignored");
    position.board=Array.from({length:9},()=>Array(9).fill(null));h.review.select(0);
    assert.equal(board.querySelector(".is-ai-first"),null,"19x19 recommendations cannot leak onto smaller boards");
    h.review.close();
    assert.equal(board.querySelector(".is-ai-first"),null);
  } finally { await h.close(); }
});

test("the chart fills tablet widths and graph taps select the same move after resizing", async () => {
  const h=harness();
  try {
    const chart=h.find("record-winrate-chart");
    let width=600, height=128;
    chart.getBoundingClientRect=()=>({left:0,top:0,width,height});
    h.open(4,{formatVersion:1,key:"record",results:[.4,.5,.6,.7].map(blackWinRate=>({blackWinRate,candidates:[]}))});
    assert.equal(chart.getAttribute("viewBox"),"0 0 600 128");
    assert.match(h.find("record-winrate-line").getAttribute("d"),/L588\.00 /);
    chart.dispatchEvent(new h.view.MouseEvent("click",{clientX:12+(width-24)*2/3}));
    assert.equal(h.selections.at(-1),2);
    width=210;height=100;h.review.select(2);
    assert.equal(chart.getAttribute("viewBox"),"0 0 210 100");
    chart.dispatchEvent(new h.view.MouseEvent("click",{clientX:12+(width-24)/3}));
    assert.equal(h.selections.at(-1),1);
  } finally { await h.close(); }
});

test("play starts from the beginning at the last move, steps once per tick, pauses and stops at the end", async () => {
  const h = harness();
  try {
    h.open();
    const play = h.find("record-replay-play");
    play.click();
    assert.deepEqual(h.selections, [0]);
    assert.equal(play.getAttribute("aria-label"), "暂停");
    assert.equal(play.querySelector("[data-pause-icon]").hasAttribute("hidden"), false);
    assert.equal(play.querySelector("[data-play-icon]").hasAttribute("hidden"), true);
    h.tick(); assert.deepEqual(h.selections, [0, 1]);
    play.click(); h.tick(); assert.deepEqual(h.selections, [0, 1]);
    assert.equal(play.getAttribute("aria-pressed"), "false");
    play.click(); h.tick(); h.tick(); h.tick();
    assert.deepEqual(h.selections, [0, 1, 2, 3]);
    assert.equal(h.timers.size, 0);
    assert.equal(play.getAttribute("aria-label"), "播放");
  } finally { await h.close(); }
});

test("manual navigation, scrubbing, analysis, hiding and leaving a record stop playback", async () => {
  const h = harness();
  try {
    h.open();
    for (const action of [
      () => h.find("replay-next").click(),
      () => h.find("replay-slider").dispatchEvent(new h.view.Event("input", { bubbles: true })),
      () => h.find("record-winrate-toggle").click(),
      () => h.review.pause(),
      () => h.review.close(),
    ]) {
      h.review.select(0);
      h.find("record-replay-play").click();
      assert.equal(h.timers.size, 1);
      action(); assert.equal(h.timers.size, 0);
    }
    assert.equal(h.find("record-winrate").hidden, true);
    const offline = harness(false);
    try {
      offline.open();
      assert.equal(offline.find("record-winrate-toggle").hidden, true, "no configured model, no AI action");
    } finally { await offline.close(); }
  } finally { await h.close(); }
});
