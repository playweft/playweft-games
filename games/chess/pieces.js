import wK from "./assets/Chess klt45.svg?url";
import wQ from "./assets/Chess qlt45.svg?url";
import wR from "./assets/Chess rlt45.svg?url";
import wB from "./assets/Chess blt45.svg?url";
import wN from "./assets/Chess nlt45.svg?url";
import wP from "./assets/Chess plt45.svg?url";
import bK from "./assets/Chess kdt45.svg?url";
import bQ from "./assets/Chess qdt45.svg?url";
import bR from "./assets/Chess rdt45.svg?url";
import bB from "./assets/Chess bdt45.svg?url";
import bN from "./assets/Chess ndt45.svg?url";
import bP from "./assets/Chess pdt45.svg?url";

const PIECES = { wK, wQ, wR, wB, wN, wP, bK, bQ, bR, bB, bN, bP };
export const PIECE_NAMES = { K: "王", Q: "后", R: "车", B: "象", N: "马", P: "兵" };
export function pieceSvg(piece) {
  const src = PIECES[piece];
  return src ? `<img class="piece" src="${src}" alt="" aria-hidden="true" draggable="false" />` : "";
}
