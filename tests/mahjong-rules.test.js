import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const PLAYER_TABLE = `{
  { id = "p1", name = "Human", seat = 1 },
  { id = "p2", name = "AI 1", seat = 2 },
  { id = "p3", name = "AI 2", seat = 3 },
  { id = "p4", name = "AI 3", seat = 4 }
}`;

async function runScenario(scenario) {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

test("Mahjong deals one deterministic complete 136-tile set", async () => {
  const result = await runScenario(`
    first = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000002a" } })
    second = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000002a" } })
    seen = {}
    duplicate = false
    total = 0
    for _, tile in ipairs(first.wall) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, tile in ipairs(first.deadWall) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, tile in ipairs(first.rinshan) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, player_id in ipairs(first.players) do
      for _, tile in ipairs(first.hands[player_id]) do
        total = total + 1
        if seen[tile] then duplicate = true end
        seen[tile] = true
      end
    end
    total = total + 1
    if seen[first.drawnTile] then duplicate = true end
    seen[first.drawnTile] = true
    result = {
      total = total,
      duplicate = duplicate,
      wall = #first.wall,
      handCounts = {
        #first.hands.p1, #first.hands.p2, #first.hands.p3, #first.hands.p4,
      },
      deterministic = first.hands.p1[1] == second.hands.p1[1]
        and first.wall[#first.wall] == second.wall[#second.wall],
    }
  `);

  assert.equal(result.total, 136);
  assert.equal(result.duplicate, false);
  assert.equal(result.wall, 69);
  assert.deepEqual(result.handCounts, [13, 13, 13, 13]);
  assert.equal(result.deterministic, true);
});

test("Mahjong draws seats deterministically and can assign every initial wind", async () => {
  const result = await runScenario(`
    local first = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000002a" } })
    local second = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000002a" } })
    local east_seats = {}
    for seed = 1, 32 do
      local state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = string.format("%032x", seed) } })
      east_seats[state.dealerIndex] = true
    end
    local covered = 0
    for seat = 1, 4 do if east_seats[seat] then covered = covered + 1 end end
    result = {
      dealer = first.dealerIndex,
      deterministic = first.dealerIndex == second.dealerIndex,
      covered = covered,
    }
  `);

  assert.ok(result.dealer >= 1 && result.dealer <= 4);
  assert.equal(result.deterministic, true);
  assert.equal(result.covered, 4);
});

test("Mahjong rematches advance the match draw for new seat assignments", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000002a" } })
    local dealers = {}
    local seeds = {}
    for index = 1, 5 do
      state.phase, state.matchEnded = "hand_ended", false
      local rematch = on_action(state, { type = "new_match" }, { actor = { id = "p1" } })
      state = rematch.state
      dealers[state.dealerIndex] = true
      seeds[#seeds + 1] = state.seed
    end
    local dealerCount = 0
    for _ in pairs(dealers) do dealerCount = dealerCount + 1 end
    result = { dealerCount = dealerCount, seedChanged = seeds[1] ~= seeds[2] }
  `);

  assert.ok(result.dealerCount >= 2);
  assert.equal(result.seedChanged, true);
});

test("Mahjong view reveals only the viewer's concealed hand", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000007" } })
    result = view(state, {}, {
      viewer = { id = "p2", seat = 2, role = "player", isOwner = false }
    }).state
  `);

  assert.equal(result.ownHand.length, 13);
  assert.equal(result.handCounts.p1, 13);
  assert.equal(result.handCounts.p2, 13);
  assert.equal(result.drawnPlayerIndex, result.dealerIndex);
  assert.equal("hands" in result, false);
  assert.deepEqual(result.legalActions.claims, {});
});

test("Mahjong keeps the pending claim respondent private from other players", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000008" } })
    state.phase, state.claimIndex = "claiming", 1
    state.claimants = {
      { playerId = "p2", playerIndex = 2, options = { { kind = "pon", tileIds = { 1, 2 } } } }
    }
    local private_event = { type = "claim_passed", player = "p2", playerIndex = 2 }
    local observer_projection = view(state, { private_event }, { viewer = { id = "p1", seat = 1 } })
    local observer = observer_projection.state
    local respondent = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    result = {
      observerResponseIndex = observer.responseIndex,
      observerClaims = #observer.legalActions.claims,
      observerEvents = #observer_projection.events,
      respondentResponseIndex = respondent.responseIndex,
      respondentClaims = #respondent.legalActions.claims,
    }
  `);

  assert.equal(result.observerResponseIndex, 0);
  assert.equal(result.observerClaims, 0);
  assert.equal(result.observerEvents, 0);
  assert.equal(result.respondentResponseIndex, 2);
  assert.equal(result.respondentClaims, 1);
});

test("Mahjong opens every private claim window on the discard frame", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000051" } })
    state.phase, state.claimIndex = "claiming", 1
    state.claimResponses = {}
    state.claimants = {
      { playerId = "p2", playerIndex = 2, distance = 1,
        options = { { kind = "chi", tileIds = { 5, 9 } } } },
      { playerId = "p3", playerIndex = 3, distance = 2,
        options = { { kind = "pon", tileIds = { 2, 3 } } } },
    }
    local p1 = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state
    local p2 = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    local p3 = view(state, {}, { viewer = { id = "p3", seat = 3 } }).state
    result = {
      observerClaims = #p1.legalActions.claims,
      p2ResponseIndex = p2.responseIndex,
      p2Kind = p2.legalActions.claims[1].kind,
      p3ResponseIndex = p3.responseIndex,
      p3Kind = p3.legalActions.claims[1].kind,
    }
  `);

  assert.deepEqual(result, {
    observerClaims: 0,
    p2ResponseIndex: 2,
    p2Kind: "chi",
    p3ResponseIndex: 3,
    p3Kind: "pon",
  });
});

test("Mahjong cancels lower claim windows and resolves a higher claim immediately", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000052" } })
    state.phase, state.claimIndex = "claiming", 1
    state.claimResponses = {}
    state.discards.p1 = { { tile = 1, claimed = false } }
    state.lastDiscard = {
      player = "p1", playerIndex = 1, tile = 1, discardIndex = 1,
    }
    state.hands.p2 = { 2,3, 13,17,21,25,29,33,37,41,45,49,53 }
    state.hands.p3 = { 5,9, 13,17,21,25,29,33,37,41,45,49,53 }
    state.claimants = {
      { playerId = "p2", playerIndex = 2, distance = 1,
        options = { { kind = "pon", tileIds = { 2, 3 } } } },
      { playerId = "p3", playerIndex = 3, distance = 2,
        options = { { kind = "chi", tileIds = { 5, 9 } } } },
    }

    local claimed = on_action(
      state, { type = "claim", option = 1 }, { actor = { id = "p2" } }
    )
    local cancelled = on_action(
      claimed.state, { type = "claim", option = 1 }, { actor = { id = "p3" } }
    )
    result = {
      accepted = claimed.accepted,
      phase = claimed.state.phase,
      turnIndex = claimed.state.turnIndex,
      meldKind = claimed.state.melds.p2[1].kind,
      discardClaimed = claimed.state.discards.p1[1].claimed,
      lowerRejected = not cancelled.accepted,
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    phase: "playing",
    turnIndex: 2,
    meldKind: "pon",
    discardClaimed: true,
    lowerRejected: true,
  });
});

test("Mahjong waits for unresolved claims of the same or higher priority", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000053" } })
    state.phase, state.claimIndex = "claiming", 1
    state.claimResponses = {}
    state.discards.p1 = { { tile = 1, claimed = false } }
    state.lastDiscard = {
      player = "p1", playerIndex = 1, tile = 1, discardIndex = 1,
    }
    state.hands.p2 = { 2,3, 13,17,21,25,29,33,37,41,45,49,53 }
    state.hands.p3 = { 5,9, 13,17,21,25,29,33,37,41,45,49,53 }
    state.claimants = {
      { playerId = "p2", playerIndex = 2, distance = 1,
        options = { { kind = "pon", tileIds = { 2, 3 } } } },
      { playerId = "p3", playerIndex = 3, distance = 2,
        options = { { kind = "chi", tileIds = { 5, 9 } } } },
    }

    local lower = on_action(
      state, { type = "claim", option = 1 }, { actor = { id = "p3" } }
    )
    local p2 = view(lower.state, lower.events, {
      viewer = { id = "p2", seat = 2 },
    }).state
    local intermediate_phase = lower.state.phase
    local higher = on_action(
      lower.state, { type = "pass" }, { actor = { id = "p2" } }
    )
    result = {
      intermediatePhase = intermediate_phase,
      higherStillAsked = p2.legalActions.claims[1].kind,
      finalPhase = higher.state.phase,
      finalTurnIndex = higher.state.turnIndex,
      meldKind = higher.state.melds.p3[1].kind,
    }
  `);

  assert.deepEqual(result, {
    intermediatePhase: "claiming",
    higherStillAsked: "pon",
    finalPhase: "playing",
    finalTurnIndex: 3,
    meldKind: "chi",
  });
});

test("Mahjong stores the current draw outside the fixed concealed rack", async () => {
  const result = await runScenario(`
    local base_rack = { 109,5,9,13,17,21,25,29,33,37,41,45,49 }
    local harmless = { 1,5,9,13,17,21,25,29,33,37,41,45,49 }

    local tedashi = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000049" } })
    tedashi.hands.p1 = copy_array(base_rack)
    tedashi.hands.p2, tedashi.hands.p3, tedashi.hands.p4 =
      copy_array(harmless), copy_array(harmless), copy_array(harmless)
    tedashi.turnIndex, tedashi.drawnTile = 1, 53
    local tedashi_result = on_action(tedashi, { type = "discard", tileId = 109 }, { actor = { id = "p1" } })
    tedashi = tedashi_result.state
    local opponent_projection = view(tedashi, tedashi_result.events, {
      viewer = { id = "p2", seat = 2, role = "player", isOwner = false }
    })

    local tsumogiri = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000004a" } })
    tsumogiri.hands.p1 = copy_array(base_rack)
    tsumogiri.hands.p2, tsumogiri.hands.p3, tsumogiri.hands.p4 =
      copy_array(harmless), copy_array(harmless), copy_array(harmless)
    tsumogiri.turnIndex, tsumogiri.drawnTile = 1, 53
    local before = table.concat(tsumogiri.hands.p1, ",")
    local tsumogiri_result = on_action(tsumogiri, { type = "discard", tileId = 53 }, { actor = { id = "p1" } })
    tsumogiri = tsumogiri_result.state

    local function contains(hand, tile)
      for _, candidate in ipairs(hand) do if candidate == tile then return true end end
      return false
    end
    result = {
      tedashiAccepted = tedashi_result.accepted,
      tedashiFromDrawn = tedashi_result.events[1].fromDrawn,
      projectedDiscardType = opponent_projection.events[1].tile,
      projectedFromDrawn = opponent_projection.events[1].fromDrawn,
      projectedTileIdHidden = opponent_projection.events[1].tileId == nil,
      projectedHandIndexHidden = opponent_projection.events[1].handIndex == nil,
      tedashiRackCount = #tedashi.hands.p1,
      tedashiIntegratedDraw = contains(tedashi.hands.p1, 53),
      tedashiRemovedDiscard = not contains(tedashi.hands.p1, 109),
      nextRackCount = #tedashi.hands.p2,
      nextDrawSeparated = tedashi.turnIndex == 2 and tedashi.drawnTile > 0,
      tsumogiriAccepted = tsumogiri_result.accepted,
      tsumogiriFromDrawn = tsumogiri_result.events[1].fromDrawn,
      tsumogiriRackUnchanged = before == table.concat(tsumogiri.hands.p1, ","),
    }
  `);

  assert.deepEqual(result, {
    tedashiAccepted: true,
    tedashiFromDrawn: false,
    projectedDiscardType: 28,
    projectedFromDrawn: false,
    projectedTileIdHidden: true,
    projectedHandIndexHidden: true,
    tedashiRackCount: 13,
    tedashiIntegratedDraw: true,
    tedashiRemovedDiscard: true,
    nextRackCount: 13,
    nextDrawSeparated: true,
    tsumogiriAccepted: true,
    tsumogiriFromDrawn: true,
    tsumogiriRackUnchanged: true,
  });
});

test("Mahjong projects waits and remaining copies for every tenpai discard", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function discard_option(legal, tile_id)
      for _, option in ipairs(legal.tenpaiDiscards) do
        if option.tileId == tile_id then return option end
      end
      return nil
    end

    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000054" } })
    local ready = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28,28 })
    state.drawnTile, state.turnIndex = table.remove(ready), 1
    state.hands.p1 = ready
    state.deadWall[1] = 133
    state.discards.p2 = { { tile = 111, claimed = true } }
    state.melds.p3 = {
      { kind = "pon", tiles = { 111 }, calledTile = 111, fromIndex = 2 },
    }

    local one_left = discard_option(legal_actions(state, "p1"), 110)
    state.discards.p4 = { { tile = 112, claimed = false } }
    local exhausted = discard_option(legal_actions(state, "p1"), 110)
    result = {
      waitType = one_left.waits[1].type,
      remaining = one_left.waits[1].remaining,
      exhaustedRemaining = exhausted.waits[1].remaining,
      claimedTileNotDoubleCounted = one_left.waits[1].remaining == 1,
    }
  `);

  assert.deepEqual(result, {
    waitType: 28,
    remaining: 1,
    exhaustedRemaining: 0,
    claimedTileNotDoubleCounted: true,
  });
});

test("Mahjong marks waits that have no yaku on ron", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function discard_option(legal, tile_id)
      for _, option in ipairs(legal.tenpaiDiscards) do
        if option.tileId == tile_id then return option end
      end
      return nil
    end

    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000055" } })
    state.dealerIndex = 1
    state.hands.p1 = ids({ 1,1,1, 11,11,11, 3,4,5, 30,30,31,31 })
    state.drawnTile, state.turnIndex = 25, 1
    state.scores[1] = 0
    local option = discard_option(legal_actions(state, "p1"), 25)
    local waits = {}
    for _, wait in ipairs(option.waits) do
      waits[wait.type] = wait.noYaku
    end
    state.scores[1] = 25000
    local riichi_legal = legal_actions(state, "p1")
    local riichi_option = discard_option(riichi_legal, 25)
    state.riichi.p1 = true
    local declared_riichi_option = discard_option(legal_actions(state, "p1"), 25)
    state.drawnTile = 117
    result = {
      ronWindHasNoYaku = waits[30] == true,
      riichiCandidateStillHasNoYaku = riichi_option.waits[1].noYaku == true,
      declaredRiichiWaitHasYaku = declared_riichi_option.waits[1].noYaku == false,
      riichiAvailable = #riichi_legal.riichiTiles > 0,
      tsumoWindCanWin = legal_actions(state, "p1").canTsumo == true,
    }
  `);

  assert.deepEqual(result, {
    ronWindHasNoYaku: true,
    riichiCandidateStillHasNoYaku: true,
    declaredRiichiWaitHasYaku: true,
    riichiAvailable: true,
    tsumoWindCanWin: true,
  });
});

test("Mahjong records each exhaustive-draw tenpai player's waiting tile types", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000055" } })
    state.hands.p1 = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.hands.p2, state.hands.p3, state.hands.p4 = {}, {}, {}
    finish_exhaustive_draw(state)
    result = {
      tenpai = state.result.tenpai,
      firstWaits = state.result.tenpaiWaits[1],
      secondWaits = state.result.tenpaiWaits[2],
    }
  `);

  assert.deepEqual(result, {
    tenpai: [true, false, false, false],
    firstWaits: [28],
    secondWaits: {},
  });
});

test("Mahjong uses a matching late-wall declaration and falls back only for an invalid player report", async () => {
  const result = await runScenario(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local function report_key(hand)
      local hand_counts, meld_counts = {}, {}
      for kind = 1, 34 do hand_counts[kind], meld_counts[kind] = 0, 0 end
      for _, tile in ipairs(hand) do
        local kind = math.floor((tile - 1) / 4) + 1
        hand_counts[kind] = hand_counts[kind] + 1
      end
      return table.concat(hand_counts, ",") .. ":" .. table.concat(meld_counts, ",")
    end

    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000056" } })
    local waiting_hand = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.hands.p1 = waiting_hand
    state.hands.p2 = {}
    state.hands.p3 = waiting_hand
    state.hands.p4 = {}
    state.tenpaiReports = {
      p1 = { key = report_key(waiting_hand), tenpai = false },
      p3 = { key = "stale", tenpai = false },
    }
    finish_exhaustive_draw(state)
    result = {
      tenpai = state.result.tenpai,
      p3Waits = state.result.tenpaiWaits[3],
    }
  `);

  assert.deepEqual(result, {
    tenpai: [false, false, true, false],
    p3Waits: [28],
  });
});

test("Mahjong derives the same waits as complete structural validation", async () => {
  const result = await runScenario(`
    local function same_types(left, right)
      if #left ~= #right then return false end
      for index = 1, #left do
        if left[index] ~= right[index] then return false end
      end
      return true
    end

    local function reference_waits(hand, melds)
      local result, counts, locked_counts = {}, type_counts(hand), type_counts(hand)
      for _, meld in ipairs(melds or {}) do
        for _, tile in ipairs(meld.tiles or {}) do
          local kind = tile_type(tile)
          locked_counts[kind] = locked_counts[kind] + 1
        end
      end
      for kind = 1, 34 do
        if locked_counts[kind] < 4 then
          local candidate = copy_array(hand)
          candidate[#candidate + 1] = (kind - 1) * 4 + 1
          if is_structural_win(candidate, melds) then
            result[#result + 1] = kind
          end
        end
      end
      return result
    end

    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    local function any_wait_matches(hand, melds)
      local full, any = waiting_types(hand, melds), waiting_types(hand, melds, "any")
      if #full == 0 then return #any == 0 end
      for _, kind in ipairs(full) do
        if kind == any[1] then return #any == 1 end
      end
      return false
    end

    local checked, matched, any_matched = 0, true, true
    for seed = 1, 80 do
      local state = setup({
        players = ${PLAYER_TABLE},
        match = { randomSeed = string.format("%032x", seed) },
      })
      for seat = 2, 4 do
        local player_id = state.players[seat]
        checked = checked + 1
        if not same_types(
          waiting_types(state.hands[player_id], state.melds[player_id]),
          reference_waits(state.hands[player_id], state.melds[player_id])
        ) then
          matched = false
        end
        any_matched = any_matched and any_wait_matches(state.hands[player_id], state.melds[player_id])
      end
    end

    local opened_melds = { { kind = "chi", tiles = ids({ 1, 2, 3 }) } }
    local opened_hand = ids({ 4,5,6, 10,11,12, 19,20,21, 28 })
    checked = checked + 1
    matched = matched and same_types(
      waiting_types(opened_hand, opened_melds),
      reference_waits(opened_hand, opened_melds)
    )
    any_matched = any_matched and any_wait_matches(opened_hand, opened_melds)
    for _, hand in ipairs({
      ids({ 1,1, 2,2, 3,3, 4,4, 5,5, 6,6, 7 }),
      ids({ 1,9,10,18,19,27,28,29,30,31,32,33,34 }),
    }) do
      checked = checked + 1
      matched = matched and same_types(waiting_types(hand, {}), reference_waits(hand, {}))
      any_matched = any_matched and any_wait_matches(hand, {})
    end

    result = { checked = checked, matched = matched, any_matched = any_matched }
  `);

  assert.ok(result.checked > 0);
  assert.equal(result.matched, true);
  assert.equal(result.any_matched, true);
});

test("Mahjong keeps tenpai when one suit can be read two ways", async () => {
  const result = await runScenario(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    -- Two open pons plus 4p, red 5p, 6s6s6s, 7s8s; the drawn 3s is the only
    -- tenpai discard, waiting on 3p and 6p.
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000061" } })
    state.hands.p1 = ids({ 13, 14, 24, 24, 24, 25, 26 })
    state.melds.p1 = {
      { kind = "pon", tiles = ids({ 4, 4, 4 }), calledTile = 15, fromIndex = 2 },
      { kind = "pon", tiles = ids({ 8, 8, 8 }), calledTile = 31, fromIndex = 3 },
    }
    state.turnIndex, state.drawnTile, state.drawnPlayerIndex = 1, ids({ 21 })[1], 1

    local waits = waiting_types(state.hands.p1, state.melds.p1)
    local options = tenpai_discard_waits(state, "p1")

    result = { waits = waits, options = options }
  `);

  assert.deepEqual(result.waits, [12, 15]);
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].tileId, 81);
  assert.deepEqual(result.options[0].waits, [12, 15]);
});

test("Mahjong derives the same waits for open hands with two fixed groups", async () => {
  const result = await runScenario(`
    local function same_types(left, right)
      if #left ~= #right then return false end
      for index = 1, #left do
        if left[index] ~= right[index] then return false end
      end
      return true
    end

    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    local function reference_waits(hand, melds)
      local result, locked_counts = {}, type_counts(hand)
      for _, meld in ipairs(melds or {}) do
        for _, tile in ipairs(meld.tiles or {}) do
          local kind = tile_type(tile)
          locked_counts[kind] = locked_counts[kind] + 1
        end
      end
      for kind = 1, 34 do
        if locked_counts[kind] < 4 then
          local candidate = copy_array(hand)
          candidate[#candidate + 1] = (kind - 1) * 4 + 1
          if is_structural_win(candidate, melds) then
            result[#result + 1] = kind
          end
        end
      end
      return result
    end

    local melds = {
      { kind = "pon", tiles = ids({ 4, 4, 4 }), fromIndex = 2 },
      { kind = "pon", tiles = ids({ 8, 8, 8 }), fromIndex = 3 },
    }
    local pool = { 13, 14, 15, 24, 25, 26, 28 }
    local pool_counts = {}
    for _, kind in ipairs(pool) do pool_counts[kind] = 0 end

    local checked, matched = 0, true
    local function evaluate()
      local hand = {}
      for _, kind in ipairs(pool) do
        for _ = 1, pool_counts[kind] do hand[#hand + 1] = kind end
      end
      local tiles = ids(hand)
      checked = checked + 1
      matched = matched and same_types(waiting_types(tiles, melds), reference_waits(tiles, melds))
    end

    local function walk(index, remaining)
      if index > #pool then
        if remaining == 0 then evaluate() end
        return
      end
      for take = 0, math.min(4, remaining) do
        pool_counts[pool[index]] = take
        walk(index + 1, remaining - take)
      end
      pool_counts[pool[index]] = 0
    end

    walk(1, 7)
    result = { checked = checked, matched = matched }
  `);

  assert.ok(result.checked > 1000);
  assert.equal(result.matched, true);
});

test("Mahjong terminal view reveals tile faces and red-five identity", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000007" } })
    state.phase, state.winningTile = "hand_ended", 17
    state.deadWall[1], state.deadWall[2] = 17, 21
    state.hands.p2 = { 17, 18, 21 }
    result = view(state, {}, {
      viewer = { id = "p1", seat = 1, role = "player", isOwner = true }
    }).state
  `);

  assert.deepEqual(result.revealedHands.p2, [
    { type: 5, red: true },
    { type: 5, red: false },
    { type: 6, red: false },
  ]);
  assert.equal(result.winningTile, 5);
  assert.equal(result.winningTileRed, true);
  assert.deepEqual(result.doraIndicatorTiles, [{ type: 5, red: true }]);
  assert.deepEqual(result.uraDoraIndicatorTiles, [{ type: 6, red: false }]);
});

test("Mahjong chi options distinguish red fives without duplicating identical copies", async () => {
  const result = await runScenario(`
    local options = chi_options({ 5, 9, 10, 17, 18, 21 }, 4)
    local state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000009" } })
    state.hands.p2 = { 5, 9, 10, 17, 18, 21 }
    state.phase, state.claimIndex = "claiming", 1
    state.lastDiscard = { player = "p1", playerIndex = 1, tile = 13, discardIndex = 1 }
    state.claimants = { { playerId = "p2", playerIndex = 2, options = options } }
    local projected = legal_actions(state, "p2").claims
    result = {
      count = #options,
      ids = {},
      projectedCount = #projected,
      normalFiveRed = projected[2].red,
      redFiveRed = projected[3].red,
      redFiveTypes = projected[3].tileTypes,
    }
    for _, option in ipairs(options) do
      result.ids[#result.ids + 1] = option.tileIds
    end
  `);

  assert.equal(result.count, 5);
  assert.deepEqual(result.ids, [
    [5, 9],
    [9, 18],
    [9, 17],
    [18, 21],
    [17, 21],
  ]);
  assert.equal(result.projectedCount, 5);
  assert.deepEqual(result.normalFiveRed, [false, false]);
  assert.deepEqual(result.redFiveRed, [false, true]);
  assert.deepEqual(result.redFiveTypes, [3, 5]);
});

test("Mahjong pon options let players keep or use a red five", async () => {
  const result = await runScenario(`
    local options = pon_options({ 17, 18, 19, 25, 29 }, 5)
    local state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000000b" } })
    state.hands.p2 = { 17, 18, 19, 25, 29 }
    state.phase, state.claimIndex = "claiming", 1
    state.claimants = { { playerId = "p2", playerIndex = 2, options = options } }
    local projected = legal_actions(state, "p2").claims
    result = {
      count = #options,
      ids = { options[1].tileIds, options[2].tileIds },
      projectedCount = #projected,
      withoutRed = projected[1].red,
      withRed = projected[2].red,
    }
  `);

  assert.equal(result.count, 2);
  assert.deepEqual(result.ids, [
    [18, 19],
    [18, 17],
  ]);
  assert.equal(result.projectedCount, 2);
  assert.deepEqual(result.withoutRed, [false, false]);
  assert.deepEqual(result.withRed, [false, true]);
});

test("Mahjong moves the riichi river marker to the next discard when the declaration tile is called", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000011" } })
    state.riichi.p1 = true
    state.discards.p1 = { { tile = 5, claimed = false, riichi = true } }
    state.lastDiscard = { player = "p1", playerIndex = 1, tile = 5, discardIndex = 1 }
    state.phase, state.claimIndex = "claiming", 1
    state.claimants = {
      { playerId = "p2", playerIndex = 2, options = { { kind = "pon", tileIds = { 6, 7 } } } },
    }
    state.claimResponses = {}
    state.hands.p2 = { 6, 7 }

    local called = on_action(state, { type = "claim", option = 1 }, { actor = { id = "p2" } })
    state = called.state
    local marker_pending_after_call = state.riichiMarkerPending.p1

    state.phase, state.turnIndex, state.drawnTile = "playing", 1, 9
    local next_discard = on_action(state, { type = "discard", tileId = 9 }, { actor = { id = "p1" } })
    state = next_discard.state
    result = {
      declarationClaimed = state.discards.p1[1].claimed,
      markerPendingAfterCall = marker_pending_after_call,
      nextDiscardMarked = state.discards.p1[2].riichi,
      markerCleared = state.riichiMarkerPending.p1 == false,
    }
  `);

  assert.deepEqual(result, {
    declarationClaimed: true,
    markerPendingAfterCall: true,
    nextDiscardMarked: true,
    markerCleared: true,
  });
});

test("Mahjong recognizes standard, seven-pairs, and thirteen-orphans wins", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000000b" } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function can_tsumo(types)
      local hand = ids(types)
      state.drawnTile = table.remove(hand)
      state.hands.p1 = hand
      state.turnIndex = 1
      state.phase = "playing"
      return view(state, {}, { viewer = { id = "p1", seat = 1 } }).state.legalActions.canTsumo
    end
    result = {
      standard = can_tsumo({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28,28 }),
      sevenPairs = can_tsumo({ 1,1, 3,3, 10,10, 12,12, 20,20, 28,28, 34,34 }),
      orphans = can_tsumo({ 1,9,10,18,19,27,28,29,30,31,32,33,34,34 }),
      incomplete = can_tsumo({ 1,2,4, 5,7,9, 10,13,16, 19,22,25, 28,34 }),
    }
  `);

  assert.equal(result.standard, true);
  assert.equal(result.sevenPairs, true);
  assert.equal(result.orphans, true);
  assert.equal(result.incomplete, false);
});

test("Mahjong local AI finishes a complete game through validated Lua actions", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000003039" } })
    steps = 0
    all_accepted = true
    while state.phase ~= "hand_ended" and steps < 500 do
      local actor = state.phase == "claiming"
        and state.claimants[state.claimIndex].playerId
        or state.players[state.turnIndex]
      local action = ai_action(state, actor)
      local applied = on_action(state, action, { actor = { id = actor } })
      if not applied.accepted then all_accepted = false break end
      state = applied.state
      steps = steps + 1
    end
    result = {
      ended = state.phase == "hand_ended",
      allAccepted = all_accepted,
      steps = steps,
      winner = state.winner,
      draw = state.draw,
      wall = #state.wall,
    }
  `);

  assert.equal(result.ended, true);
  assert.equal(result.allAccepted, true);
  assert.ok(result.steps > 20 && result.steps < 500);
  assert.ok(result.winner || result.draw);
  assert.ok(result.wall >= 0);
});

test("Mahjong AI balances riichi, dama, defense, calls, and dealer aggression", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function fresh(seed)
      local state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = string.format("%032x", seed) } })
      state.phase, state.turnIndex = "playing", 2
      state.discards.p1, state.discards.p2, state.discards.p3, state.discards.p4 = {}, {}, {}, {}
      state.melds.p1, state.melds.p2, state.melds.p3, state.melds.p4 = {}, {}, {}, {}
      state.riichi.p1, state.riichi.p2, state.riichi.p3, state.riichi.p4 = false, false, false, false
      state.kuikaeForbidden.p2 = {}
      return state
    end

    local defense = fresh(901)
    defense.hands.p2 = {
      5, 18, 29, 41, 53, 65, 77, 89, 101, 109, 117, 125, 133,
    }
    defense.drawnTile = 25
    defense.riichi.p1 = true
    defense.discards.p1 = { { tile = 19, claimed = false, riichi = true } }
    local defense_action = ai_action(defense, "p2")

    local riichi = fresh(902)
    riichi.hands.p2 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    riichi.drawnTile = (30 - 1) * 4 + 1
    local riichi_action = ai_action(riichi, "p2")

    local dama = fresh(903)
    dama.hands.p2 = ids({ 2,3,4, 6,7,8, 20,21, 24,24, 26,26,26 })
    dama.drawnTile = (30 - 1) * 4 + 1
    dama.deadWall[1] = (25 - 1) * 4 + 1
    local dama_action = ai_action(dama, "p2")

    local chi = fresh(904)
    chi.hands.p2 = ids({ 2,3, 6,7,8, 11,12,13, 20,21, 25,25,30 })
    chi.phase, chi.drawnTile = "claiming", 0
    chi.lastDiscard = {
      player = "p1", playerIndex = 1, tile = (4 - 1) * 4 + 1, discardIndex = 1,
    }
    chi.discards.p1 = { { tile = chi.lastDiscard.tile, claimed = false } }
    chi.claimants, chi.claimIndex = { {
      playerId = "p2", playerIndex = 2, distance = 1,
      options = { { kind = "chi", tileIds = { chi.hands.p2[1], chi.hands.p2[2] } } },
    } }, 1
    local chi_action = ai_action(chi, "p2")

    local bad_chi = fresh(906)
    bad_chi.hands.p2 = ids({ 2,3, 1,9,10,18,19,27,28,29,30,31,34 })
    bad_chi.phase, bad_chi.drawnTile = "claiming", 0
    bad_chi.lastDiscard = {
      player = "p1", playerIndex = 1, tile = (4 - 1) * 4 + 1, discardIndex = 1,
    }
    bad_chi.discards.p1 = { { tile = bad_chi.lastDiscard.tile, claimed = false } }
    bad_chi.claimants, bad_chi.claimIndex = { {
      playerId = "p2", playerIndex = 2, distance = 1,
      options = { { kind = "chi", tileIds = { bad_chi.hands.p2[1], bad_chi.hands.p2[2] } } },
    } }, 1
    local bad_chi_action = ai_action(bad_chi, "p2")

    local pon = fresh(905)
    pon.hands.p2 = ids({ 32,32, 2,3,4, 6,7,8, 11,12, 25,25,30 })
    pon.phase, pon.drawnTile = "claiming", 0
    pon.lastDiscard = {
      player = "p1", playerIndex = 1, tile = (32 - 1) * 4 + 3, discardIndex = 1,
    }
    pon.discards.p1 = { { tile = pon.lastDiscard.tile, claimed = false } }
    pon.claimants, pon.claimIndex = { {
      playerId = "p2", playerIndex = 2, distance = 1,
      options = { { kind = "pon", tileIds = { pon.hands.p2[1], pon.hands.p2[2] } } },
    } }, 1
    local pon_action = ai_action(pon, "p2")

    result = {
      defenseType = tile_type(defense_action.tileId),
      riichiAction = riichi_action.type,
      damaAction = dama_action.type,
      chiAction = chi_action.type,
      badChiAction = bad_chi_action.type,
      ponAction = pon_action.type,
      dealerBias = dealer_aggression(riichi, riichi.dealerIndex),
      nonDealerBias = dealer_aggression(riichi, 2),
    }
  `);

  assert.equal(result.defenseType, 5);
  assert.equal(result.riichiAction, "riichi");
  assert.equal(result.damaAction, "discard");
  assert.equal(result.chiAction, "claim");
  assert.equal(result.badChiAction, "pass");
  assert.equal(result.ponAction, "claim");
  assert.ok(result.dealerBias > result.nonDealerBias);
});

test("Mahjong AI does not treat a potential flush as a guaranteed open yaku", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000071" } })
    local flush_goal = ai_hand_goal(state, 2,
      ids({ 1,2,3, 4,5,6, 7,8,9, 1,2,3, 28 }), {})
    local yakuhai_goal = ai_hand_goal(state, 2,
      ids({ 1,2,3, 4,5,6, 7,8,9, 10,11,12 }), {
        { kind = "pon", tiles = ids({ 34,34,34 }) },
      })
    result = {
      flushGuaranteed = flush_goal.guaranteedOpen,
      yakuhaiGuaranteed = yakuhai_goal.guaranteedOpen,
    }
  `);

  assert.equal(result.flushGuaranteed, 0);
  assert.ok(result.yakuhaiGuaranteed >= 1);
});

test("Mahjong early-outer confidence follows its distance from riichi", async () => {
  const result = await runScenario(`
    function river(size, source)
      local result = {}
      for index = 1, size do
        result[index] = {
          tile = ((index == source and 4 or 12) - 1) * 4 + 1,
          claimed = false,
          riichi = index == size,
        }
      end
      return result
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000072" } })
    state.riichi.p1 = true
    state.discards.p1 = river(6, 1)
    local early = early_outer_factor(state, "p1", 1)
    state.discards.p1 = river(6, 5)
    local just_before_riichi = early_outer_factor(state, "p1", 1)
    state.discards.p1 = river(12, 6)
    local late_riichi = early_outer_factor(state, "p1", 1)
    result = {
      early = early,
      justBeforeRiichi = just_before_riichi,
      lateRiichi = late_riichi,
    }
  `);

  assert.ok(result.early < 0.65);
  assert.ok(result.justBeforeRiichi > 0.94);
  assert.ok(result.lateRiichi < 0.60);
  assert.ok(result.early < result.lateRiichi + 0.08);
});

test("Mahjong AI values wait quality, future safety, and placement pressure", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000073", settings = { matchType = "east" } } })
    state.hands.p2 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21,22, 26 })
    state.discards.p2 = { { tile = ids({ 5 })[1], claimed = false } }
    local visible = visible_type_counts(state, "p2", state.hands.p2, {})
    local ryanmen = tenpai_wait_profile(state, 2,
      ids({ 2,3,4, 6,7,8, 11,12,13, 20,21,22, 26 }), {}, visible)
    local kanchan = tenpai_wait_profile(state, 2,
      ids({ 2,3,4, 6,7,8, 11,12,13, 20,22,23, 26 }), {}, visible)

    state.riichi.p1 = true
    state.discards.p1 = { { tile = ids({ 9 })[1], claimed = false, riichi = true } }
    local danger_cache = {}
    local reserve = future_safe_reserve(state, 2,
      ids({ 9, 28, 1,2,3, 10,11,12, 19,20,21, 25 }), visible, danger_cache)
    local no_reserve = future_safe_reserve(state, 2,
      ids({ 4,5,6, 13,14,15, 22,23,24, 25,26,27, 17 }), visible, {})

    state.roundWind, state.handNumber = 1, 3
    state.scores = { 25000, 24000, 26000, 25000 }
    local chase = placement_push_value(state, 2, endgame_objective(state, 2))
    state.scores = { 25000, 26000, 24000, 25000 }
    local protect = placement_push_value(state, 2, endgame_objective(state, 2))
    result = {
      ryanmen = ryanmen.quality,
      kanchan = kanchan.quality,
      reserve = reserve,
      noReserve = no_reserve,
      chase = chase,
      protect = protect,
    }
  `);

  assert.ok(result.ryanmen > result.kanchan);
  assert.ok(result.reserve > result.noReserve);
  assert.ok(result.chase > 0);
  assert.ok(result.protect < 0);
});

test("Mahjong AI profiles public threat value and late formal tenpai", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000074", settings = { matchType = "east" } } })
    state.dealerIndex = 1
    state.discards.p1 = {
      { tile = ids({ 1 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 9 })[1], claimed = false, tsumogiri = true },
      { tile = ids({ 15 })[1], claimed = false, tsumogiri = true, riichi = true },
    }
    state.riichi.p1 = true
    local riichi_profile = opponent_profile(state, "p1")
    local riichi_loss = opponent_dealin_loss(state, "p1")

    state.riichi.p1 = false
    state.melds.p1 = {
      { kind = "pon", tiles = ids({ 32,32,32 }) },
      { kind = "pon", tiles = ids({ 5,5,5 }) },
    }
    state.discards.p1 = {
      { tile = ids({ 1 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 9 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 18 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 27 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 10 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 19 })[1], claimed = false, tsumogiri = false },
      { tile = ids({ 28 })[1], claimed = false, tsumogiri = false },
    }
    local open_profile = opponent_profile(state, "p1")
    local open_loss = opponent_dealin_loss(state, "p1")

    state.wall = { 1,2,3,4,5,6 }
    state.roundWind, state.handNumber = 1, 3
    state.scores = { 25000, 26000, 24000, 25000 }
    local formal = endgame_tenpai_value(state, { shanten = 0 }, endgame_objective(state, 2))
    local noten = endgame_tenpai_value(state, { shanten = 1 }, endgame_objective(state, 2))
    result = {
      riichiSpeed = riichi_profile.speed,
      openValue = open_profile.value,
      riichiLoss = riichi_loss,
      openLoss = open_loss,
      formal = formal,
      noten = noten,
    }
  `);

  assert.ok(result.riichiSpeed > 0.9);
  assert.ok(result.openValue > 0.5);
  assert.ok(result.riichiLoss > 5000);
  assert.ok(result.openLoss > 3000);
  assert.ok(result.formal > 50);
  assert.equal(result.noten, 0);
});

test("Mahjong riichi costs 1000 points and own discards cause furiten", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000005b", settings = { matchType = "east" } } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.hands.p1 = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.drawnTile = ids({ 9 })[1]
    state.turnIndex = 1
    local declared = on_action(state, { type = "riichi", tileId = state.drawnTile }, { actor = { id = "p1" } })
    state = declared.state
    state.discards.p1[#state.discards.p1 + 1] = { tile = (28 - 1) * 4 + 1, claimed = false }
    local projected = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state
    result = {
      accepted = declared.accepted,
      score = state.scores[1],
      sticks = state.riichiSticks,
      riichi = state.riichi.p1,
      furiten = projected.furiten,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.score, 24000);
  assert.equal(result.sticks, 1);
  assert.equal(result.riichi, true);
  assert.equal(result.furiten, true);
});

test("Mahjong scores yaku, han and fu with conserved tsumo payments", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000004d" } })
    state.dealerIndex = 1
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.hands.p1 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    state.deadWall[1] = 1
    state.drawnTile = ids({ 22 })[1]
    state.turnIndex = 1
    state.firstTurn.p1 = false
    local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p1" } })
    state = applied.state
    local names = {}
    for _, yaku in ipairs(state.result.yaku) do names[yaku.name] = true end
    local delta_sum = 0
    for _, delta in ipairs(state.result.deltas) do delta_sum = delta_sum + delta end
    result = {
      accepted = applied.accepted,
      phase = state.phase,
      han = state.result.han,
      fu = state.result.fu,
      tanyao = names["断幺九"] == true,
      pinfu = names["平和"] == true,
      menzenTsumo = names["门前清自摸和"] == true,
      dora = names["宝牌"] == true,
      basePaymentTotal = state.result.basePaymentTotal,
      winnerDelta = state.result.deltas[1],
      deltaSum = delta_sum,
      nextDealer = state.nextDealerIndex,
      nextHonba = state.nextHonba,
      scoreHistoryRows = #state.scoreHistory,
      recordedScore = state.scoreHistory[#state.scoreHistory].scores[1],
      winnerScore = state.scores[1],
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.phase, "hand_ended");
  assert.equal(result.han, 6);
  assert.equal(result.fu, 20);
  assert.equal(result.tanyao, true);
  assert.equal(result.pinfu, true);
  assert.equal(result.menzenTsumo, true);
  assert.equal(result.dora, true);
  assert.equal(result.basePaymentTotal, result.winnerDelta);
  assert.equal(result.deltaSum, 0);
  assert.equal(result.nextDealer, 1);
  assert.equal(result.nextHonba, 1);
  assert.equal(result.scoreHistoryRows, 2);
  assert.equal(result.recordedScore, result.winnerScore);
});

test("Mahjong East match ends after East 4 while hanchan advances to South 1", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function finish_east_four(match_type)
      local state = setup({ players = ${PLAYER_TABLE}, match = {
        randomSeed = "00000000000000000000000000000058", settings = { matchType = match_type }
      } })
      state.handNumber, state.roundWind, state.dealerIndex = 4, 1, 1
      state.hands.p2 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
      state.drawnTile = ids({ 22 })[1]
      state.turnIndex = 2
      local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p2" } })
      return applied.state
    end
    east = finish_east_four("east")
    south = finish_east_four("hanchan")
    local advanced = on_action(south, { type = "next_hand" }, { actor = { id = "p1" } }).state
    result = {
      eastEnded = east.matchEnded,
      hanchanEnded = south.matchEnded,
      roundWind = advanced.roundWind,
      handNumber = advanced.handNumber,
      dealer = advanced.dealerIndex,
    }
  `);

  assert.equal(result.eastEnded, true);
  assert.equal(result.hanchanEnded, false);
  assert.equal(result.roundWind, 2);
  assert.equal(result.handNumber, 1);
  assert.equal(result.dealer, 2);
});

test("Mahjong supports concealed kan and reveals an extra dora indicator", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000013a" } })
    state.hands.p1 = { 1,2,3, 17,21,25, 41,45,49, 77,81,109,113 }
    state.drawnTile, state.turnIndex = 4, 1
    local applied = on_action(state, { type = "kan", kind = "ankan", tileType = 1 }, { actor = { id = "p1" } })
    state = applied.state
    state.deadWall[1] = 17
    local projected = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state
    result = {
      accepted = applied.accepted,
      meldKind = state.melds.p1[1].kind,
      kanCount = state.kanCount,
      handCount = #state.hands.p1,
      indicators = #projected.doraIndicators,
      visualIndicators = #projected.doraIndicatorTiles,
      uraIndicators = #projected.uraDoraIndicatorTiles,
      firstIndicatorType = projected.doraIndicatorTiles[1].type,
      firstIndicatorRed = projected.doraIndicatorTiles[1].red,
      drew = state.drawnTile > 0,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.meldKind, "ankan");
  assert.equal(result.kanCount, 1);
  assert.equal(result.handCount, 10);
  assert.equal(result.indicators, 2);
  assert.equal(result.visualIndicators, 2);
  assert.equal(result.uraIndicators, 0);
  assert.equal(result.firstIndicatorType, 5);
  assert.equal(result.firstIndicatorRed, true);
  assert.equal(result.drew, true);
});

test("Mahjong concealed kan preserves riichi and closed-hand wins", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    local riichi_state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000013b" } })
    local riichi_tiles = ids({ 1,1,1,1, 2,3, 5,6,7, 10,11,12, 28,28 })
    riichi_state.drawnTile = table.remove(riichi_tiles)
    riichi_state.hands.p1, riichi_state.turnIndex = riichi_tiles, 1
    riichi_state.rinshan[#riichi_state.rinshan] = (9 - 1) * 4 + 1
    local riichi_kan = on_action(
      riichi_state,
      { type = "kan", kind = "ankan", tileType = 1 },
      { actor = { id = "p1" } }
    )
    riichi_state = riichi_kan.state
    local riichi_draw = riichi_state.drawnTile
    local riichi_legal = legal_actions(riichi_state, "p1")
    local declared = on_action(
      riichi_state,
      { type = "riichi", tileId = riichi_draw },
      { actor = { id = "p1" } }
    )

    local win_state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000013c" } })
    local win_tiles = ids({ 1,1,1,1, 2,3,4, 5,6,7, 10,11, 28,28 })
    win_state.drawnTile = table.remove(win_tiles)
    win_state.hands.p1, win_state.turnIndex = win_tiles, 1
    win_state.rinshan[#win_state.rinshan] = (12 - 1) * 4 + 1
    local win_kan = on_action(
      win_state,
      { type = "kan", kind = "ankan", tileType = 1 },
      { actor = { id = "p1" } }
    )
    win_state = win_kan.state
    -- This represents the same closed hand on a later ordinary draw; without
    -- menzen-tsumo it deliberately has no other yaku.
    win_state.rinshanWin = false
    local can_tsumo = legal_actions(win_state, "p1").canTsumo
    local won = on_action(win_state, { type = "tsumo" }, { actor = { id = "p1" } })
    local menzen_tsumo = false
    if won.state.result then
      for _, yaku in ipairs(won.state.result.yaku) do
        if yaku.name == "门前清自摸和" then menzen_tsumo = true end
      end
    end

    result = {
      kanAccepted = riichi_kan.accepted and win_kan.accepted,
      canRiichi = riichi_legal.canRiichi,
      riichiAccepted = declared.accepted,
      riichiDeclared = declared.state.riichi.p1,
      canTsumo = can_tsumo,
      tsumoAccepted = won.accepted,
      menzenTsumo = menzen_tsumo,
    }
  `);

  assert.deepEqual(result, {
    kanAccepted: true,
    canRiichi: true,
    riichiAccepted: true,
    riichiDeclared: true,
    canTsumo: true,
    tsumoAccepted: true,
    menzenTsumo: true,
  });
});

test("Mahjong opens a robbing-kan window and scores chankan", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000a9e" } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.melds.p1 = { { kind = "pon", tiles = { 9,10,11 }, fromIndex = 4 } }
    state.hands.p1 = { 17,21,25, 41,45,49, 77,81,85, 109 }
    state.drawnTile, state.turnIndex = 12, 1
    state.hands.p2 = ids({ 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 })
    state.riichi.p2 = true
    local declared = on_action(state, { type = "kan", kind = "kakan", tileType = 3 }, { actor = { id = "p1" } })
    state = declared.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      local action = { type = "pass" }
      if claimant.playerId == "p2" then action = { type = "claim", option = 1 } end
      state = on_action(state, action, { actor = { id = claimant.playerId } }).state
    end
    local chankan = false
    for _, yaku in ipairs(state.result.yaku) do if yaku.name == "抢杠" then chankan = true end end
    result = {
      openedWindow = declared.state ~= nil,
      winner = state.winner,
      winType = state.winType,
      chankan = chankan,
      ponStayedPon = state.melds.p1[1].kind == "pon",
    }
  `);

  assert.equal(result.openedWindow, true);
  assert.equal(result.winner, "p2");
  assert.equal(result.winType, "ron");
  assert.equal(result.chankan, true);
  assert.equal(result.ponStayedPon, true);
});

test("Mahjong pays every ron winner on one discard", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000652" } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local waiting = { 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 }
    state.hands.p1, state.hands.p2 = ids(waiting), ids(waiting)
    state.riichi.p1, state.riichi.p2 = true, true
    local p4_hand = ids({ 3,4,5, 7,8,9, 13,14,15, 22,23,24, 29, 3 })
    state.drawnTile = table.remove(p4_hand)
    state.hands.p4, state.turnIndex = p4_hand, 4
    local discarded = on_action(state, { type = "discard", tileId = state.drawnTile }, { actor = { id = "p4" } })
    state = discarded.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      local action = (claimant.playerId == "p1" or claimant.playerId == "p2")
        and { type = "claim", option = 1 } or { type = "pass" }
      state = on_action(state, action, { actor = { id = claimant.playerId } }).state
    end
    result = {
      phase = state.phase,
      winners = #state.winners,
      first = state.winners[1],
      second = state.winners[2],
      payerDelta = state.result.deltas[4],
    }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.winners, 2);
  assert.equal(result.first, "p1");
  assert.equal(result.second, "p2");
  assert.ok(result.payerDelta < -10000);
});

test("Mahjong broadcasts multiple ron only after every claimant responds", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000653" } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local waiting = { 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 }
    state.hands.p1, state.hands.p2 = ids(waiting), ids(waiting)
    state.riichi.p1, state.riichi.p2 = true, true
    local p4_hand = ids({ 3,4,5, 7,8,9, 13,14,15, 22,23,24, 29, 3 })
    state.drawnTile = table.remove(p4_hand)
    state.hands.p4, state.turnIndex = p4_hand, 4
    state = on_action(state, { type = "discard", tileId = state.drawnTile }, { actor = { id = "p4" } }).state

    local first_response = on_action(state, { type = "claim", option = 1 }, { actor = { id = "p1" } })
    state = first_response.state
    local intermediate = view(state, first_response.events, { viewer = { id = "p4", seat = 4 } })

    local final_response = on_action(state, { type = "claim", option = 1 }, { actor = { id = "p2" } })
    local final = view(final_response.state, final_response.events, { viewer = { id = "p4", seat = 4 } })
    result = {
      intermediatePhase = intermediate.state.phase,
      intermediateResponseIndex = intermediate.state.responseIndex,
      intermediateEvents = #intermediate.events,
      finalPhase = final.state.phase,
      finalWins = #final.events,
      finalWinners = #final.state.winners,
    }
  `);

  assert.equal(result.intermediatePhase, "claiming");
  assert.equal(result.intermediateResponseIndex, 0);
  assert.equal(result.intermediateEvents, 0);
  assert.equal(result.finalPhase, "hand_ended");
  assert.equal(result.finalWins, 2);
  assert.equal(result.finalWinners, 2);
});

test("Mahjong supports nine-terminals abortive draw and keeps the dealer", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "000000000000000000000000000003e7" } })
    state.dealerIndex = 1
    state.hands.p1 = { 1,33,37,69,73,105,109,113,117,121,125,129,133 }
    state.drawnTile, state.turnIndex = 134, 1
    local legal = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state.legalActions
    local applied = on_action(state, { type = "abort_nine" }, { actor = { id = "p1" } })
    state = applied.state
    local visible = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    result = {
      legal = legal.canAbortNine,
      accepted = applied.accepted,
      reason = state.abortiveReason,
      abortivePlayerIndex = state.abortivePlayerIndex,
      abortiveTile = state.abortiveTile,
      visiblePlayerIndex = visible.abortivePlayerIndex,
      visibleTile = visible.abortiveTile,
      nextDealer = state.nextDealerIndex,
      nextHonba = state.nextHonba,
    }
  `);

  assert.equal(result.legal, true);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "九种九牌");
  assert.equal(result.abortivePlayerIndex, 1);
  assert.equal(result.abortiveTile, 134);
  assert.equal(result.visiblePlayerIndex, 1);
  assert.equal(result.visibleTile, 34);
  assert.equal(result.nextDealer, 1);
  assert.equal(result.nextHonba, 1);
});

test("Mahjong applies yakuman responsibility payment and bankruptcy ending", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "000000000000000000000000000007e8" } })
    state.melds.p1 = {
      { kind = "pon", tiles = { 125,126,127 }, fromIndex = 2 },
      { kind = "pon", tiles = { 129,130,131 }, fromIndex = 3 },
      { kind = "pon", tiles = { 133,134,135 }, fromIndex = 2 },
    }
    state.hands.p1 = { 1,5,109,110 }
    state.drawnTile, state.turnIndex = 9, 1
    state.pao.p1.daisangen = 2
    local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p1" } })
    state = applied.state
    result = {
      accepted = applied.accepted,
      paoSeat = state.result.paoSeat,
      liableDelta = state.result.deltas[2],
      otherDelta = state.result.deltas[3],
      ended = state.matchEnded,
      reason = state.endReason,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.paoSeat, 2);
  assert.equal(result.liableDelta, -48000);
  assert.equal(result.otherDelta, 0);
  assert.equal(result.ended, true);
  assert.equal(result.reason, "击飞结束");
});

test("Mahjong awards nagashi mangan instead of noten payments", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000001092" } })
    state.dealerIndex = 1
    state.wall = {}
    state.hands.p1 = { 1,5,9,13,17,21,25,29,33,37,41,45,49 }
    state.turnIndex, state.drawnTile = 1, 109
    local applied = on_action(state, { type = "discard", tileId = 109 }, { actor = { id = "p1" } })
    state = applied.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      state = on_action(state, { type = "pass" }, { actor = { id = claimant.playerId } }).state
    end
    result = {
      phase = state.phase,
      winType = state.winType,
      winner = state.winner,
      yaku = state.result.yaku[1].name,
      delta = state.result.deltas[1],
    }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.winType, "nagashi");
  assert.equal(result.winner, "p1");
  assert.equal(result.yaku, "流局满贯");
  assert.equal(result.delta, 12000);
});

test("Mahjong detects four-winds abortive draw after claims are passed", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000141e" } })
    local east = 109
    state.discards.p1 = { { tile = east, claimed = false } }
    state.discards.p2 = { { tile = 110, claimed = false } }
    state.discards.p3 = { { tile = 111, claimed = false } }
    state.moveCount = 3
    state.turnIndex, state.drawnTile = 4, 112
    local applied = on_action(state, { type = "discard", tileId = 112 }, { actor = { id = "p4" } })
    state = applied.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      state = on_action(state, { type = "pass" }, { actor = { id = claimant.playerId } }).state
    end
    result = {
      phase = state.phase,
      reason = state.abortiveReason,
      honba = state.nextHonba,
      scoreHistoryRows = #state.scoreHistory,
    }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.reason, "四风连打");
  assert.equal(result.honba, 1);
  assert.equal(result.scoreHistoryRows, 1);
});

test("Mahjong supports agari-yame and East-match extension", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function winning_hand(state, player_id, seat)
      state.hands[player_id] = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
      state.drawnTile = ids({ 22 })[1]
      state.turnIndex = seat
      state.firstTurn[player_id] = false
    end
    yame = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000003d", settings = { matchType = "east" } } })
    yame.dealerIndex = 1
    yame.handNumber, yame.scores[1] = 4, 31000
    winning_hand(yame, "p1", 1)
    yame = on_action(yame, { type = "tsumo" }, { actor = { id = "p1" } }).state

    extension = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000003e", settings = { matchType = "east" } } })
    extension.dealerIndex = 1
    extension.handNumber = 4
    extension.scores = { 20000, 20000, 20000, 20000 }
    winning_hand(extension, "p2", 2)
    extension = on_action(extension, { type = "tsumo" }, { actor = { id = "p2" } }).state
    local advanced = on_action(extension, { type = "next_hand" }, { actor = { id = "p1" } }).state
    result = {
      yameEnded = yame.matchEnded,
      yameReason = yame.endReason,
      extensionEnded = extension.matchEnded,
      extensionWind = advanced.roundWind,
      extensionHand = advanced.handNumber,
    }
  `);

  assert.equal(result.yameEnded, true);
  assert.equal(result.yameReason, "庄家止和");
  assert.equal(result.extensionEnded, false);
  assert.equal(result.extensionWind, 2);
  assert.equal(result.extensionHand, 1);
});

test("Mahjong extension draws ignore target score until the forced final hand", async () => {
  const result = await runScenario(`
    function extension_state(match_type, wind, hand, scores)
      local state = setup({ players = ${PLAYER_TABLE}, match = {
        randomSeed = "00000000000000000000000000000047",
        settings = { matchType = match_type }
      } })
      state.roundWind, state.handNumber, state.dealerIndex = wind, hand, 1
      state.scores = scores
      state.result = { tenpai = { false, false, false, false } }
      return state
    end

    south_draw = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_draw, false, true)
    west_draw = extension_state("hanchan", 3, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(west_draw, false, true)

    south_tenpai = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_tenpai, true, true)
    south_win = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_win, false, false)

    south_four = extension_state("east", 2, 4, { 26000, 25000, 25000, 24000 })
    mark_next_hand(south_four, false, true)
    west_four = extension_state("hanchan", 3, 4, { 26000, 25000, 25000, 24000 })
    mark_next_hand(west_four, false, true)
    south_four_repeat = extension_state("east", 2, 4, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_four_repeat, true, true)

    result = {
      southDrawEnded = south_draw.matchEnded,
      southNextHand = south_draw.nextHandNumber,
      westDrawEnded = west_draw.matchEnded,
      westNextHand = west_draw.nextHandNumber,
      tenpaiEnded = south_tenpai.matchEnded,
      tenpaiNextHand = south_tenpai.nextHandNumber,
      winEnded = south_win.matchEnded,
      southFourEnded = south_four.matchEnded,
      southFourReason = south_four.endReason,
      westFourEnded = west_four.matchEnded,
      westFourReason = west_four.endReason,
      southFourRepeatEnded = south_four_repeat.matchEnded,
    }
  `);

  assert.equal(result.southDrawEnded, false);
  assert.equal(result.southNextHand, 2);
  assert.equal(result.westDrawEnded, false);
  assert.equal(result.westNextHand, 2);
  assert.equal(result.tenpaiEnded, false);
  assert.equal(result.tenpaiNextHand, 1);
  assert.equal(result.winEnded, true);
  assert.equal(result.southFourEnded, true);
  assert.equal(result.southFourReason, "延长赛结束");
  assert.equal(result.westFourEnded, true);
  assert.equal(result.westFourReason, "延长赛结束");
  assert.equal(result.southFourRepeatEnded, false);
});

test("Mahjong forbids genbutsu and suji kuikae immediately after a call", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000047" } })
    state.hands.p2 = ids({ 2,3,4,5,6,7,8,9,10,11,12,28,29 })
    local called = 1
    state.discards.p1 = { { tile = called, claimed = false } }
    state.lastDiscard = { player = "p1", playerIndex = 1, tile = called, discardIndex = 1 }
    state.claimants = { {
      playerId = "p2", playerIndex = 2, distance = 1,
      options = { { kind = "chi", tileIds = { 5, 9 } } },
    } }
    state.claimResponses = { { claimant = 1, option = 1 } }
    local events = {}
    resolve_claims(state, events)

    local projected = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    local ai = ai_action(state, "p2")
    local forbidden = on_action(state, { type = "discard", tileId = 13 }, { actor = { id = "p2" } })
    local allowed = on_action(state, { type = "discard", tileId = 113 }, { actor = { id = "p2" } })
    local pon = kuikae_forbidden_types({ kind = "pon", tileIds = { 53, 54 } })
    result = {
      forbiddenTypes = projected.legalActions.forbiddenDiscardTypes,
      forbiddenAccepted = forbidden.accepted,
      forbiddenCode = forbidden.error.code,
      allowedAccepted = allowed.accepted,
      cleared = next(state.kuikaeForbidden.p2) == nil,
      aiAvoided = tile_type(ai.tileId) ~= 1 and tile_type(ai.tileId) ~= 4,
      ponGenbutsu = pon[14] == true,
      calledTileIndex = projected.melds.p2[1].calledTileIndex,
    }
  `);

  assert.deepEqual(result.forbiddenTypes, [1, 4]);
  assert.equal(result.forbiddenAccepted, false);
  assert.equal(result.forbiddenCode, "KUIKAE_FORBIDDEN");
  assert.equal(result.allowedAccepted, true);
  assert.equal(result.cleared, true);
  assert.equal(result.aiAvoided, true);
  assert.equal(result.ponGenbutsu, true);
  assert.equal(result.calledTileIndex, 0);
});

test("Mahjong voids a riichi declaration when its declaration tile is ronned", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000321" } })
    local declarer = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28,28 })
    state.drawnTile = table.remove(declarer)
    state.hands.p1, state.turnIndex = declarer, 1
    state.hands.p2 = ids({ 1,2, 4,5,6, 10,11,12, 19,20,21, 32,32 })
    state.riichi.p2 = true
    state.riichiSticks = 2
    local declared = on_action(state, { type = "riichi", tileId = 9 }, { actor = { id = "p1" } })
    state = declared.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      local action = { type = "pass" }
      for index, option in ipairs(claimant.options) do
        if claimant.playerId == "p2" and option.kind == "ron" then action = { type = "claim", option = index } end
      end
      state = on_action(state, action, { actor = { id = claimant.playerId } }).state
    end
    result = {
      accepted = declared.accepted,
      declarerRiichi = state.riichi.p1,
      marker = state.discards.p1[1].riichi,
      awardedSticks = state.result.riichiAward,
      remainingSticks = state.riichiSticks,
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    declarerRiichi: false,
    marker: true,
    awardedSticks: 2000,
    remainingSticks: 0,
  });
});

test("Mahjong rejects post-riichi okuri-kan and impossible fifth-copy waits", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000322" } })
    state.hands.p1 = ids({ 1,1,1,1, 2,3, 5,6,7, 10,11,12, 28 })
    state.drawnTile, state.turnIndex, state.riichi.p1 = ids({ 29 })[1], 1, true
    local kans = self_kan_options(state, "p1")
    local sent_kan = false
    for _, option in ipairs(kans) do if option.kind == "ankan" and option.tileType == 1 then sent_kan = true end end

    local melds = { { kind = "pon", tiles = { 1,2,3 }, fromIndex = 2 } }
    local waits = waiting_types(ids({ 1, 2,3,4, 5,6,7, 10,11,12 }), melds)
    local fifth_copy = false
    for _, kind in ipairs(waits) do if kind == 1 then fifth_copy = true end end
    result = { sentKan = sent_kan, fifthCopyWait = fifth_copy }
  `);

  assert.deepEqual(result, { sentKan: false, fifthCopyWait: false });
});

test("Mahjong tracks no-yaku and declined-ron temporary furiten correctly", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    no_yaku = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000323" } })
    no_yaku.hands.p3 = ids({ 1,2, 4,5,6, 10,11,12, 25,26,27, 28,28 })
    begin_claims(no_yaku, 1, 9)
    local no_yaku_furiten = no_yaku.tempFuriten.p3

    called = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000324" } })
    called.melds.p2 = { { kind = "pon", tiles = { 125,126,127 }, fromIndex = 3 } }
    called.hands.p2 = ids({ 1,1, 2,3,4, 5,6,7, 28,28 })
    called.hands.p3 = ids({ 2,3,4,5,6,7,8,9,10,11,12,29,30 })
    called.hands.p4 = ids({ 2,3,4,5,6,7,8,9,10,11,12,30,31 })
    called.discards.p1 = { { tile = 4, claimed = false } }
    called.lastDiscard = { player = "p1", playerIndex = 1, tile = 4, discardIndex = 1 }
    begin_claims(called, 1, 4)
    local claimant = called.claimants[called.claimIndex]
    local pon_index = 0
    for index, option in ipairs(claimant.options) do if option.kind == "pon" then pon_index = index end end
    called = on_action(called, { type = "claim", option = pon_index }, { actor = { id = "p2" } }).state
    local furiten_after_call = called.tempFuriten.p2
    local discarded = on_action(called, { type = "discard", tileId = 5 }, { actor = { id = "p2" } })
    result = {
      noYakuFuriten = no_yaku_furiten,
      furitenAfterDecliningRon = furiten_after_call,
      discardAccepted = discarded.accepted,
      clearedAfterCalledTurn = not discarded.state.tempFuriten.p2,
    }
  `);

  assert.deepEqual(result, {
    noYakuFuriten: true,
    furitenAfterDecliningRon: true,
    discardAccepted: true,
    clearedAfterCalledTurn: true,
  });
});

test("Mahjong blocks last-discard calls and keeps last-tile yaku exclusive", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000325" } })
    state.wall = {}
    state.hands.p2 = ids({ 2,3, 5,6,8,9, 11,12,14,15,20,24,29 })
    local options = claim_options(state, 2, 1, 1)
    local group_call = false
    for _, option in ipairs(options) do if option.kind ~= "ron" then group_call = true end end

    state.hands.p1 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    state.drawnTile, state.turnIndex = ids({ 22 })[1], 1
    state.firstTurn.p1, state.rinshanWin = false, true
    local rinshan = score_hand(state, 1, state.drawnTile, "tsumo")
    local rinshan_names = {}
    for _, yaku in ipairs(rinshan.yaku) do rinshan_names[yaku.name] = true end

    state.hands.p2 = ids({ 1,1, 2,2, 3,3, 10,10, 11,11, 19,19, 28 })
    state.rinshanWin, state.chankanWin, state.firstTurn.p2 = false, false, false
    local houtei = score_hand(state, 2, ids({ 28 })[1], "ron")
    local houtei_names = {}
    for _, yaku in ipairs(houtei.yaku) do houtei_names[yaku.name] = true end
    state.chankanWin = true
    local chankan = score_hand(state, 2, ids({ 28 })[1], "ron")
    local chankan_names = {}
    for _, yaku in ipairs(chankan.yaku) do chankan_names[yaku.name] = true end
    result = {
      groupCall = group_call,
      rinshan = rinshan_names["岭上开花"] == true,
      rinshanHaitei = rinshan_names["海底摸月"] == true,
      chiitoiHoutei = houtei_names["河底捞鱼"] == true,
      chiitoiChankan = chankan_names["抢杠"] == true,
      chankanHoutei = chankan_names["河底捞鱼"] == true,
    }
  `);

  assert.deepEqual(result, {
    groupCall: false,
    rinshan: true,
    rinshanHaitei: false,
    chiitoiHoutei: true,
    chiitoiChankan: true,
    chankanHoutei: false,
  });
});

test("Mahjong scores first-turn, nine-gates, and seven-pairs yakuman cleanly", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function names(score)
      local result = {}
      for _, yaku in ipairs(score.yaku or {}) do result[yaku.name] = true end
      return result
    end
    heaven = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000326" } })
    heaven.dealerIndex = 1
    heaven.hands.p1 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    heaven.drawnTile, heaven.turnIndex = ids({ 22 })[1], 1
    local heaven_score = score_hand(heaven, 1, heaven.drawnTile, "tsumo")

    earth = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000327" } })
    earth.dealerIndex = 1
    earth.hands.p2 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    earth.drawnTile, earth.turnIndex = ids({ 22 })[1], 2
    local earth_score = score_hand(earth, 2, earth.drawnTile, "tsumo")

    gates = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000328" } })
    gates.hands.p1 = ids({ 1,1,1,2,3,4,5,6,7,8,9,9,9 })
    gates.drawnTile, gates.turnIndex, gates.firstTurn.p1 = ids({ 5 })[1], 1, false
    local gates_score = score_hand(gates, 1, gates.drawnTile, "tsumo")

    honors = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "00000000000000000000000000000329" } })
    honors.hands.p2 = ids({ 28,28,29,29,30,30,31,31,32,32,33,33,34 })
    honors.firstTurn.p2 = false
    local honors_score = score_hand(honors, 2, ids({ 34 })[1], "ron")
    local heaven_names, earth_names = names(heaven_score), names(earth_score)
    local gates_names, honors_names = names(gates_score), names(honors_score)
    result = {
      heaven = heaven_names["天和"] == true,
      earth = earth_names["地和"] == true,
      gates = gates_names["九莲宝灯"] == true,
      gatesOnlyYakuman = #gates_score.yaku == 1,
      honors = honors_names["字一色"] == true,
      honorsOnlyYakuman = #honors_score.yaku == 1,
    }
  `);

  assert.deepEqual(result, {
    heaven: true,
    earth: true,
    gates: true,
    gatesOnlyYakuman: true,
    honors: true,
    honorsOnlyYakuman: true,
  });
});

test("Mahjong applies pao only to the liable yakuman and leaves honba to the discarder", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = "0000000000000000000000000000032a" } })
    state.dealerIndex = 1
    state.honba = 1
    state.pao.p1.daisangen = 2
    local score = {
      yakuman = 2, han = 26, base = 16000,
      yaku = { { name = "大三元", han = 13 }, { name = "字一色", han = 13 } },
    }
    local ron = score_payment_deltas(state, score, 1, "ron", 3)
    local tsumo_score = {
      yakuman = 2, han = 26, base = 16000,
      yaku = { { name = "大三元", han = 13 }, { name = "字一色", han = 13 } },
    }
    local tsumo = score_payment_deltas(state, tsumo_score, 1, "tsumo", 0)
    result = {
      ronLiable = ron[2], ronDiscarder = ron[3], ronWinner = ron[1],
      tsumoLiable = tsumo[2], tsumoOtherA = tsumo[3], tsumoOtherB = tsumo[4], tsumoWinner = tsumo[1],
    }
  `);

  assert.deepEqual(result, {
    ronLiable: -24000,
    ronDiscarder: -72300,
    ronWinner: 96300,
    tsumoLiable: -64100,
    tsumoOtherA: -16100,
    tsumoOtherB: -16100,
    tsumoWinner: 96300,
  });
});
