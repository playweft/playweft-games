const tileKey = (id) => `${Math.floor((id - 1) / 4) + 1}:${[17, 53, 89].includes(id) ? "red" : "plain"}`;

// Run in the match worker before applying the accepted action. The policy
// reads only the player's own hand and public evidence, not future wall tiles.
export function evaluateCareerDiscard(game, action, actorId) {
  if (!["discard", "riichi"].includes(action.type)) return null;
  try {
    const state = game.checkpoint().state;
    if (state.phase !== "playing" || state.players[state.turnIndex - 1] !== actorId || state.riichi[actorId]) return null;
    const hand = [...state.hands[actorId], ...(state.drawnTile > 0 ? [state.drawnTile] : [])];
    const forbidden = state.kuikaeForbidden?.[actorId] || {};
    const options = new Set(hand.filter((id) => !forbidden[Math.floor((id - 1) / 4) + 1]).map(tileKey));
    if (options.size <= 1) return null;
    const recommendation = game.aiAction(state, actorId)?.action;
    if (!["discard", "riichi"].includes(recommendation?.type)) return null;
    const review = game.aiActionReview?.(state, actorId, action);
    const scale = review?.mode === "fold" ? 1050 : review?.mode === "mixed" ? 400 : 300;
    const loss = review ? Math.min(1, Math.max(0, review.scoreLoss - 14) / scale) : null;
    return { eligible: true, agreed: tileKey(action.tileId) === tileKey(recommendation.tileId),
      review: review ? { ...review, quality: Math.round((1 - loss) * 100),
        major: loss >= 0.4 } : null };
  } catch {
    return { unavailable: true };
  }
}
