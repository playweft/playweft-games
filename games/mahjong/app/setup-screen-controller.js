const DEFAULT_EXIT_DURATION_MS = 560;

/** Owns setup-screen visibility and its one transition used before a deal. */
export function createMahjongSetupScreenController({
  window,
  elements,
  closePaipuPanel,
  transientNotice,
  getSoloSave,
  exitDuration = DEFAULT_EXIT_DURATION_MS,
}) {
  const matchTypeButtons = () =>
    elements.setup.querySelectorAll("[data-match-type]");

  function show({ room = false } = {}) {
    elements.setup.inert = false;
    if (elements.setup.dataset) elements.setup.dataset.room = String(room);
    closePaipuPanel({ animate: false, restoreFocus: false });
    elements.setup.classList.remove(
      "is-leaving",
      "is-prepared-for-result-exit",
    );
    const savedMatchType = room ? null : getSoloSave()?.matchType;
    for (const button of matchTypeButtons()) {
      button.disabled = Boolean(
        savedMatchType && button.dataset.matchType !== savedMatchType,
      );
    }
    elements.setup.hidden = false;
  }

  function showRoom() {
    show({ room: true });
    elements.loading.classList.remove("is-room-waiting");
    elements.loading.hidden = true;
  }

  function showRecoveryError(message) {
    transientNotice.show(message);
  }

  function beginExit() {
    const menu = elements.setup.querySelector(".setup-menu");
    elements.setup.inert = true;
    elements.setup.classList.add("is-leaving");
    elements.loading.classList.add("is-active");
    for (const button of matchTypeButtons()) button.disabled = true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        menu.removeEventListener("transitionend", handleTransitionEnd);
        window.clearTimeout(fallbackTimer);
        resolve();
      };
      const handleTransitionEnd = (event) => {
        if (event.target === menu && event.propertyName === "opacity")
          finish();
      };
      const fallbackTimer = window.setTimeout(finish, exitDuration + 100);
      menu.addEventListener("transitionend", handleTransitionEnd);
    });
  }

  return { beginExit, show, showRecoveryError, showRoom };
}
