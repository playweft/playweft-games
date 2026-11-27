import { GO_VIEW_ANGLE } from "./scene-geometry.js";

// Two parallel vertical touch drags change pitch. Single taps, mouse input,
// pinching and keyboard activation keep their existing meaning.
export function createGoViewGesture({ root, surface, getEnabled, getAngle, onStart, onChange,
  view = root.ownerDocument.defaultView }) {
  const document = root.ownerDocument, touches = new Map();
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let origin, consumed = false, moving = false, needsSnap = false, frame;
  const inSurface = target => surface.contains(target);
  const nearestAngle = () => getAngle() < GO_VIEW_ANGLE / 2 ? 0 : GO_VIEW_ANGLE;
  function stopAnimation() {
    view.cancelAnimationFrame(frame);
    frame = undefined;
  }
  function settle() {
    stopAnimation();
    const start = getAngle(), target = nearestAngle();
    if (reducedMotion.matches || Math.abs(start - target) < 1e-6) { onChange(target); return; }
    const started = view.performance.now();
    function animate(now) {
      frame = undefined;
      if (!getEnabled()) return;
      const progress = Math.max(0, Math.min(1, (now - started) / 220));
      onChange(progress === 1 ? target : start + (target - start) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = view.requestAnimationFrame(animate);
    }
    frame = view.requestAnimationFrame(animate);
  }
  function release(id) {
    if (root.hasPointerCapture?.(id)) root.releasePointerCapture(id);
  }
  function cancel() {
    const shouldSnap = needsSnap || frame !== undefined;
    stopAnimation();
    const ids = [...touches.keys()];
    touches.clear(); origin = undefined; moving = false; needsSnap = false;
    ids.forEach(release);
    if (shouldSnap) onChange(nearestAngle());
  }
  function rebase() {
    needsSnap ||= frame !== undefined || (getAngle() > 0 && getAngle() < GO_VIEW_ANGLE);
    stopAnimation();
    origin = { angle: getAngle(), points: [...touches.values()].map(p => ({ ...p })) };
    moving = false;
  }
  function block(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  function down(event) {
    if (!inSurface(event.target)) return;
    if (!touches.size) consumed = false;
    if (event.pointerType !== "touch" || !getEnabled()) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size < 2) return;
    if (!consumed) { consumed = true; onStart(); }
    if (touches.size === 2) rebase();
    else origin = undefined;
    for (const id of touches.keys()) {
      try { root.setPointerCapture(id); } catch { /* document listeners cover older webviews */ }
    }
    block(event);
  }
  function move(event) {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!consumed) return;
    block(event);
    if (!getEnabled()) { cancel(); return; }
    if (touches.size !== 2 || !origin) return;
    const deltas = [...touches.values()].map((p, i) => ({
      x: p.x - origin.points[i].x, y: p.y - origin.points[i].y,
    }));
    const dy = (deltas[0].y + deltas[1].y) / 2, dx = (deltas[0].x + deltas[1].x) / 2;
    if (!moving) {
      if (deltas[0].y * deltas[1].y <= 0 ||
          Math.min(Math.abs(deltas[0].y), Math.abs(deltas[1].y)) < 4 || Math.abs(dy) <= Math.abs(dx)) return;
      moving = true;
    }
    const distance = Math.max(100, Math.min(180, view.innerHeight * .2));
    const angle = Math.max(0, Math.min(GO_VIEW_ANGLE, origin.angle - dy / distance * GO_VIEW_ANGLE));
    needsSnap ||= angle !== getAngle();
    onChange(angle);
  }
  function up(event) {
    if (!touches.has(event.pointerId)) return;
    if (consumed) block(event);
    touches.delete(event.pointerId);
    release(event.pointerId);
    if (touches.size === 2 && consumed) rebase();
    else {
      if (touches.size < 2 && needsSnap) { settle(); needsSnap = false; }
      origin = undefined; moving = false;
    }
    // consumed stays set through compatibility clicks. A fresh pointerdown
    // resets it, so the next normal tap works immediately, without a timeout.
  }
  function click(event) {
    if (consumed && event.detail !== 0 && inSurface(event.target)) block(event);
  }
  root.addEventListener("pointerdown", down, { capture: true });
  root.addEventListener("click", click, { capture: true });
  document.addEventListener("pointermove", move, { capture: true, passive: false });
  document.addEventListener("pointerup", up, { capture: true });
  document.addEventListener("pointercancel", up, { capture: true });
  document.addEventListener("visibilitychange", cancel);
  view.addEventListener("blur", cancel);
  view.addEventListener("resize", cancel);
  reducedMotion.addEventListener("change", cancel);
  return {
    cancel,
    dispose() {
      cancel();
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("visibilitychange", cancel);
      view.removeEventListener("blur", cancel);
      view.removeEventListener("resize", cancel);
      reducedMotion.removeEventListener("change", cancel);
    },
  };
}
