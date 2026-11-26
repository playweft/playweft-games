import "./overlay-dialog.css";
import { animate } from "motion/mini";

const SHEET_QUERY = "(width < 600px) and (orientation: portrait)";
const ENTER_DURATION = 0.225;
const EXIT_DURATION = 0.195;
const ENTER_EASING = [0, 0, 0.2, 1];
const EXIT_EASING = [0.4, 0, 1, 1];

function syncPageLock() {
  document.body.classList.toggle(
    "has-overlay-dialog",
    Boolean(document.querySelector("dialog.overlay-dialog[open]")),
  );
}

function resolveTarget(target, fallback) {
  return (typeof target === "function" ? target() : target) ?? fallback;
}

export function createOverlayDialog({
  root,
  surface,
  closeButtons = [],
  dismissible = true,
  initialFocus,
  returnFocus,
  beforeOpen,
  beforeClose,
}) {
  let surfaceMotion;
  let backdropMotion;
  let motionId = 0;

  function stopMotion() {
    surfaceMotion?.stop();
    backdropMotion?.stop();
    surfaceMotion = undefined;
    backdropMotion = undefined;
  }

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function isBottomSheet() {
    return (
      root.classList.contains("overlay-dialog--sheet-narrow") &&
      window.matchMedia(SHEET_QUERY).matches
    );
  }

  function sheetOffset() {
    return surface.getBoundingClientRect().height;
  }

  function backdropTarget(property, fallback) {
    return getComputedStyle(root).getPropertyValue(property).trim() || fallback;
  }

  function playEnter(initial) {
    stopMotion();
    const id = ++motionId;
    const duration = reducedMotion() ? 0 : ENTER_DURATION;
    if (initial) {
      if (isBottomSheet())
        surface.style.transform = `translateY(${sheetOffset()}px)`;
      else surface.style.opacity = "0";
      root.style.backgroundColor = "rgba(0, 0, 0, 0)";
      root.style.backdropFilter = "blur(0px)";
    }
    surfaceMotion = isBottomSheet()
      ? animate(
          surface,
          { transform: "translateY(0px)" },
          { duration, ease: ENTER_EASING },
        )
      : animate(surface, { opacity: 1 }, { duration, ease: ENTER_EASING });
    backdropMotion = animate(
      root,
      {
        backgroundColor: backdropTarget(
          "--overlay-dialog-backdrop-color",
          "rgba(0, 0, 0, 0.5)",
        ),
        backdropFilter: backdropTarget(
          "--overlay-dialog-backdrop-filter",
          "blur(0px)",
        ),
      },
      { duration, ease: ENTER_EASING },
    );
    Promise.all([surfaceMotion, backdropMotion]).then(() => {
      if (id === motionId && root.dataset.state === "open") {
        surfaceMotion = undefined;
        backdropMotion = undefined;
      }
    });
  }

  function playExit() {
    stopMotion();
    const id = ++motionId;
    const duration = reducedMotion() ? 0 : EXIT_DURATION;
    surfaceMotion = isBottomSheet()
      ? animate(
          surface,
          { transform: `translateY(${sheetOffset()}px)` },
          { duration, ease: EXIT_EASING },
        )
      : animate(surface, { opacity: 0 }, { duration, ease: EXIT_EASING });
    backdropMotion = animate(
      root,
      { backgroundColor: "rgba(0, 0, 0, 0)", backdropFilter: "blur(0px)" },
      { duration, ease: EXIT_EASING },
    );
    Promise.all([surfaceMotion, backdropMotion]).then(() => {
      if (id === motionId && root.open && root.dataset.state === "closing") {
        root.close();
      }
    });
  }

  function finishClose() {
    stopMotion();
    motionId += 1;
    surface.style.removeProperty("transform");
    surface.style.removeProperty("opacity");
    root.style.removeProperty("background-color");
    root.style.removeProperty("backdrop-filter");
    delete root.dataset.state;
    syncPageLock();
    resolveTarget(returnFocus)?.focus({ preventScroll: true });
  }

  function setOpen(open) {
    if (open) {
      if (root.open && root.dataset.state !== "closing") return;
      const initial = !root.open;
      beforeOpen?.();
      root.dataset.state = "open";
      if (!root.open) root.showModal();
      syncPageLock();
      playEnter(initial);
      resolveTarget(initialFocus, surface)?.focus({ preventScroll: true });
      return;
    }

    if (!root.open || root.dataset.state === "closing") return;
    beforeClose?.();
    root.dataset.state = "closing";
    playExit();
  }

  root.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (dismissible) setOpen(false);
  });
  root.addEventListener("close", finishClose);
  root.addEventListener("click", (event) => {
    if (dismissible && event.target === root) setOpen(false);
  });
  for (const button of closeButtons) {
    button.addEventListener("click", () => setOpen(false));
  }

  return {
    get isOpen() {
      return root.open && root.dataset.state !== "closing";
    },
    setOpen,
  };
}
