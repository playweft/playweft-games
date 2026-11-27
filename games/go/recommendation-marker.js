import { LatheGeometry, Mesh, MeshStandardMaterial, Vector2 } from "three";
import { GO_BOARD_TOP, boardIntersection } from "./scene-geometry.js";

export function createGoRecommendationMarker(environment) {
  const profile=[[0,-.025],[.93,-.025],[1,-.008],[1,.008],[.93,.025],[0,.025]];
  const geometry=new LatheGeometry(profile.map(([r,y])=>new Vector2(r,y)),48);
  geometry.normalizeNormals();
  const marker=new Mesh(geometry,new MeshStandardMaterial({
    color:"#c99122",metalness:.8,roughness:.32,
    ...(environment ? {envMap:environment,envMapIntensity:.7} : {}),
  }));
  marker.visible=false;
  marker.receiveShadow=true;
  return marker;
}

export function updateGoRecommendationMarker(marker,index,size) {
  marker.visible=[9,13,19].includes(size) && Number.isInteger(index) && index>=0 && index<size*size;
  if (!marker.visible) return;
  const radius=.34/size, position=boardIntersection(Math.floor(index/size),index%size,size);
  marker.scale.setScalar(radius);
  // The solid foil rests just above the board face, avoiding depth flicker.
  marker.position.set(position.x,GO_BOARD_TOP+.0002+.025*radius,position.z);
}
