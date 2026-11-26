import test from "node:test";
import assert from "node:assert/strict";
import { goTableView } from "../games/go/table-view.js";

test("near and far ownership follows the viewing player, independently of the turn", () => {
  for (const blackIndex of [1,2]) for (const current of [1,2]) {
    const state={blackIndex,current,players:["a","b"],settings:{opponent:"ai"}};
    for (const [mode,playerId,nearColor] of [
      ["solo","a",blackIndex===1?1:2],
      ["room","a",blackIndex===1?1:2],
      ["room","b",blackIndex===2?1:2],
      ["room","spectator",1],
    ]) {
      const view=goTableView(state,{mode,playerId});
      assert.equal(view.nearColor,nearColor);
      assert.equal(view.currentColor,current===blackIndex?1:2);
      assert.equal(view.players.find(p=>p.near).color,nearColor);
      for (const p of view.players) assert.equal(p.playerIndex+1===blackIndex,p.color===1);
    }
  }
});

test("local pairs keep black near and white far through turn changes and rematches", () => {
  for (const blackIndex of [1,2]) for (const current of [1,2]) {
    const view=goTableView({blackIndex,current,players:["a","b"],settings:{opponent:"local"}},
      {mode:"solo",playerId:"a"});
    assert.equal(view.nearColor,1);
    assert.equal(view.players[0].near,true);
    assert.equal(view.players[1].near,false);
  }
});
