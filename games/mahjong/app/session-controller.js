import {
  automaticMahjongAction,
  sameMahjongAction,
} from "../rules/auto-actions.js";
import {
  createMahjongAutoActionScheduler,
  shouldScheduleMahjongAiTurn,
} from "../rules/auto-action-scheduler.js";
import { automaticRiichiDiscard } from "../rules/game-format.js";
import {
  reconcileRoomAction,
  roomActionStateKey,
} from "../rules/room-action-reconciliation.js";

/**
 * Owns the authoritative Mahjong action lifecycle. Page code supplies the
 * transport and presentation callbacks, so a render or audio concern cannot
 * alter action locking, AI scheduling, or worker ownership.
 */
export function createMahjongSessionController({
  humanId,
  getMode,
  getGame,
  getState,
  getAutoActions,
  getRiichiMode,
  isKanDrawPending,
  sendRoomAction,
  onRoomUnavailable,
  persistAcceptedAction,
  getSoloActionOptions,
  refreshProjection,
  onSoloActionAccepted,
  onActionRejected,
  onActionError,
  onProjectionTransitionError,
  onAiActionRejected,
  onAiError,
  delays,
  scheduler = createMahjongAutoActionScheduler(),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  wait = (delay) =>
    new Promise((resolve) =>
      globalThis.setTimeout(resolve, Math.max(0, delay)),
    ),
} = {}) {
  let actionInFlight = false;
  let roomActionRequestId = "";
  let roomActionAttempt = null;
  const settledRoomRequestIds = new Set();
  let scheduledTurnKey = "";
  let reconcilePending = false;

  const sameCurrentGame = (candidate) => candidate === getGame?.();

  const aiTurnKey = (state) =>
    JSON.stringify([
      state?.phase,
      state?.turnIndex,
      state?.responseIndex,
      state?.claimIndex,
      state?.moveCount,
      state?.drawnTile,
      state?.lastDiscard,
      state?.wallCount,
      state?.players?.[Number(state?.turnIndex) - 1],
    ]);

  function cancelScheduler() {
    scheduler.cancel();
    scheduledTurnKey = "";
  }

  function settleRoomAction(outcome) {
    if (roomActionAttempt?.requestId)
      settledRoomRequestIds.add(roomActionAttempt.requestId);
    if (settledRoomRequestIds.size > 32) {
      const oldest = settledRoomRequestIds.values().next().value;
      settledRoomRequestIds.delete(oldest);
    }
    roomActionAttempt = null;
    roomActionRequestId = "";
    actionInFlight = false;
    return outcome;
  }

  function startRoomActionAttempt(requestId, action, source, baseState) {
    if (typeof requestId !== "string" || !requestId) return;
    roomActionRequestId = requestId;
    roomActionAttempt = {
      requestId,
      action,
      source,
      baseStateKey: roomActionStateKey(baseState),
      baseMoveCount: Number(baseState?.moveCount) || 0,
    };
  }

  function scheduleOwned(callback, delay, turnKey) {
    scheduledTurnKey = turnKey;
    return scheduler.schedule((generation) => {
      if (scheduledTurnKey === turnKey) scheduledTurnKey = "";
      callback(generation);
    }, delay);
  }

  async function dispatch(
    action,
    { source = "manual", onAcceptedProjection, recoveryAttempt = 0 } = {},
  ) {
    if (!getState?.() && getMode?.() !== "room") return false;
    if (actionInFlight) return false;
    if (source === "manual") cancelScheduler();

    if (getMode?.() === "room") {
      actionInFlight = true;
      const baseState = getState?.();
      try {
        const requestId = await sendRoomAction?.(action, {
          onRequestStarted(startedRequestId) {
            startRoomActionAttempt(startedRequestId, action, source, baseState);
          },
        });
        if (!requestId) {
          actionInFlight = false;
          onRoomUnavailable?.();
          return false;
        }
        if (!roomActionAttempt)
          startRoomActionAttempt(requestId, action, source, baseState);
        return true;
      } catch (error) {
        actionInFlight = false;
        onActionError?.(error);
        return false;
      }
    }

    const currentGame = getGame?.();
    if (!currentGame) return false;
    let reschedule = false;
    let rescheduleOptions;
    actionInFlight = true;
    try {
      const outcome = await currentGame.action(action, humanId, humanId, getSoloActionOptions?.({ action, source }));
      if (!sameCurrentGame(currentGame)) return false;
      if (!outcome.result?.accepted) {
        onActionRejected?.(outcome.result?.error?.code);
        if (source === "automatic" && recoveryAttempt < 1) {
          reschedule = true;
          rescheduleOptions = {
            retryIn: delays?.ai ?? 0,
            recoveryAttempt: recoveryAttempt + 1,
          };
        }
        return false;
      }
      reschedule = true;
      await persistAcceptedAction?.(
        action,
        humanId,
        outcome.projection,
        currentGame,
        outcome.careerAnalysis,
      );
      onSoloActionAccepted?.(action, outcome.projection);
      if (onAcceptedProjection) {
        try {
          await onAcceptedProjection(outcome.projection, currentGame);
        } catch (error) {
          onProjectionTransitionError?.(error);
          await refreshProjection?.(outcome.projection);
        }
      } else {
        await refreshProjection?.(outcome.projection, {
          ownDiscardedTile:
            action.type === "discard" || action.type === "riichi"
              ? Number(action.tileId) || 0
              : 0,
        });
      }
      return true;
    } catch (error) {
      if (sameCurrentGame(currentGame)) onActionError?.(error);
      if (source === "automatic" && recoveryAttempt < 1) {
        reschedule = true;
        rescheduleOptions = {
          retryIn: delays?.ai ?? 0,
          recoveryAttempt: recoveryAttempt + 1,
        };
      }
      return false;
    } finally {
      actionInFlight = false;
      if (
        sameCurrentGame(currentGame) &&
        (reschedule || reconcilePending)
      ) {
        reconcilePending = false;
        scheduleAi(rescheduleOptions);
      }
    }
  }

  async function runAiTurn(
    generation,
    startedAt,
    minimumDelay,
    recoveryAttempt,
  ) {
    const currentGame = getGame?.();
    const currentState = getState?.();
    if (
      getMode?.() !== "solo" ||
      !currentGame ||
      !currentState ||
      currentState.phase === "hand_ended" ||
      actionInFlight ||
      !scheduler.isCurrent(generation)
    ) {
      if (actionInFlight) reconcilePending = true;
      return;
    }

    const initialTurnKey = aiTurnKey(currentState);
    let reschedule = false;
    let recover = false;
    actionInFlight = true;
    try {
      const outcome = await currentGame.aiDecision(humanId);
      if (!sameCurrentGame(currentGame) || !scheduler.isCurrent(generation)) {
        return;
      }
      if (
        outcome?.status !== "acted" ||
        !outcome.action ||
        outcome.version === undefined
      ) {
        recover = outcome?.status !== "waiting_for_human";
        if (recover) {
          console.error("Mahjong AI returned an invalid decision", outcome);
        }
        return;
      }
      const remainingDelay = minimumDelay - (now() - startedAt);
      if (remainingDelay > 0) await wait(remainingDelay);
      if (
        !sameCurrentGame(currentGame) ||
        !scheduler.isCurrent(generation) ||
        aiTurnKey(getState?.()) !== initialTurnKey
      ) {
        return;
      }
      const applied = await currentGame.action(
        outcome.action,
        outcome.actorId,
        humanId,
      );
      if (!sameCurrentGame(currentGame)) return;
      if (!applied?.result?.accepted) {
        console.error("Mahjong AI action was rejected", {
          actorId: outcome.actorId,
          action: outcome.action,
          result: applied?.result,
        });
        onAiActionRejected?.({ ...outcome, result: applied?.result });
        recover = true;
        return;
      }
      await persistAcceptedAction?.(
        outcome.action,
        outcome.actorId,
        applied.projection,
        currentGame,
      );
      reschedule = true;
      await refreshProjection?.(applied.projection);
    } catch (error) {
      recover = true;
      console.error("Mahjong AI decision failed", error);
      if (sameCurrentGame(currentGame)) onAiError?.(error);
    } finally {
      actionInFlight = false;
      const shouldReconcile = reconcilePending;
      reconcilePending = false;
      if (sameCurrentGame(currentGame) && (reschedule || recover)) {
        if (reschedule) {
          scheduleAi();
        } else if (recoveryAttempt < 1) {
          scheduleAi({
            retryIn: delays?.ai ?? 0,
            recoveryAttempt: recoveryAttempt + 1,
          });
        }
      } else if (sameCurrentGame(currentGame) && shouldReconcile) {
        scheduleAi();
      }
    }
  }

  function scheduleAutomaticAction(
    currentState,
    {
      visualDelay = 0,
      isCurrent = () => true,
      skipPassClaims = false,
      scheduleKey = aiTurnKey(currentState),
      recoveryAttempt = 0,
    } = {},
  ) {
    if (
      !currentState ||
      currentState.phase === "hand_ended" ||
      isKanDrawPending?.()
    ) {
      return false;
    }
    const automaticActions = {
      ...getAutoActions?.(),
      ...(skipPassClaims ? { passClaims: false } : {}),
    };
    const autoAction = automaticMahjongAction(currentState, automaticActions, {
      riichiMode: getRiichiMode?.() === true,
    });
    if (!autoAction) return false;
    const visibleDecision = ["claim", "tsumo", "discard"].includes(
      autoAction.type,
    );
    scheduleOwned(
      (generation) => {
        if (!scheduler.isCurrent(generation) || !isCurrent()) return;
        if (actionInFlight) {
          reconcilePending = true;
          return;
        }
        const latestAction = automaticMahjongAction(
          getState?.(),
          {
            ...getAutoActions?.(),
            ...(skipPassClaims ? { passClaims: false } : {}),
          },
          { riichiMode: getRiichiMode?.() === true },
        );
        if (isCurrent() && sameMahjongAction(latestAction, autoAction)) {
          void dispatch(autoAction, {
            source: "automatic",
            recoveryAttempt,
          });
        }
      },
      visibleDecision
        ? Math.max(
            visualDelay,
            autoAction.type === "claim" ? 0 : (delays?.ownDrawEntry ?? 0),
          ) + (delays?.autoDecision ?? 0)
        : 0,
      scheduleKey,
    );
    return true;
  }

  function scheduleRoomAutomaticAction({ state, isCurrent } = {}) {
    const currentState = state ?? getState?.();
    if (actionInFlight) {
      reconcilePending = true;
      return false;
    }
    if (getMode?.() !== "room" || !currentState) {
      cancelScheduler();
      return false;
    }
    const planKey = JSON.stringify([
      "room",
      aiTurnKey(currentState),
      getAutoActions?.(),
      getRiichiMode?.() === true,
    ]);
    if (scheduledTurnKey === planKey) return true;
    cancelScheduler();
    return scheduleAutomaticAction(currentState, {
      isCurrent,
      skipPassClaims: true,
      scheduleKey: planKey,
      recoveryAttempt: 0,
    });
  }

  function scheduleAi({
    afterDealIn = false,
    retryIn = 0,
    recoveryAttempt = 0,
  } = {}) {
    if (actionInFlight) {
      reconcilePending = true;
      return false;
    }
    const currentState = getState?.();
    if (
      getMode?.() !== "solo" ||
      !currentState ||
      currentState.phase === "hand_ended" ||
      isKanDrawPending?.()
    ) {
      cancelScheduler();
      return false;
    }

    const turnKey = aiTurnKey(currentState);
    const planKey = JSON.stringify([
      "solo",
      turnKey,
      getAutoActions?.(),
      getRiichiMode?.() === true,
    ]);
    if (scheduledTurnKey === planKey) return true;
    cancelScheduler();

    const visualDelay = afterDealIn ? (delays?.newHandDeal ?? 0) : 0;
    if (
      scheduleAutomaticAction(currentState, {
        visualDelay,
        scheduleKey: planKey,
        recoveryAttempt,
      })
    )
      return true;

    const automaticTile = automaticRiichiDiscard(currentState, humanId);
    if (automaticTile) {
      scheduleOwned(
        (generation) => {
          if (!scheduler.isCurrent(generation)) return;
          if (actionInFlight) {
            reconcilePending = true;
            return;
          }
          if (automaticRiichiDiscard(getState?.(), humanId) === automaticTile) {
            void dispatch(
              { type: "discard", tileId: automaticTile },
              { source: "automatic", recoveryAttempt },
            );
          }
        },
        Math.max(visualDelay, delays?.ownDrawEntry ?? 0) +
          (delays?.autoDecision ?? 0),
        planKey,
      );
      return true;
    }

    if (!shouldScheduleMahjongAiTurn(currentState)) return false;
    const startedAt = now();
    scheduleOwned(
      (generation) =>
        void runAiTurn(
          generation,
          startedAt,
          visualDelay + (delays?.ai ?? 0),
          recoveryAttempt,
        ),
      retryIn,
      planKey,
    );
    return true;
  }

  return {
    dispatch,
    scheduleAi,
    scheduleRoomAutomaticAction,
    cancelScheduledActions() {
      cancelScheduler();
      reconcilePending = false;
    },
    isActionInFlight() {
      return actionInFlight;
    },
    confirmRoomState(snapshot) {
      if (snapshot === undefined) return settleRoomAction({ outcome: "confirmed" });
      const result = reconcileRoomAction({
        attempt: roomActionAttempt,
        state: snapshot?.state,
      });
      if (result.outcome !== "pending") settleRoomAction(result);
      return result;
    },
    rejectRoomAction(requestId) {
      if (requestId && requestId !== roomActionRequestId) return false;
      settleRoomAction({ outcome: "rejected", shouldNotify: true });
      return true;
    },
    reconcileRoomActionError({ requestId, errorCode, state } = {}) {
      if (requestId && settledRoomRequestIds.has(requestId))
        return { outcome: "stale", shouldNotify: false };
      if (requestId && requestId !== roomActionRequestId)
        return { outcome: "stale", shouldNotify: false };
      if (!requestId && !roomActionAttempt)
        return { outcome: "unknown", shouldNotify: true };
      const result = reconcileRoomAction({
        attempt: roomActionAttempt,
        state,
        errorCode,
      });
      if (result.outcome !== "pending") settleRoomAction(result);
      return result;
    },
  };
}
