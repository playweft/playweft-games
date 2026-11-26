import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createGoSceneView } from "../games/go/scene-view.js";

function harness() {
  const browser = new Window();
  browser.document.body.innerHTML = '<main><div class="table-layout">Old board</div></main>';
  const root = browser.document.querySelector("main");
  let resolve, reject, calls = 0, options, timer;
  browser.setTimeout = callback => { timer=callback; return 1; };
  browser.clearTimeout = () => { timer=undefined; };
  const visible = [];
  const scene = { setVisible: value => visible.push(value), getIntersection: () => ({ row:2,column:3 }) };
  const view = createGoSceneView({ root,
    load: () => { calls++; return new Promise((yes,no) => { resolve=yes;reject=no; }); },
  });
  return { root,view,visible,get options(){return options;},get calls(){return calls;},
    resolve() { resolve({createGoBoardScene: config => { options=config;return scene; }}); },
    reject, fail() { reject(new Error("no WebGL")); },
    recoverFallback() { timer?.(); },get hasTimer(){return !!timer;},
    close: () => browser.happyDOM.abort(),
  };
}
async function flush() { for(let i=0;i<4;i++) await Promise.resolve(); }

test("the old board stays covered until the first rendered frame, not merely the module load", async () => {
  const h=harness();
  try {
    h.view.setVisible(false);
    assert.equal(h.calls,0);
    h.view.setVisible(true);
    assert.ok(h.root.classList.contains("scene-loading"));
    assert.equal(h.root.getAttribute("aria-busy"),"true");
    h.resolve(); await flush();
    assert.ok(h.root.classList.contains("scene-loading"));
    h.options.onReady();
    assert.equal(h.root.classList.contains("scene-loading"),false);
    h.view.setVisible(false); h.view.setVisible(true);
    assert.equal(h.calls,1);
    assert.equal(h.root.classList.contains("scene-loading"),false);
  } finally { await h.close(); }
});

test("returning home during loading does not uncover or restart the unfinished scene", async () => {
  const h=harness();
  try {
    h.view.setVisible(true); h.view.setVisible(false);
    h.resolve(); await flush();
    assert.deepEqual(h.visible,[false]);
    assert.equal(h.root.classList.contains("scene-loading"),false);
    h.view.setVisible(true);
    assert.ok(h.root.classList.contains("scene-loading"));
    h.options.onReady();
    assert.equal(h.root.classList.contains("scene-loading"),false);
  } finally { await h.close(); }
});

test("temporary context loss stays covered; recovery or a genuine failure releases the cover", async t => {
  const h=harness();
  try {
    h.view.setVisible(true);h.resolve();await flush();h.options.onReady();
    h.options.onUnavailable();
    assert.ok(h.root.classList.contains("scene-loading"));
    assert.ok(h.hasTimer);
    h.options.onReady();
    assert.equal(h.hasTimer,false);
    assert.equal(h.root.classList.contains("scene-loading"),false);
    h.options.onUnavailable();h.recoverFallback();
    assert.equal(h.root.classList.contains("scene-loading"),false);
    h.options.onReady();
  } finally { await h.close(); }
  const failed=harness();
  t.mock.method(console,"warn",()=>{});
  try {
    failed.view.setVisible(true);failed.fail();await flush();
    assert.equal(failed.root.classList.contains("scene-loading"),false);
    failed.view.setVisible(false);failed.view.setVisible(true);
    assert.equal(failed.calls,1);
  } finally { await failed.close(); }
});
