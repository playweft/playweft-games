import { createPlayweftStorageBridge } from "./playweft-storage.js";
import {
  PLAYWEFT_BRIDGE_VERSION,
  createPlayweftRpcPeer,
} from "./playweft-rpc.js";

/**
 * Initializes a Manifest-backed solo client when hosted by Playweft.
 * A top-level game page stays entirely local.
 */
export function createPlayweftSoloClient({ onReady, onContext, onError } = {}) {
  let destroyed = false;

  if (window.parent === window) {
    return {
      readClipboardText() {
        return Promise.reject(
          new Error("The game is not running inside Playweft"),
        );
      },
      getUserProfile() {
        return Promise.reject(
          new Error("The game is not running inside Playweft"),
        );
      },
      confirm() {
        return Promise.reject(
          new Error("The game is not running inside Playweft"),
        );
      },
      destroy() {},
    };
  }

  const rpc = createPlayweftRpcPeer({
    onNotification(method, params) {
      if (method === "platform.error") {
        const error = params?.error;
        onError?.(
          error?.message ?? "Platform error",
          error?.code ?? "PLATFORM_ERROR",
        );
      }
    },
  });

  const storageBridge = createPlayweftStorageBridge(rpc);

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
        storageBridge.initialize(context);
        onContext?.(context);
        onReady?.(context);
      })
      .catch((error) => {
        if (destroyed) return;
        storageBridge.fail(error);
        onError?.(
          error?.message ?? "Platform initialization failed",
          error?.code ?? "RPC_ERROR",
        );
      });
  }

  window.addEventListener("message", receiveBridge);
  announceReady();

  return {
    ready: storageBridge.ready,
    localStorage: storageBridge.localStorage,
    readClipboardText() {
      return rpc.call("navigator.clipboard.readText");
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
      storageBridge.destroy();
      rpc.destroy();
    },
  };
}
