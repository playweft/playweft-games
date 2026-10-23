// Hydrated before game startup. Existing synchronous settings code reads this
// snapshot; writes go to an ordered, acknowledged asynchronous backend.
const games = new Map();

export function getGameStorage(gameId) {
  return games.get(gameId);
}

export async function loadGameStorageCache({
  gameId,
  keys,
  backend,
  validate,
  onError,
  onSaved,
}) {
  const entries = new Map();
  for (const key of keys) {
    const value = await backend.getItem(key);
    validate?.(key, value);
    if (value !== null) entries.set(key, value);
  }
  const allowed = new Set(keys);
  const dirty = new Map();
  let writing;
  let failure;
  function check(key) {
    key = String(key);
    if (!allowed.has(key))
      throw new Error(`Unregistered ${gameId} storage key: ${key}`);
    return key;
  }
  function write() {
    if (writing) return writing;
    if (failure) return Promise.reject(failure);
    writing = (async () => {
      // Defer even synchronous test backends so writing is assigned first.
      await Promise.resolve();
      while (dirty.size) {
        const [key, revision] = dirty.entries().next().value;
        if (revision.value === null) await backend.removeItem(key);
        else await backend.setItem(key, revision.value);
        if (dirty.get(key) === revision) dirty.delete(key);
      }
      onSaved?.();
    })()
      .catch((error) => {
        failure = error;
        onError?.(error, cache.retry);
        throw error;
      })
      .finally(() => {
        writing = undefined;
      });
    return writing;
  }
  function update(key, value) {
    key = check(key);
    if ((entries.get(key) ?? null) === value) return;
    if (value === null) entries.delete(key);
    else entries.set(key, value);
    dirty.set(key, { value });
    void write().catch(() => {});
  }
  const cache = {
    getItem(key) {
      return entries.get(check(key)) ?? null;
    },
    setItem(key, value) {
      update(key, String(value));
    },
    removeItem(key) {
      update(key, null);
    },
    flush: write,
    retry() {
      failure = undefined;
      return write();
    },
  };
  games.set(gameId, cache);
  return cache;
}
