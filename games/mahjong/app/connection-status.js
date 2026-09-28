/**
 * Online connection quality for the table view.
 *
 * The platform measures the room round-trip time and publishes it as the
 * `platform.latency` notification, so the game owns the presentation: a signal
 * icon plus the latency in whole milliseconds. The indicator only exists while
 * a room match is active and stays hidden until the first measurement.
 */
const STRONG_MAX_MS = 100;
const MEDIUM_MAX_MS = 220;
const LEVEL_CLASSES = ["is-strong", "is-medium", "is-weak"];

export const MAHJONG_CONNECTION_LEVEL_LABELS = Object.freeze({
  strong: "强",
  medium: "中",
  weak: "弱",
});

/** Accept only real, non-negative millisecond values; "" and null are not 0ms. */
function latencyMilliseconds(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

export function mahjongConnectionLevel(rttMs) {
  const value = latencyMilliseconds(rttMs);
  if (value === null) return "";
  if (value <= STRONG_MAX_MS) return "strong";
  if (value <= MEDIUM_MAX_MS) return "medium";
  return "weak";
}

export function formatMahjongLatency(rttMs) {
  const value = latencyMilliseconds(rttMs);
  return value === null ? "" : `${Math.round(value)}ms`;
}

export const MAHJONG_CONNECTION_LEVELS = Object.freeze([
  "strong",
  "medium",
  "weak",
]);

export function createMahjongConnectionStatus({
  element,
  latencyElement,
  resolveIcon,
} = {}) {
  let level = "";
  let rttMs = 0;
  let inRoom = false;

  function render() {
    const visible = inRoom && level !== "";
    if (element) element.hidden = !visible;
    if (!visible) return;
    // Resolve the icons on every render: an unscoped createIcons() call
    // replaces icon elements, so a cached reference would keep updating a
    // detached node while the table shows a stale signal level.
    for (const name of MAHJONG_CONNECTION_LEVELS) {
      resolveIcon?.(name)?.toggleAttribute?.("hidden", name !== level);
    }
    if (latencyElement) latencyElement.textContent = formatMahjongLatency(rttMs);
    element?.classList?.remove?.(...LEVEL_CLASSES);
    element?.classList?.add?.(`is-${level}`);
    element?.setAttribute?.(
      "aria-label",
      `网络延时 ${Math.round(rttMs)} 毫秒，信号${MAHJONG_CONNECTION_LEVEL_LABELS[level]}`,
    );
  }

  // Start from the rendered state so the markup does not decide visibility.
  render();

  return {
    /** Apply one platform latency sample; invalid values leave the state alone. */
    setLatency(nextRttMs) {
      const nextLevel = mahjongConnectionLevel(nextRttMs);
      if (!nextLevel) return;
      level = nextLevel;
      rttMs = Number(nextRttMs);
      render();
    },
    /** Room matches own the indicator; solo play and replays must not show it. */
    setRoomActive(active) {
      const next = active === true;
      if (next === inRoom) return;
      inRoom = next;
      render();
    },
    clear() {
      level = "";
      rttMs = 0;
      render();
    },
  };
}
