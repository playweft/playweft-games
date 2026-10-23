export const PLAYWEFT_BRIDGE_VERSION = 1;
export const JSON_RPC_VERSION = "2.0";

export class PlayweftRpcError extends Error {
  constructor(error) {
    super(error?.message ?? "Unexpected platform error");
    this.name = "PlayweftRpcError";
    this.rpcCode = error?.code;
    this.code = error?.data?.code;
    this.retryable = error?.data?.retryable === true;
  }
}

function connectionError(code, message, retryable = false) {
  return new PlayweftRpcError({
    code: -32000,
    message,
    data: { code, retryable },
  });
}

/**
 * Owns the JSON-RPC request lifecycle for a transferred Playweft MessagePort.
 */
export function createPlayweftRpcPeer({ onNotification } = {}) {
  let port;
  let destroyed = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function receiveMessage(event) {
    const message = event.data;
    if (message?.jsonrpc !== JSON_RPC_VERSION) return;

    if (Object.hasOwn(message, "id")) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) {
        request.reject(new PlayweftRpcError(message.error));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      onNotification?.(message.method, message.params);
    }
  }

  return {
    connect(nextPort) {
      if (destroyed) {
        nextPort.close();
        return;
      }
      if (port) {
        rejectPending(
          connectionError(
            "BRIDGE_REPLACED",
            "The Playweft bridge was replaced",
            true,
          ),
        );
        port.close();
      }
      port = nextPort;
      port.onmessage = receiveMessage;
      port.start();
    },

    isConnected() {
      return Boolean(port);
    },

    call(method, params, id = crypto.randomUUID(), { timeoutMs } = {}) {
      if (!port) {
        return Promise.reject(
          connectionError(
            "PLATFORM_NOT_CONNECTED",
            "The Playweft platform is not connected",
            true,
          ),
        );
      }
      return new Promise((resolve, reject) => {
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                pending.delete(id);
                reject(
                  connectionError(
                    "STORAGE_TIMEOUT",
                    "Storage request timed out; its commit status is unknown",
                    true,
                  ),
                );
              }, timeoutMs);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        try {
          port.postMessage({
            jsonrpc: JSON_RPC_VERSION,
            id,
            method,
            ...(params === undefined ? {} : { params }),
          });
        } catch (error) {
          pending.get(id)?.reject(error);
          pending.delete(id);
        }
      });
    },

    notify(method, params) {
      port?.postMessage({
        jsonrpc: JSON_RPC_VERSION,
        method,
        ...(params === undefined ? {} : { params }),
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectPending(
        connectionError("BRIDGE_CLOSED", "The Playweft bridge was closed"),
      );
      port?.close();
      port = undefined;
    },
  };
}
