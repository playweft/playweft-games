import test from "node:test";
import assert from "node:assert/strict";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { GO_TABLE_TOP } from "../games/go/table-model.js";
import { GO_BOARD_TOP, configureSceneCamera, boardIntersection,
  projectBounds, projectScenePoint, sceneIntersection, screenOnPlane } from "../games/go/scene-geometry.js";

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

test("review fits the complete projected board into the available area without changing perspective", () => {
  const board = new Box3(new Vector3(-.5,GO_TABLE_TOP,-.5),new Vector3(.5,GO_BOARD_TOP,.5));
  for (const [width,height,rect] of [
    [390,844,{left:18,top:76,width:354,height:640}],
    [390,844,{left:18,top:76,width:354,height:420}],
    [375,667,{left:18,top:76,width:339,height:275}],
    [844,390,{left:28,top:80,width:528,height:290}],
    [1280,900,{left:20,top:108,width:1020,height:680}],
  ]) {
    const viewport={width,height}, camera=new PerspectiveCamera(30,1,.1,100);
    configureSceneCamera(camera,rect,viewport);
    const position=camera.position.clone(), rotation=camera.quaternion.clone();
    configureSceneCamera(camera,rect,viewport,{boardFit:1});
    const bounds=projectBounds(board,camera,viewport);
    assert.ok(bounds.left>=rect.left-1e-6 && bounds.right<=rect.left+rect.width+1e-6);
    assert.ok(bounds.top>=rect.top-1e-6 && bounds.bottom<=rect.top+rect.height+1e-6);
    assert.ok(Math.abs((bounds.left+bounds.right)/2-(rect.left+rect.width/2))<1e-6);
    assert.ok(Math.abs((bounds.top+bounds.bottom)/2-(rect.top+rect.height/2))<1e-6);
    assert.ok(Math.max((bounds.right-bounds.left)/rect.width,(bounds.bottom-bounds.top)/rect.height)>.999,
      "use the available area for the board, not the surrounding furniture");
    assert.deepEqual(camera.position,position);
    assert.deepEqual(camera.quaternion.toArray(),rotation.toArray());
    for (const row of [0,9,18]) for (const column of [0,9,18]) {
      const p=boardIntersection(row,column,19);
      assert.deepEqual(sceneIntersection(projectScenePoint(p.x,GO_BOARD_TOP,p.z,camera,viewport),camera,viewport,19),
        {row:row+1,column:column+1});
    }
  }
});

test("every tilt, including exact overhead, preserves board fitting and touch intersections on phones and tablets", () => {
  const board = new Box3(new Vector3(-.5, GO_TABLE_TOP, -.5), new Vector3(.5, GO_BOARD_TOP, .5));
  for (const [width, height] of [[390, 844], [844, 390], [768, 1024], [1024, 768],
    [820, 1180], [1180, 820], [1024, 1366], [1366, 1024]]) {
    const viewport = { width, height };
    const rect = { left: 20, top: 100, width: width < height ? width - 40 : width - 320, height: height - 200 };
    for (const degrees of [0, .01, 6, 13, 20, 26]) {
      const camera = new PerspectiveCamera(30, 1, .1, 100);
      configureSceneCamera(camera, rect, viewport, { boardFit: 1, viewAngle: degrees * Math.PI / 180 });
      const bounds = projectBounds(board, camera, viewport);
      assert.ok(bounds.left >= rect.left - 1e-6 && bounds.right <= rect.left + rect.width + 1e-6);
      assert.ok(bounds.top >= rect.top - 1e-6 && bounds.bottom <= rect.top + rect.height + 1e-6);
      assert.ok(camera.projectionMatrix.elements.every(Number.isFinite), "no singular overhead camera");
      for (const size of [9, 13, 19]) for (const row of [0, Math.floor(size / 2), size - 1]) {
        for (const column of [0, Math.floor(size / 2), size - 1]) {
          const local = boardIntersection(row, column, size);
          const point = projectScenePoint(local.x, GO_BOARD_TOP, local.z, camera, viewport);
          assert.deepEqual(sceneIntersection(point, camera, viewport, size), { row: row + 1, column: column + 1 });
        }
      }
      if (degrees === 0) {
        const topLeft = projectScenePoint(-.5, GO_BOARD_TOP, -.5, camera, viewport);
        const topRight = projectScenePoint(.5, GO_BOARD_TOP, -.5, camera, viewport);
        const bottomLeft = projectScenePoint(-.5, GO_BOARD_TOP, .5, camera, viewport);
        assert.ok(topLeft.x < topRight.x && topLeft.y < bottomLeft.y, "keep the board upright");
        assert.ok(Math.abs(topRight.x - topLeft.x - (bottomLeft.y - topLeft.y)) < 1e-6, "overhead is square");
      }
    }
  }
});

test("framing blends continuously from the existing view to a board-only crop", () => {
  const camera = new PerspectiveCamera(30, 1, .1, 100), viewport = { width: 390, height: 844 };
  const rect = { left: 34, top: 290, width: 322, height: 322 };
  const fitRect = { left: 18, top: 137, width: 354, height: 630 };
  const board = new Box3(new Vector3(-.5, GO_TABLE_TOP, -.5), new Vector3(.5, GO_BOARD_TOP, .5));
  let previous;
  for (let step = 0; step <= 100; step++) {
    const boardFit = step / 100, viewAngle = (1 - boardFit) * 26 * Math.PI / 180;
    configureSceneCamera(camera, rect, viewport, { boardFit, viewAngle, fitRect });
    const bounds = projectBounds(board, camera, viewport);
    if (previous) for (const edge of ["left", "right", "top", "bottom"]) {
      assert.ok(Math.abs(bounds[edge] - previous[edge]) < 2, "no crop jump on the first gesture frame");
    }
    previous = bounds;
  }
  assert.ok(Math.abs(previous.left - fitRect.left) < 1e-6);
  assert.ok(Math.abs(previous.right - fitRect.left - fitRect.width) < 1e-6);
});
