import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, Shape, Vector2 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Board width is one world unit (about 45 cm).
export const GO_TABLE_TOP = 1.7;
export const GO_TABLE_WIDTH = 1.28;
export const GO_TABLE_DEPTH = 2;

export function createGoTable(material) {
  const table = new Group();
  function part(name, geometry, x, y, z) {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x,y,z);
    mesh.castShadow = mesh.receiveShadow = true;
    table.add(mesh);
    return mesh;
  }
  part("tabletop", createTableTop(), 0, GO_TABLE_TOP - .0575, 0);
  const legHeight = GO_TABLE_TOP - .06;
  const legs = new CylinderGeometry(.055,.043,legHeight,4);
  legs.rotateY(Math.PI/4);
  const legX = GO_TABLE_WIDTH / 2 - .11, legZ = GO_TABLE_DEPTH / 2 - .11;
  for (const x of [-legX,legX]) for (const z of [-legZ,legZ]) {
    part("leg",legs,x,legHeight/2,z);
  }
  const apronY = legHeight - .075;
  const cross = new RoundedBoxGeometry(legX * 2,.15,.04,2,.006);
  const side = new RoundedBoxGeometry(.04,.15,legZ * 2,2,.006);
  for (const z of [-legZ,legZ]) part("apron",cross,0,apronY,z);
  for (const x of [-legX,legX]) part("apron",side,x,apronY,0);
  return table;
}

function createTableTop() {
  const width = GO_TABLE_WIDTH, depth = GO_TABLE_DEPTH, r = .025, thickness = .055;
  const x = -width / 2, y = -depth / 2;
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + depth - r);
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  shape.lineTo(x + r, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness, steps: 1, curveSegments: 8,
    bevelEnabled: true, bevelSize: .003, bevelThickness: .0025, bevelSegments: 2,
    UVGenerator: {
      generateTopUV(_, vertices, ...ids) {
        return ids.map(i => new Vector2(vertices[i * 3] / width + .5,
          vertices[i * 3 + 1] / depth + .5));
      },
      generateSideWallUV(_, vertices, ...ids) {
        const horizontal = Math.abs(vertices[ids[1] * 3] - vertices[ids[0] * 3]) >
          Math.abs(vertices[ids[1] * 3 + 1] - vertices[ids[0] * 3 + 1]);
        return ids.map(i => new Vector2(vertices[i * 3 + (horizontal ? 0 : 1)] /
          (horizontal ? width : depth) + .5, vertices[i * 3 + 2] / thickness));
      },
    },
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
