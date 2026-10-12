import assert from "node:assert/strict";
import test from "node:test";
import { createBoardCanvas } from "../games/reversi/board-canvas.js";
import { createReversiState, applyReversiAction } from "../games/reversi/rules.js";

function browser(t) {
  const saved = new Map(), frames = new Map(), canvases = [], observers = [];
  let nextFrame = 1;
  class Context {
    constructor(canvas) { this.canvas=canvas; this.sources=[]; }
    setTransform(...values) { this.matrix=values; }
    beginPath() {} moveTo() {} lineTo() {} closePath() {} save() {} restore() {} scale() {} translate() {} transform() {} stroke() {}
    createRadialGradient() { return { addColorStop() {} }; }
    fill() { this.canvas.painted=true; }
    fillRect() { this.canvas.painted=true; }
    clearRect() { this.canvas.painted=false; this.sources=[]; }
    drawImage(source) { this.sources.push(source); if(source.painted)this.canvas.painted=true; }
  }
  class Canvas extends EventTarget {
    constructor() { super(); this.ctx=new Context(this); this.painted=false; canvases.push(this); }
    set width(value) { this.w=value; this.reset(); }
    get width() { return this.w; }
    set height(value) { this.h=value; this.reset(); }
    get height() { return this.h; }
    reset() { this.painted=false; this.ctx.sources=[]; this.ctx.matrix=[1,0,0,1,0,0]; }
    getContext() { return this.ctx; }
  }
  const window = new EventTarget(), document = new EventTarget(), motion = new EventTarget();
  window.devicePixelRatio=2; window.matchMedia=()=>motion; motion.matches=false;
  document.hidden=false; document.createElement=()=>new Canvas();
  const globals={ window, document,
    ResizeObserver: class { constructor(callback){this.callback=callback;observers.push(this);} observe(){} disconnect(){this.disconnected=true;} },
    requestAnimationFrame(callback){const id=nextFrame++;frames.set(id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
  };
  for(const [key,value] of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
  t.after(()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const host={clientWidth:390,clientHeight:560}, base=new Canvas(), overlay=new Canvas();
  const cells=Array.from({length:64},()=>({style:{}}));
  const view=createBoardCanvas(host,base,overlay,cells);
  let state=createReversiState();
  view.update(state,true);
  return {view,host,base,overlay,canvases,frames,window,document,observers,
    play(){state=applyReversiAction(state,{type:"play",row:3,column:4}).state;view.update(state,true);},
    purge(){for(const canvas of canvases)canvas.reset();},
    flush(now=performance.now()){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(now);},
  };
}

function assertRestored(env) {
  assert.equal(env.base.painted,true);
  assert.deepEqual(env.base.ctx.matrix,[2,0,0,2,0,0]);
  assert.ok(env.base.ctx.sources.every(canvas=>canvas.painted),"all cached surfaces must be rebuilt too");
  assert.equal(env.frames.size,0,"static recovery must not start a permanent drawing loop");
}

test("Reversi reconstructs lost buffers and caches on focus even when dimensions have not changed", t=>{
  const env=browser(t),oldSources=[...env.base.ctx.sources];
  env.purge();assert.equal(env.base.painted,false);
  env.window.dispatchEvent(new Event("focus"));
  env.window.dispatchEvent(new Event("pageshow"));
  env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.frames.size,1,"foreground events should share one reconstruction");
  env.flush();assertRestored(env);
  assert.ok(env.base.ctx.sources.slice(1).every(image=>!oldSources.includes(image)),"discard old piece textures");
  env.view.destroy();
});

test("Reversi restores the latest move and settles an interrupted flip after returning from the background", t=>{
  const env=browser(t);env.play();assert.ok(env.frames.size>0);
  env.document.hidden=true;env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(env.frames.size,0);
  env.purge();
  env.document.hidden=false;env.document.dispatchEvent(new Event("visibilitychange"));env.flush();
  assertRestored(env);
  const faces=env.base.ctx.sources.slice(1).map(image=>image.ctx.fillStyle);
  assert.equal(faces.filter(color=>color==="#262724").length,4);
  assert.equal(faces.filter(color=>color==="#f3f3ed").length,1);
  env.view.destroy();
});

test("Reversi preserves the first move animation when window focus queues a reconstruction", t=>{
  for (const focusBeforeMove of [true, false]) {
    const env=browser(t);
    if(focusBeforeMove)env.window.dispatchEvent(new Event("focus"));
    env.play();
    if(!focusBeforeMove)env.window.dispatchEvent(new Event("focus"));
    env.flush();
    assert.equal(env.frames.size,1,"the flip should continue after focus recovery");
    assert.equal(env.base.ctx.sources.length,5,"the flipping disc stays out of the static layer");
    assert.equal(env.overlay.painted,true);
    env.flush(performance.now()+500);
    assertRestored(env);
    assert.equal(env.base.ctx.sources.length,6,"all five discs become static after the flip");
    env.view.destroy();
  }
});

test("Reversi restores drawing state on context restoration and redraws after zero-sized layout becomes visible", t=>{
  const env=browser(t);env.purge();
  env.base.dispatchEvent(new Event("contextlost"));
  env.host.clientWidth=0;env.base.dispatchEvent(new Event("contextrestored"));env.flush();
  assert.equal(env.base.painted,false);
  env.host.clientWidth=390;env.observers[0].callback();
  assertRestored(env);
  env.view.destroy();
});

test("Reversi destroys pending recovery and ignores subsequent lifecycle events", t=>{
  const env=browser(t);env.window.dispatchEvent(new Event("focus"));assert.equal(env.frames.size,1);
  env.view.destroy();env.purge();
  env.window.dispatchEvent(new Event("focus"));env.window.dispatchEvent(new Event("pageshow"));
  env.document.dispatchEvent(new Event("visibilitychange"));env.base.dispatchEvent(new Event("contextrestored"));
  assert.equal(env.frames.size,0);assert.equal(env.base.painted,false);assert.equal(env.observers[0].disconnected,true);
});
