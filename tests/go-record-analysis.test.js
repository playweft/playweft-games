import test from "node:test";
import assert from "node:assert/strict";
import { createGoRecordAnalysis } from "../games/go/record-analysis.js";

function harness() {
  const workers=[],updates=[];
  const analysis=createGoRecordAnalysis({onUpdate: value=>updates.push(value),createWorker() {
    const worker={sent:[],terminated:false,postMessage(value){this.sent.push(value);},
      terminate(){this.terminated=true;},reply(data){this.onmessage({data:{id:this.sent.at(-1).id,...data}});} };
    workers.push(worker);return worker;
  }});
  const position=index=>({board:[[null]],index});
  return {analysis,workers,updates,position};
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
