import { chooseReversiMove } from "./ai.js";

export function createReversiAiController({
  onMove,
  choose = chooseReversiMove,
  schedule = callback => setTimeout(callback, 424),
  unschedule = timer => clearTimeout(timer),
}) {
  let timer, pending;
  function cancel() {
    if (timer !== undefined) unschedule(timer);
    timer = undefined;
    pending = undefined;
  }
  return {
    update(state, enabled) {
      if (!enabled || !state || state.ended || state.current !== 2) { cancel(); return; }
      if (pending?.state === state) return;
      cancel();
      const request = { state };
      pending = request;
      // Yield to rendering and let the player's 400ms flip finish before replying.
      timer = schedule(() => {
        if (pending !== request) return;
        timer = undefined;
        const move = choose(state);
        pending = undefined;
        if (move) onMove({ type: "play", ...move });
      });
    },
    cancel,
  };
}
