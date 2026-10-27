import {
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  MAHJONG_SOLO_CHECKPOINT_VERSION,
  MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
  writeMahjongSoloSave,
  setMahjongSoloCheckpoint,
} from "../replay/solo-save.js";

/** Keeps local-match persistence separate from the action and UI lifecycles. */
export function createMahjongSoloSaveController({
  initialSave,
  writeSave = writeMahjongSoloSave,
  clearSave = clearMahjongSoloSave,
  humanId,
  getThemeController,
  saveCompletedPaipu,
}) {
  let save = initialSave;

  function get() {
    return save;
  }

  function set(next) {
    save = next;
  }

  function write(next = save, state, evaluation) {
    save = next;
    if (next) return writeSave(next, state, evaluation);
  }

  function clear() {
    clearSave();
    save = null;
  }

  async function persistAcceptedAction(action, actorId, projection, game, evaluation) {
    let checkpointState;
    if (!save) return;
    let next = appendMahjongSoloAction(save, action, actorId);
    if (!next) return;
    if (projection?.state?.phase === "hand_ended" && game) {
      try {
        const snapshot = await game.checkpoint();
        checkpointState = snapshot.state;
        next =
          setMahjongSoloCheckpoint(next, {
            formatVersion: MAHJONG_SOLO_CHECKPOINT_VERSION,
            actionIndex: next.actions.length,
            state: snapshot.state,
            events: snapshot.events,
            engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
            stateVersion: snapshot.version,
          }) || next;
      } catch (error) {
        console.warn(
          "Mahjong save checkpoint failed; keeping the action log",
          error,
        );
      }
    }
    await write(next, checkpointState, evaluation);
    if (!projection?.state?.matchEnded || !game?.exportPaipu) return;
    try {
      const paipu = {
        ...(await game.exportPaipu()),
        viewerPlayerId: game.playerId || humanId,
      };
      const themeController = getThemeController?.();
      paipu.playerPresentations =
        save?.playerPresentations ||
        themeController?.getPaipuPlayerPresentations?.(
          paipu.players,
          paipu.viewerPlayerId,
        ) ||
        {};
      if (paipu.status === "completed") await saveCompletedPaipu?.(paipu);
    } catch (error) {
      console.warn("Mahjong paipu save failed", error);
    }
  }

  return { clear, get, persistAcceptedAction, set, write };
}
