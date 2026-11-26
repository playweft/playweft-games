import test from "node:test";
import assert from "node:assert/strict";
import { Box3, MeshStandardMaterial, PerspectiveCamera } from "three";
import { createGoTable, GO_TABLE_TOP, GO_TABLE_WIDTH, GO_TABLE_DEPTH } from "../games/go/table-model.js";
import { GO_BOARD_TOP, configureSceneCamera, projectScenePoint } from "../games/go/scene-geometry.js";

test("the high table has four floor-contact legs, supporting aprons and a thin tabletop", () => {
  const material=new MeshStandardMaterial(),table=createGoTable(material);
  const legs=table.children.filter(part=>part.name==="leg");
  assert.equal(legs.length,4);
  assert.equal(table.children.filter(part=>part.name==="apron").length,4);
  assert.ok(GO_TABLE_TOP>1.5,"height is comparable to a chair-height table, not a floor tray");
  const top=new Box3().setFromObject(table.getObjectByName("tabletop"));
  assert.ok(Math.abs(top.max.y-GO_TABLE_TOP)<1e-6);
  assert.ok(Math.abs(top.max.y-top.min.y-.06)<1e-6);
  assert.ok(Math.abs((GO_BOARD_TOP-.026)-top.max.y)<1e-6,"board rests on the tabletop");
  for (const leg of legs) {
    const box=new Box3().setFromObject(leg);
    assert.ok(Math.abs(box.min.y)<1e-6,"each foot touches the ground");
    assert.ok(Math.abs(box.max.y-top.min.y)<1e-6,"each leg supports the tabletop");
    assert.ok(Math.abs(leg.position.x)<GO_TABLE_WIDTH/2);
    assert.ok(Math.abs(leg.position.z)<GO_TABLE_DEPTH/2);
  }
  const geometries=new Set(table.children.map(part=>part.geometry));
  geometries.forEach(geometry=>geometry.dispose());material.dispose();
});

test("the near feet project below the tabletop silhouette, making its height visible", () => {
  const camera=new PerspectiveCamera(30,1,.1,100),viewport={width:390,height:844};
  configureSceneCamera(camera,{left:55,top:270,width:280,height:280},viewport);
  for (const x of [-.53,.53]) {
    const foot=projectScenePoint(x,0,.72,camera,viewport);
    const edge=projectScenePoint(x,GO_TABLE_TOP,GO_TABLE_DEPTH/2,camera,viewport);
    assert.ok(foot.y-edge.y>30,"visible leg length comes from real elevation and perspective");
  }
});

test("turning the furniture swaps its long side without changing height or scale", () => {
  const material=new MeshStandardMaterial(),table=createGoTable(material);
  const before=new Box3().setFromObject(table);
  table.rotation.y=Math.PI/2;
  const after=new Box3().setFromObject(table);
  assert.ok(Math.abs((after.max.x-after.min.x)-(before.max.z-before.min.z))<1e-6);
  assert.ok(Math.abs((after.max.z-after.min.z)-(before.max.x-before.min.x))<1e-6);
  assert.equal(after.min.y,before.min.y);
  assert.equal(after.max.y,before.max.y);
  assert.equal(table.scale.x,1);
  assert.equal(table.scale.y,1);
  assert.equal(table.scale.z,1);
  new Set(table.children.map(part=>part.geometry)).forEach(geometry=>geometry.dispose());
  material.dispose();
});
