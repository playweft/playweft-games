import { Vector3 } from "three";
import { GO_TABLE_TOP, GO_TABLE_WIDTH, GO_TABLE_DEPTH } from "./table-model.js";
import piles from "./assets/bowl-piles.js";
import { stoneRadius } from "./stone-size.js";

// Bowl diameter is .329 of the board's width (about 15 cm on a 45 cm board).
export const GO_BOWL_SCALE = .35;

export function tableBowlPosition(near, landscape = false) {
  const direction = near ? 1 : -1;
  // Leave about 2 cm between the cup's rim and the tabletop edge.
  const end = GO_TABLE_DEPTH / 2 - GO_BOWL_SCALE * .47 - .04;
  const side = GO_TABLE_WIDTH / 2 - GO_BOWL_SCALE * .47 - .04;
  return landscape
    ? new Vector3(direction * end, GO_TABLE_TOP, direction * side)
    : new Vector3(direction * .28, GO_TABLE_TOP, direction * end);
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

const pileCache = new Map();

// Contact settling is baked offline; resizing or changing turns only reuses it.
export function bowlStoneLayout(size, seed = 89) {
  const key = `${size}:${seed}`;
  if (!pileCache.has(key)) {
    const radius = stoneRadius(size) / GO_BOWL_SCALE;
    const coordinates = piles[key];
    if (!coordinates) throw new RangeError("Unsupported Go bowl layout");
    pileCache.set(key, Object.freeze(coordinates.map(([x, y, z, tiltX, turn, tiltZ, contacts = []]) =>
      Object.freeze({ x, y, z, radius, tiltX, turn, tiltZ,
        contacts: Object.freeze(contacts.map(point => Object.freeze(point))) }))));
  }
  return pileCache.get(key);
}
