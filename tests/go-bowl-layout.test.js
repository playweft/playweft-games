import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { configureSceneCamera, projectBounds, projectScenePoint } from "../games/go/scene-geometry.js";
import { GO_BOWL_SCALE, bowlArea, bowlPosition, bowlStoneLayout } from "../games/go/bowl-layout.js";
import { createGoStoneGeometry } from "../games/go/stone-shape.js";

function bowlBounds(near, portrait, size = 19, color = 1) {
  const bounds = new Box3(new Vector3(-.47,.025,-.47),new Vector3(.47,.45,.47));
  const x = portrait ? (near ? -.94 : .94) : -.12, z = portrait ? 0 : .9;
  bounds.union(new Box3(new Vector3(x-.36,.0008,z-.36),new Vector3(x+.36,.0872,z+.36)));
  const geometry = createGoStoneGeometry();
  geometry.computeBoundingBox();
  for (const p of bowlStoneLayout(size, color === 1 ? 233 : 89)) {
    const matrix = new Matrix4().compose(new Vector3(p.x,p.y,p.z),
      new Quaternion().setFromEuler(new Euler(p.tiltX,p.turn,p.tiltZ)),new Vector3().setScalar(p.radius));
    bounds.union(geometry.boundingBox.clone().applyMatrix4(matrix));
  }
  geometry.dispose();
  bounds.min.multiplyScalar(GO_BOWL_SCALE);
  bounds.max.multiplyScalar(GO_BOWL_SCALE);
  return bounds;
}

test("portrait fits the whole scene proportionally, including short floating windows", () => {
  for (const [width,height] of [[390,844],[534,850],[375,667],[414,560],[360,500]]) {
    const viewport={width,height}, space={left:10,right:width-10,top:137,bottom:height-68};
    const side=Math.min(width-56,(space.bottom-space.top)/1.8);
    const board={left:(width-side)/2,right:(width+side)/2,
      top:(space.top+space.bottom-side)/2,width:side,height:side};
    const camera=new PerspectiveCamera(30,1,.1,100);
    configureSceneCamera(camera,board,viewport);
    const table=projectBounds(new Box3(new Vector3(-.623,.0475,-.573),
      new Vector3(.623,.1075,.573)),camera,viewport);
    for (const near of [false,true]) for (const size of [9,13,19]) for (const color of [1,2]) {
      const bounds=bowlBounds(near,true,size,color);
      const area=bowlArea({board,table,space,near,portrait:true});
      const position=bowlPosition(bounds,area,camera,viewport,{near,portrait:true});
      const screen=projectBounds(bounds.clone().translate(position),camera,viewport);
      assert.ok(Math.abs(position.y)<1e-9,"cup and lid stay on the floor");
      for (const edge of ["left","top"]) assert.ok(screen[edge]>=area[edge]-.1,
        `${width}x${height}, ${size}, near=${near}: ${edge} ${screen[edge]} >= ${area[edge]}`);
      for (const edge of ["right","bottom"]) assert.ok(screen[edge]<=area[edge]+.1,
        `${width}x${height}, ${size}, near=${near}: ${edge} ${screen[edge]} <= ${area[edge]}`);
      const cup=projectScenePoint(position.x,GO_BOWL_SCALE*.4,position.z,camera,viewport);
      assert.equal(cup.y>(space.top+space.bottom)/2,near);
    }
    if (height<=560) assert.ok(side>=(space.bottom-space.top)*.55,"short windows do not lose fixed-height bands");
  }
});

test("bowl piles use fixed physical dimensions for each board size", () => {
  const small=bowlStoneLayout(19), large=bowlStoneLayout(9);
  assert.ok(large.length<small.length);
  for (const size of [9,13,19]) {
    const radius=.435/size/GO_BOWL_SCALE, stones=bowlStoneLayout(size);
    assert.ok(stones.length>0 && stones.length<=128);
    assert.ok(stones.some(p=>Math.hypot(p.x,p.z)<radius*.5), "cover the well's center");
    assert.ok(new Set(stones.map(p=>p.y)).size>1, "stagger two layers to cover gaps");
    for (const p of stones) {
      assert.equal(p.radius,radius);
      assert.ok(Math.abs(p.radius*GO_BOWL_SCALE-.435/size)<1e-10, "same world radius as board stones");
      assert.ok(Math.hypot(p.x,p.z)+radius<=.45);
    }
  }
});

test("landscape keeps far upper-left and near lower-right; cards only act as obstacles", () => {
  for (const [width,height,side,centerX,top,panelLeft,desktop] of [
    [1280,900,545,530,177.5,1060,true],
    [900,600,345,340,127.5,680,true],
    [844,390,278,292,86,584,false],
    [667,375,193,203.5,95.5,407,false],
  ]) {
    const viewport={width,height}, camera=new PerspectiveCamera(30,1,.1,100);
    const board={left:centerX-side/2,right:centerX+side/2,top,width:side,height:side};
    configureSceneCamera(camera,board,viewport);
    const table=projectBounds(new Box3(new Vector3(-.623,.0475,-.573),
      new Vector3(.623,.1075,.573)),camera,viewport);
    const space={left:0,right:panelLeft,top:desktop?0:60,bottom:height};
    const obstacles=desktop ? [
      {left:10,right:200,top:18,bottom:168},
      {left:panelLeft-200,right:panelLeft-10,top:height-174,bottom:height-24},
    ] : [
      {left:panelLeft,right:width,top:72,bottom:140},
      {left:panelLeft,right:width,top:152,bottom:220},
    ];
    for (const near of [false,true]) for (const size of [9,13,19]) for (const color of [1,2]) {
      const bounds=bowlBounds(near,false,size,color),original=bounds.clone();
      const area=bowlArea({board,table,space,near,portrait:false,obstacles});
      const position=bowlPosition(bounds,area,camera,viewport,{near,portrait:false});
      const screen=projectBounds(bounds.clone().translate(position),camera,viewport);
      assert.deepEqual(bounds,original,"placing a bowl never changes its dimensions");
      for (const edge of ["left","top"]) assert.ok(screen[edge]>=area[edge]-.1,`${width}, ${size}, near=${near}: ${edge}`);
      for (const edge of ["right","bottom"]) assert.ok(screen[edge]<=area[edge]+.1,`${width}, ${size}, near=${near}: ${edge}`);
      const cup=projectScenePoint(position.x,GO_BOWL_SCALE*.4,position.z,camera,viewport);
      assert.equal(cup.x>centerX,near);
      assert.equal(cup.y>(table.top+table.bottom)/2,near,"the near cup must not jump to the upper-right");
    }
  }
});

test("piles have varied heights and tilts, staying stable between renders and distinct between bowls", () => {
  const a=bowlStoneLayout(19,89), b=bowlStoneLayout(19,233);
  assert.deepEqual(a,bowlStoneLayout(19,89));
  assert.notDeepEqual(a,b);
  assert.ok(new Set(a.map(p=>p.y)).size>a.length/2);
  assert.ok(new Set(a.map(p=>p.tiltX)).size>a.length/2);
});
