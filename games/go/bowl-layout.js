import { Vector3 } from "three";
import { GO_TABLE_TOP, GO_TABLE_WIDTH } from "./table-model.js";

// Bowl diameter is .1692 of the board's width, regardless of the viewport.
export const GO_BOWL_SCALE = .18;

export function tableBowlPosition(near, landscape = false) {
  const direction = near ? 1 : -1;
  // In landscape the table's width becomes its front-to-back depth. Leave
  // about 2 cm between the cup's rim and the player's end of the tabletop.
  const landscapeEnd = GO_TABLE_WIDTH / 2 - GO_BOWL_SCALE * .47 - .04;
  return landscape
    ? new Vector3(direction * .68, GO_TABLE_TOP, direction * landscapeEnd)
    : new Vector3(direction * .28, GO_TABLE_TOP, direction * .70);
}

// Enlarge the pickup target into nearby empty space, while excluding the board
// and the surrounding player cards and controls.
export function bowlPickupRect(cup, board, space, near, landscape = false) {
  const left = landscape && near ? board.right + 4 : space.left;
  const right = landscape && !near ? board.left - 4 : space.right;
  const top = !landscape && near ? board.bottom + 4 : space.top;
  const bottom = !landscape && !near ? board.top - 4 : space.bottom;
  const width = Math.max(0, Math.min(200, right - left));
  const height = Math.max(0, Math.min(128, bottom - top));
  return { width, height,
    left: Math.max(left, Math.min(cup.x - width / 2, right - width)),
    top: Math.max(top, Math.min(cup.y - height / 2, bottom - height)),
  };
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
