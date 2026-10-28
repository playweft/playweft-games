import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.js";
import {
  addBuildVersionMeta,
  emitBuildVersion,
  hashBundle,
} from "../build/vite/plugins/emit-build-version.js";
import { emitGamePackages } from "../build/vite/plugins/emit-game-packages.js";
import { preserveGameUrls } from "../build/vite/plugins/preserve-game-urls.js";

test("Vite config keeps the configured dev port and composes its build plugins", () => {
  assert.equal(viteConfig.server.port, 9139);
  assert.deepEqual(
    viteConfig.plugins.map((plugin) => plugin.name),
    [
      "emit-game-packages",
      "preserve-game-urls",
      "emit-build-version",
    ],
  );
});

test("build version hashes output content and is stamped into HTML", () => {
  const createBundle = (code) => ({
    "assets/app.js": { type: "chunk", fileName: "assets/app.js", code },
    "gomoku/index.html": {
      type: "asset",
      fileName: "gomoku/index.html",
      source: "<!doctype html><html><head><title>五子棋</title></head></html>",
    },
  });
  const bundle = createBundle("console.log('one')");
  const firstVersion = hashBundle(bundle);
  const secondVersion = hashBundle(createBundle("console.log('two')"));
  const emitted = [];

  emitBuildVersion().generateBundle.call(
    { emitFile: (file) => emitted.push(file) },
    {},
    bundle,
  );

  assert.notEqual(firstVersion, secondVersion);
  assert.ok(
    addBuildVersionMeta(bundle["gomoku/index.html"].source, firstVersion).includes(
      `<meta name="playweft-build-version" content="${firstVersion}" />`,
    ),
  );
  assert.deepEqual(emitted, [{
    type: "asset",
    fileName: "build-version.json",
    source: `${JSON.stringify({ version: firstVersion })}\n`,
  }]);
});

test("Vite keeps common bridge modules in the shared runtime chunk", () => {
  const output = viteConfig.build.rolldownOptions.output;
  const [sharedRuntime] = output.codeSplitting.groups;
  assert.equal(output.codeSplitting.groups.length, 1);
  assert.equal(sharedRuntime.name, "shared-runtime");
  assert.equal(sharedRuntime.test("/project/node_modules/lucide/dist/esm/icons/play.js"), true);
  assert.equal(sharedRuntime.test("\0vite/modulepreload-polyfill.js"), true);
  assert.equal(sharedRuntime.test("/project/src/playweft-client.js"), true);
  assert.equal(sharedRuntime.test("/project/games/gomoku/solo.js"), false);
  assert.equal(output.chunkFileNames({ name: "shared-runtime" }), "assets/[name]-[hash].js");
});

test("game package plugin emits only requested manifests and room Lua files", async () => {
  const emitted = [];
  await emitGamePackages({ games: ["pig-dice", "sudoku"] }).generateBundle.call({ emitFile(file) { emitted.push(file); } });
  assert.deepEqual(emitted.map(({ fileName }) => fileName), [
    "games/pig-dice/playweft.json", "games/pig-dice/game.lua", "games/sudoku/playweft.json",
  ]);
  assert.ok(emitted.every(({ source }) => source.length > 0));
});

test("preserve-game-urls plugin rewrites public game paths in dev", async () => {
  const plugin = preserveGameUrls({ games: ["gomoku", "sudoku"] });
  const middleware = [];
  plugin.configureServer({ middlewares: { use(handler) { middleware.push(handler); } } });
  const request = { url: "/gomoku/index.html?mode=solo" };
  let nextCalls = 0;
  middleware[0](request, {}, () => {
    nextCalls += 1;
  });
  assert.equal(request.url, "/games/gomoku/index.html?mode=solo");
  assert.equal(nextCalls, 1);
});
