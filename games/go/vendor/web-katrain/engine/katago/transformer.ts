// KataGo v17 inference, following cpp/neuralnet/desc.cpp and eigenbackend.cpp.
import * as tf from '@tensorflow/tfjs';
import { parseMatMul, type KataGoBinModelParser, type ParsedMatMul } from './binModelParser';

export type ParsedRmsNorm = {
  channels: number; epsilon: number; spatial: boolean;
  scale: Float32Array; bias?: Float32Array;
};
export type ParsedTransformerBlock = {
  kind: 'transformer_attention'; norm: ParsedRmsNorm;
  heads: number; kvHeads: number; qDim: number; vDim: number;
  q: ParsedMatMul; k: ParsedMatMul; v: ParsedMatMul; out: ParsedMatMul;
  rope: boolean; frequencies?: Float32Array; theta?: number;
} | {
  kind: 'transformer_ffn'; norm: ParsedRmsNorm;
  linear1: ParsedMatMul; gate?: ParsedMatMul; linear2: ParsedMatMul;
};

export function parseRmsNorm(p: KataGoBinModelParser, tip = false): ParsedRmsNorm {
  p.readToken();
  const channels = p.readInt(), epsilon = p.readFloatAscii();
  const spatial = tip && p.readInt() !== 0;
  if (tip && p.readInt() !== 0) throw new Error('Grouped spatial RMSNorm is unsupported');
  if (channels < 1 || !(epsilon > 0 && epsilon <= 1)) throw new Error('Invalid RMSNorm dimensions or epsilon');
  const scale = p.readBinaryFloats(channels);
  const bias = tip ? p.readBinaryFloats(channels) : undefined;
  return { channels, epsilon, spatial, scale, bias };
}

export function parseTransformerBlock(p: KataGoBinModelParser, kind: string): ParsedTransformerBlock {
  p.readToken(); // block name
  if (kind === 'transformer_ffn_block') {
    const channels = p.readInt(), hidden = p.readInt(), swiGLU = p.readInt() !== 0;
    const norm = parseRmsNorm(p), linear1 = parseMatMul(p);
    const gate = swiGLU ? parseMatMul(p) : undefined;
    const linear2 = parseMatMul(p);
    if (channels !== norm.channels || linear1.inChannels !== channels || linear1.outChannels !== hidden ||
        linear2.inChannels !== hidden || linear2.outChannels !== channels ||
        (gate && (gate.inChannels !== channels || gate.outChannels !== hidden))) throw new Error('Invalid transformer FFN dimensions');
    return { kind: 'transformer_ffn', norm, linear1, gate, linear2 };
  }
  const heads = p.readInt(), kvHeads = p.readInt(), qDim = p.readInt(), vDim = p.readInt();
  const rope = p.readInt() !== 0, learned = p.readInt() !== 0;
  if (heads < 1 || kvHeads < 1 || heads % kvHeads || qDim < 1 || vDim < 1 || (rope && qDim % 2)) {
    throw new Error('Invalid transformer attention dimensions');
  }
  const norm = parseRmsNorm(p);
  const q = parseMatMul(p), k = parseMatMul(p), v = parseMatMul(p), out = parseMatMul(p);
  if (q.outChannels !== heads * qDim || k.outChannels !== kvHeads * qDim || v.outChannels !== kvHeads * vDim ||
      out.inChannels !== heads * vDim || out.outChannels !== norm.channels ||
      [q, k, v].some(projection => projection.inChannels !== norm.channels)) throw new Error('Invalid attention projection dimensions');
  let frequencies, theta;
  if (rope) {
    p.readToken();
    if (learned) {
      if (p.readInt() !== kvHeads || p.readInt() !== qDim / 2 || p.readInt() !== 2) throw new Error('Invalid learned RoPE dimensions');
      frequencies = p.readBinaryFloats(kvHeads * qDim);
    } else {
      theta = p.readFloatAscii();
      if (!(theta > 0 && Number.isFinite(theta)) || qDim % 4) throw new Error('Invalid fixed RoPE parameters');
    }
  }
  return { kind: 'transformer_attention', norm, heads, kvHeads, qDim, vDim, q, k, v, out, rope, frequencies, theta };
}

export function makeRmsNorm(norm: ParsedRmsNorm) {
  return { ...norm, scale: tf.tensor4d(norm.scale, [1, 1, 1, norm.channels]),
    bias: norm.bias ? tf.tensor4d(norm.bias, [1, 1, 1, norm.channels]) : undefined };
}
export type TfRmsNorm = ReturnType<typeof makeRmsNorm>;
export function rmsNorm(x: tf.Tensor4D, norm: TfRmsNorm): tf.Tensor4D {
  const meanSquare = x.square().mean(norm.spatial ? [1, 2, 3] : [3], true);
  let result = x.mul(meanSquare.add(norm.epsilon).rsqrt()).mul(norm.scale);
  if (norm.bias) result = result.add(norm.bias);
  return result as tf.Tensor4D;
}
export function disposeRmsNorm(norm: TfRmsNorm) { norm.scale.dispose(); norm.bias?.dispose(); }

export function makeTransformerBlock(block: ParsedTransformerBlock) {
  const norm = makeRmsNorm(block.norm);
  const weights: tf.Tensor[] = [];
  const matrix = (m: ParsedMatMul) => {
    const tensor = tf.tensor2d(m.weights, [m.inChannels, m.outChannels]);
    weights.push(tensor); return tensor;
  };
  const tables = new Map<string, { cos: tf.Tensor4D; sin: tf.Tensor4D }>();
  let forward: (x: tf.Tensor4D) => tf.Tensor4D;
  if (block.kind === 'transformer_ffn') {
    const first = matrix(block.linear1), gate = block.gate ? matrix(block.gate) : undefined, last = matrix(block.linear2);
    forward = x => tf.tidy(() => {
      const shape = x.shape;
      const flat = rmsNorm(x, norm).reshape([-1, shape[3]]);
      const projected = flat.matMul(first);
      let hidden = projected.mul(projected.sigmoid());
      if (gate) hidden = hidden.mul(flat.matMul(gate));
      return x.add(hidden.matMul(last).reshape(shape)) as tf.Tensor4D;
    });
  } else {
    const qWeight = matrix(block.q), kWeight = matrix(block.k), vWeight = matrix(block.v), outWeight = matrix(block.out);
    const { heads: queryHeads, kvHeads, qDim, vDim, rope, frequencies, theta } = block;
    function rotate(tensor: tf.Tensor4D, height: number, width: number, heads: number): tf.Tensor4D {
      if (!rope) return tensor;
      const key = `${height}:${width}:${heads}`, pairs = qDim / 2, seq = height * width;
      let table = tables.get(key);
      if (!table) {
        const cos = new Float32Array(heads * seq * pairs), sin = new Float32Array(cos.length);
        for (let h = 0; h < heads; h++) for (let s = 0; s < seq; s++) for (let pair = 0; pair < pairs; pair++) {
          const x = s % width, y = Math.floor(s / width);
          const kv = Math.floor(h * kvHeads / heads);
          const index = (kv * pairs + pair) * 2;
          const angle = frequencies ? x * frequencies[index] + y * frequencies[index + 1]
            : (pair < pairs / 2 ? y : x) / Math.pow(theta!, 2 * (pair % (pairs / 2)) / pairs);
          const offset = (h * seq + s) * pairs + pair;
          cos[offset] = Math.cos(angle); sin[offset] = Math.sin(angle);
        }
        table = { cos: tf.keep(tf.tensor4d(cos, [1, heads, seq, pairs])), sin: tf.keep(tf.tensor4d(sin, [1, heads, seq, pairs])) };
        tables.set(key, table);
      }
      const [even, odd] = tf.unstack(tensor.reshape([tensor.shape[0], heads, seq, pairs, 2]), 4);
      return tf.stack([even.mul(table.cos).sub(odd.mul(table.sin)), even.mul(table.sin).add(odd.mul(table.cos))], 4)
        .reshape(tensor.shape) as tf.Tensor4D;
    }
    forward = x => tf.tidy(() => {
      const [batch, height, width, channels] = x.shape, seq = height * width;
      const flat = rmsNorm(x, norm).reshape([batch * seq, channels]);
      const project = (weight: tf.Tensor2D, heads: number, dim: number) => flat.matMul(weight)
        .reshape([batch, seq, heads, dim]).transpose([0, 2, 1, 3]) as tf.Tensor4D;
      const q = rotate(project(qWeight, queryHeads, qDim), height, width, queryHeads);
      let k = rotate(project(kWeight, kvHeads, qDim), height, width, kvHeads);
      let v = project(vWeight, kvHeads, vDim);
      if (queryHeads !== kvHeads) {
        const repeat = (t: tf.Tensor4D) => t.expandDims(2).tile([1, 1, queryHeads / kvHeads, 1, 1])
          .reshape([batch, queryHeads, seq, t.shape[3]]) as tf.Tensor4D;
        k = repeat(k); v = repeat(v);
      }
      const scores = tf.matMul(q, k, false, true).mul(1 / Math.sqrt(qDim));
      const attended = tf.matMul(tf.softmax(scores, -1), v).transpose([0, 2, 1, 3]).reshape([batch * seq, queryHeads * vDim]);
      return x.add(attended.matMul(outWeight).reshape(x.shape)) as tf.Tensor4D;
    });
  }
  return { kind: block.kind, forward, dispose() {
    disposeRmsNorm(norm); tf.dispose(weights);
    for (const table of tables.values()) tf.dispose([table.cos, table.sin]);
    tables.clear();
  } };
}
export type TfTransformerBlock = ReturnType<typeof makeTransformerBlock>;
