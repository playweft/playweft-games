import { SIZE } from "./rules.js";

const TILT = 20 * Math.PI / 180;
const COS = Math.cos(TILT), SIN = Math.sin(TILT);
export const HALF_THICKNESS = 3;
export const FLIP_DURATION = 400;

export function createBoardGeometry(width, height) {
  const side = Math.min(width * .94, height * .98);
  const distance = width * 3;
  const cellSize = (side - 12 - (SIZE - 1)) / SIZE;
  const start = -side / 2 + 6;
  const project = (x, y, z = 0) => {
    const scale = distance / (distance - y * SIN - z * COS);
    return { x: width / 2 + x * scale, y: height / 2 + (y * COS - z * SIN) * scale };
  };
  const cell = index => {
    const x = start + (index % SIZE) * (cellSize + 1);
    const y = start + Math.floor(index / SIZE) * (cellSize + 1);
    return { x: x + cellSize / 2, y: y + cellSize / 2, corners: [
      project(x, y), project(x + cellSize, y), project(x + cellSize, y + cellSize), project(x, y + cellSize),
    ] };
  };
  return { width, height, side, distance, cellSize, radius: cellSize * .4, project, cell,
    camera: { x: 0, y: distance * SIN, z: distance * COS },
    groundTransform(x, y) {
      const scale = distance / (distance - y * SIN);
      const center = project(x, y);
      return [scale, 0, x * SIN * scale * scale / distance, COS * scale * scale, center.x, center.y];
    },
  };
}

export function flipPose(from, to, progress, radius) {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  const angle = from + (to - from) * eased;
  return { angle, lift: radius * Math.abs(Math.sin(angle)) + HALF_THICKNESS * Math.abs(Math.cos(angle)) };
}

export function discPoint(center, radius, angle, lift, phase, z) {
  const x = Math.cos(phase) * radius;
  return { x: center.x + x * Math.cos(angle) + z * Math.sin(angle),
    y: center.y + Math.sin(phase) * radius,
    z: lift - x * Math.sin(angle) + z * Math.cos(angle) };
}
