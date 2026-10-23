import { createGameStorage } from "./game-storage.js";
import { loadGameStorageCache } from "./game-storage-cache.js";

/** Block startup on failed reads; retain the latest in-memory writes for retry. */
export async function initializeGameStorage(
  bridge,
  { gameId, keys, validate },
) {
  const backend = createGameStorage(bridge, {
    legacyKeys: keys,
    migrationKey: `playweft:${gameId}:storage-migrated:v1`,
  });
  let overlay;
  let previousFocus;
  let blockedElements = [];
  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = undefined;
    for (const node of blockedElements) node.inert = false;
    blockedElements = [];
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function show(error, retry, saving) {
    if (!overlay) {
      previousFocus = document.activeElement;
      blockedElements = [...document.body.children].filter(
        (node) => !node.inert && node.tagName !== "SCRIPT",
      );
      for (const node of blockedElements) node.inert = true;
      overlay = document.createElement("div");
      overlay.className = "game-storage-overlay";
      document.body.append(overlay);
    }
    const card = document.createElement("div");
    card.className = "game-storage-error";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "game-storage-title");
    card.setAttribute("aria-describedby", "game-storage-reason");
    const title = document.createElement("h2");
    title.id = "game-storage-title";
    title.textContent = saving ? "存档保存失败" : "存档读取失败";
    const reason = document.createElement("p");
    reason.id = "game-storage-reason";
    reason.textContent = `${error?.code ? `[${error.code}]\n` : ""}${error?.message || String(error)}\n${saving ? "当前进度仍保留在本页，请重试保存。" : "旧存档已保留，请重试读取。"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = saving ? "重试保存" : "重试读取";
    button.onclick = async () => {
      button.disabled = true;
      try {
        await retry();
      } finally {
        button.disabled = false;
      }
    };
    card.onkeydown = (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        button.focus();
      }
      event.stopPropagation();
    };
    card.append(title, reason, button);
    overlay.replaceChildren(card);
    button.focus();
  }
  while (true) {
    try {
      const cache = await loadGameStorageCache({
        gameId,
        keys,
        backend,
        validate,
        onError(error, retry) {
          show(error, () => retry().catch(() => {}), true);
        },
        onSaved: close,
      });
      close();
      return cache;
    } catch (error) {
      await new Promise((resolve) => show(error, resolve, false));
    }
  }
}
