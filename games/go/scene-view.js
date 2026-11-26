import { stoneDragPoint } from "./stone-drag.js";

export function createGoSceneView({ root, load = () => import("./board-scene.js"),
  onUnavailable, ...elements }) {
  const view = root.ownerDocument.defaultView;
  const indicator = root.ownerDocument.createElement("div");
  indicator.className = "go-scene-loader";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-label", "正在准备棋盘");
  indicator.innerHTML = '<span aria-hidden="true"></span>';
  indicator.hidden = true;
  root.append(indicator);
  let scene, loading, visible = false, ready = false, failed = false, unavailable = false, timer;

  function pending(value) {
    root.classList.toggle("scene-loading", value);
    root.setAttribute("aria-busy", String(value));
    indicator.hidden = !value;
  }
  function clearTimer() { view.clearTimeout(timer); timer = undefined; }
  function waitForRecovery() {
    clearTimer();
    // Only show the DOM fallback after a real, prolonged context failure.
    timer = view.setTimeout(() => pending(false), 6000);
  }
  function onReady() {
    ready = true; unavailable = false;
    clearTimer(); pending(false);
  }

  return {
    setVisible(next) {
      visible = next;
      clearTimer();
      pending(visible && !ready && !failed);
      if (scene) {
        scene.setVisible(visible);
        if (visible && unavailable) waitForRecovery();
      } else if (visible && !failed && !loading) {
        loading = load().then(({ createGoBoardScene }) => {
          scene = createGoBoardScene({ root, ...elements, onReady,
            onUnavailable: () => {
              ready = false; unavailable = true;
              onUnavailable?.();
              pending(visible);
              if (visible) waitForRecovery();
            },
          });
          scene.setVisible(visible);
        }).catch(error => {
          failed = true;
          pending(false);
          console.warn("Go scene unavailable; using the DOM board", error);
        });
      }
    },
    getIntersection(position, rect, size) {
      return scene ? scene.getIntersection(position, rect, size) : stoneDragPoint(position, rect, size);
    },
  };
}
