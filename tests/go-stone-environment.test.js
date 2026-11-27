import assert from "node:assert/strict";
import { test } from "node:test";
import { MeshPhysicalMaterial, PMREMGenerator, WebGLRenderTarget } from "three";
import { createStoneEnvironment, stoneSkyRadiance } from "../games/go/stone-environment.js";

test("sky lighting is soft, seamless, bounded and brighter above the courtyard", () => {
  const above = stoneSkyRadiance(0, 1, 0), below = stoneSkyRadiance(0, -1, 0);
  assert.ok(above.every((v, i) => v > below[i] * 3));
  assert.ok(above[2] > above[0], "cool skylight");
  assert.ok(below[0] > below[2], "muted warm ground");
  for (let latitude = -.5; latitude <= .5; latitude += .025) {
    const y = Math.sin(latitude * Math.PI), r = Math.cos(latitude * Math.PI);
    for (let longitude = -Math.PI; longitude < Math.PI; longitude += .025) {
      const light = stoneSkyRadiance(r * Math.cos(longitude), y, r * Math.sin(longitude));
      const next = stoneSkyRadiance(r * Math.cos(longitude + .001), y, r * Math.sin(longitude + .001));
      assert.ok(light.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
      assert.ok(light.every((v, i) => Math.abs(v - next[i]) < .003), "no sharp reflection dots");
    }
  }
  const left = stoneSkyRadiance(-1, .2, 1e-7), right = stoneSkyRadiance(-1, .2, -1e-7);
  assert.ok(left.every((v, i) => Math.abs(v - right[i]) < 1e-6), "no longitude seam");
});

test("unsupported render targets retain the base finish without allocating an environment", () => {
  assert.equal(createStoneEnvironment({ extensions: { has: () => false } }), undefined);
});

test("one shared reflection survives context recovery and releases its resources", t => {
  const calls = [], target = new WebGLRenderTarget(336, 128);
  let source, generatorDisposals = 0, targetDisposals = 0, sourceDisposals = 0;
  t.mock.method(PMREMGenerator.prototype, "fromEquirectangular", function(texture, previous) {
    source = texture;
    calls.push({ previous, version: source.version });
    return target;
  });
  t.mock.method(PMREMGenerator.prototype, "dispose", () => { generatorDisposals++; });
  const environment = createStoneEnvironment({ extensions: { has: () => true } });
  source.addEventListener("dispose", () => { sourceDisposals++; });
  target.addEventListener("dispose", () => { targetDisposals++; });
  const board = new MeshPhysicalMaterial({ envMap: environment.texture });
  const bowl = board.clone(), preview = board.clone();
  assert.equal(source.image.data.byteLength, 128 * 64 * 4, "small CPU source, no downloaded HDR");
  assert.equal(calls.length, 1);
  environment.refresh();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].previous, target, "refill the existing GPU target on recovery");
  assert.ok(calls[1].version > calls[0].version);
  for (const material of [board, bowl, preview]) {
    assert.equal(material.envMap, target.texture);
    material.dispose();
  }
  environment.dispose();
  assert.deepEqual([generatorDisposals, targetDisposals, sourceDisposals], [1, 1, 1]);
});
