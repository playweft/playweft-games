import { LatheGeometry, Vector2 } from "three";

// A lens formed by two spherical caps, rather than a flattened sphere.
// Radius 1, total thickness .8: approximately 8.8 mm thick at 22 mm diameter.
export const STONE_TOP = .48;
export const STONE_BOTTOM = .32;
export const STONE_SETTLE_MS = 460;

function capHeight(radius, height) {
  const sphereRadius = (1 + height * height) / (2 * height);
  return height - sphereRadius + Math.sqrt(sphereRadius * sphereRadius - radius * radius);
}

export const STONE_PROFILE = [];
for (let i = 0; i <= 10; i++) {
  const r = .985 * i / 10;
  STONE_PROFILE.push([r, -capHeight(r, STONE_BOTTOM)]);
}
STONE_PROFILE.push([1, .003]);
for (let i = 14; i >= 0; i--) {
  const r = .985 * i / 14;
  STONE_PROFILE.push([r, capHeight(r, STONE_TOP)]);
}

export function createGoStoneGeometry() {
  return new LatheGeometry(STONE_PROFILE.map(([r,y]) => new Vector2(r,y)), 48);
}

// Lowest point of the rotated surface of revolution, so rocking stays in contact.
export function stoneSupport(angle) {
  const sin = Math.abs(Math.sin(angle)), cos = Math.cos(angle);
  return -Math.min(...STONE_PROFILE.map(([r,y]) => y * cos - r * sin));
}

export function stoneLandingPose(elapsed) {
  const t = Math.min(1, Math.max(0, elapsed / STONE_SETTLE_MS));
  const settled = t === 1;
  if (settled) return { angle: 0, height: STONE_BOTTOM, settled: true };
  const rockTime = Math.max(0, (elapsed - 65) / (STONE_SETTLE_MS - 65));
  const angle = settled ? 0 : .075 * Math.exp(-4.5 * rockTime) * Math.sin(rockTime * Math.PI * 4);
  const lift = elapsed < 65 ? .3 * (1 - Math.max(0, elapsed) / 65) ** 2 : 0;
  return { angle, height: stoneSupport(angle) + lift, settled };
}
