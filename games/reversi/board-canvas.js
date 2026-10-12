import { SIZE } from "./rules.js";
import { createBoardGeometry, discPoint, flipPose, HALF_THICKNESS, FLIP_DURATION } from "./board-geometry.js";

const TAU = Math.PI * 2;
const FACE = { 1: "#262724", 2: "#f3f3ed" };
const EDGE = { 1: "#181916", 2: "#dedfd7" };
const indexOf = ({ row, column }) => row > 0 && column > 0 ? (row - 1) * SIZE + column - 1 : -1;
const makeCanvas = () => document.createElement("canvas");

function polygon(ctx, points, fill) {
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

export function createBoardCanvas(host, staticCanvas, animationCanvas, cells) {
  const base = staticCanvas.getContext("2d"), overlay = animationCanvas.getContext("2d");
  const background = makeCanvas(), shadowImage = makeCanvas();
  const sprites = new Map(), flips = new Map();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let geometry, ratio, scene, colors = [], legal = new Set(), last = -1;
  let hover = -1, focus = -1, frame = 0, recoveryFrame = 0, destroyed = false, needsRebuild = false;

  // This soft image is reused for every shadow; no per-frame blur/filter work.
  function rebuildShadow() {
    shadowImage.width = shadowImage.height = 64;
    const ctx = shadowImage.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 18, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,.18)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }

  function shadow(ctx, center, angle = 0) {
    const { radius } = geometry;
    const sin = Math.abs(Math.sin(angle));
    ctx.save();
    ctx.transform(...geometry.groundTransform(center.x, center.y + 2));
    ctx.globalAlpha = 1 - sin * .4;
    const rx = radius * Math.abs(Math.cos(angle)) + HALF_THICKNESS * sin + 2;
    ctx.drawImage(shadowImage, -rx, -radius - 2, rx * 2, (radius + 2) * 2);
    ctx.restore();
  }

  function disc(ctx, center, angle, lift) {
    const { radius, project, camera } = geometry;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const point = (phase, z) => {
      const p = discPoint(center, radius, angle, lift, phase, z);
      return project(p.x, p.y, p.z);
    };
    const sides = [];
    for (let i = 0; i < 24; i++) {
      const a = i * TAU / 24, b = (i + 1) * TAU / 24, mid = (a + b) / 2;
      const world = discPoint(center, radius, angle, lift, mid, 0);
      const facing = Math.cos(mid) * cos * (camera.x - world.x) + Math.sin(mid) * (camera.y - world.y)
        - Math.cos(mid) * sin * (camera.z - world.z);
      if (facing <= 0) continue;
      sides.push({ a, b, depth: Math.hypot(camera.x - world.x, camera.y - world.y, camera.z - world.z) });
    }
    sides.sort((a, b) => b.depth - a.depth);
    for (const { a, b } of sides) {
      for (const [bottom, top, color] of [[-HALF_THICKNESS, 0, 2], [0, HALF_THICKNESS, 1]]) {
        polygon(ctx, [point(a, bottom), point(b, bottom), point(b, top), point(a, top)], EDGE[color]);
      }
    }
    const blackVisible = sin * (camera.x - center.x) + cos * (camera.z - lift) >= 0;
    const color = blackVisible ? 1 : 2, z = blackVisible ? HALF_THICKNESS : -HALF_THICKNESS;
    polygon(ctx, Array.from({ length: 48 }, (_, i) => point(i * TAU / 48, z)), FACE[color]);
  }

  function sprite(index, color) {
    const key = `${index}:${color}`;
    if (sprites.has(key)) return sprites.get(key);
    const center = geometry.cell(index);
    const origin = geometry.project(center.x, center.y);
    // Generous transparent padding includes the rim and soft shadow at either board edge.
    const size = Math.ceil(geometry.cellSize * 1.8 + 16);
    const image = makeCanvas();
    image.addEventListener("contextrestored", recover);
    image.width = image.height = Math.ceil(size * ratio);
    const ctx = image.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.translate(size / 2 - origin.x, size / 2 - origin.y);
    shadow(ctx, center);
    disc(ctx, center, color === 1 ? 0 : Math.PI, HALF_THICKNESS);
    const cached = { image, x: origin.x - size / 2, y: origin.y - size / 2, size };
    sprites.set(key, cached);
    return cached;
  }

  function marker(ctx, index) {
    const center = geometry.cell(index), radius = geometry.cellSize * .045;
    polygon(ctx, Array.from({ length: 20 }, (_, i) => {
      const a = i * TAU / 20;
      return geometry.project(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, HALF_THICKNESS * 2);
    }), colors[index] === 1 ? "#eeefe8" : "#232522");
  }

  function hint(ctx, index) {
    const center = geometry.cell(index), r = geometry.cellSize * .075;
    polygon(ctx, Array.from({ length: 16 }, (_, i) => {
      const a = i * TAU / 16;
      return geometry.project(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
    }), "rgba(238,240,234,.48)");
  }

  function drawStatic() {
    if (!geometry || !scene || destroyed || document.hidden) return;
    base.clearRect(0, 0, geometry.width, geometry.height);
    base.drawImage(background, 0, 0, geometry.width, geometry.height);
    for (const index of legal) hint(base, index);
    colors.forEach((color, index) => {
      if (!color || flips.has(index)) return;
      const { image, x, y, size } = sprite(index, color);
      base.drawImage(image, x, y, size, size);
    });
    if (last >= 0 && colors[last] && !flips.has(last)) marker(base, last);
  }

  function drawOverlay(now) {
    if (!geometry || destroyed || document.hidden) return;
    overlay.clearRect(0, 0, geometry.width, geometry.height);
    if (legal.has(hover)) { polygon(overlay, geometry.cell(hover).corners, "#39865e"); hint(overlay, hover); }
    // Sort lifted discs by position so overlapping flips retain the shared camera view.
    for (const [index, flip] of [...flips].sort(([a], [b]) => a - b)) {
      const pose = flipPose(flip.from, flip.to, (now - flip.started) / FLIP_DURATION, geometry.radius);
      const center = geometry.cell(index);
      shadow(overlay, center, pose.angle);
      disc(overlay, center, pose.angle, pose.lift);
    }
    if (focus >= 0) {
      polygon(overlay, geometry.cell(focus).corners);
      overlay.strokeStyle = "#e6d9a5";
      overlay.lineWidth = 2;
      overlay.stroke();
    }
  }

  function tick(now) {
    frame = 0;
    if (destroyed || document.hidden) return;
    let finished = false;
    for (const [index, flip] of flips) {
      if (now - flip.started >= FLIP_DURATION) { flips.delete(index); finished = true; }
    }
    if (finished) drawStatic();
    drawOverlay(now);
    if (flips.size) frame = requestAnimationFrame(tick);
  }

  function resize() {
    if (destroyed) return;
    const width = host.clientWidth, height = host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!width || !height) { needsRebuild = true; return; }
    if (!needsRebuild && geometry?.width === width && geometry?.height === height && ratio === dpr) return;
    needsRebuild = false;
    geometry = createBoardGeometry(width, height);
    ratio = dpr;
    sprites.clear();
    rebuildShadow();
    for (const canvas of [staticCanvas, animationCanvas, background]) {
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const bg = background.getContext("2d"), { side, project } = geometry;
    const corner = side / 2, r = 5, perimeter = [];
    for (const [x, y, start] of [[corner-r,-corner+r,-Math.PI/2],[corner-r,corner-r,0],[-corner+r,corner-r,Math.PI/2],[-corner+r,-corner+r,Math.PI]]) {
      for (let step = 0; step <= 8; step++) {
        const a = start + step * Math.PI / 16;
        perimeter.push(project(x + Math.cos(a) * r, y + Math.sin(a) * r));
      }
    }
    polygon(bg, perimeter, "#16442f");
    cells.forEach((cell, index) => {
      const { corners } = geometry.cell(index);
      polygon(bg, corners, "#2f7854");
      const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
      const w = Math.max(...corners.map(p => p.x)) - left, h = Math.max(...corners.map(p => p.y)) - top;
      cell.style.left = `${left}px`; cell.style.top = `${top}px`;
      cell.style.width = `${w}px`; cell.style.height = `${h}px`;
      cell.style.clipPath = `polygon(${corners.map(p => `${(p.x-left)/w*100}% ${(p.y-top)/h*100}%`).join(",")})`;
    });
    drawStatic(); drawOverlay(performance.now());
  }

  function cancelFlips() {
    flips.clear();
    cancelAnimationFrame(frame); frame = 0;
  }
  function stopFlips() {
    cancelFlips();
    drawStatic(); drawOverlay(performance.now());
  }
  function recover() {
    if (destroyed) return;
    needsRebuild = true;
    if (document.hidden || recoveryFrame) return;
    // Coalesce focus/pageshow/visibility/context events into one full reconstruction.
    recoveryFrame = requestAnimationFrame(() => {
      recoveryFrame = 0;
      if (destroyed || document.hidden) return;
      // A focus event can precede a click in the same frame; keep its new flip running.
      needsRebuild = true;
      resize();
    });
  }
  function suspend() {
    cancelFlips();
    cancelAnimationFrame(recoveryFrame); recoveryFrame = 0;
    needsRebuild = true;
  }
  function visibilityChanged() {
    if (document.hidden) suspend();
    else recover();
  }
  const canvases = [staticCanvas, animationCanvas, background, shadowImage];
  for (const canvas of canvases) {
    canvas.addEventListener("contextlost", suspend);
    canvas.addEventListener("contextrestored", recover);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.addEventListener("resize", resize);
  window.addEventListener("focus", recover);
  window.addEventListener("pageshow", recover);
  document.addEventListener("visibilitychange", visibilityChanged);
  reducedMotion.addEventListener("change", stopFlips);
  resize();

  return {
    update(next, active) {
      const now = performance.now(), nextColors = next.board.flat();
      const reset = scene?.round !== next.round;
      if (reset) { flips.clear(); cancelAnimationFrame(frame); frame = 0; }
      const flipped = new Set((Array.isArray(next.lastFlipped) ? next.lastFlipped : []).map(indexOf));
      nextColors.forEach((color, index) => {
        if (color === colors[index]) return;
        const old = colors[index], running = flips.get(index);
        flips.delete(index);
        if (reset || !old || !color || !flipped.has(index) || reducedMotion.matches || document.hidden) return;
        const from = running ? flipPose(running.from, running.to, (now-running.started)/FLIP_DURATION, geometry?.radius ?? 0).angle : old === 1 ? 0 : Math.PI;
        const target = color === 1 ? 0 : Math.PI;
        const to = target + Math.round((from-target)/TAU) * TAU;
        flips.set(index, { from, to, started: now });
      });
      const nextLegal = new Set(active && Array.isArray(next.legalMoves) ? next.legalMoves.map(indexOf) : []), nextLast = indexOf(next.lastMove);
      const changed = reset || nextColors.some((c,i) => c !== colors[i]) || nextLast !== last
        || nextLegal.size !== legal.size || [...nextLegal].some(i => !legal.has(i));
      scene = next; colors = nextColors; legal = nextLegal; last = nextLast;
      if (changed) { drawStatic(); drawOverlay(now); }
      if (flips.size && !frame) frame = requestAnimationFrame(tick);
    },
    hover(index) { if (hover !== index) { hover = index; drawOverlay(performance.now()); } },
    focus(index) { if (focus !== index) { focus = index; drawOverlay(performance.now()); } },
    destroy() {
      destroyed = true;
      suspend();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("focus", recover);
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", visibilityChanged);
      reducedMotion.removeEventListener("change", stopFlips);
      for (const canvas of canvases) {
        canvas.removeEventListener("contextlost", suspend);
        canvas.removeEventListener("contextrestored", recover);
      }
      for (const { image } of sprites.values()) image.removeEventListener("contextrestored", recover);
      sprites.clear(); flips.clear();
    },
  };
}
