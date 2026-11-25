// The application remains the authority for legality and scoring. The engine
// receives real replay positions, including passes and the board before a ko.
export function goAiPosition(state, frames = []) {
  const toBoard = board => board?.map(row => row.map(value =>
    value === 1 ? "black" : value === 2 ? "white" : null));
  const previous = [...frames].reverse().filter(frame => frame.moveNumber < state.moves);
  const history = frames.filter(frame => frame.moveNumber > 0 && frame.moveNumber <= state.moves)
    .map(frame => ({
      x: frame.lastEvent?.kind === "play" ? frame.lastMove.column - 1 : -1,
      y: frame.lastEvent?.kind === "play" ? frame.lastMove.row - 1 : -1,
      player: frame.lastEvent?.playerIndex === state.blackIndex ? "black" : "white",
    }));
  return {
    board: toBoard(state.board),
    previousBoard: toBoard(previous[0]?.board),
    previousPreviousBoard: toBoard(previous[1]?.board),
    currentPlayer: state.current === state.blackIndex ? "black" : "white",
    moveHistory: history,
    komi: state.settings.komi,
    rules: state.settings.rules,
  };
}

export function isGoAiTurn(state, enabled = true) {
  return enabled && state?.settings?.opponent === "ai" &&
    state.phase === "playing" && !state.ended && state.current === 2;
}
