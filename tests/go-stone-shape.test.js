import test from "node:test";
import assert from "node:assert/strict";
import { createGoStoneGeometry, STONE_PROFILE, STONE_TOP, STONE_BOTTOM,
  STONE_SETTLE_MS, stoneLandingPose } from "../games/go/stone-shape.js";

test("Go lens has distinct curved faces and a rounded edge at a realistic thickness", () => {
  const geometry = createGoStoneGeometry();
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y + STONE_BOTTOM) < 1e-6);
  assert.ok(Math.abs(geometry.boundingBox.max.y - STONE_TOP) < 1e-6);
  assert.equal(geometry.boundingBox.max.x, 1);
  assert.ok(STONE_TOP > STONE_BOTTOM);
  assert.ok(STONE_PROFILE.some(([r,y]) => r > .4 && r < .6 && y < -.1));
  assert.ok(STONE_PROFILE.some(([r,y]) => r > .4 && r < .6 && y > .1));
  assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  geometry.dispose();
});

test("landing rocks in both directions without letting any point penetrate the board", () => {
  let positive = false, negative = false;
  for (let elapsed = 0; elapsed <= STONE_SETTLE_MS; elapsed += 4) {
    const pose = stoneLandingPose(elapsed);
    positive ||= pose.angle > .005;
    negative ||= pose.angle < -.001;
    for (const [r,y] of STONE_PROFILE) {
      for (let k = 0; k < 24; k++) {
        const rotatedY = y * Math.cos(pose.angle) + r * Math.sin(k * Math.PI / 12) * Math.sin(pose.angle);
        assert.ok(rotatedY + pose.height >= -1e-9);
      }
    }
  }
  assert.ok(positive && negative);
  assert.ok(stoneLandingPose(0).height > STONE_BOTTOM);
  assert.deepEqual(stoneLandingPose(STONE_SETTLE_MS), { angle: 0, height: STONE_BOTTOM, settled: true });
  assert.deepEqual(stoneLandingPose(5000), stoneLandingPose(STONE_SETTLE_MS));
});
