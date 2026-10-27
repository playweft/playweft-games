// Each file contains its record and summary together, so a committed file never
// depends on a separately committed index. Filenames are reversible, safe IDs.
export async function openMahjongPaipuOpfs({ getDirectory = () => navigator.storage.getDirectory() } = {}) {
  const root = await getDirectory();
  const mahjong = await root.getDirectoryHandle("mahjong", { create: true });
  const directory = await mahjong.getDirectoryHandle("paipu", { create: true });
  const filename = (id) => encodeURIComponent(id) + ".json";
  async function readFile(name) {
    let handle;
    try { handle = await directory.getFileHandle(name); }
    catch (error) { if (error.name === "NotFoundError") return null; throw error; }
    return JSON.parse(await (await handle.getFile()).text());
  }
  async function writeFile(name, value) {
    let existed = true;
    try { await directory.getFileHandle(name); }
    catch (error) { if (error.name !== "NotFoundError") throw error; existed = false; }
    const handle = await directory.getFileHandle(name, { create: true });
    let writer;
    try {
      writer = await handle.createWritable();
      await writer.write(JSON.stringify(value));
      await writer.close();
    }
    catch (error) {
      try { await writer?.abort(); } catch {}
      if (!existed) { try { await directory.removeEntry(name); } catch {} }
      throw error;
    }
  }
  async function remove(id) {
    try { await directory.removeEntry(filename(id)); }
    catch (error) { if (error.name !== "NotFoundError") throw error; }
  }
  return {
    opfs: true,
    close() {},
    async readOne(store, id) { return (await readFile(filename(id)))?.[store] ?? undefined; },
    async readAll(store) {
      const result = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== "file" || !name.endsWith(".json")) continue;
        const value = await readFile(name);
        if (value?.[store]) result.push(value[store]);
      }
      return result;
    },
    async writeProgress(record) {
      const previous = await readFile(filename(record.id));
      await writeFile(filename(record.id), { ...previous, records: record });
    },
    async writeRecords(record, summary, evictedIds) {
      // Commit the new record before eviction. A failed write retains old data.
      await writeFile(filename(record.id), { records: record, matches: summary });
      for (const id of evictedIds) await remove(id);
    },
    async setPinned(id, pinned) {
      const previous = await readFile(filename(id));
      if (!previous?.matches) return false;
      previous.matches.pinned = pinned === true;
      await writeFile(filename(id), previous);
      return true;
    },
    async migrate(readLegacy) {
      if (await readFile("idb-migrated")) return;
      // Legacy reads may be blocked in Safari. This must not disable new OPFS
      // writes; retry migration on a later page load, retaining the old DB.
      let legacy;
      try { legacy = await readLegacy(); }
      catch (error) {
        console.warn("Unable to read legacy Mahjong paipu; original database retained", error);
        return;
      }
      for (const record of legacy.records) {
        if (await readFile(filename(record.id))) continue;
        const summary = legacy.matches.find((entry) => entry.id === record.id);
        await writeFile(filename(record.id), { records: record, ...(summary ? { matches: summary } : {}) });
      }
      await writeFile("idb-migrated", true);
    },
  };
}
