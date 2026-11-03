export const GO_TIE_BREAKS = ["draw", "white", "first-pass"];

export function defaultGoKomi(rules = "chinese") {
  return rules === "japanese" ? 6.5 : 7;
}

export const DEFAULT_GO_SETTINGS = {
  size: 19,
  rules: "chinese",
  komi: defaultGoKomi(),
  tieBreak: "first-pass",
  handicap: 0,
  blackMode: "random",
};

export function goTieBreakLabel(tieBreak = "white") {
  return { draw: "和棋", white: "白胜", "first-pass": "先停着者胜" }[tieBreak];
}

export function goWinnerIndex(state, scores) {
  const whiteIndex = (state.blackIndex % state.players.length) + 1;
  if (scores.black > scores.white) return state.blackIndex;
  if (scores.white > scores.black) return whiteIndex;
  // Saves and already-running rooms from before this setting used white wins.
  const tieBreak = state.settings?.tieBreak ?? "white";
  if (tieBreak === "white") return whiteIndex;
  if (tieBreak === "first-pass") return Number(state.firstPassIndex) || 0;
  return 0;
}
