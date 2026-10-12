export const CHESS_PERSPECTIVES = ["head-to-head", "turn", "white"];

export function resolveChessView(perspective, state) {
  const flipped = perspective === "turn" && Boolean(state) && state.current !== state.whiteIndex;
  const bottomSide = flipped ? "b" : "w";
  return {
    flipped,
    bottomSide,
    topSide: flipped ? "w" : "b",
    upsideDownSide: perspective === "head-to-head" ? "b" : undefined,
  };
}
