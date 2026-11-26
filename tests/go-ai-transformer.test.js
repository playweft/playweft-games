import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import * as tf from "@tensorflow/tfjs";
import { createServer } from "vite";

// Use Vite's normal TS loader, keeping the tests compatible with Node 22.12.
const server = await createServer({ configFile: false, logLevel: "silent",
  server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => server.close());
const base = "/games/go/vendor/web-katrain/engine/katago/";
const { makeTransformerBlock, makeRmsNorm, rmsNorm, disposeRmsNorm } = await server.ssrLoadModule(base + "transformer.ts");
const { parseKataGoModelV8 } = await server.ssrLoadModule(base + "loadModelV8.ts");
const { KataGoModelV8Tf } = await server.ssrLoadModule(base + "modelV8.ts");
await tf.setBackend("cpu");

const input = [.2, -.4, .6, .8, -.3, .7, -.5, .1, .9, .2, -.1, -.8];
const norm = { channels: 4, epsilon: 1e-5, spatial: false, scale: new Float32Array(4).fill(1) };
const matrix = (rows, cols, shift) => ({ inChannels: rows, outChannels: cols,
  weights: Float32Array.from({ length: rows * cols }, (_, i) => (i % 11 - 5 + shift) / 17) });
function close(actual, expected, tolerance = 2e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < tolerance, `${i}: ${value} != ${expected[i]}`));
}

// Reference outputs computed independently with PyTorch float32 using KataGo's
// RMSNorm, scaled dot-product attention, interleaved RoPE, and SiLU equations.
test("v17 grouped-query attention and learned 2D RoPE match the reference and release cached tensors", async () => {
  const before = tf.memory().numTensors;
  const block = makeTransformerBlock({ kind: "transformer_attention", norm, heads: 2, kvHeads: 1,
    qDim: 4, vDim: 4, q: matrix(4, 8, 0), k: matrix(4, 4, 1), v: matrix(4, 4, -1),
    out: matrix(8, 4, 2), rope: true, frequencies: new Float32Array([.3, .7, -.2, .6]) });
  const x = tf.tensor4d(input, [1, 1, 3, 4]);
  const expected = [.1007322893, -.5629810095, .4873221815, .7073160410, -.3730249405, .5554853678,
    -.6028668880, .0049709827, .8119431138, .0440615416, -.2100182623, -.8960093260];
  for (let i = 0; i < 3; i++) {
    const out = block.forward(x);
    close(Array.from(await out.data()), expected);
    out.dispose();
  }
  // Different board shapes need different RoPE tables, even at equal area.
  const other = x.reshape([1, 3, 1, 4]), out = block.forward(other);
  assert.ok(Array.from(await out.data()).every(Number.isFinite));
  tf.dispose([x, other, out]); block.dispose();
  assert.equal(tf.memory().numTensors, before);
});

test("v17 SwiGLU FFN matches the reference", async () => {
  const before = tf.memory().numTensors;
  const block = makeTransformerBlock({ kind: "transformer_ffn", norm,
    linear1: matrix(4, 8, 0), gate: matrix(4, 8, 1), linear2: matrix(8, 4, 2) });
  const x = tf.tensor4d(input, [1, 1, 3, 4]), out = block.forward(x);
  close(Array.from(await out.data()), [.3155639172, -.2403720319, .6064796448, .8432997465,
    -.2388044894, .8019888401, -.4320259094, .1386030614, .9097353220, .2170826793, -.0931216404, -.7885736823]);
  tf.dispose([x, out]); block.dispose();
  assert.equal(tf.memory().numTensors, before);
});

test("spatial trunk RMSNorm normalizes across the whole board and applies per-channel scale and bias", async () => {
  const layer = makeRmsNorm({ ...norm, spatial: true, scale: new Float32Array([1, 2, 3, 4]), bias: new Float32Array([.1, .2, .3, .4]) });
  const x = tf.tensor4d(input, [1, 1, 3, 4]);
  const out = tf.tidy(() => rmsNorm(x, layer));
  const inverse = 1 / Math.sqrt(input.reduce((sum, v) => sum + v * v, 0) / input.length + norm.epsilon);
  close(Array.from(await out.data()), input.map((v, i) => v * inverse * (i % 4 + 1) + (i % 4 + 1) / 10));
  tf.dispose([x, out]); disposeRmsNorm(layer);
});

test("bundled v8 b6 still parses, evaluates and releases its tensors", async () => {
  const before = tf.memory().numTensors;
  const bytes = gunzipSync(await readFile(new URL("../games/go/assets/katago-b6.bin.gz", import.meta.url)));
  const parsed = parseKataGoModelV8(bytes);
  assert.equal(parsed.modelVersion, 8);
  const model = new KataGoModelV8Tf(parsed);
  const x = tf.zeros([1, 9, 9, 22]), global = tf.zeros([1, 19]);
  const out = model.forward(x, global);
  for (const tensor of Object.values(out)) assert.ok(Array.from(await tensor.data()).every(Number.isFinite));
  assert.deepEqual(out.value.shape, [1, 3]);
  // Captured from the original b6 implementation before adding v17 support.
  close(Array.from(await out.value.data()), [5.0436463356, .8088914752, -8.4993915558], 1e-5);
  close(Array.from(await out.policyPass.data()), [-.2391360849], 1e-5);
  close(Array.from(await out.policy.data()).slice(0, 4), [-4.4597187042, -2.1122233868, -.8888502717, -.7609532475], 1e-5);
  tf.dispose([out, x, global]); model.dispose();
  assert.equal(tf.memory().numTensors, before);
});

// A tiny complete v17 binary exercises parser alignment, RMS trunk tip, both
// transformer block types and the new head headers without a 94 MB test asset.
function tinyV17() {
  const parts = [];
  const text = (...values) => parts.push(Buffer.from(values.join(" ") + "\n"));
  const floats = values => {
    parts.push(Buffer.from("@BIN@"));
    const data = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => data.writeFloatLE(v, i * 4));
    parts.push(data, Buffer.from("\n"));
  };
  const zeros = n => floats(Array(n).fill(0));
  const mm = (a, b) => { text("matrix", a, b); zeros(a * b); };
  const bias = n => { text("bias", n); zeros(n); };
  const conv = (a, b) => { text("conv", 1, 1, a, b, 1, 1); zeros(a * b); };
  const bn = n => { text("norm", n, .001, 0, 0); zeros(n); floats(Array(n).fill(1)); };
  const rms = () => { text("rms", 4, 1e-5); floats([1, 1, 1, 1]); };
  const act = () => text("activation", "ACTIVATION_SILU");
  text("tiny-v17", 17, 22, 19, 20, 20, 20, 20, 40, .25, 30, 0, 0, 0, 0, 0, 0, 0, 0);
  text("trunk", 2, 4, 4, 4, 0, 1, 1, 0, 0, 0, 0, 0);
  conv(22, 4); mm(19, 4);
  text("transformer_attention_block", "attention", 2, 1, 4, 4, 1, 1);
  rms(); mm(4, 8); mm(4, 4); mm(4, 4); mm(8, 4);
  text("rope", 1, 2, 2); floats([.3, .7, -.2, .6]);
  text("transformer_ffn_block", "ffn", 4, 8, 1); rms(); mm(4, 8); mm(4, 8); mm(8, 4);
  text("tip", 4, 1e-5, 1, 0); floats([1, 1, 1, 1]); zeros(4); act();
  text("policy", 2, 0, 0, 0);
  conv(4, 2); conv(4, 1); bn(1); act(); mm(3, 2); bn(2); act(); conv(2, 2);
  mm(3, 2); bias(2); act(); mm(2, 2);
  text("value", 0, 0, 0);
  conv(4, 2); bn(2); act(); mm(6, 3); bias(3); act(); mm(3, 3); bias(3); mm(3, 6); bias(6); conv(2, 1);
  return Buffer.concat(parts);
}

test("a complete v17 binary parses and runs its attention, FFN, RMS and policy/value heads", async () => {
  const before = tf.memory().numTensors;
  const parsed = parseKataGoModelV8(tinyV17());
  assert.equal(parsed.modelVersion, 17);
  assert.equal(parsed.policyOutChannels, 2);
  assert.equal(parsed.trunk.tipRMS.spatial, true);
  assert.deepEqual(parsed.trunk.blocks.map(b => b.kind), ["transformer_attention", "transformer_ffn"]);
  const model = new KataGoModelV8Tf(parsed), x = tf.zeros([1, 3, 3, 22]), global = tf.zeros([1, 19]);
  const out = model.forward(x, global);
  for (const tensor of Object.values(out)) assert.ok(Array.from(await tensor.data()).every(v => v === 0));
  tf.dispose([out, x, global]); model.dispose();
  assert.equal(tf.memory().numTensors, before);
});
