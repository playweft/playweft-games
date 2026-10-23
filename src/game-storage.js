/** First-party IndexedDB when standalone; platform-owned storage when embedded. */
export function createStandaloneStorage({
  factory = globalThis.indexedDB,
  name = "playweft-games-storage",
} = {}) {
  let connection;
  function open() {
    if (connection) return connection;
    const pending = new Promise((resolve, reject) => {
      if (!factory) return reject(new Error("IndexedDB is unavailable"));
      const request = factory.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () =>
        request.result.createObjectStore("entries");
      request.onblocked = () => {
        failed = true;
        reject(new Error("Storage upgrade is blocked by another tab"));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (failed) return db.close();
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        resolve(db);
      };
    });
    connection = pending;
    void pending.catch(() => {
      if (connection === pending) connection = null;
    });
    return pending;
  }
  async function request(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("entries", mode, {
        durability: mode === "readwrite" ? "strict" : "default",
      });
      const result = action(tx.objectStore("entries"));
      tx.oncomplete = () => resolve(result.result ?? null);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Storage transaction aborted"));
    });
  }
  return {
    getItem: (key) => request("readonly", (store) => store.get(String(key))),
    setItem: async (key, value) => {
      await request("readwrite", (store) =>
        store.put(String(value), String(key)),
      );
    },
    removeItem: async (key) => {
      await request("readwrite", (store) => store.delete(String(key)));
    },
    clear: async () => {
      await request("readwrite", (store) => store.clear());
    },
    length: () => request("readonly", (store) => store.count()),
    key: async (index) => {
      if (!Number.isSafeInteger(index) || index < 0)
        throw new TypeError("Invalid storage index");
      const keys = await request("readonly", (store) => store.getAllKeys());
      return keys[index] ?? null;
    },
    async close() {
      (await connection)?.close();
      connection = null;
    },
  };
}

export function createGameStorage(
  bridge,
  {
    embedded = window.parent !== window,
    standalone,
    legacyStorage = () => globalThis.localStorage,
    legacyKeys = [],
    migrationKey,
  } = {},
) {
  let initialized,
    tail = Promise.resolve();
  async function initialize() {
    let storage;
    if (embedded) {
      const context = await bridge.ready();
      if (
        !["getItem", "setItem", "removeItem"].every((method) =>
          context.capabilities?.includes(`localStorage.${method}`),
        )
      )
        throw Object.assign(
          new Error(
            "The platform does not support persistent game storage. Update or reload the platform.",
          ),
          { code: "STORAGE_UNSUPPORTED" },
        );
      storage = bridge.localStorage;
    } else storage = standalone ??= createStandaloneStorage();
    if (!migrationKey || (await storage.getItem(migrationKey)) !== null)
      return storage;
    // Existing platform/IDB progress is authoritative. Never replace it with a
    // possibly stale localStorage backup from another browsing context.
    let legacy;
    for (const key of legacyKeys) {
      if ((await storage.getItem(key)) !== null) continue;
      legacy ??= legacyStorage();
      const raw = legacy?.getItem(key) ?? null;
      if (raw !== null) await storage.setItem(key, raw);
    }
    await storage.setItem(migrationKey, "1");
    try {
      legacy ??= legacyStorage();
      for (const key of legacyKeys) legacy?.removeItem(key);
    } catch {
      /* The committed copy is authoritative. */
    }

    return storage;
  }
  function backend() {
    if (!initialized) {
      const pending = initialize();
      initialized = pending;
      void pending.catch(() => {
        if (initialized === pending) initialized = null;
      });
    }
    return initialized;
  }
  function call(method, args) {
    const result = tail.then(async () => (await backend())[method](...args));
    tail = result.catch(() => {});
    return result;
  }
  return {
    getItem: (key) => call("getItem", [String(key)]),
    setItem: (key, value) => call("setItem", [String(key), String(value)]),
    removeItem: (key) => call("removeItem", [String(key)]),
    clear: () => call("clear", []),
    key: (index) => call("key", [index]),
    length: () => call("length", []),
  };
}
