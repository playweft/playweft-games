import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { downloadGoAiModel } from "../games/go/ai-model-download.js";

function streamed(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers });
}

test("model URL download streams gzip and handles a header split across network chunks", async () => {
  const original = Buffer.from("KataGo model weights\n".repeat(1000));
  const gzip = gzipSync(original);
  const progress = [];
  const bytes = await downloadGoAiModel("https://models.example/b18.bin.gz", {
    fetchFile: async url => {
      assert.equal(url, "https://models.example/b18.bin.gz");
      return streamed([gzip.subarray(0, 1), gzip.subarray(1, 21), gzip.subarray(21)], {
        "content-length": String(gzip.length),
      });
    },
    onProgress: (loaded, total) => progress.push([loaded, total]),
  });
  assert.deepEqual(Buffer.from(bytes), original);
  assert.deepEqual(progress.at(-1), [gzip.length, gzip.length]);
});

test("model URL download accepts weights already decoded by HTTP Content-Encoding", async () => {
  const original = Buffer.from("model-name\n14\n22\n19\n");
  const bytes = await downloadGoAiModel("bundled-b6.gz", {
    fetchFile: async () => streamed([original], { "content-encoding": "gzip" }),
  });
  assert.deepEqual(Buffer.from(bytes), original);
});

test("failed model URL reports the HTTP error", async () => {
  await assert.rejects(downloadGoAiModel("missing", {
    fetchFile: async () => new Response("not found", { status: 404 }),
  }), /模型下载失败（404）/);
});

test("empty and truncated model downloads are rejected", async () => {
  await assert.rejects(downloadGoAiModel("empty", {
    fetchFile: async () => new Response(new Uint8Array()),
  }), /模型文件不完整/);
  await assert.rejects(downloadGoAiModel("truncated", {
    fetchFile: async () => new Response(gzipSync("model").subarray(0, 12)),
  }));
});

test("bundled b6 is the original lightweight model and fits the static asset limit", async () => {
  const bytes = await readFile(new URL("../games/go/assets/katago-b6.bin.gz", import.meta.url));
  assert.ok(bytes.length < 25 * 1024 * 1024);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "f5d32604e3675c480c7c8f6aa579a1ea857135628a0afccc8fa56330fbacd38d");
  assert.ok(gunzipSync(bytes).subarray(0, 100).toString().startsWith("g170-b6c96-s175395328-d26788732\n"));
});
