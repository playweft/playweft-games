import { getGameStorage } from "./game-storage-cache.js";
const DEFAULT_MODE = "none";
const DEFAULT_POLICY = "network-first";
const HOME_GAME_ID = "home";
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;
const BUILD_VERSION_PATTERN = /^[a-f0-9]{16}$/;
const DEVELOPMENT_BUILD_VERSION = "development";
const BUILD_VERSION_META_NAME = "playweft-build-version";
const OFFLINE_MANIFEST_URL = "/__playweft-offline-package__";

export const MAHJONG_GAME_ID = "mahjong";
// Kept as the fallback for pages produced before build-version metadata existed.
export const CACHE_VERSION = "v2";
export const SETTINGS_KEY = "playweft.mahjong.offline-cache-mode";
export const POLICY_KEY = "playweft.mahjong.offline-cache-policy";
export const CACHE_NAME = `playweft-offline:${MAHJONG_GAME_ID}:${CACHE_VERSION}`;

function normalizeGameId(gameId = MAHJONG_GAME_ID) {
  const value = String(gameId || MAHJONG_GAME_ID).trim().toLowerCase();
  return GAME_ID_PATTERN.test(value) ? value : MAHJONG_GAME_ID;
}

export function readBuildContentVersion(document = globalThis.document) {
  const value = document
    ?.querySelector?.(`meta[name="${BUILD_VERSION_META_NAME}"]`)
    ?.getAttribute?.("content")
    ?.trim()
    ?.toLowerCase();
  return BUILD_VERSION_PATTERN.test(value) ? value : DEVELOPMENT_BUILD_VERSION;
}

function normalizeBuildVersion(version) {
  const value = String(version || "").trim().toLowerCase();
  return BUILD_VERSION_PATTERN.test(value) || value === DEVELOPMENT_BUILD_VERSION
    ? value
    : CACHE_VERSION;
}

export function gameOfflineCacheName(
  gameId = MAHJONG_GAME_ID,
  buildVersion = readBuildContentVersion(),
) {
  return `playweft-offline:${normalizeGameId(gameId)}:${normalizeBuildVersion(buildVersion)}`;
}

export function gameOfflineSettingsKeys(gameId = MAHJONG_GAME_ID) {
  const normalized = normalizeGameId(gameId);
  return {
    mode: `playweft.${normalized}.offline-cache-mode`,
    policy: `playweft.${normalized}.offline-cache-policy`,
    version: `playweft.${normalized}.offline-cache-version`,
  };
}

function defaultSettingsStorage(gameId) {
  const storage = getGameStorage(gameId);
  // Migrated entries hydrate before startup and must never fall back to the
  // iframe partition. Other games keep their existing storage behavior.
  if (storage || gameId === "mahjong" || gameId === "sudoku") return storage;
  return globalThis.localStorage;
}

export function readGameOfflineSettings(
  gameId = MAHJONG_GAME_ID,
  storage = defaultSettingsStorage(gameId),
) {
  const keys = gameOfflineSettingsKeys(gameId);
  let mode = DEFAULT_MODE;
  let policy = DEFAULT_POLICY;
  let version = "";
  try {
    mode = ["download", "true"].includes(storage?.getItem(keys.mode))
      ? "download"
      : DEFAULT_MODE;
    policy = storage?.getItem(keys.policy) === "local-first"
      ? "local-first"
      : DEFAULT_POLICY;
    version = String(storage?.getItem(keys.version) || "").trim().toLowerCase();
  } catch {}
  return { mode, policy, version };
}

export function writeGameOfflineSettings(
  gameId,
  { mode, policy, version } = {},
  storage = defaultSettingsStorage(gameId),
) {
  const keys = gameOfflineSettingsKeys(gameId);
  const next = {
    mode: mode === "download" ? "download" : DEFAULT_MODE,
    policy: policy === "local-first" ? "local-first" : DEFAULT_POLICY,
    version: mode === "download" ? normalizeBuildVersion(version) : "",
  };
  try {
    storage?.setItem(keys.mode, next.mode);
    storage?.setItem(keys.policy, next.policy);
    if (next.version) storage?.setItem(keys.version, next.version);
    else storage?.removeItem(keys.version);
  } catch {}
  return next;
}

/** A complete package must still contain every resource recorded at download time. */
export async function hasGameOfflineResources(
  gameId = MAHJONG_GAME_ID,
  {
    settings = readGameOfflineSettings(gameId),
    buildVersion = readBuildContentVersion(),
  } = {},
) {
  if (settings.mode !== "download" || settings.version !== buildVersion)
    return false;
  try {
    const cacheName = gameOfflineCacheName(gameId, buildVersion);
    if (!await globalThis.caches?.has(cacheName)) return false;
    const cache = await caches.open(cacheName);
    const manifest = await cache.match(OFFLINE_MANIFEST_URL);
    if (!manifest) return false;
    const { urls } = await manifest.json();
    if (!Array.isArray(urls) || !urls.length) return false;
    const cachedUrls = new Set((await cache.keys()).map((request) => request.url));
    return urls.every((url) => typeof url === "string" && cachedUrls.has(url));
  } catch {
    // Storage can be unavailable or evicted without the saved preference changing.
    return false;
  }
}

export async function fetchGameResource(
  url,
  {
    gameId = MAHJONG_GAME_ID,
    mode,
    policy,
    buildVersion = readBuildContentVersion(),
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const request = new Request(url, { cache: "no-store" });
  const settings = readGameOfflineSettings(gameId);
  const selectedMode = mode || settings.mode;
  const selectedPolicy = policy || settings.policy;
  const available = await hasGameOfflineResources(gameId, {
    settings: { ...settings, mode: selectedMode, version: mode ? buildVersion : settings.version },
    buildVersion,
  });
  const cache = available
    ? await caches.open(gameOfflineCacheName(gameId, buildVersion))
    : null;
  if (selectedPolicy === "local-first" && cache) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try {
    const response = await fetchImpl(request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (cache && selectedMode === "download") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = cache && await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

export async function cacheGameOfflineResources(
  gameId,
  urls,
  {
    buildVersion = readBuildContentVersion(),
    fetchImpl = globalThis.fetch,
    signal,
  } = {},
) {
  const cache = await caches.open(gameOfflineCacheName(gameId, buildVersion));
  await cache.delete(OFFLINE_MANIFEST_URL);
  const results = [];
  for (const url of [...new Set((urls || []).filter(Boolean))]) {
    if (signal?.aborted) {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      throw error;
    }
    try {
      const response = await fetchImpl(new Request(url, { cache: "no-store", signal }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response.clone());
      results.push({ url, ok: true });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      results.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!signal?.aborted && results.length && results.every((result) => result.ok)) {
    await cache.put(OFFLINE_MANIFEST_URL, new Response(JSON.stringify({
      urls: results.map(({ url }) => new Request(url).url),
    }), { headers: { "Content-Type": "application/json" } }));
  }
  return results;
}

export async function clearGameOfflineCache(gameId = MAHJONG_GAME_ID) {
  if (typeof caches === "undefined") return false;
  const prefix = `playweft-offline:${normalizeGameId(gameId)}:`;
  const names = await caches.keys();
  const removed = await Promise.all(
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => caches.delete(name)),
  );
  return removed.some(Boolean);
}

export async function registerGameOfflineServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function notifyGameOfflineSettings(
  gameId = MAHJONG_GAME_ID,
  settings = readGameOfflineSettings(gameId),
) {
  const buildVersion = readBuildContentVersion();
  const available = await hasGameOfflineResources(gameId, { settings, buildVersion });
  const message = {
    type: "game-offline-settings",
    gameId: normalizeGameId(gameId),
    mode: available ? "download" : DEFAULT_MODE,
    policy: available && settings.policy === "local-first" ? "local-first" : DEFAULT_POLICY,
    buildVersion,
  };
  const serviceWorker = globalThis.navigator?.serviceWorker;
  const controller = serviceWorker?.controller;
  if (controller) controller.postMessage(message);
  else void serviceWorker?.ready.then((registration) => {
    registration.active?.postMessage(message);
  }).catch(() => {});
}

export function gameOfflineResourceUrls(gameId = MAHJONG_GAME_ID, extra = []) {
  const prefix = `/${normalizeGameId(gameId)}/`;
  const current = performance.getEntriesByType?.("resource")
    ?.map((entry) => entry.name)
    .filter((url) => {
      try {
        const parsed = new URL(url, globalThis.location?.href);
        return parsed.origin === globalThis.location?.origin &&
          !parsed.pathname.endsWith("/sw.js");
      } catch {
        return false;
      }
    }) || [];
  return [...new Set([
    `${prefix}`,
    `${prefix}index.html`,
    "/build-version.json",
    ...current,
    ...extra,
  ])];
}

// Backward-compatible Mahjong facade for existing callers.
export const readMahjongOfflineSettings = (storage) =>
  readGameOfflineSettings(MAHJONG_GAME_ID, storage);
export const writeMahjongOfflineSettings = (settings, storage) =>
  writeGameOfflineSettings(MAHJONG_GAME_ID, settings, storage);
export const fetchMahjongResource = (url, options) =>
  fetchGameResource(url, { ...options, gameId: MAHJONG_GAME_ID });
export const cacheMahjongOfflineResources = (urls, options) =>
  cacheGameOfflineResources(MAHJONG_GAME_ID, urls, options);
export const clearMahjongOfflineCache = () =>
  clearGameOfflineCache(MAHJONG_GAME_ID);
export const registerMahjongOfflineServiceWorker = registerGameOfflineServiceWorker;
export const notifyMahjongOfflinePolicy = (policy) =>
  notifyGameOfflineSettings(MAHJONG_GAME_ID, {
    ...readMahjongOfflineSettings(),
    policy,
  });
export const mahjongOfflineResourceUrls = (extra) =>
  gameOfflineResourceUrls(MAHJONG_GAME_ID, extra);

export { DEFAULT_MODE, DEFAULT_POLICY, HOME_GAME_ID };
