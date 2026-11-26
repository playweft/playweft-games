// Ownership and viewing direction stay fixed for a round; the turn is separate.
export function goTableView(state, { mode, playerId }) {
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const ownIndex = state.players?.indexOf(playerId) ?? -1;
  const localPair = mode === "solo" && state.settings?.opponent !== "ai";
  const nearIndex = mode === "solo"
    ? localPair ? blackIndex : 0
    : ownIndex >= 0 ? ownIndex : blackIndex;
  const nearColor = nearIndex === blackIndex ? 1 : 2;
  return {
    nearColor,
    currentColor: Number(state.current) - 1 === blackIndex ? 1 : 2,
    players: [1, 2].map(color => ({
      color,
      playerIndex: color === 1 ? blackIndex : 1 - blackIndex,
      label: color === 1 ? "黑方" : "白方",
      near: color === nearColor,
    })),
  };
}
