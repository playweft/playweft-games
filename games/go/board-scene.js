import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GO_BOARD_TOP, configureSceneCamera, projectScenePoint, projectBounds,
  sceneIntersection, boardIntersection } from "./scene-geometry.js";
import { stoneDragPoint } from "./stone-drag.js";
import { createGoStoneGeometry, STONE_TOP, STONE_BOTTOM, stoneLandingPose } from "./stone-shape.js";
import { createCourtyard } from "./courtyard.js";
import { createTableWood } from "./wooden-table.js";
import { createGoTable, GO_TABLE_TOP } from "./table-model.js";
import { GO_BOWL_SCALE, tableBowlPosition, bowlPickupRect, bowlStoneLayout } from "./bowl-layout.js";
import boardGrainUrl from "./assets/board-grain.webp?url";

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function texture(draw, size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// Calibrated under this scene's daylight to the reference's #f2ba7b midtone.
function woodSurface(ctx, size, grain, color = "#fe9659") {
  const rand = random(1527);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 10; i++) {
    const x = rand() * size, drift = (rand() - .5) * size * .14;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + drift, size * .35, x - drift * .7,
      size * .7, x + drift * .4, size);
    ctx.strokeStyle = `rgba(105,56,28,${.006 + rand() * .009})`;
    ctx.lineWidth = size * (.015 + rand() * .035);
    ctx.stroke();
  }
  if (grain) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = .6;
    ctx.filter = "brightness(1.71)";
    ctx.drawImage(grain, 0, 0, size, size);
    ctx.restore();
  }
}

function boardTexture(size, grain) {
  return texture((ctx, pixels) => {
    woodSurface(ctx, pixels, grain);
    const step = pixels / size, edge = step / 2;
    ctx.strokeStyle = "rgba(70,48,27,.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < size; i++) {
      const point = (i + .5) * step;
      ctx.moveTo(edge, point); ctx.lineTo(pixels - edge, point);
      ctx.moveTo(point, edge); ctx.lineTo(point, pixels - edge);
    }
    ctx.stroke();
    const stars = size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : [3, 9, 15];
    ctx.fillStyle = "#49331e";
    for (const row of stars) for (const col of stars) {
      ctx.beginPath();
      ctx.arc((col + .5) * step, (row + .5) * step, Math.max(2.7, step * .085), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function mesh(geometry, material, parent, { shadow = true } = {}) {
  const item = new THREE.Mesh(geometry, material);
  item.castShadow = shadow;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function bowlGroup(stoneGeometry, stoneMaterial, wood) {
  const group = new THREE.Group();
  const cup = new THREE.Group();
  cup.position.y = -.025;
  group.add(cup);
  const profile = [[0,.025],[.16,.025],[.30,.07],[.41,.18],[.46,.32],
    [.47,.42],[.46,.45],[.425,.45],[.415,.4],[.385,.28],[.29,.15],[0,.13]];
  mesh(new THREE.LatheGeometry(profile.map(([x,y]) => new THREE.Vector2(x,y)), 48), wood, cup);
  const rim = mesh(new THREE.TorusGeometry(.443, .014, 8, 48), wood, cup);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = .44;
  const lid = mesh(new THREE.SphereGeometry(.36, 32, 12), wood, group);
  lid.scale.y = .12;
  lid.position.set(-.7, .044, -.44);
  const ring = mesh(new THREE.TorusGeometry(.30, .006, 5, 48), wood, group);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-.7, .070, -.44);
  const pile = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, 128);
  pile.castShadow = pile.receiveShadow = true;
  pile.count = 0;
  pile.frustumCulled = false;
  cup.add(pile);
  return { group, pile, lid, ring };
}

export function createGoBoardScene({ root, board, bowls: bowlElements, onUnavailable, onReady }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false,
    powerPreference: "low-power" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  const canvas = renderer.domElement;
  canvas.className = "go-scene";
  canvas.setAttribute("aria-hidden", "true");
  root.prepend(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#ebe9e3");
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  scene.add(new THREE.HemisphereLight("#f8faff", "#b2aaa0", 1.2));
  const sun = new THREE.DirectionalLight("#fff3da", 2.1);
  sun.position.set(-7, 12, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2;
  sun.shadow.bias = -.00003;
  sun.shadow.normalBias = .0004;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 25;
  scene.add(sun, sun.target);

  let assetsReady = false, presented = false;
  const assets = new THREE.LoadingManager(() => { assetsReady = true; requestPaint(); });
  const textureLoader = new THREE.TextureLoader(assets);
  scene.add(createCourtyard(requestPaint, textureLoader));
  const wood = createTableWood(requestPaint, textureLoader);
  const furniture = createGoTable(wood);
  scene.add(furniture);
  const table = new THREE.Group();
  scene.add(table);
  const boardMaterial = new THREE.MeshStandardMaterial({ color: "#fe9659", roughness: .88 });
  const boardBody = mesh(new RoundedBoxGeometry(1, .026, 1, 3, .007), boardMaterial, table);
  boardBody.position.y = GO_BOARD_TOP - .013;
  const face = mesh(new THREE.PlaneGeometry(.998, .998),
    new THREE.MeshStandardMaterial({ roughness: .8 }), table, { shadow: false });
  face.rotation.x = -Math.PI / 2;
  face.position.y = GO_BOARD_TOP + .0001;
  const boardBounds = new THREE.Box3(new THREE.Vector3(-.5,GO_BOARD_TOP,-.5),
    new THREE.Vector3(.5,GO_BOARD_TOP,.5));

  const stoneGeometry = createGoStoneGeometry();
  const stoneMaterials = [
    new THREE.MeshPhongMaterial({ color: "#282b2d", specular: "#343a3d", shininess: 45 }),
    new THREE.MeshPhongMaterial({ color: "#f4f0e5", specular: "#c6c3b5", shininess: 40 }),
  ];
  const previewMaterials = stoneMaterials.map((material, i) => {
    const preview = material.clone();
    preview.transparent = true;
    preview.opacity = i === 0 ? .5 : .65;
    preview.depthWrite = false;
    return preview;
  });
  const previewStone = mesh(stoneGeometry, previewMaterials[0], table, { shadow: false });
  previewStone.receiveShadow = false;
  previewStone.visible = false;
  const stones = stoneMaterials.map(material => {
    const batch = new THREE.InstancedMesh(stoneGeometry, material, 361);
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.castShadow = batch.receiveShadow = true;
    batch.count = 0;
    // The buffer is reused for different board sizes and positions.
    batch.frustumCulled = false;
    table.add(batch);
    return batch;
  });
  const marker = mesh(new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: "#fff8e9" }), table, { shadow: false });
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  const bowls = bowlElements.map(element => {
    const color = Number(element.dataset.color);
    const result = bowlGroup(stoneGeometry, stoneMaterials[color - 1], wood);
    result.group.scale.setScalar(GO_BOWL_SCALE);
    scene.add(result.group);
    return { ...result, element, color };
  });
  let visible = !root.hidden, frame, disposed = false, lost = false, size = 0;
  let width = 0, height = 0, boardKey = "", layoutKey = "";
  let viewport;
  let grainImage, grainDirty = false;
  let previousPieces = [], animation;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const landscape = window.matchMedia("(orientation: landscape)");
  let hoveredPoint;
  const dummy = new THREE.Object3D();
  const rockAxis = new THREE.Vector3(.8, 0, .6);
  const markerPlane = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  new THREE.ImageLoader(assets).load(boardGrainUrl, image => {
    grainImage = image; grainDirty = true; requestPaint();
  });

  function requestPaint() {
    if (frame !== undefined || !visible || disposed || lost || document.hidden) return;
    frame = requestAnimationFrame(paint);
  }

  function paint(now = performance.now()) {
    frame = undefined;
    if (!visible || root.hidden || document.hidden || lost || disposed || !assetsReady) return;
    const nextSize = Math.sqrt(board.children.length);
    if (![9,13,19].includes(nextSize)) return;
    root.classList.add("has-scene");
    viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = board.getBoundingClientRect();
    if (rect.width < 1) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    if (width !== viewport.width || height !== viewport.height) {
      width = viewport.width; height = viewport.height;
      renderer.setSize(width, height, false);
    }
    if (size !== nextSize || grainDirty) {
      size = nextSize;
      grainDirty = false;
      face.material.map?.dispose();
      face.material.map = boardTexture(size, grainImage);
      face.material.needsUpdate = true;
    }
    const key = [...board.children].map(p => p.dataset.piece || "0").join("") +
      ":" + board.querySelector(".is-last-move")?.getAttribute("aria-label");
    const isLandscape = landscape.matches;
    const nextLayoutKey = `${rect.x}:${rect.y}:${rect.width}:${size}:${width}:${height}:${isLandscape}`;
    const layoutChanged = nextLayoutKey !== layoutKey;
    if (layoutChanged) {
      configureSceneCamera(camera, rect, viewport);
      furniture.rotation.y = isLandscape ? Math.PI / 2 : 0;
    }
    if (animation && board.dataset.animateMoves === "false") { animation = undefined; boardKey = ""; }
    const rebuild = key !== boardKey || layoutChanged;
    let shadowsChanged = rebuild;
    if (rebuild) {
      const pieces = [...board.children].map(point => Number(point.dataset.piece) || 0);
      const lastIndex = [...board.children].findIndex(point => point.classList.contains("is-last-move"));
      const animateMove = previousPieces.length === pieces.length && lastIndex >= 0 &&
        previousPieces[lastIndex] === 0 && pieces[lastIndex] > 0 &&
        board.dataset.animateMoves !== "false" && !reducedMotion.matches;
      animation = undefined;
      const counts = [0,0];
      marker.visible = false;
      stones.forEach(batch => batch.instanceMatrix.clearUpdateRanges());
      for (let i = 0; i < board.children.length; i++) {
        const point = board.children[i], color = Number(point.dataset.piece);
        if (color !== 1 && color !== 2) continue;
        const position = boardIntersection(Math.floor(i / size), i % size, size);
        const radius = .435 / size;
        dummy.quaternion.identity();
        dummy.position.set(position.x, GO_BOARD_TOP + STONE_BOTTOM * radius, position.z);
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        const instanceIndex = counts[color - 1]++;
        stones[color - 1].setMatrixAt(instanceIndex, dummy.matrix);
        if (animateMove && i === lastIndex) {
          animation = { color, instanceIndex, radius, position, started: now };
        }
        if (point.classList.contains("is-last-move")) {
          marker.visible = true;
          marker.position.set(position.x, GO_BOARD_TOP + (STONE_BOTTOM + STONE_TOP) * radius + .0003, position.z);
          marker.quaternion.copy(markerPlane);
          marker.scale.setScalar(.085 / size);
          marker.material.color.set(color === 1 ? "#fff8e9" : "#49453e");
        }
      }
      stones.forEach((batch, i) => {
        batch.count = counts[i];
        batch.instanceMatrix.needsUpdate = true;
      });
      previousPieces = pieces;
      boardKey = key; layoutKey = nextLayoutKey;
    }
    if (animation) {
      const { color, instanceIndex, radius, position, started } = animation;
      const pose = stoneLandingPose(now - started);
      dummy.position.set(position.x, GO_BOARD_TOP + pose.height * radius, position.z);
      dummy.quaternion.setFromAxisAngle(rockAxis, pose.angle);
      dummy.scale.setScalar(radius);
      dummy.updateMatrix();
      const batch = stones[color - 1];
      batch.setMatrixAt(instanceIndex, dummy.matrix);
      if (!rebuild) batch.instanceMatrix.addUpdateRange(instanceIndex * 16, 16);
      batch.instanceMatrix.needsUpdate = true;
      marker.position.set(0, STONE_TOP * radius + .0003, 0)
        .applyQuaternion(dummy.quaternion).add(dummy.position);
      marker.quaternion.copy(dummy.quaternion).multiply(markerPlane);
      shadowsChanged = true;
      if (pose.settled) animation = undefined;
    }
    const previewPoint = board.querySelector(".is-pending-move") ||
      board.querySelector(".go-point:focus-visible") || hoveredPoint;
    previewStone.visible = Boolean(previewPoint?.parentElement === board &&
      !previewPoint.disabled && previewPoint.dataset.piece === "0");
    if (previewStone.visible) {
      const index = [...board.children].indexOf(previewPoint);
      const p = boardIntersection(Math.floor(index / size), index % size, size);
      const radius = .435 / size;
      previewStone.position.set(p.x, GO_BOARD_TOP + STONE_BOTTOM * radius, p.z);
      previewStone.scale.setScalar(radius);
      previewStone.material = previewMaterials[previewPoint.classList.contains("piece-white") ? 1 : 0];
    }
    if (layoutChanged) for (let i = 0; i < board.children.length; i++) {
      const point = board.children[i];
      const local = boardIntersection(Math.floor(i / size), i % size, size);
      const p = projectScenePoint(local.x, GO_BOARD_TOP, local.z, camera, viewport);
      const edge = projectScenePoint(local.x + .45 / size, GO_BOARD_TOP, local.z, camera, viewport);
      point.style.left = `${p.x - rect.left}px`;
      point.style.top = `${p.y - rect.top}px`;
      point.style.width = `${(edge.x - p.x) * 2}px`;
    }
    const portrait = width < 900 && !isLandscape;
    const boardScreen = projectBounds(boardBounds, camera, viewport);
    const space = portrait ? root.querySelector(".board-space").getBoundingClientRect() : {
      left: 0, right: root.querySelector(".action-panel").getBoundingClientRect().left,
      top: document.querySelector(".game-header").getBoundingClientRect().bottom, bottom: height,
    };
    for (const bowl of bowls) {
      const near = bowl.element.classList.contains("stone-bowl--near");
      if (bowl.size !== size) {
        const placements = bowlStoneLayout(size, bowl.color === 1 ? 233 : 89);
        for (let i = 0; i < placements.length; i++) {
          const p = placements[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(p.tiltX, p.turn, p.tiltZ);
          dummy.scale.setScalar(p.radius);
          dummy.updateMatrix();
          bowl.pile.setMatrixAt(i, dummy.matrix);
        }
        bowl.pile.count = placements.length;
        bowl.pile.instanceMatrix.needsUpdate = true;
        bowl.pile.computeBoundingBox();
        bowl.size = size;
        shadowsChanged = true;
      }
      const positionKey = `${nextLayoutKey}:${near}`;
      if (layoutChanged || bowl.positionKey !== positionKey) {
        const lidOffset = near ? -.94 : .94;
        bowl.lid.position.set(isLandscape ? 0 : lidOffset, .044, isLandscape ? lidOffset : 0);
        bowl.ring.position.set(bowl.lid.position.x, .070, bowl.lid.position.z);
        bowl.group.position.copy(tableBowlPosition(near, isLandscape));
        const cup = projectScenePoint(bowl.group.position.x, GO_TABLE_TOP + GO_BOWL_SCALE * .4,
          bowl.group.position.z, camera, viewport);
        const hit = bowlPickupRect(cup, boardScreen, space, near, isLandscape);
        for (const key of ["left","top","width","height"]) bowl.element.style[key] = `${hit[key]}px`;
        bowl.positionKey = positionKey;
      }
      const { x, z } = bowl.group.position;
      const bowlKey = `${x}:${z}:${portrait}`;
      shadowsChanged ||= bowlKey !== bowl.key;
      bowl.key = bowlKey;
    }
    // Fit the shadow camera to the actual casters, not the entire courtyard.
    const extent = 2.4;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
    if (shadowsChanged) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    if (!presented) { presented = true; onReady?.(); }
    if (animation) requestPaint();
  }

  const observer = new MutationObserver(requestPaint);
  observer.observe(board, { subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-piece", "class", "data-animate-moves"] });
  for (const bowl of bowlElements) {
    observer.observe(bowl, { attributes: true, attributeFilter: ["class"] });
  }
  const resize = new ResizeObserver(requestPaint);
  resize.observe(board);
  resize.observe(root);
  window.addEventListener("resize", requestPaint);
  window.addEventListener("scroll", requestPaint, { passive: true });
  window.addEventListener("pageshow", requestPaint);
  landscape.addEventListener("change", requestPaint);
  let resolution;
  function watchResolution() {
    resolution?.removeEventListener("change", watchResolution);
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    resolution.addEventListener("change", watchResolution);
    requestPaint();
  }
  watchResolution();
  function hover(event) {
    const point = event.pointerType === "mouse" && finePointer.matches
      ? event.target.closest?.(".go-point") : undefined;
    if (point === hoveredPoint) return;
    hoveredPoint = point;
    requestPaint();
  }
  function clearHover() {
    if (!hoveredPoint) return;
    hoveredPoint = undefined;
    requestPaint();
  }
  board.addEventListener("pointermove", hover);
  board.addEventListener("pointerleave", clearHover);
  board.addEventListener("focusin", requestPaint);
  board.addEventListener("focusout", requestPaint);
  finePointer.addEventListener("change", clearHover);
  window.addEventListener("blur", clearHover);
  function resetAnimation() {
    animation = undefined; boardKey = "";
    requestPaint();
  }
  document.addEventListener("visibilitychange", resetAnimation);
  reducedMotion.addEventListener("change", resetAnimation);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    lost = true;
    presented = false;
    animation = undefined;
    onUnavailable?.();
    cancelAnimationFrame(frame); frame = undefined;
    root.classList.remove("has-scene");
    restoreHitGrid();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false; boardKey = layoutKey = "";
    requestPaint();
  });
  requestPaint();
  function restoreHitGrid() {
    for (const bowl of bowlElements) for (const property of ["left", "top", "width", "height"]) {
      bowl.style.removeProperty(property);
    }
    const gridSize = Math.sqrt(board.children.length);
    if (![9,13,19].includes(gridSize)) return;
    for (let i = 0; i < board.children.length; i++) {
      const point = board.children[i];
      point.style.left = `${(i % gridSize + .5) * 100 / gridSize}%`;
      point.style.top = `${(Math.floor(i / gridSize) + .5) * 100 / gridSize}%`;
      point.style.removeProperty("width");
    }
  }
  return {
    getIntersection(position, rect, size) {
      return root.classList.contains("has-scene") && viewport
        ? sceneIntersection(position, camera, viewport, size)
        : stoneDragPoint(position, rect, size);
    },
    setVisible(next) {
      if (next !== visible) {
        animation = undefined; previousPieces = []; boardKey = "";
        hoveredPoint = undefined;
      }
      visible = next;
      if (visible) requestPaint();
      else { cancelAnimationFrame(frame); frame = undefined; }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect(); resize.disconnect();
      window.removeEventListener("resize", requestPaint);
      window.removeEventListener("scroll", requestPaint);
      window.removeEventListener("pageshow", requestPaint);
      landscape.removeEventListener("change", requestPaint);
      resolution.removeEventListener("change", watchResolution);
      board.removeEventListener("pointermove", hover);
      board.removeEventListener("pointerleave", clearHover);
      board.removeEventListener("focusin", requestPaint);
      board.removeEventListener("focusout", requestPaint);
      finePointer.removeEventListener("change", clearHover);
      window.removeEventListener("blur", clearHover);
      document.removeEventListener("visibilitychange", resetAnimation);
      reducedMotion.removeEventListener("change", resetAnimation);
      const geometries = new Set(), materials = new Set(), maps = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [object.material].flat().filter(Boolean)) {
          materials.add(material);
          for (const key of ["map", "bumpMap", "roughnessMap"]) {
            if (material[key]) maps.add(material[key]);
          }
        }
      });
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose()); maps.forEach(item => item.dispose());
      previewMaterials.forEach(item => { if (!materials.has(item)) item.dispose(); });
      sun.shadow.dispose(); renderer.dispose(); canvas.remove();
      root.classList.remove("has-scene"); restoreHitGrid();
    },
  };
}
