import { STONE_DIAMETER_RATIO } from "./stone-size.js";

export const STONE_PICKUP_DELAY = 160;
export const STONE_DRAG_GAIN = 2;
const STONE_LIFT = 64;

export function projectStoneDrag(anchor, pointer) {
  return {
    x: anchor.x + (pointer.x - anchor.x) * STONE_DRAG_GAIN,
    y: anchor.y - STONE_LIFT + (pointer.y - anchor.y) * STONE_DRAG_GAIN,
  };
}

export function stoneDragPoint(position, rect, size) {
  if (position.x < rect.left || position.y < rect.top ||
      position.x >= rect.left + rect.width || position.y >= rect.top + rect.height) return;
  return {
    row: Math.floor((position.y - rect.top) / rect.height * size) + 1,
    column: Math.floor((position.x - rect.left) / rect.width * size) + 1,
  };
}

export function createGoStoneDrag({ sources, board, stone, getPoint, onPlay, onPickup, getIntersection,
  view = board.ownerDocument.defaultView }) {
  const document = board.ownerDocument;
  const portrait = view.matchMedia("(width < 900px) and (orientation: portrait)");
  let context = { enabled: false }, gesture, frame;

  function clearTarget() {
    gesture?.target?.classList.remove("is-drag-target");
    if (gesture) gesture.target = undefined;
  }

  function cancel() {
    if (!gesture) return;
    const { id, source } = gesture;
    view.clearTimeout(gesture.timer);
    view.cancelAnimationFrame(frame);
    frame = undefined;
    clearTarget();
    gesture = undefined;
    stone.hidden = true;
    source.classList.remove("is-dragging");
    if (source.hasPointerCapture?.(id)) source.releasePointerCapture(id);
  }

  function paint() {
    frame = undefined;
    if (!gesture?.active) return;
    const position = projectStoneDrag(gesture.anchor, gesture.pointer);
    const point = getIntersection
      ? getIntersection(position, gesture.rect, context.size)
      : stoneDragPoint(position, gesture.rect, context.size);
    const target = point && getPoint(point.row, point.column);
    const valid = Boolean(target && !target.disabled && target.dataset.piece === "0");
    if (gesture.target !== (valid ? target : undefined)) {
      clearTarget();
      if (valid) {
        gesture.target = target;
        target.classList.add("is-drag-target");
      }
    }
    gesture.point = valid ? point : undefined;
    stone.dataset.valid = String(valid);
    stone.style.transform = `translate3d(${position.x - gesture.radius}px, ${position.y - gesture.radius}px, 0)`;
  }

  function activate() {
    if (!gesture || !context.enabled || !portrait.matches || document.hidden) { cancel(); return; }
    onPickup();
    gesture.active = true;
    gesture.anchor = { ...gesture.pointer };
    gesture.rect = board.getBoundingClientRect();
    const diameter = Math.max(18, gesture.rect.width / context.size * STONE_DIAMETER_RATIO);
    gesture.radius = diameter / 2;
    stone.style.width = `${diameter}px`;
    stone.classList.toggle("go-stone--black", gesture.color === 1);
    stone.classList.toggle("go-stone--white", gesture.color === 2);
    stone.hidden = false;
    gesture.source.classList.add("is-dragging");
    paint();
  }

  function start(event) {
    const source = event.currentTarget;
    const color = Number(source.dataset.color);
    if (gesture || !portrait.matches || !context.enabled || event.isPrimary === false ||
        color !== context.currentColor ||
        (event.pointerType === "mouse" && event.button !== 0) || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    gesture = { id: event.pointerId, source, color, pointer: { x: event.clientX, y: event.clientY } };
    gesture.timer = view.setTimeout(activate, STONE_PICKUP_DELAY);
    // Document listeners also cover capture loss in older or embedded browsers.
    try { source.setPointerCapture(event.pointerId); } catch {}
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.preventDefault();
    gesture.pointer = { x: event.clientX, y: event.clientY };
    if (gesture.active && frame === undefined) frame = view.requestAnimationFrame(paint);
  }

  function finish(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.preventDefault();
    view.cancelAnimationFrame(frame);
    gesture.pointer = { x: event.clientX, y: event.clientY };
    paint();
    const point = gesture.active && gesture.point;
    cancel();
    if (point && context.enabled && portrait.matches && !document.hidden) onPlay(point);
  }

  for (const source of sources) {
    source.addEventListener("pointerdown", start);
    source.addEventListener("contextmenu", event => event.preventDefault());
    source.addEventListener("lostpointercapture", cancel);
    source.addEventListener("dragstart", event => event.preventDefault());
  }
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("pointerdown", event => {
    if (gesture && event.pointerId !== gesture.id) cancel();
  }, { capture: true });
  document.addEventListener("visibilitychange", cancel);
  view.addEventListener("blur", cancel);
  view.addEventListener("resize", cancel);
  view.addEventListener("scroll", cancel, { capture: true, passive: true });
  view.visualViewport?.addEventListener("resize", cancel);
  view.visualViewport?.addEventListener("scroll", cancel);
  portrait.addEventListener("change", cancel);

  return {
    cancel,
    update(next) {
      if (!next.enabled || next.key !== context.key || next.currentColor !== context.currentColor || next.size !== context.size) cancel();
      context = next;
      for (const source of sources) {
        source.classList.toggle("can-pick-up", Boolean(next.enabled) && Number(source.dataset.color) === next.currentColor);
      }
    },
  };
}
