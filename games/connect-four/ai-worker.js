import { chooseConnectFourMove } from "./ai.js";

self.onmessage = ({ data: { requestId, state } }) => {
  try {
    self.postMessage({ requestId, move: chooseConnectFourMove(state) });
  } catch {
    self.postMessage({ requestId, error: true });
  }
};
