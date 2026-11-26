import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { GO_TABLE_TOP } from "./table-model.js";

export const GO_VIEW_ANGLE = 26 * Math.PI / 180;
export const GO_BOARD_TOP = GO_TABLE_TOP + .026;
const CAMERA_DISTANCE = 3.5;
const ray = new Raycaster();
const plane = new Plane(new Vector3(0, 1, 0), -GO_BOARD_TOP);

export function configureSceneCamera(camera, rect, viewport) {
  // Keep perspective consistent across portrait and landscape, fitting the board
  // at its center rather than changing the camera's physical distance.
  camera.fov = 2 * Math.atan(viewport.height / (2 * CAMERA_DISTANCE * rect.width)) * 180 / Math.PI;
  camera.aspect = viewport.width / viewport.height;
  camera.position.set(0, GO_BOARD_TOP + CAMERA_DISTANCE * Math.cos(GO_VIEW_ANGLE),
    CAMERA_DISTANCE * Math.sin(GO_VIEW_ANGLE));
  camera.lookAt(0, GO_BOARD_TOP, 0);
  camera.setViewOffset(viewport.width, viewport.height,
    viewport.width / 2 - rect.left - rect.width / 2,
    viewport.height / 2 - rect.top - rect.height / 2,
    viewport.width, viewport.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function boardIntersection(row, column, size) {
  return { x: (column + .5) / size - .5, z: (row + .5) / size - .5 };
}

export function projectScenePoint(x, y, z, camera, viewport) {
  const projected = new Vector3(x, y, z).project(camera);
  return { x: (projected.x + 1) * viewport.width / 2,
    y: (1 - projected.y) * viewport.height / 2 };
}

export function projectBounds(bounds, camera, viewport) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) points.push(projectScenePoint(x, y, z, camera, viewport));
  }
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}

export function screenOnPlane(position, camera, viewport, height = GO_BOARD_TOP) {
  ray.setFromCamera(new Vector2(position.x / viewport.width * 2 - 1,
    1 - position.y / viewport.height * 2), camera);
  plane.constant = -height;
  return ray.ray.intersectPlane(plane, new Vector3());
}

export function sceneIntersection(position, camera, viewport, size) {
  const point = screenOnPlane(position, camera, viewport);
  if (!point || point.x < -.5 || point.x >= .5 || point.z < -.5 || point.z >= .5) return;
  return { row: Math.floor((point.z + .5) * size) + 1,
    column: Math.floor((point.x + .5) * size) + 1 };
}
