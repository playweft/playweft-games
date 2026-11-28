// Generate fixed, non-intersecting Go bowl piles offline. No solver runs in the browser.
import { writeFile } from "node:fs/promises";
import { Euler, Quaternion, Vector3 } from "three";
import { GO_BOWL_SCALE } from "../games/go/bowl-layout.js";
import { STONE_PROFILE } from "../games/go/stone-shape.js";
import { stoneRadius } from "../games/go/stone-size.js";

// Supporting planes of the actual lens keep different tilted layers apart.
const contactNormals = [new Vector3(0, 1, 0)];
for (const angle of [35, 65, 82]) for (let i = 0; i < 12; i++) {
  const tilt = angle * Math.PI / 180, turn = i * Math.PI / 6;
  contactNormals.push(new Vector3(Math.sin(tilt) * Math.cos(turn), Math.cos(tilt),
    Math.sin(tilt) * Math.sin(turn)));
}
const floorSamples = STONE_PROFILE.flatMap(([radius, y]) => Array.from({ length: 16 }, (_, i) =>
  new Vector3(radius * Math.cos(i * Math.PI / 8), y, radius * Math.sin(i * Math.PI / 8))));

function bowlFloor(radius) {
  const profile = [[0, .13], [.29, .15], [.385, .28], [.415, .4], [.425, .45]];
  for (let i = 1; i < profile.length; i++) {
    const [r, y] = profile[i], [previousR, previousY] = profile[i - 1];
    if (radius <= r) return previousY + (y - previousY) * (radius - previousR) / (r - previousR);
  }
  return .45;
}

function support(normal, inverse, radius) {
  const local = normal.clone().applyQuaternion(inverse);
  const horizontal = Math.hypot(local.x, local.z);
  return radius * Math.max(...STONE_PROFILE.map(([r, y]) => r * horizontal + y * local.y));
}

function generatePile(size, seed) {
  const radius = stoneRadius(size) / GO_BOWL_SCALE;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points = [], limit = Math.max(0, .425 - radius);
  const count = Math.min(128, Math.round(.05 / (1.33 * radius ** 3)));
  for (let i = 0; i < count; i++) {
    let best;
    // Try several drop sites, keeping the lowest supported one. This fills
    // cavities rather than building disconnected columns or horizontal layers.
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = i ? limit * Math.sqrt(random()) : 0, angle = random() * Math.PI * 2;
      const p = { x: Math.cos(angle) * r, z: Math.sin(angle) * r, radius,
        tiltX: (random() - .5) * .44, tiltZ: (random() - .5) * .44, turn: random() * Math.PI * 2 };
      const rotation = new Quaternion().setFromEuler(new Euler(p.tiltX, p.turn, p.tiltZ));
      const inverse = rotation.clone().invert();
      p.upper = contactNormals.map(n => support(n, inverse, radius));
      p.lower = contactNormals.map(n => support(n.clone().negate(), inverse, radius));
      p.y = -Infinity;
      for (const sample of floorSamples) {
        const v = sample.clone().multiplyScalar(radius).applyQuaternion(rotation);
        p.y = Math.max(p.y, bowlFloor(Math.hypot(p.x + v.x, p.z + v.z)) - v.y);
      }
      for (const previous of points) {
        const dx = previous.x - p.x, dz = previous.z - p.z;
        if (dx * dx + dz * dz > (2.002 * radius) ** 2) continue;
        let contact = Infinity;
        for (let j = 0; j < contactNormals.length; j++) {
          const n = contactNormals[j];
          contact = Math.min(contact, previous.y +
            (n.x * dx + n.z * dz + previous.upper[j] + p.lower[j]) / n.y);
        }
        p.y = Math.max(p.y, contact);
      }
      p.y += .00002; // Clearance also covers rounding in the baked asset.
      if (!best || p.y < best.y) best = p;
    }
    points.push(best);
  }
  return points;
}

function contactPoints(points) {
  const rotations = points.map(p => new Quaternion().setFromEuler(new Euler(p.tiltX, p.turn, p.tiltZ)));
  const contacts = points.map(() => []);
  function surfacePoint(index, normal) {
    const local = normal.clone().applyQuaternion(rotations[index].clone().invert());
    const h = Math.hypot(local.x, local.z);
    const [r, y] = STONE_PROFILE.reduce((best, p) =>
      p[0] * h + p[1] * local.y > best[0] * h + best[1] * local.y ? p : best);
    return new Vector3(h ? r * local.x / h : 0, y, h ? r * local.z / h : 0);
  }
  for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) {
    const p = points[i], q = points[j], dx = q.x - p.x, dz = q.z - p.z;
    if (dx * dx + dz * dz > (2.002 * p.radius) ** 2) continue;
    let height = Infinity, axis;
    contactNormals.forEach((n, k) => {
      const y = q.y + (n.x * dx + n.z * dz + q.upper[k] + p.lower[k]) / n.y;
      if (y < height) { height = y; axis = n; }
    });
    if (p.y - height > p.radius * .16) continue;
    const a = surfacePoint(i, axis.clone().negate()), b = surfacePoint(j, axis);
    const worldA = a.clone().multiplyScalar(p.radius).applyQuaternion(rotations[i]).add(new Vector3(p.x, p.y, p.z));
    const worldB = b.clone().multiplyScalar(q.radius).applyQuaternion(rotations[j]).add(new Vector3(q.x, q.y, q.z));
    const distance = worldA.distanceTo(worldB) / p.radius;
    if (distance > .4) continue;
    contacts[i].push({ point: a, distance });
    contacts[j].push({ point: b, distance });
  }
  return contacts.map(list => list.sort((a, b) => a.distance - b.distance)
    .slice(0, 3).map(({ point }) => point.toArray().map(value => Number(value.toFixed(5)))));
}

const piles = {};
for (const size of [9, 13, 19]) for (const seed of [89, 233]) {
  const points = generatePile(size, seed);
  const contacts = contactPoints(points);
  piles[`${size}:${seed}`] = points.map((p, i) => [
    ...[p.x, p.y, p.z, p.tiltX, p.turn, p.tiltZ].map(value => Number(value.toFixed(6))), contacts[i],
  ]);
}
const rows = Object.entries(piles).map(([key, points]) =>
  `  "${key}": [\n${points.map(p => `    ${JSON.stringify(p)}`).join(",\n")}\n  ]`);
await writeFile(new URL("../games/go/assets/bowl-piles.js", import.meta.url),
  "// Generated by node tools/generate-go-bowl-piles.mjs.\n" +
  "// Each row: x, y, z, tiltX, turn, tiltZ, local contact points.\n" +
  `export default {\n${rows.join(",\n")}\n};\n`);
