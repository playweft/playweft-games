export async function downloadGoAiModel(url, {
  onProgress = () => {},
  fetchFile = fetch,
} = {}) {
  const abort = new AbortController();
  try {
    const response = await fetchFile(url, { signal: abort.signal });
    if (!response.ok) throw new Error(`AI 模型下载失败（${response.status}）`);
    const reader = response.body.getReader();
    const total = Number(response.headers.get("content-length")) || 0;
    let loaded = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) { reader.releaseLock(); controller.close(); return; }
          loaded += value.byteLength;
          onProgress(loaded, total);
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) { abort.abort(); return reader.cancel(reason); },
    });

    // Some .gz hosts set Content-Encoding: gzip, so fetch has already decoded
    // the weights. Check actual bytes before choosing whether to decompress.
    const peek = stream.getReader();
    const prefix = [];
    let length = 0;
    while (length < 2) {
      const part = await peek.read();
      if (part.done) throw new Error("AI 模型文件不完整，请重试");
      prefix.push(part.value);
      length += part.value.byteLength;
    }
    const header = prefix.flatMap(bytes => Array.from(bytes.subarray(0, 2))).slice(0, 2);
    const joined = new ReadableStream({
      async pull(controller) {
        if (prefix.length) { controller.enqueue(prefix.shift()); return; }
        const { value, done } = await peek.read();
        if (done) { peek.releaseLock(); controller.close(); }
        else controller.enqueue(value);
      },
      cancel(reason) { return peek.cancel(reason); },
    });
    const decoded = header[0] === 0x1f && header[1] === 0x8b
      ? joined.pipeThrough(new DecompressionStream("gzip")) : joined;
    return new Uint8Array(await new Response(decoded).arrayBuffer());
  } finally {
    abort.abort();
  }
}
