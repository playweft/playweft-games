import { CanvasTexture, ExtrudeGeometry, MeshStandardMaterial, Shape, SRGBColorSpace,
  TextureLoader, Vector2 } from "three";
import woodUrl from "./assets/table-texture-plywood.webp?url";
import grainUrl from "./assets/board-grain.webp?url";

export function createTableWood(invalidate, loader = new TextureLoader()) {
  // The lit surface renders near the reference's #ad754e.
  const base = "#895d44";
  const material = new MeshStandardMaterial({ color: base, roughness: .91 });
  Promise.all([loader.loadAsync(grainUrl), loader.loadAsync(woodUrl)]).then(([flow, detail]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 683;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = .7;
    ctx.filter = "brightness(1.71)";
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(flow.image, -canvas.height / 2, -canvas.width / 2, canvas.height, canvas.width);
    ctx.restore();
    ctx.filter = "brightness(.907)";
    ctx.globalAlpha = .1;
    ctx.drawImage(detail.image, 0, 0, canvas.width, canvas.height);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    material.color.set("#ffffff");
    material.map = map;
    material.bumpMap = detail;
    material.bumpScale = .00015;
    material.needsUpdate = true;
    flow.dispose();
    invalidate();
  }).catch(error => console.warn("Go wood detail unavailable", error));
  return material;
}

export function createTableTop() {
  const width = 1.24, depth = 1.14, r = .025, thickness = .055;
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
