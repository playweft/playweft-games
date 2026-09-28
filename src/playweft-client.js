import {
  PLAYWEFT_BRIDGE_VERSION,
  PlayweftRpcError,
  createPlayweftRpcPeer,
} from "./playweft-rpc.js";
import {
  recordImmediateResponseLatency,
  shouldMeasureImmediateResponse,
} from "./response-latency.js";

/** Connect a static game entry to its Playweft iframe host. */
export function createPlayweftClient({
  onReady,
  onState,
  onActionResult,
  onError,
  onContext,
  onLatency,
  onPlayerProfileChanged,
} = {}) {
  let playerId;
  let latestMatchId;
  let latestVersion = -1;
  let destroyed = false;

  const reportRpcError = (error, requestId) => {
    if (destroyed) return;
    const rpcError =
      error instanceof PlayweftRpcError
        ? error
        : new PlayweftRpcError({ code: -32603, message: String(error) });
    onError?.(rpcError.message, rpcError.code ?? "RPC_ERROR", requestId);
  };

  const rpc = createPlayweftRpcPeer({
    onNotification(method, params) {
      if (method === "platform.error") {
        const error = params?.error;
        onError?.(
          error?.message ?? "Platform error",
          error?.code ?? "PLATFORM_ERROR",
        );
        return;
      }
      if (method === "platform.latency") {
        const rttMs = Number(params?.rttMs);
        if (Number.isFinite(rttMs) && rttMs >= 0) onLatency?.(rttMs);
        return;
      }
      if (method === "room.players.profileChanged") {
        const fields = Array.isArray(params?.fields)
          ? params.fields.filter(
              (field) => field === "name" || field === "avatar",
            )
          : [];
        if (typeof params?.playerId === "string" && fields.length > 0) {
          onPlayerProfileChanged?.({ playerId: params.playerId, fields });
        }
        return;
      }
      if (method !== "game.state") return;

      const update = params;
      if (!update || typeof update !== "object") return;
      if (update.matchId !== latestMatchId) {
        latestMatchId = update.matchId;
        latestVersion = -1;
      }
      if (
        typeof update.version === "number" &&
        update.version <= latestVersion
      ) {
        return;
      }
      if (typeof update.version === "number") latestVersion = update.version;
      onState?.({
        state: update.state,
        events: Array.isArray(update.events) ? update.events : [],
        matchId: update.matchId,
        version: update.version,
        serverTime: update.serverTime,
        playerId,
      });
    },
  });

  const announceReady = () => {
    if (!destroyed) {
      window.parent.postMessage(
        {
          type: "playweft:bridge-ready",
          version: PLAYWEFT_BRIDGE_VERSION,
        },
        "*",
      );
    }
  };
  const probe = window.setInterval(announceReady, 500);

  function receiveBridge(event) {
    if (
      event.source !== window.parent ||
      event.data?.type !== "playweft:bridge" ||
      event.data?.version !== PLAYWEFT_BRIDGE_VERSION
    ) {
      return;
    }
    const [nextPort] = event.ports;
    if (!nextPort) return;

    window.clearInterval(probe);
    rpc.connect(nextPort);
    void rpc
      .call("game.initialize")
      .then((context) => {
        if (destroyed) return;
        onContext?.(context);
        playerId = context?.playerId;
        onReady?.({
          mode: context?.mode,
          protocolVersion: context?.protocolVersion,
          capabilities: Array.isArray(context?.capabilities)
            ? context.capabilities
            : [],
          player: context?.player,
          playerId,
          phase: context?.phase,
        });
      })
      .catch((error) => reportRpcError(error));
  }

  window.addEventListener("message", receiveBridge);
  announceReady();

  return {
    sendAction(action) {
      if (!rpc.isConnected()) return undefined;
      const requestId = crypto.randomUUID();
      const measureResponseLatency = shouldMeasureImmediateResponse(action);
      const sentAt = measureResponseLatency ? performance.now() : 0;
      void rpc
        .call("room.action", { action }, requestId)
        .then((result) => {
          if (destroyed) return;
          if (measureResponseLatency) {
            recordImmediateResponseLatency(action, performance.now() - sentAt);
          }
          if (result?.accepted === false) {
            onError?.(
              result.error?.message ?? "Action rejected",
              result.error?.code ?? "ACTION_REJECTED",
              requestId,
            );
            return;
          }
          if (result?.accepted !== true) {
            onError?.(
              "The platform returned an invalid action result",
              "INVALID_ACTION_RESULT",
              requestId,
            );
            return;
          }
          onActionResult?.({
            requestId,
            accepted: true,
            matchId: result.matchId,
            version: result.version,
          });
        })
        .catch((error) => reportRpcError(error, requestId));
      return requestId;
    },
    readClipboardText() {
      return rpc.call("navigator.clipboard.readText");
    },
    getRoomPlayerProfile({ playerId, fields }) {
      return rpc.call("room.players.getProfile", { playerId, fields });
    },
    getUserProfile({ fields }) {
      return rpc.call("user.getProfile", { fields });
    },
    confirm(message) {
      return rpc.call("window.confirm", { message: String(message ?? "") });
    },
    destroy() {
      destroyed = true;
      window.clearInterval(probe);
      window.removeEventListener("message", receiveBridge);
      rpc.destroy();
    },
  };
}
