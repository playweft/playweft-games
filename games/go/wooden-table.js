import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace, TextureLoader } from "three";
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
