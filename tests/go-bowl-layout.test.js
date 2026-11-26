import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { GO_BOARD_TOP, configureSceneCamera, projectBounds, projectScenePoint } from "../games/go/scene-geometry.js";
import { GO_BOWL_SCALE, tableBowlPosition, bowlPickupRect, bowlStoneLayout } from "../games/go/bowl-layout.js";
import { GO_TABLE_TOP, GO_TABLE_WIDTH, GO_TABLE_DEPTH } from "../games/go/table-model.js";
import { createGoStoneGeometry } from "../games/go/stone-shape.js";

function bowlBounds(near, size = 19, color = 1, landscape = false) {
  const bounds = new Box3(new Vector3(-.47,0,-.47),new Vector3(.47,.425,.47));
  const offset = near ? -.94 : .94;
  const x = landscape ? 0 : offset, z = landscape ? offset : 0;
  bounds.union(new Box3(new Vector3(x-.36,.0008,z-.36),new Vector3(x+.36,.0872,z+.36)));
  const geometry = createGoStoneGeometry();
  geometry.computeBoundingBox();
  for (const p of bowlStoneLayout(size, color === 1 ? 233 : 89)) {
    const matrix = new Matrix4().compose(new Vector3(p.x,p.y-.025,p.z),
      new Quaternion().setFromEuler(new Euler(p.tiltX,p.turn,p.tiltZ)),new Vector3().setScalar(p.radius));
    bounds.union(geometry.boundingBox.clone().applyMatrix4(matrix));
  }
  geometry.dispose();
  bounds.min.multiplyScalar(GO_BOWL_SCALE);
  bounds.max.multiplyScalar(GO_BOWL_SCALE);
  return bounds;
}

test("fixed bowls and lids rest on the tabletop, inside its edge and clear of the board", () => {
  for (const landscape of [false,true]) for (const near of [false,true]) for (const size of [9,13,19]) for (const color of [1,2]) {
    const position=tableBowlPosition(near,landscape);
    const bounds=bowlBounds(near,size,color,landscape).translate(position);
    const width=landscape?GO_TABLE_DEPTH:GO_TABLE_WIDTH,depth=landscape?GO_TABLE_WIDTH:GO_TABLE_DEPTH;
    assert.equal(position.y,GO_TABLE_TOP);
    assert.ok(Math.abs(bounds.min.y-GO_TABLE_TOP)<1e-6);
    assert.ok(bounds.min.x>-width/2+.02 && bounds.max.x<width/2-.02);
    assert.ok(bounds.min.z>-depth/2+.02 && bounds.max.z<depth/2-.02);
    assert.ok(landscape ? (near ? bounds.min.x>.5 : bounds.max.x<-.5)
      : (near ? bounds.min.z>.5 : bounds.max.z<-.5),"no intersection with the board");
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

test("landscape cups sit near each player's table edge, preserving the lateral gap", () => {
  const camera=new PerspectiveCamera(30,1,.1,100),viewport={width:1280,height:900};
  configureSceneCamera(camera,{left:262,top:125,width:536,height:536},viewport);
  for (const near of [false,true]) {
    const direction=near?1:-1;
    const previous=new Vector3(direction*.68,GO_TABLE_TOP,direction*.12);
    const position=tableBowlPosition(near,true);
    assert.equal(position.x,previous.x,"do not move closer to the left or right table edge");
    const edgeGap=GO_TABLE_WIDTH/2-Math.abs(position.z)-GO_BOWL_SCALE*.47;
    assert.ok(Math.abs(edgeGap-.04)<1e-10,"leave about 2 cm at the player's end, not a large empty area");
    const before=projectScenePoint(previous.x,previous.y,previous.z,camera,viewport);
    const after=projectScenePoint(position.x,position.y,position.z,camera,viewport);
    assert.ok(near?after.y>before.y:after.y<before.y,"near moves down; far moves up");
  }
});

test("elevated tabletop bowls stay visible and pickable across portrait, landscape and floating windows", () => {
  const fixtures=[];
  for (const [width,height] of [[390,844],[534,850],[375,667],[414,560],[360,500]]) {
    const space={left:10,right:width-10,top:137,bottom:height-68};
    const side=Math.min((width-20)/1.32,(space.bottom-space.top)/1.85);
    fixtures.push({width,height,side,space,centerX:width/2,centerY:(space.top+space.bottom)/2});
  }
  for (const [width,height] of [[1280,900],[900,600],[1000,1200]]) {
    const side=width>height ? Math.min((height-42)/1.6,(width-244)/1.8)
      : Math.min((height-42)/1.85,(width-244)/1.32);
    fixtures.push({width,height,side,space:{left:0,right:width-220,top:0,bottom:height},
      centerX:(width-220)/2,centerY:(height-6)/2});
  }
  for (const [width,height] of [[844,390],[667,375]]) {
    const side=Math.min((height-84)/1.6,(width-300)/1.8);
    fixtures.push({width,height,side,space:{left:0,right:width-260,top:60,bottom:height},
      centerX:(width-260)/2,centerY:(60+height)/2});
  }
  for (const {width,height,side,space,centerX,centerY} of fixtures) {
    const viewport={width,height},camera=new PerspectiveCamera(30,1,.1,100);
    const landscape=width>height;
    const board={left:centerX-side/2,top:centerY-side*(landscape?.6:.66),width:side,height:side};
    configureSceneCamera(camera,board,viewport);
    const boardScreen=projectBounds(new Box3(new Vector3(-.5,GO_BOARD_TOP,-.5),
      new Vector3(.5,GO_BOARD_TOP,.5)),camera,viewport);
    for (const near of [false,true]) for (const size of [9,13,19]) for (const color of [1,2]) {
      const position=tableBowlPosition(near,landscape),before=position.clone();
      const screen=projectBounds(bowlBounds(near,size,color,landscape).translate(position),camera,viewport);
      for (const edge of ["left","top"]) assert.ok(screen[edge]>=space[edge]-.1,`${width}x${height}: ${edge}`);
      for (const edge of ["right","bottom"]) assert.ok(screen[edge]<=space[edge]+.1,`${width}x${height}: ${edge}`);
      const cup=projectScenePoint(position.x,GO_TABLE_TOP+GO_BOWL_SCALE*.4,position.z,camera,viewport);
      assert.equal(cup.x>centerX,near);
      assert.equal(cup.y>centerY-side*(landscape?.1:.16),near);
      const hit=bowlPickupRect(cup,boardScreen,space,near,landscape);
      assert.ok(hit.width>0 && hit.height>0);
      assert.ok(cup.x>=hit.left && cup.x<=hit.left+hit.width && cup.y>=hit.top && cup.y<=hit.top+hit.height,
        `${width}x${height}: pickup area follows the actual cup`);
      assert.ok(landscape ? (near ? hit.left>boardScreen.right : hit.left+hit.width<boardScreen.left)
        : (near ? hit.top>boardScreen.bottom : hit.top+hit.height<boardScreen.top),
        "expanded pickup areas never intercept board input");
      assert.deepEqual(position,before,"viewport changes never move the physical bowl");
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
