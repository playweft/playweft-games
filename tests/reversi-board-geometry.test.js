import assert from "node:assert/strict";
import test from "node:test";
import { createBoardGeometry, discPoint, flipPose, HALF_THICKNESS } from "../games/reversi/board-geometry.js";

const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
const inside = (point, corners) => corners.every((a,i) => {
  const b = corners[(i+1)%corners.length];
  return (b.x-a.x)*(point.y-a.y) - (b.y-a.y)*(point.x-a.x) >= -1e-8;
});

test("Reversi perspective keeps every clickable square inside the stage at narrow and wide aspect ratios", () => {
  for (const [width,height] of [[390,560],[296,380],[804,220],[860,580]]) {
    const view = createBoardGeometry(width,height);
    for (let index=0;index<64;index++) {
      const cell = view.cell(index);
      for (const p of cell.corners) assert.ok(p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height);
      assert.ok(inside(view.project(cell.x,cell.y),cell.corners));
      // Native button clicks use the bounding box center, which must hit the clipped polygon.
      const xs=cell.corners.map(p=>p.x), ys=cell.corners.map(p=>p.y);
      assert.ok(inside({x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2},cell.corners));
    }
    const far=view.cell(0).corners, close=view.cell(56).corners;
    assert.ok(far[1].x-far[0].x < close[2].x-close[3].x);
  }
});

test("Reversi flip begins and ends with the correct face at the same height", () => {
  const center={x:12,y:-18}, radius=30;
  const start=flipPose(0,Math.PI,0,radius), end=flipPose(0,Math.PI,1,radius);
  const black=discPoint(center,radius,start.angle,start.lift,0,HALF_THICKNESS);
  const white=discPoint(center,radius,end.angle,end.lift,Math.PI,-HALF_THICKNESS);
  near(black.x,white.x); near(black.y,white.y); near(black.z,6); near(white.z,6);
  near(flipPose(Math.PI,Math.PI*2,1,radius).angle,Math.PI*2);
});

test("Reversi discs lift above the board throughout both forward and interrupted reverse flips", () => {
  for (const radius of [12,35,60]) for (const [from,to] of [[0,Math.PI],[Math.PI,Math.PI*2],[.9,0],[4.2,Math.PI]]) {
    for (let step=0;step<=40;step++) {
      const pose=flipPose(from,to,step/40,radius);
      for (let side=0;side<32;side++) for (const z of [-HALF_THICKNESS,HALF_THICKNESS]) {
        const p=discPoint({x:0,y:0},radius,pose.angle,pose.lift,side*Math.PI/16,z);
        assert.ok(p.z>=-1e-8, `rim crossed the board at ${pose.angle}`);
      }
    }
  }
});

test("Reversi flip progress clamps to settled poses and does not change the true circular face", () => {
  const center={x:9,y:7}, radius=22;
  near(flipPose(0,Math.PI,-1,radius).angle,0);
  near(flipPose(0,Math.PI,2,radius).angle,Math.PI);
  for (let i=0;i<48;i++) {
    const p=discPoint(center,radius,0,HALF_THICKNESS,i*Math.PI/24,HALF_THICKNESS);
    near(Math.hypot(p.x-center.x,p.y-center.y),radius);
  }
});
