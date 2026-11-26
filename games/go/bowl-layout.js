import { Vector3 } from "three";
import { projectBounds, projectScenePoint, screenOnPlane } from "./scene-geometry.js";

// Bowl diameter is .1692 of the board's width, regardless of the viewport.
export const GO_BOWL_SCALE = .18;

// Move a rigid cup-and-lid group into the available floor space without resizing
// it. Reproject after each correction because perspective changes its footprint.
export function bowlArea({ board, table, space, near, portrait, obstacles = [] }) {
  const middle = (table.top + table.bottom) / 2;
  const area = portrait ? {
    left: near ? space.left + 8 : Math.max(space.left + 8, board.left - 8),
    right: near ? Math.min(space.right - 8, board.right + 8) : space.right - 8,
    top: near ? table.bottom + 8 : space.top + 8,
    bottom: near ? space.bottom - 8 : table.top - 8,
  } : {
    left: near ? table.right + 10 : space.left + 10,
    right: near ? space.right - 10 : table.left - 10,
    top: near ? space.top + 10 : Math.max(space.top + 10, table.top + 10),
    bottom: near ? Math.min(space.bottom - 10, table.bottom - 10) : space.bottom - 10,
  };
  for (const rect of obstacles) {
    if (rect.right <= area.left || rect.left >= area.right) continue;
    if (near && rect.top >= middle) area.bottom = Math.min(area.bottom, rect.top - 12);
    if (!near && rect.bottom <= middle) area.top = Math.max(area.top, rect.bottom + 12);
  }
  return area;
}

export function bowlPosition(bounds, area, camera, viewport, { near, portrait }) {
  const center = bounds.getCenter(new Vector3());
  const position = screenOnPlane({ x: (area.left + area.right) / 2,
    y: (area.top + area.bottom) / 2 }, camera, viewport, center.y).sub(center);
  for (let i = 0; i < 4; i++) {
    const screen = projectBounds(bounds.clone().translate(position), camera, viewport);
    const dx = near ? area.right - screen.right : area.left - screen.left;
    const dy = portrait ? (area.top + area.bottom - screen.top - screen.bottom) / 2
      : near ? area.bottom - screen.bottom : area.top - screen.top;
    const anchor = projectScenePoint(center.x + position.x, center.y,
      center.z + position.z, camera, viewport);
    position.copy(screenOnPlane({ x: anchor.x + dx, y: anchor.y + dy },
      camera, viewport, center.y).sub(center));
  }
  return position;
}

export function bowlStoneLayout(size, seed = 89) {
  const radius = .435 / size / GO_BOWL_SCALE;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points = [], limit = Math.max(0, .425 - radius * .95);
  const count = Math.min(64, Math.max(1, Math.round((.425 / radius) ** 2 * .65)));
  for (let layer = 0; layer < 2; layer++) {
    const group = [];
    for (let attempt = 0; attempt < count * 150 && group.length < count; attempt++) {
      const r = group.length ? limit * Math.sqrt(random()) : Math.min(limit, radius * .2) * random();
      const angle = random() * Math.PI * 2;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      const y = .22 + radius * (.32 + layer * .72 + random() * .55);
      // Respect the lens's flatter vertical profile, allowing natural overlap in
      // projection when stones sit at different heights, without a visible grid.
      if (group.some(p => ((x-p.x)**2+(z-p.z)**2)/(radius*1.7)**2 +
        (y-p.y)**2/(radius*.6)**2 < 1)) continue;
      group.push({ x,z,y,radius,tiltX:(random()-.5)*.5,
        tiltZ:(random()-.5)*.5,turn:random()*Math.PI*2 });
    }
    points.push(...group);
  }
  return points;
}
