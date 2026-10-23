import { getGameStorage } from "../../src/game-storage-cache.js";
const DOUBLE_CLICK_TSUMOGIRI_KEY = "playweft.mahjong.double-click-tsumogiri";
const DOUBLE_CLICK_PASS_KEY = "playweft.mahjong.double-click-pass";
const GAME_HINTS_KEY = "playweft.mahjong.game-hints";
const AUTO_WIN_AFTER_RIICHI_KEY = "playweft.mahjong.auto-win-after-riichi";
const DISCARD_VOLUME_KEY = "playweft.mahjong.discard-volume";
const MUSIC_VOLUME_KEY = "playweft.mahjong.music-volume";
const MASTER_VOLUME_KEY = "playweft.mahjong.master-volume";
const VOICE_VOLUME_KEY = "playweft.mahjong.voice-volume";
const AVATAR_SOURCE_PREFERENCE_KEY =
  "playweft.mahjong.avatar-source-preference";
const DEFAULT_DISCARD_VOLUME = 100;
const DEFAULT_MUSIC_VOLUME = 32;
const DEFAULT_MASTER_VOLUME = 100;
const DEFAULT_VOICE_VOLUME = 100;
const DEFAULT_AVATAR_SOURCE_PREFERENCE = "auto";
const DIALOG_TRANSITION_FALLBACK_MS = 240;

export function createMahjongSettingsDialog({
  trigger,
  root,
  surface,
  closeButton,
  returnButton,
  endMatchButton,
  tabButtons,
  tabPanels,
  gameHints,
  autoWinAfterRiichi,
  doubleClickTsumogiri,
  doubleClickPass,
  discardVolume,
  discardVolumeValue,
  masterVolume,
  masterVolumeValue,
  musicVolume,
  musicVolumeValue,
  voiceVolume,
  voiceVolumeValue,
  avatarSourcePreference,
  offlinePolicy,
  offlineAction,
  onMusicVolumeChange,
  onMasterVolumeChange,
  onVoiceVolumeChange,
  onGameHintsChange,
  onAvatarSourcePreferenceChange,
  onOfflinePolicyChange,
  onOfflineAction,
  onEndMatch,
  getAdditionalFocusable = () => [],
  onOpenChange,
  onTabChange,
}) {
  let returnFocus = null;
  let open = false;
  let openingFrame = 0;
  let closingTimer = 0;
  let restoreFocusAfterClose = true;
  if (returnButton) returnButton.textContent = "返回大厅";
  gameHints.checked = readBooleanSetting(GAME_HINTS_KEY, true);
  autoWinAfterRiichi.checked = readBooleanSetting(
    AUTO_WIN_AFTER_RIICHI_KEY,
    false,
  );
  doubleClickTsumogiri.checked = readBooleanSetting(
    DOUBLE_CLICK_TSUMOGIRI_KEY,
    false,
  );
  doubleClickPass.checked = readBooleanSetting(DOUBLE_CLICK_PASS_KEY, false);
  discardVolume.value = String(
    readVolumeSetting(DISCARD_VOLUME_KEY, DEFAULT_DISCARD_VOLUME),
  );
  renderDiscardVolume();
  musicVolume.value = String(
    readVolumeSetting(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME),
  );
  renderMusicVolume();
  masterVolume.value = String(
    readVolumeSetting(MASTER_VOLUME_KEY, DEFAULT_MASTER_VOLUME),
  );
  renderMasterVolume();
  voiceVolume.value = String(
    readVolumeSetting(VOICE_VOLUME_KEY, DEFAULT_VOICE_VOLUME),
  );
  renderVoiceVolume();
  avatarSourcePreference.value = readAvatarSourcePreference();
  if (offlinePolicy) offlinePolicy.value = readOfflinePolicy();

  function renderDiscardVolume() {
    const value = normalizeDiscardVolume(discardVolume.value);
    const label = value === 0 ? "静音" : `${value}%`;
    discardVolume.value = String(value);
    discardVolume.setAttribute("aria-valuetext", label);
    discardVolumeValue.textContent = label;
    return value;
  }

  function renderMusicVolume() {
    const value = normalizeMusicVolume(musicVolume.value);
    const label = value === 0 ? "静音" : `${value}%`;
    musicVolume.value = String(value);
    musicVolume.setAttribute("aria-valuetext", label);
    musicVolumeValue.textContent = label;
    return value;
  }

  function renderMasterVolume() {
    const value = normalizeVolume(masterVolume.value, DEFAULT_MASTER_VOLUME);
    const label = value === 0 ? "静音" : `${value}%`;
    masterVolume.value = String(value);
    masterVolume.setAttribute("aria-valuetext", label);
    masterVolumeValue.textContent = label;
    return value;
  }

  function renderVoiceVolume() {
    const value = normalizeVolume(voiceVolume.value, DEFAULT_VOICE_VOLUME);
    const label = value === 0 ? "静音" : `${value}%`;
    voiceVolume.value = String(value);
    voiceVolume.setAttribute("aria-valuetext", label);
    voiceVolumeValue.textContent = label;
    return value;
  }

  function setTab(name) {
    for (const button of tabButtons) {
      const selected = button.dataset.settingsTab === name;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of tabPanels) {
      panel.hidden = panel.dataset.settingsPanel !== name;
    }
    onTabChange?.(name);
  }

  function clearMotionTimers() {
    if (openingFrame) window.cancelAnimationFrame(openingFrame);
    if (closingTimer) window.clearTimeout(closingTimer);
    openingFrame = 0;
    closingTimer = 0;
  }

  function finishClose() {
    if (open) return;
    clearMotionTimers();
    root.hidden = true;
    root.classList.remove("is-open");
    if (restoreFocusAfterClose) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function motionReduced() {
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
  }

  function setOpen(nextOpen, { restoreFocus = true, animate = true } = {}) {
    if (nextOpen) {
      if (open) return;
      const wasHidden = root.hidden;
      open = true;
      clearMotionTimers();
      if (wasHidden) {
        returnFocus = document.activeElement;
        root.classList.remove("is-open");
      }
      root.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      setTab("operation");
      onOpenChange?.(true);
      const reveal = () => {
        openingFrame = 0;
        if (!open) return;
        root.classList.add("is-open");
        surface.focus({ preventScroll: true });
      };
      if (animate && !motionReduced() && wasHidden) {
        openingFrame = window.requestAnimationFrame(reveal);
      } else {
        reveal();
      }
      return;
    }
    if (!open && root.hidden) return;
    const wasVisible = root.classList.contains("is-open");
    open = false;
    onOpenChange?.(false);
    clearMotionTimers();
    restoreFocusAfterClose = restoreFocus;
    root.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (!animate || motionReduced() || !wasVisible) {
      finishClose();
      return;
    }
    closingTimer = window.setTimeout(
      finishClose,
      DIALOG_TRANSITION_FALLBACK_MS,
    );
  }

  function onRootClick(event) {
    if (event.target === root) setOpen(false);
  }

  function onSurfaceTransitionEnd(event) {
    if (
      !open &&
      event.target === surface &&
      event.propertyName === "transform"
    ) {
      finishClose();
    }
  }

  function onKeyDown(event) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...surface.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), iframe',
      ),
      ...getAdditionalFocusable(),
    ].filter((element) => !element.closest("[hidden], [inert]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onTabKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = tabButtons.indexOf(event.currentTarget);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next =
      tabButtons[(current + direction + tabButtons.length) % tabButtons.length];
    setTab(next.dataset.settingsTab);
    next.focus();
  }

  function onTsumogiriSettingChange() {
    writeBooleanSetting(
      DOUBLE_CLICK_TSUMOGIRI_KEY,
      doubleClickTsumogiri.checked,
    );
  }

  function onGameHintsSettingChange() {
    writeBooleanSetting(GAME_HINTS_KEY, gameHints.checked);
    onGameHintsChange?.();
  }

  function onAutoWinAfterRiichiSettingChange() {
    writeBooleanSetting(AUTO_WIN_AFTER_RIICHI_KEY, autoWinAfterRiichi.checked);
  }

  function onPassSettingChange() {
    writeBooleanSetting(DOUBLE_CLICK_PASS_KEY, doubleClickPass.checked);
  }

  function onDiscardVolumeInput() {
    writeVolumeSetting(DISCARD_VOLUME_KEY, renderDiscardVolume());
  }

  function onMusicVolumeInput() {
    const value = renderMusicVolume();
    writeVolumeSetting(MUSIC_VOLUME_KEY, value);
    onMusicVolumeChange?.();
  }

  function onMasterVolumeInput() {
    writeVolumeSetting(MASTER_VOLUME_KEY, renderMasterVolume());
    onMasterVolumeChange?.();
  }

  function onVoiceVolumeInput() {
    writeVolumeSetting(VOICE_VOLUME_KEY, renderVoiceVolume());
    onVoiceVolumeChange?.();
  }

  function onAvatarSourcePreferenceChangeInternal() {
    const value = normalizeAvatarSourcePreference(avatarSourcePreference.value);
    avatarSourcePreference.value = value;
    writeAvatarSourcePreference(value);
    onAvatarSourcePreferenceChange?.();
  }

  function onOfflinePolicyChangeInternal() {
    const value =
      offlinePolicy.value === "local-first" ? "local-first" : "network-first";
    offlinePolicy.value = value;
    try {
      getGameStorage("mahjong").setItem(
        "playweft.mahjong.offline-cache-policy",
        value,
      );
    } catch {}
    onOfflinePolicyChange?.(value);
  }

  function onOfflineActionClick() {
    onOfflineAction?.();
  }

  function onOfflinePolicyRowClick(event) {
    if (!offlinePolicy || offlinePolicy.disabled || event.target === offlinePolicy) return;
    offlinePolicy.focus({ preventScroll: true });
    try {
      offlinePolicy.showPicker?.();
    } catch {
      // Some embedded browsers allow focus but block programmatic picker opening.
    }
  }

  function onTriggerClick() {
    setOpen(true);
  }

  function onCloseClick() {
    setOpen(false);
  }

  function onReturnClick() {
    setOpen(false);
  }

  function onEndMatchClick() {
    onEndMatch?.();
  }

  trigger.addEventListener("click", onTriggerClick);
  closeButton.addEventListener("click", onCloseClick);
  returnButton?.addEventListener("click", onReturnClick);
  endMatchButton?.addEventListener("click", onEndMatchClick);
  root.addEventListener("click", onRootClick);
  surface.addEventListener("transitionend", onSurfaceTransitionEnd);
  document.addEventListener("keydown", onKeyDown);
  gameHints.addEventListener("change", onGameHintsSettingChange);
  autoWinAfterRiichi.addEventListener(
    "change",
    onAutoWinAfterRiichiSettingChange,
  );
  doubleClickTsumogiri.addEventListener("change", onTsumogiriSettingChange);
  doubleClickPass.addEventListener("change", onPassSettingChange);
  discardVolume.addEventListener("input", onDiscardVolumeInput);
  musicVolume.addEventListener("input", onMusicVolumeInput);
  masterVolume.addEventListener("input", onMasterVolumeInput);
  voiceVolume.addEventListener("input", onVoiceVolumeInput);
  avatarSourcePreference.addEventListener(
    "change",
    onAvatarSourcePreferenceChangeInternal,
  );
  offlinePolicy?.addEventListener("change", onOfflinePolicyChangeInternal);
  offlineAction?.addEventListener("click", onOfflineActionClick);
  offlinePolicy
    ?.closest(".settings-list-item-button")
    ?.addEventListener("click", onOfflinePolicyRowClick);
  for (const button of tabButtons) {
    button.addEventListener("click", () => setTab(button.dataset.settingsTab));
    button.addEventListener("keydown", onTabKeyDown);
  }

  return {
    get gameHintsEnabled() {
      return gameHints.checked;
    },
    get autoWinAfterRiichiEnabled() {
      return autoWinAfterRiichi.checked;
    },
    get doubleClickTsumogiriEnabled() {
      return doubleClickTsumogiri.checked;
    },
    get doubleClickPassEnabled() {
      return doubleClickPass.checked;
    },
    get discardVolumeScale() {
      return normalizeDiscardVolume(discardVolume.value) / 100;
    },
    get musicVolumeScale() {
      return normalizeMusicVolume(musicVolume.value) / 100;
    },
    get masterVolumeScale() {
      return normalizeVolume(masterVolume.value, DEFAULT_MASTER_VOLUME) / 100;
    },
    get voiceVolumeScale() {
      return normalizeVolume(voiceVolume.value, DEFAULT_VOICE_VOLUME) / 100;
    },
    get avatarSourcePreference() {
      return normalizeAvatarSourcePreference(avatarSourcePreference.value);
    },
    setSoloMatchActive(active) {
      if (endMatchButton) endMatchButton.hidden = !active;
      if (returnButton)
        returnButton.textContent = active ? "返回对局" : "返回大厅";
    },
    setEndMatchLabel(label) {
      if (endMatchButton) endMatchButton.textContent = label;
    },
    setOpen,
    destroy() {
      open = false;
      restoreFocusAfterClose = false;
      finishClose();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeEventListener("click", onTriggerClick);
      closeButton.removeEventListener("click", onCloseClick);
      returnButton?.removeEventListener("click", onReturnClick);
      endMatchButton?.removeEventListener("click", onEndMatchClick);
      root.removeEventListener("click", onRootClick);
      surface.removeEventListener("transitionend", onSurfaceTransitionEnd);
      document.removeEventListener("keydown", onKeyDown);
      gameHints.removeEventListener("change", onGameHintsSettingChange);
      autoWinAfterRiichi.removeEventListener(
        "change",
        onAutoWinAfterRiichiSettingChange,
      );
      doubleClickTsumogiri.removeEventListener(
        "change",
        onTsumogiriSettingChange,
      );
      doubleClickPass.removeEventListener("change", onPassSettingChange);
      discardVolume.removeEventListener("input", onDiscardVolumeInput);
      musicVolume.removeEventListener("input", onMusicVolumeInput);
      masterVolume.removeEventListener("input", onMasterVolumeInput);
      voiceVolume.removeEventListener("input", onVoiceVolumeInput);
      avatarSourcePreference.removeEventListener(
        "change",
        onAvatarSourcePreferenceChangeInternal,
      );
      offlineAction?.removeEventListener("click", onOfflineActionClick);
      offlinePolicy?.removeEventListener(
        "change",
        onOfflinePolicyChangeInternal,
      );
      offlinePolicy
        ?.closest(".settings-list-item-button")
        ?.removeEventListener("click", onOfflinePolicyRowClick);
      for (const button of tabButtons) {
        button.removeEventListener("keydown", onTabKeyDown);
      }
    },
  };
}

export function normalizeAvatarSourcePreference(value) {
  return value === "theme" ? "theme" : DEFAULT_AVATAR_SOURCE_PREFERENCE;
}

function readAvatarSourcePreference() {
  try {
    return normalizeAvatarSourcePreference(
      getGameStorage("mahjong").getItem(AVATAR_SOURCE_PREFERENCE_KEY),
    );
  } catch {
    return DEFAULT_AVATAR_SOURCE_PREFERENCE;
  }
}

function readOfflinePolicy() {
  try {
    return getGameStorage("mahjong").getItem(
      "playweft.mahjong.offline-cache-policy",
    ) === "local-first"
      ? "local-first"
      : "network-first";
  } catch {
    return "network-first";
  }
}

function writeAvatarSourcePreference(value) {
  try {
    getGameStorage("mahjong").setItem(AVATAR_SOURCE_PREFERENCE_KEY, value);
  } catch {
    // Storage can be unavailable; the current select value remains active.
  }
}

export function normalizeDiscardVolume(
  value,
  fallback = DEFAULT_DISCARD_VOLUME,
) {
  return normalizeVolume(value, fallback);
}

export function normalizeMusicVolume(value, fallback = DEFAULT_MUSIC_VOLUME) {
  return normalizeVolume(value, fallback);
}

function normalizeVolume(value, fallback = DEFAULT_DISCARD_VOLUME) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function readBooleanSetting(key, fallback) {
  try {
    const value = getGameStorage("mahjong").getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeBooleanSetting(key, value) {
  try {
    getGameStorage("mahjong").setItem(key, String(value));
  } catch {
    // Storage can be unavailable in sandboxed game hosts; the session value remains active.
  }
}

function readVolumeSetting(key, fallback) {
  try {
    const value = getGameStorage("mahjong").getItem(key);
    return value === null ? fallback : normalizeDiscardVolume(value, fallback);
  } catch {
    return fallback;
  }
}

function writeVolumeSetting(key, value) {
  try {
    getGameStorage("mahjong").setItem(key, String(value));
  } catch {
    // Storage can be unavailable in sandboxed game hosts; the session value remains active.
  }
}
