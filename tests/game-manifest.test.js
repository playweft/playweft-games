import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ROOM_GAMES = new Map([
  ["pig-dice", [2, 2]],
  ["connect-four", [2, 2]],
  ["texas-holdem", [2, 6]],
  ["dou-dizhu", [3, 3]],
  ["mahjong", [2, 4]],
  ["werewolf-dealer", [6, 15]],
  ["uno", [2, 4]],
  ["go", [2, 2]],
  ["gomoku", [2, 2]],
  ["xiangqi", [2, 2]],
  ["chess", [2, 2]],
]);
const ALL_GAMES = [
  "dou-dizhu",
  "mahjong",
  "xiangqi",
  "chess",
  "uno",
  "werewolf-dealer",
  "gomoku",
  "sudoku",
  "texas-holdem",
  "go",
  "connect-four",
  "pig-dice",
];
const CATALOGUE_TECHNICAL_COPY = /Lua|WebGL|Canvas|Three\.js|浏览器|规则引擎|协议|同步|简单 AI/i;

test("Every game package has a strict Playweft Manifest v1 for bridge v1", async () => {
  const ids = new Set();

  for (const game of ALL_GAMES) {
    const manifest = JSON.parse(
      await readFile(`games/${game}/playweft.json`, "utf8"),
    );

    assert.deepEqual(
      Object.keys(manifest).sort(),
      [
        "$schema",
        "background_color",
        "categories",
        "description",
        "description_localized",
        "help_url",
        "id",
        "icons",
        "manifest_version",
        "modes",
        "name",
        "name_localized",
        ...(["dou-dizhu", "mahjong"].includes(game) ? ["orientation"] : []),
        "protocol",
        "start_url",
        "theme_color",
        "version",
      ].sort(),
      `${game} manifest should not contain unknown top-level fields`,
    );
    assert.equal(manifest.manifest_version, 1);
    assert.equal(manifest.id, `/${game}/`);
    assert.equal(ids.has(manifest.id), false, `${manifest.id} must be unique`);
    ids.add(manifest.id);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(manifest.protocol, { min: 1, max: 1 });
    assert.equal(manifest.start_url, "./");
    assert.equal(typeof manifest.name, "string");
    assert.equal(typeof manifest.name_localized["zh-CN"], "string");
    assert.equal(typeof manifest.description, "string");
    assert.equal(typeof manifest.description_localized["zh-CN"], "string");
    assert.ok(manifest.description.length <= 100, `${game} English description is too long`);
    assert.ok(
      manifest.description_localized["zh-CN"].length <= 32,
      `${game} Chinese description is too long`,
    );
    assert.doesNotMatch(
      manifest.description_localized["zh-CN"],
      CATALOGUE_TECHNICAL_COPY,
      `${game} description should describe the play experience`,
    );
    assert.ok(manifest.categories.length > 0);
    assert.equal(manifest.help_url, "./help.html");
    assert.equal(manifest.icons.length, 1);
    const [manifestIcon] = manifest.icons;
    assert.match(
      manifestIcon.src,
      new RegExp(`^\\.\\./${game}\\.(?:svg|png|webp)$`),
    );
    const icon = await readFile(`public/${manifestIcon.src.slice(3)}`);
    assert.ok(icon.byteLength > 0, `${game} icon should not be empty`);

    if (manifestIcon.src.endsWith(".svg")) {
      assert.equal(manifestIcon.sizes, "any");
      assert.equal(manifestIcon.type, "image/svg+xml");
    }

    if (["dou-dizhu", "mahjong"].includes(game)) {
      assert.equal(manifest.orientation, "landscape");
    } else {
      assert.equal("orientation" in manifest, false);
    }
    assert.equal("permissions" in manifest, false);

    if (game === "sudoku") {
      assert.deepEqual(manifest.modes, { solo: {} });
      continue;
    }

    const [min, max] = ROOM_GAMES.get(game);
    const expectedModes = {
      room: {
        players: { min, max },
        server: {
          runtime: "lua",
          entry: game === "mahjong" ? "./game-online.lua" : "./game.lua",
          persistence: "durable",
        },
      },
    };
    if (["go", "dou-dizhu", "gomoku", "xiangqi", "chess", "werewolf-dealer", "mahjong"].includes(game)) {
      expectedModes.solo = {};
    }
    assert.deepEqual(manifest.modes, expectedModes);
  }
});

test("Featured list points exclusively to every game Manifest", async () => {
  const featured = JSON.parse(
    await readFile("public/featured-games.json", "utf8"),
  );

  assert.deepEqual(
    featured,
    ALL_GAMES.map((game) => ({
      manifestUrl: `./${game}/playweft.json`,
    })),
  );
});

test("Cloudflare Pages limits static CORS to browser-fetched JSON", async () => {
  const headers = await readFile("public/_headers", "utf8");

  assert.match(headers, /^\/featured-games\.json\s*$/m);
  assert.match(headers, /^\/:game\/playweft\.json\s*$/m);
  assert.equal(
    headers.match(/^\s+Access-Control-Allow-Origin: \*$/gm)?.length,
    2,
  );
  assert.doesNotMatch(headers, /^\/\*\s*$/m);
  assert.doesNotMatch(headers, /game\.lua/);
});

test("Werewolf dealer supports complete presets through 15 players", async () => {
  const { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT, PRESETS, roleCount } =
    await import("../games/werewolf-dealer/role-config.js");

  assert.equal(MIN_PLAYER_COUNT, 6);
  assert.equal(MAX_PLAYER_COUNT, 15);
  for (const playerCount of [13, 14, 15]) {
    assert.ok(
      PRESETS.some((preset) => roleCount(preset) === playerCount),
      `${playerCount} players should have a built-in preset`,
    );
  }
});

test("Werewolf dealer keeps its generated card-back asset usable", async () => {
  const cardBack = await readFile(
    "games/werewolf-dealer/assets/werewolf-card-back.jpg",
  );

  assert.ok(cardBack.byteLength > 30_000);
  assert.ok(cardBack.byteLength < 150_000);
});

test("Werewolf dealer uses the platform-safe White God role name", async () => {
  const files = [
    "games/werewolf-dealer/role-config.js",
    "games/werewolf-dealer/help.html",
    "games/werewolf-dealer/index.html",
    "games/werewolf-dealer/dealer.js",
  ];
  const prohibitedRoleName = ["白", "痴"].join("");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(
      source.includes(prohibitedRoleName),
      false,
      `${file} contains a prohibited role name`,
    );
  }
});
