import { createLocalLuaGame } from "../../../src/local-lua-game.js";

import { evaluateCareerDiscard } from "../career/evaluate-discard.js";

let game;

self.addEventListener("message", ({ data }) => {
  void handleRequest(data);
});

async function handleRequest({ id, type, payload = {} }) {
  try {
    const result = await handle(type, payload);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name || "Error",
        message: error?.message || "Mahjong worker request failed",
      },
    });
  }
}

async function handle(type, payload) {
  if (type === "init") {
    game?.close();
    game = await createLocalLuaGame(payload.options);
    return {
      matchId: game.matchId,
      projection: game.view(payload.viewerId),
    };
  }
  if (!game) throw new Error("Mahjong worker is not initialized");
  if (type === "view") return game.view(payload.viewerId, payload.viewOptions);
  if (type === "checkpoint") return game.checkpoint();
  if (type === "exportPaipu") return game.exportPaipu();
  if (type === "restoreCheckpoint") {
    return {
      projection: game.restoreCheckpoint(payload.checkpoint, payload.viewerId),
    };
  }
  if (type === "loadReplayHand") {
    return {
      projection: game.loadReplayHand(payload.hand, payload.viewerId),
    };
  }
  if (type === "replayActions") return replayActions(payload);
  if (type === "action") {
    const careerAnalysis = payload.actionOptions?.evaluateCareer
      ? evaluateCareerDiscard(game, payload.action, payload.actorId) : null;
    const result = game.action(payload.action, payload.actorId);
    return {
      result,
      careerAnalysis: result?.accepted ? careerAnalysis : null,
      projection: result?.accepted ? game.view(payload.viewerId) : null,
    };
  }
  if (type === "aiTurn") {
    return game.aiTurn(payload.viewerId);
  }
  if (type === "aiDecision") {
    return game.aiDecision(payload.viewerId);
  }
  if (type === "aiAction") {
    return game.aiAction(payload.state, payload.actorId);
  }
  if (type === "legalActions") {
    return game.legalActions(payload.state, payload.viewerId);
  }
  if (type === "tenpaiReports") {
    return game.tenpaiReports(payload.state, payload.viewerId);
  }
  if (type === "tenpaiReport") {
    return game.tenpaiReport(payload.state, payload.tileId, payload.viewerId);
  }
  if (type === "currentTenpaiReport") {
    return game.currentTenpaiReport(payload.state, payload.viewerId);
  }
  if (type === "riichiWaitReport") {
    return game.riichiWaitReport(payload.state, payload.viewerId);
  }
  if (type === "currentGameTenpaiReport") {
    return game.currentGameTenpaiReport(payload.viewerId);
  }
  throw new TypeError(`Unknown Mahjong worker request: ${type}`);
}

function replayActions({
  actions,
  checkpoint,
  checkpointActionIndex = 0,
  replayHand,
  restart = false,
  viewerId,
} = {}) {
  if (!Array.isArray(actions)) {
    throw new TypeError("Mahjong replay actions must be an array");
  }

  let firstAction = 0;
  let checkpointError;
  if (replayHand) {
    game.loadReplayHand(replayHand, viewerId);
  } else if (checkpoint) {
    const actionIndex = Number(checkpointActionIndex);
    if (
      !Number.isInteger(actionIndex) ||
      actionIndex < 0 ||
      actionIndex > actions.length
    ) {
      throw new TypeError("Mahjong checkpoint action index is invalid");
    }
    try {
      game.restoreCheckpoint(checkpoint, viewerId);
      firstAction = actionIndex;
    } catch (error) {
      checkpointError = {
        name: error?.name || "Error",
        message: error?.message || "Mahjong checkpoint could not be restored",
      };
      game.restart(viewerId);
    }
  } else if (restart) {
    game.restart(viewerId);
  } else {
    throw new TypeError(
      "Mahjong replay needs a checkpoint, replay hand, or restart",
    );
  }

  for (let index = firstAction; index < actions.length; index += 1) {
    const entry = actions[index];
    if (!entry || typeof entry !== "object") {
      throw new TypeError(`Mahjong replay action ${index} is invalid`);
    }
    const result = game.action(entry.action, entry.actorId);
    if (result?.accepted) continue;
    const code = result?.error?.code || "unknown";
    throw new Error(`Mahjong replay action ${index} was rejected: ${code}`);
  }

  return {
    projection: game.view(viewerId),
    checkpointError,
  };
}
