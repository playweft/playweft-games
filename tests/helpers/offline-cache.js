const NativeRequest = globalThis.Request;

export function installOfflineCache(t) {
  const origin = "https://game.example";
  const caches = new Map();
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const cacheStorage = {
    async has(name) { return caches.has(name); },
    async keys() { return [...caches.keys()]; },
    async delete(name) { return caches.delete(name); },
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      const entries = caches.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) { entries.set(key(request), response.clone()); },
        async delete(request) { return entries.delete(key(request)); },
        async keys() { return [...entries.keys()].map((url) => new NativeRequest(url)); },
      };
    },
  };
  const originals = new Map();
  t.after(() => {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
  function setGlobal(name, value) {
    if (!originals.has(name))
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  setGlobal("caches", cacheStorage);
  setGlobal("Request", class extends NativeRequest {
    constructor(url, options) {
      super(typeof url === "string" ? new URL(url, origin) : url, options);
    }
  });
  return { caches: cacheStorage, setGlobal };
}
