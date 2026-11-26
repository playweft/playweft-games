import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import { GO_BOARD_TOP, configureSceneCamera, boardIntersection,
  projectScenePoint, sceneIntersection, screenOnPlane } from "../games/go/scene-geometry.js";

function view(width, height, side) {
  const viewport = { width, height };
  const rect = { left: 20, top: 90, width: side, height: side };
  const camera = new PerspectiveCamera(30, 1, .1, 100);
  configureSceneCamera(camera, rect, viewport);
  return { camera, viewport, rect };
}

test("perspective hits round-trip through the actual camera for every board size and viewport", () => {
  for (const dimensions of [[390,844,334], [1280,720,672], [844,390,240]]) {
    const { camera, viewport } = view(...dimensions);
    for (const size of [9,13,19]) {
      for (const row of [0,Math.floor(size / 2),size - 1]) {
        for (const column of [0,Math.floor(size / 2),size - 1]) {
          const local = boardIntersection(row, column, size);
          const point = projectScenePoint(local.x, GO_BOARD_TOP, local.z, camera, viewport);
          assert.deepEqual(sceneIntersection(point, camera, viewport, size),
            { row: row + 1, column: column + 1 });
        }
      }
    }
  }
});

test("board is a real trapezoid; empty space outside its far corners never places a stone", () => {
  const { camera, viewport } = view(390,844,334);
  const project = (x,z) => projectScenePoint(x, GO_BOARD_TOP, z, camera, viewport);
  const nearLeft = project(-.5,.5), nearRight = project(.5,.5);
  const farLeft = project(-.5,-.5), farRight = project(.5,-.5);
  assert.ok(nearRight.x - nearLeft.x > (farRight.x - farLeft.x) * 1.08);
  // Inside the enclosing rectangle but outside the trapezoid.
  assert.equal(sceneIntersection({ x: nearLeft.x + 1, y: farLeft.y + 1 }, camera, viewport, 19), undefined);
  assert.equal(sceneIntersection(project(.51,0), camera, viewport, 19), undefined);
});

test("bowl anchors at different heights round-trip without mixing camera angles", () => {
  const { camera, viewport } = view(1280,720,672);
  for (const height of [0,.1,.3]) {
    const p = screenOnPlane({ x: 160, y: 440 }, camera, viewport, height);
    const projected = projectScenePoint(p.x, p.y, p.z, camera, viewport);
    assert.ok(Math.abs(projected.x - 160) < 1e-8);
    assert.ok(Math.abs(projected.y - 440) < 1e-8);
  }
});
