import assert from "node:assert/strict";
import test from "node:test";
import { usesMahjongOpfs } from "../games/mahjong/storage/environment.js";
import { openMahjongPaipuOpfs } from "../games/mahjong/storage/paipu-opfs.js";
import { saveMahjongPaipu, listMahjongPaipuSummaries, loadMahjongPaipu, setMahjongPaipuPinned } from "../games/mahjong/replay/paipu-store.js";

function filesystem() {
  let failWrite = false;
  const notFound = () => new DOMException("Missing", "NotFoundError");
  function directory() {
    const children = new Map();
    return {
      kind: "directory", children,
      async getDirectoryHandle(name, { create = false } = {}) {
        if (!children.has(name)) { if (!create) throw notFound(); children.set(name, directory()); }
        return children.get(name);
      },
      async getFileHandle(name, { create = false } = {}) {
        if (!children.has(name)) {
          if (!create) throw notFound();
          let committed = "";
          children.set(name, {
            kind: "file",
            async getFile() { return { text: async () => committed }; },
            async createWritable() {
              let pending;
              return {
                async write(value) { if (failWrite) throw new DOMException("Full", "QuotaExceededError"); pending = value; },
                async close() { committed = pending; }, async abort() {},
              };
            },
          });
        }
        return children.get(name);
      },
      async removeEntry(name) { if (!children.delete(name)) throw notFound(); },
      async *entries() { yield* children; },
    };
  }
  const root = directory();
  return { root, open: () => openMahjongPaipuOpfs({ getDirectory: async () => root }), fail: () => { failWrite = true; } };
}
function record(id, time = 1) {
  return {
    id, format: "longern.riichi.paipu", formatVersion: 3, viewerPlayerId: "p1",
    status: "completed", completedAtMs: time, game: { matchType: "east" },
    players: [1,2,3,4].map(seat => ({ id: `p${seat}`, seat })),
    hands: [{ wall: "1m".repeat(136), commands: [], events: [], end: { kind: "exhaustive_draw", winnerSeats: [], results: [] } }],
    final: { scores: [25000,25000,25000,25000], ranks: [1,2,3,4] },
  };
}

test("only embedded Safari selects OPFS, including iPad desktop mode", () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  const window = { parent: {} };
  assert.equal(usesMahjongOpfs({ window, navigator: { userAgent: ua } }), true);
  window.parent = window;
  assert.equal(usesMahjongOpfs({ window, navigator: { userAgent: ua } }), false);
  for (const userAgent of [ua.replace("Version/18.0", "CriOS/130"), "Chrome/130 Safari/537.36", ""]) {
    assert.equal(usesMahjongOpfs({ window: { parent: {} }, navigator: { userAgent } }), false);
  }
});

test("OPFS paipu survives reopening, supports pinning, safe IDs and retention", async () => {
  const fs = filesystem();
  const options = { opfs: await fs.open(), maxRecords: 2 };
  await saveMahjongPaipu(record("one:/一",1), options);
  await setMahjongPaipuPinned("one:/一",true,options);
  await saveMahjongPaipu(record("two",2),options);
  assert.deepEqual((await saveMahjongPaipu(record("three",3),options)).evictedIds,["two"]);
  const reopened = { opfs: await fs.open() };
  assert.equal((await loadMahjongPaipu("one:/一",reopened)).id,"one:/一");
  const summaries = await listMahjongPaipuSummaries(reopened);
  assert.deepEqual(summaries.map(s=>s.id),["three","one:/一"]);
  assert.equal(summaries[1].pinned,true);
  assert.equal(await loadMahjongPaipu("two",reopened),null);
  assert.ok(fs.root.children.get("mahjong").children.has("paipu"));
});

test("failed writes retain prior records and do not evict history or leave empty files", async () => {
  const fs = filesystem(); const options = { opfs: await fs.open(), maxRecords: 1 };
  await saveMahjongPaipu(record("old"),options); fs.fail();
  await assert.rejects(saveMahjongPaipu(record("new"),options),{ name: "QuotaExceededError" });
  await assert.rejects(saveMahjongPaipu(record("old",2),options),{ name: "QuotaExceededError" });
  assert.equal((await loadMahjongPaipu("old",options)).completedAtMs,1);
  assert.deepEqual((await listMahjongPaipuSummaries(options)).map(s=>s.id),["old"]);
});

test("legacy migration copies missing records once, preserving existing OPFS values and pins", async () => {
  const fs=filesystem(); const opfs=await fs.open();
  await opfs.writeRecords(record("existing",10),{id:"existing",pinned:true},[]);
  let reads=0;
  const legacy=async()=>{reads++;return { records:[record("existing",1),record("legacy",2)], matches:[{id:"legacy",pinned:true}] };};
  await opfs.migrate(legacy); await (await fs.open()).migrate(legacy);
  assert.equal(reads,1);
  assert.equal((await opfs.readOne("records","existing")).completedAtMs,10);
  assert.equal((await opfs.readOne("matches","legacy")).pinned,true);
});

test("concurrent saves serialize retention decisions", async () => {
  const fs=filesystem(); const options={opfs:await fs.open(),maxRecords:1};
  await Promise.all([saveMahjongPaipu(record("a",1),options),saveMahjongPaipu(record("b",2),options)]);
  assert.deepEqual((await listMahjongPaipuSummaries(options)).map(s=>s.id),["b"]);
});
