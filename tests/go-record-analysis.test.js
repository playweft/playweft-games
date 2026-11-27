import test from "node:test";
import assert from "node:assert/strict";
import { createGoRecordAnalysis } from "../games/go/record-analysis.js";

function harness() {
  const workers=[],updates=[],saves=[];
  const analysis=createGoRecordAnalysis({onUpdate: value=>updates.push(value),onSave: value=>saves.push(value),createWorker() {
    const worker={sent:[],terminated:false,postMessage(value){this.sent.push(value);},
      terminate(){this.terminated=true;},reply(data){this.onmessage({data:{id:this.sent.at(-1).id,
        ...(data.type === "analysis" ? { candidates: [] } : {}),...data}});} };
    workers.push(worker);return worker;
  }});
  const position=index=>({board:[[null]],index});
  return {analysis,workers,updates,saves,position};
}

test("record analysis is opt-in, sequential, keeps Black's perspective and reuses results",()=>{
  const {analysis,workers,updates,position}=harness();
  analysis.select("a",3,position);
  assert.equal(workers.length,0,"opening a record must never download a model");
  analysis.start();const worker=workers[0];
  assert.equal(worker.sent[0].type,"init");
  worker.reply({type:"ready"});
  assert.equal(worker.sent.at(-1).position.index,0);
  assert.equal(worker.sent.length,2,"only one position may be in flight");
  for (const value of [0,.8,1]) worker.reply({type:"analysis",blackWinRate:value});
  assert.deepEqual(updates.at(-1).values,[0,.8,1]);
  assert.equal(updates.at(-1).running,false);
  assert.equal(worker.terminated,true);
  analysis.select("a",3,position);analysis.start();
  assert.equal(workers.length,1,"finished results remain available without reloading the engine");
});

test("partial analysis survives a fresh controller and resumes only missing positions", () => {
  const first = harness();
  first.analysis.select("game-and-model", 3, first.position);
  first.analysis.start();
  const worker = first.workers[0];
  worker.reply({ type: "ready" });
  worker.reply({ type: "analysis", blackWinRate: 0, scoreLead: -12.5, visits: 32 });
  first.analysis.pause();
  const saved = JSON.parse(JSON.stringify(first.saves.at(-1)));
  assert.deepEqual(saved, { formatVersion: 1, key: "game-and-model",
    results: [{ blackWinRate: 0, scoreLead: -12.5, visits: 32, candidates: [] }, null, null] });
  worker.reply({ type: "analysis", blackWinRate: .99 });
  assert.equal(first.saves.length, 1, "late replies must not write to storage");

  const second = harness();
  second.analysis.select(saved.key, 3, second.position, saved);
  assert.equal(second.workers.length, 0);
  assert.equal(second.saves.length, 0, "merely opening a saved chart does not rewrite it");
  assert.deepEqual(second.updates.at(-1).values, [0, null, null]);
  second.analysis.start();
  const resumed = second.workers[0];
  resumed.reply({ type: "ready" });
  assert.equal(resumed.sent.at(-1).position.index, 1);
  resumed.reply({ type: "analysis", blackWinRate: .4, scoreLead: -2, visits: 16 });
  assert.equal(saved.results[1], null, "saved snapshots are not mutated by later analysis");
  resumed.reply({ type: "analysis", blackWinRate: 1, scoreLead: 7, visits: 32 });

  const third = harness();
  third.analysis.select(saved.key, 3, third.position, second.saves.at(-1));
  third.analysis.start();
  assert.deepEqual(third.updates.at(-1).values, [0, .4, 1]);
  assert.equal(third.workers.length, 0, "completed saved results need no model download");
});

test("incompatible or invalid saved analysis is never rendered as a valid win rate", () => {
  const { analysis, position, updates } = harness();
  const saved = { formatVersion: 1, key: "old-model",
    results: [{ blackWinRate: .8 }, { blackWinRate: NaN }, { blackWinRate: 2 }] };
  analysis.select("new-model", 3, position, saved);
  assert.deepEqual(updates.at(-1).values, [null, null, null]);
  analysis.select("old-model", 3, position, saved);
  assert.deepEqual(updates.at(-1).values, [.8, null, null]);
});

test("first and second recommendations retain ranking, pass and Black-perspective statistics across reloads", () => {
  const first = harness();
  const candidates = [
    { type: "pass", blackWinRate: .2, scoreLead: -5, visits: 21 },
    { type: "play", row: 4, column: 16, blackWinRate: .8, scoreLead: 5, visits: 10 },
  ];
  first.analysis.select("white-to-move", 1, first.position);
  first.analysis.start();
  first.workers[0].reply({ type: "ready" });
  first.workers[0].reply({ type: "analysis", blackWinRate: .3, scoreLead: -3, visits: 32, candidates });
  assert.deepEqual(first.saves[0].results[0].candidates, candidates,
    "preserve engine ranking rather than sorting by Black win rate on White's turn");
  const restored = harness();
  restored.analysis.select("white-to-move", 1, restored.position, JSON.parse(JSON.stringify(first.saves[0])));
  assert.deepEqual(restored.updates.at(-1).recommendations,[candidates[0]],"show the engine's first choice, including a pass");
  assert.equal(restored.updates.at(-1).complete, true);
  restored.analysis.start();
  assert.equal(restored.workers.length, 0);
});

test("legacy win rates stay visible and recommendations are backfilled only on explicit start", () => {
  const { analysis, updates, workers, saves, position } = harness();
  const saved = { formatVersion: 1, key: "legacy", results: [
    { blackWinRate: .3, scoreLead: -3, visits: 32 },
    { blackWinRate: .4, candidates: [] },
    { blackWinRate: .5 },
  ] };
  analysis.select("legacy", 3, position, saved);
  assert.deepEqual(updates.at(-1).values, [.3, .4, .5]);
  assert.equal(updates.at(-1).complete, false);
  assert.equal(workers.length, 0);
  assert.equal(saves.length, 0);
  analysis.start();
  workers[0].reply({ type: "ready" });
  assert.equal(workers[0].sent.at(-1).position.index, 0);
  workers[0].reply({ type: "analysis", blackWinRate: .35,
    candidates: [{ type: "play", row: 1, column: 1, blackWinRate: .4, scoreLead: -1, visits: 1 }] });
  assert.equal(workers[0].sent.at(-1).position.index, 2, "skip positions whose candidates are already saved");
  workers[0].reply({ type: "analysis", blackWinRate: .55 });
  assert.equal(updates.at(-1).complete, true);
  assert.equal(saves.length, 2);
  assert.equal(saves.at(-1).results[0].candidates.length, 1, "fewer than two recommendations is valid");
});

test("invalid recommendation coordinates or statistics cannot be marked complete or saved", () => {
  const { analysis, updates, workers, saves, position } = harness();
  const bad = { type: "play", row: 0, column: 1, blackWinRate: .5, scoreLead: 0, visits: 1 };
  analysis.select("bad", 1, position, { formatVersion: 1, key: "bad",
    results: [{ blackWinRate: .5, candidates: [bad] }] });
  assert.deepEqual(updates.at(-1).values, [.5]);
  assert.equal(updates.at(-1).complete, false);
  analysis.start();
  workers[0].reply({ type: "ready" });
  workers[0].reply({ type: "analysis", blackWinRate: .5, candidates: [bad] });
  assert.equal(updates.at(-1).running, false);
  assert.equal(saves.length, 0);
});

test("pausing or changing records kills work; late results cannot corrupt a different review",()=>{
  const {analysis,workers,updates,position}=harness();
  analysis.select("a",2,position);analysis.start();const old=workers[0];
  old.reply({type:"ready"});old.reply({type:"analysis",blackWinRate:.3});
  analysis.pause();assert.equal(old.terminated,true);
  old.reply({type:"analysis",blackWinRate:.99});
  assert.deepEqual(updates.at(-1).values,[.3,null]);
  analysis.start();const resumed=workers[1];resumed.reply({type:"ready"});
  assert.equal(resumed.sent.at(-1).position.index,1);
  analysis.select("b",2,position);
  resumed.reply({type:"analysis",blackWinRate:.9});
  assert.deepEqual(updates.at(-1).values,[null,null]);
  analysis.start();const current=workers[2];current.reply({type:"ready"});
  current.reply({type:"analysis",blackWinRate:NaN});
  assert.equal(updates.at(-1).running,false);
  assert.match(updates.at(-1).message,/重试/);
  analysis.destroy();
});
