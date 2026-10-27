/** Safari itself, including iPadOS desktop mode; exclude other iOS browser brands. */
export function usesMahjongOpfs({ window = globalThis.window, navigator = globalThis.navigator } = {}) {
  if (!window || window.parent === window) return false;
  const ua = navigator?.userAgent ?? "";
  return /AppleWebKit\//.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) &&
    !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|EdgiOS\/|OPR\/|OPiOS\/|Android/.test(ua);
}
