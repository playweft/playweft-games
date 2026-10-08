import { resolve } from "node:path";
import { defineConfig } from "vite";
import { emitGamePackages } from "./build/vite/plugins/emit-game-packages.js";
import { emitBuildVersion } from "./build/vite/plugins/emit-build-version.js";
import { mahjongDefaultAssets } from "./build/vite/plugins/mahjong-default-assets.js";
import { preserveGameUrls } from "./build/vite/plugins/preserve-game-urls.js";

const games = [
  "pig-dice",
  "connect-four",
  "texas-holdem",
  "dou-dizhu",
  "werewolf-dealer",
  "uno",
  "sudoku",
  "go",
  "gomoku",
  "xiangqi",
  "chess",
  "mahjong",
];
const THREE_VENDOR_CHUNK = "three-r185.1";
const SHARED_RUNTIME_CHUNK = "shared-runtime";

function isSharedRuntimeModule(id) {
  return (
    id.includes("vite/modulepreload-polyfill") ||
    id.includes("/node_modules/lucide/") ||
    id.endsWith("/src/game-offline-cache.js") ||
    id.endsWith("/src/playweft-client.js") ||
    id.endsWith("/src/playweft-solo-client.js") ||
    id.endsWith("/src/playweft-rpc.js")
  );
}

const input = {
  index: resolve(import.meta.dirname, "index.html"),
};

for (const game of games) {
  input[game] = resolve(import.meta.dirname, `games/${game}/index.html`);
  input[`${game}-help`] = resolve(
    import.meta.dirname,
    `games/${game}/help.html`,
  );
}

export default defineConfig({
  plugins: [
    mahjongDefaultAssets(),
    emitGamePackages({ games }),
    preserveGameUrls({ games }),
    emitBuildVersion(),
  ],
  server: {
    port: 9139,
  },
  build: {
    rolldownOptions: {
      input,
      output: {
        codeSplitting: {
          groups: [
            {
              name: THREE_VENDOR_CHUNK,
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
            },
            {
              name: SHARED_RUNTIME_CHUNK,
              test: isSharedRuntimeModule,
              priority: 10,
            },
          ],
        },
        chunkFileNames(chunk) {
          return chunk.name === THREE_VENDOR_CHUNK
            ? `assets/vendor/${THREE_VENDOR_CHUNK}-[hash].js`
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
});
