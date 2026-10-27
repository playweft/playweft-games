import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLAIM_LABELS } from "../../games/mahjong/rules/constants.js";
import { YAKU_FONT_TEXT, traditionalDrawReason } from "../../games/mahjong/rules/yaku-display.js";
import { ROOM_ENTRY_LABELS } from "../../games/mahjong/app/room-entry.js";

const root = new URL("../../games/mahjong/", import.meta.url);
export function mahjongBrushTextGroups() {
  const html = readFileSync(new URL("index.html", root), "utf8");
  return {
    lobby: [...html.matchAll(/<span class="setup-route-name[^\"]*"[^>]*>([^<]+)<\/span>/g)].map((match) => match[1]).join(""),
    roomEntry: Object.values(ROOM_ENTRY_LABELS).join(""),
    careerResult: "ABCDE" + [...html.matchAll(/data-career-brush>([^<]+)</g)].map((match) => match[1]).join(""),
    roundsAndWinds: "+0123456789四人東南西北一二三四局",
    actions: `跳过流局立直自摸${Object.values(CLAIM_LABELS).join("")}`,
    results: "继续等待中",
    draws: ["荒牌流局", "途中流局", "九种九牌", "四风连打", "四杠散了", "四家立直", "三家和", "流局满贯"].map(traditionalDrawReason).join(""),
    yaku: YAKU_FONT_TEXT,
  };
}
export function mahjongBrushText() {
  return [...new Set(Object.values(mahjongBrushTextGroups()).join(""))].sort().join("") + "\n";
}
const textFile = new URL("assets/fonts/mahjong-brush-text.txt", root);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) writeFileSync(textFile, mahjongBrushText());
  else if (readFileSync(textFile, "utf8") !== mahjongBrushText()) {
    throw new Error("Brush glyph list is out of date. Run node build/fonts/mahjong-brush-text.js --write");
  }
}
