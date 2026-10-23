import { getGameStorage } from "../../../src/game-storage-cache.js";
import {
  normalizeMahjongPortraitPool,
  resolveMahjongPortraitDefaults,
} from "./portrait-selection.js";

const ASSET_GROUPS = [
  "portraits",
  "tablecloths",
  "tableBackgrounds",
  "lobbyBackgrounds",
  "tileBacks",
  "matchBgm",
  "riichiBgm",
];
const DEFAULT_APPEARANCE_KEY = "playweft.mahjong.default-asset-appearance";

const injectedConfig =
  typeof __MAHJONG_DEFAULT_ASSET_CONFIG__ !== "undefined"
    ? __MAHJONG_DEFAULT_ASSET_CONFIG__
    : {};

export function normalizeMahjongDefaultAssetConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const assetPacks = normalizeAssetPacks(source.assetPacks);
  const catalog = Object.fromEntries(
    ASSET_GROUPS.map((group) => [
      group,
      normalizeEntries(source[group]),
    ]),
  );
  // Built-in remote config currently covers visual assets and BGM. Keep the
  // same catalog shape as a local pack so the settings renderer can inspect
  // voice entries without special-casing the default pack.
  catalog.voices = [];
  const requested = source.defaults && typeof source.defaults === "object"
    ? source.defaults
    : {};
  const portraitDefaults = requested.portraits && typeof requested.portraits === "object"
    ? requested.portraits
    : {};
  const portraitPool = normalizeMahjongPortraitPool(
    portraitDefaults.pool,
    catalog.portraits,
  );
  const appearance = {
    portraits: {
      self: pickId(catalog.portraits, portraitDefaults.self),
    },
    tablecloth: pickId(catalog.tablecloths, requested?.tablecloth),
    tableBackground: pickId(catalog.tableBackgrounds, requested?.tableBackground),
    lobbyBackground: pickId(catalog.lobbyBackgrounds, requested?.lobbyBackground),
    tileBack: pickId(catalog.tileBacks, requested?.tileBack),
    matchBgm: requested?.matchBgm === ""
      ? ""
      : pickId(catalog.matchBgm, requested?.matchBgm),
    riichiBgm: requested?.riichiBgm === ""
      ? ""
      : pickId(catalog.riichiBgm, requested?.riichiBgm),
  };
  return {
    name: "默认主题",
    catalog,
    appearance,
    portraitPool,
    assetPacks,
  };
}

export const MAHJONG_DEFAULT_ASSET_CONFIG =
  normalizeMahjongDefaultAssetConfig(injectedConfig);

export function getMahjongDefaultAssetPack(appearanceOverride) {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const configuredAppearance = readAppearance(config);
  const appearance = appearanceOverride && typeof appearanceOverride === "object"
    ? {
      ...configuredAppearance,
      ...appearanceOverride,
      portraits: {
        ...configuredAppearance.portraits,
        ...(appearanceOverride.portraits ?? {}),
      },
    }
    : configuredAppearance;
  const assets = new Map();
  for (const position of Object.keys(appearance.portraits)) {
    addSelectedAsset(
      assets,
      `portrait-${position}`,
      config.catalog.portraits,
      appearance.portraits[position],
    );
  }
  addSelectedAsset(assets, "tablecloth", config.catalog.tablecloths, appearance.tablecloth);
  addSelectedAsset(assets, "background", config.catalog.tableBackgrounds, appearance.tableBackground);
  addSelectedAsset(assets, "lobby", config.catalog.lobbyBackgrounds, appearance.lobbyBackground);
  addSelectedAsset(assets, "tile-back", config.catalog.tileBacks, appearance.tileBack);
  addSelectedAsset(assets, "music", config.catalog.matchBgm, appearance.matchBgm);
  addSelectedAsset(
    assets,
    "riichi-music",
    config.catalog.riichiBgm,
    appearance.riichiBgm,
  );
  return {
    id: "__default__",
    name: config.name,
    active: true,
    isDefault: true,
    catalog: config.catalog,
    appearance,
    portraitPool: config.portraitPool,
    defaultNames: portraitNames(config.catalog, appearance),
    assetNames: ASSET_GROUPS.flatMap((group) =>
      config.catalog[group].map((entry) => entry.label),
    ),
    assets,
  };
}

export function getMahjongDefaultAssetMap() {
  return getMahjongDefaultAssetPack().assets;
}

export function getMahjongConfiguredAssetPacks() {
  return MAHJONG_DEFAULT_ASSET_CONFIG.assetPacks.map((pack) => ({ ...pack }));
}

export function getMahjongDefaultAssetCopyright() {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const appearance = readAppearance(config);
  const matchCopyright = config.catalog.matchBgm.find(
    (entry) => entry.id === appearance.matchBgm,
  )?.copyright;
  const riichiCopyright = config.catalog.riichiBgm.find(
    (entry) => entry.id === appearance.riichiBgm,
  )?.copyright;
  return [
    matchCopyright && `对局音乐：${matchCopyright}`,
    riichiCopyright && `立直音乐：${riichiCopyright}`,
  ].filter(Boolean).join("\n");
}

export function configureMahjongDefaultAssetAppearance(nextAppearance) {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const currentAppearance = readAppearance(config);
  const appearance = {
    ...currentAppearance,
    ...(nextAppearance && typeof nextAppearance === "object" ? nextAppearance : {}),
    portraits: {
      self: nextAppearance?.portraits?.self ?? currentAppearance.portraits.self,
    },
  };
  try {
    getGameStorage("mahjong").setItem(DEFAULT_APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // The current tab still uses the returned in-memory configuration.
  }
  return getMahjongDefaultAssetPack();
}

function readAppearance(config) {
  let stored;
  try {
    stored = JSON.parse(getGameStorage("mahjong").getItem(DEFAULT_APPEARANCE_KEY) || "null");
  } catch {
    stored = null;
  }
  const requested = stored && typeof stored === "object" ? stored : config.appearance;
  return {
    portraits: resolvePortraitAppearance(config, requested?.portraits),
    tablecloth: pickId(config.catalog.tablecloths, requested?.tablecloth),
    tableBackground: pickId(config.catalog.tableBackgrounds, requested?.tableBackground),
    lobbyBackground: pickId(config.catalog.lobbyBackgrounds, requested?.lobbyBackground),
    tileBack: pickId(config.catalog.tileBacks, requested?.tileBack),
    matchBgm: requested?.matchBgm === ""
      ? ""
      : pickId(config.catalog.matchBgm, requested?.matchBgm),
    riichiBgm: requested?.riichiBgm === ""
      ? ""
      : pickId(config.catalog.riichiBgm, requested?.riichiBgm),
  };
}

function resolvePortraitAppearance(config, requested) {
  const choices = requested && typeof requested === "object" ? requested : {};
  return resolveMahjongPortraitDefaults(
    config.catalog.portraits,
    choices,
  );
}

export function portraitNames(catalog, appearance) {
  return Object.fromEntries(
    Object.entries(appearance?.portraits ?? {}).map(([position, id]) => {
      const entry = catalog?.portraits?.find((candidate) => candidate.id === id);
      return [position, entry?.label || id || ""];
    }),
  );
}

function addSelectedAsset(target, slot, entries, id) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry) {
    target.set(slot, {
      name: entry.label,
      url: entry.url,
      copyright: entry.copyright,
      fallbackColor: entry.fallbackColor,
    });
  }
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const id = String(entry?.id || "").trim();
    const url = String(entry?.url || "").trim();
    const label = String(entry?.label || id).trim();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !url || !label) return [];
    let parsed;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return [];
    } catch {
      return [];
    }
    const fallbackColor = normalizeFallbackColor(entry?.fallbackColor);
    if (entry?.fallbackColor !== undefined && !fallbackColor) return [];
    const normalised = {
      id,
      url: parsed.href,
      label: label.slice(0, 24),
      copyright: String(entry?.copyright || "").trim().slice(0, 160),
    };
    if (fallbackColor) normalised.fallbackColor = fallbackColor;
    return [normalised];
  });
}

function normalizeFallbackColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
}

function normalizeAssetPacks(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.flatMap((entry) => {
    const name = String(entry?.name || "").trim().slice(0, 40);
    const suppliedUrl = String(entry?.url || "").trim();
    if (!name || !suppliedUrl) return [];
    let url;
    try {
      const parsed = new URL(suppliedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      url = parsed.href;
    } catch {
      return [];
    }
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ name, url }];
  });
}

function pickId(entries, requested) {
  if (entries.some((entry) => entry.id === requested)) return requested;
  return entries[0]?.id || "";
}
