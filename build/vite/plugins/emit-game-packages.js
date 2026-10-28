import { readFile } from "node:fs/promises";

export function emitGamePackages({ games }) {
  return {
    name: "emit-game-packages",
    async generateBundle() {
      for (const game of games) {
        const files = game === "sudoku" ? ["playweft.json"] : ["playweft.json", "game.lua"];
        for (const fileName of files) {
          this.emitFile({
            type: "asset",
            fileName: `games/${game}/${fileName}`,
            source: await readFile(new URL(`../../../games/${game}/${fileName}`, import.meta.url), "utf8"),
          });
        }
      }
    },
  };
}
