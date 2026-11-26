import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import limestoneUrl from "./assets/courtyard-limestone.webp?url";

export function createCourtyard(invalidate, loader = new THREE.TextureLoader()) {
  const floor = new THREE.Group();
  const stoneMap = loader.load(limestoneUrl, invalidate);
  stoneMap.colorSpace = THREE.SRGBColorSpace;
  stoneMap.anisotropy = 4;
  let seed = 4107;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const relief = document.createElement("canvas");
  relief.width = relief.height = 256;
  const ctx = relief.getContext("2d");
  const image = ctx.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + Math.round((random() - .5) * 70);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const bump = new THREE.CanvasTexture(relief);
  const material = new THREE.MeshStandardMaterial({ map: stoneMap,
    roughness: .96, bumpMap: bump, bumpScale: .0012 });
  // Wider filtering on the ground softens the distant table/bowl projections.
  // Stones on the board keep the default, sharper contact shadow. Same sun and
  // five hardware-PCF samples; no additional shadow map or continuous rendering.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <shadowmap_pars_fragment>",
      THREE.ShaderChunk.shadowmap_pars_fragment.replace("shadowRadius * texelSize.x;",
        "shadowRadius * texelSize.x * 3.0;"));
  };
  material.customProgramCacheKey = () => "go-ground-soft-shadow";
  const stone = new RoundedBoxGeometry(.816, .018, .596, 2, .0035);
  const slabs = new THREE.InstancedMesh(stone, material, 17 * 17);
  slabs.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let row = -8; row <= 8; row++) for (let col = -8; col <= 8; col++) {
    dummy.position.set(col * .82 + (Math.abs(row % 2) * .41), -.009, row * .60);
    dummy.rotation.y = (random() > .5 ? Math.PI : 0) + (random() - .5) * .0006;
    dummy.scale.set(1 - random() * .0015, 1, 1 - random() * .0015);
    dummy.updateMatrix();
    slabs.setMatrixAt(index, dummy.matrix);
    slabs.setColorAt(index++, new THREE.Color().setRGB(1 - random() * .035,
      .998 - random() * .035, .99 - random() * .035));
  }
  slabs.instanceMatrix.needsUpdate = true;
  slabs.instanceColor.needsUpdate = true;
  floor.add(slabs);
  // The tiny recessed joints expose this matte grout; their light comes from the scene.
  const grout = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: "#cdc9bf", roughness: 1 }));
  grout.rotation.x = -Math.PI / 2;
  grout.position.y = -.013;
  floor.add(grout);
  return floor;
}
