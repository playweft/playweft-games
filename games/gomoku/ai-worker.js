import { chooseGomokuMove } from "./ai.js";

self.onmessage = ({ data: { requestId, state } }) => {
  try {
    self.postMessage({ requestId, move: chooseGomokuMove(state) });
  } catch {
    self.postMessage({ requestId, error: true });
  }
};
