import {
  cacheGameOfflineResources,
  clearGameOfflineCache,
  gameOfflineResourceUrls,
  notifyGameOfflineSettings,
  readBuildContentVersion,
  readGameOfflineSettings,
  writeGameOfflineSettings,
} from "../../../src/game-offline-cache.js";

export function createMahjongOfflineResourceController({
  button,
  feedback,
  icons,
  createIconsImpl,
  confirm,
  extraUrls = [],
  gameId = "mahjong",
} = {}) {
  const buildVersion = readBuildContentVersion();
  const storedSettings = readGameOfflineSettings(gameId);
  let state =
    storedSettings.mode === "download" &&
    storedSettings.version === buildVersion
      ? "complete"
      : "idle";
  let abortController = null;
  let operationId = 0;

  function render() {
    if (!button) return;
    const downloading = state === "downloading";
    const complete = state === "complete";
    const icon = downloading ? "loader-circle" : complete ? "trash-2" : "download";
    const label = downloading ? "下载中" : complete ? "删除" : "下载";
    const action = downloading ? "取消下载" : complete ? "删除离线资源" : "下载离线资源";
    button.classList.toggle("is-downloading", downloading);
    button.setAttribute("aria-label", action);
    button.setAttribute("title", action);
    button.innerHTML = `<span class="settings-general-list-label">离线资源包</span><span class="settings-list-trailing settings-offline-action-content"><span>${label}</span><i data-lucide="${icon}" aria-hidden="true"></i></span>`;
    // Scoped to this button: an unscoped scan would replace every icon in the
    // document, detaching the references other controllers hold.
    createIconsImpl?.({ icons, root: button });
  }

  async function download() {
    const currentOperation = ++operationId;
    abortController = new AbortController();
    state = "downloading";
    render();
    if (feedback) feedback.textContent = "正在下载麻将离线资源…";
    try {
      const results = await cacheGameOfflineResources(
        gameId,
        gameOfflineResourceUrls(gameId, extraUrls),
        { buildVersion, signal: abortController.signal },
      );
      if (currentOperation !== operationId) return;
      const failed = results.filter((result) => !result.ok).length;
      if (failed) {
        state = "idle";
        if (feedback) feedback.textContent = `已缓存 ${results.length - failed} 项，${failed} 项暂时无法下载。`;
      } else {
        state = "complete";
        if (feedback) feedback.textContent = `已缓存 ${results.length} 项麻将离线资源。`;
        const settings = writeGameOfflineSettings(gameId, {
          ...readGameOfflineSettings(gameId),
          mode: "download",
          version: buildVersion,
        });
        notifyGameOfflineSettings(gameId, settings);
      }
    } catch (error) {
      if (currentOperation !== operationId) return;
      state = "idle";
      if (error?.name === "AbortError") {
        await clearGameOfflineCache(gameId);
        if (feedback) feedback.textContent = "已取消下载。";
      } else if (feedback) {
        feedback.textContent = "下载失败，请稍后重试。";
      }
    } finally {
      if (currentOperation === operationId) {
        abortController = null;
        render();
      }
    }
  }

  async function clear() {
    ++operationId;
    abortController?.abort();
    abortController = null;
    await clearGameOfflineCache(gameId);
    state = "idle";
    const settings = writeGameOfflineSettings(gameId, {
      ...readGameOfflineSettings(gameId),
      mode: "none",
    });
    notifyGameOfflineSettings(gameId, settings);
    if (feedback) feedback.textContent = "已删除麻将离线缓存。";
    render();
  }

  async function handleAction() {
    if (state === "downloading") abortController?.abort();
    else if (state === "complete") {
      const confirmed = await confirm?.("删除离线资源？删除后需要重新下载才能离线使用。");
      if (confirmed) await clear();
    }
    else await download();
  }

  render();
  return {
    get state() {
      return state;
    },
    handleAction,
    download,
    clear,
    render,
  };
}
