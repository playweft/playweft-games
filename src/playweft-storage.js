/** Storage capabilities on the existing game bridge; never opens a second port. */
export function createPlayweftStorageBridge(rpc) {
  let context;
  let closed = false;
  const waiters = new Set();
  const api = {
    initialize(value) {
      context = value;
      for (const waiter of waiters) waiter.resolve(value);
    },
    fail(error) {
      for (const waiter of waiters) waiter.reject(error);
    },
    ready({ timeoutMs = 10000 } = {}) {
      if (closed)
        return Promise.reject(new Error("The game bridge was closed"));
      if (context) return Promise.resolve(context);
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(value) {
            finish();
            resolve(value);
          },
          reject(error) {
            finish();
            reject(error);
          },
        };
        function finish() {
          clearTimeout(timer);
          waiters.delete(waiter);
        }
        const timer = setTimeout(
          () =>
            waiter.reject(
              Object.assign(
                new Error(
                  "Platform storage initialization timed out. Reload the platform and retry.",
                ),
                { code: "STORAGE_UNAVAILABLE" },
              ),
            ),
          timeoutMs,
        );
        waiters.add(waiter);
      });
    },
    destroy() {
      closed = true;
      api.fail(new Error("The game bridge was closed"));
    },
  };
  async function call(method, params) {
    const value = await api.ready();
    if (!value?.capabilities?.includes(method))
      throw Object.assign(
        new Error(`Platform capability unavailable: ${method}`),
        { code: "STORAGE_UNSUPPORTED" },
      );
    return rpc.call(method, params, undefined, { timeoutMs: 10000 });
  }
  api.localStorage = {
    getItem: (key) => call("localStorage.getItem", { key: String(key) }),
    async setItem(key, value) {
      await call("localStorage.setItem", {
        key: String(key),
        value: String(value),
      });
    },
    async removeItem(key) {
      await call("localStorage.removeItem", { key: String(key) });
    },
    async clear() {
      await call("localStorage.clear");
    },
    key(index) {
      if (!Number.isSafeInteger(index) || index < 0)
        return Promise.reject(new TypeError("Invalid storage index"));
      return call("localStorage.key", { index });
    },
    length: () => call("localStorage.length"),
  };
  return api;
}
