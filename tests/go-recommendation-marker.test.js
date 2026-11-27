import test from "node:test";
import assert from "node:assert/strict";
import { Box3 } from "three";
import { GO_BOARD_TOP, boardIntersection } from "../games/go/scene-geometry.js";
import { createGoRecommendationMarker, updateGoRecommendationMarker } from "../games/go/recommendation-marker.js";

test("the recommendation is a solid, thin disc resting on the board for every grid size",()=>{
  const marker=createGoRecommendationMarker();
  try {
    const positions=marker.geometry.attributes.position, normals=marker.geometry.attributes.normal;
    assert.ok(Array.from({length:positions.count},(_,i)=>i).some(i=>
      Math.abs(positions.getX(i))<1e-8 && Math.abs(positions.getZ(i))<1e-8 &&
      positions.getY(i)>0 && normals.getY(i)>.99),"a filled top face covers the center; this is not a ring");
    for(const size of [9,13,19]) for(const index of [0,Math.floor(size*size/2),size*size-1]) {
      updateGoRecommendationMarker(marker,index,size);marker.updateMatrixWorld(true);
      const bounds=new Box3().setFromObject(marker), point=boardIntersection(Math.floor(index/size),index%size,size);
      assert.equal(marker.visible,true);
      assert.equal(marker.position.x,point.x);assert.equal(marker.position.z,point.z);
      assert.ok(bounds.min.y>GO_BOARD_TOP+.0001,"no intersection or depth fighting with the board face");
      assert.ok(bounds.max.y-bounds.min.y<.03/size,"foil thickness, rather than a stone's domed profile");
      assert.ok(bounds.max.x-bounds.min.x>.5/size && bounds.max.x-bounds.min.x<1/size);
      assert.ok(bounds.min.x>-.5 && bounds.max.x<.5 && bounds.min.z>-.5 && bounds.max.z<.5);
    }
    for(const index of [-1,NaN,19*19,1.5]) {
      updateGoRecommendationMarker(marker,index,19);assert.equal(marker.visible,false);
    }
  } finally { marker.geometry.dispose();marker.material.dispose(); }
});
