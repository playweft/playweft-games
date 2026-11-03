import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const LEGACY_SCENARIO_ADAPTER = `
local __protocol_setup = setup
setup = function(context)
  if context.match == nil then
    local players = {}
    for seat, id in ipairs(context.players) do
      players[seat] = { id = id, seat = seat }
    end
    context = {
      protocolVersion = 1,
      players = players,
      match = {
        id = "match_test",
        ownerId = context.hostId or context.ownerId or context.players[1],
        startedAt = 0,
        randomSeed = context.randomSeed or "00000000000000000000000000000001",
      },
    }
  end
  return __protocol_setup(context)
end

local __protocol_action = on_action
on_action = function(state, action, context)
  if context.actor == nil then
    context = {
      protocolVersion = 1,
      matchId = "match_test",
      actionId = "action_test",
      actionAt = context.actionAt or 0,
      version = context.version or 0,
      actor = {
        id = context.playerId,
        role = "player",
        isOwner = context.playerId == state.hostId,
      },
    }
  end
  return __protocol_action(state, action, context)
end
`;

async function runGo(scenario) {
  const source = await readFile("games/go/game.lua", "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${LEGACY_SCENARIO_ADAPTER}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

test("Go defaults to a 19 × 19 board", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    result = {
      size = state.settings.size,
      boardSize = #state.board,
    }
  `);

  assert.deepEqual(result, {
    size: 19,
    boardSize: 19,
  });
});

test("Go preserves optional player names for the game UI", async () => {
  const result = await runGo(`
    state = setup({
      protocolVersion = 1,
      players = {
        { id = "host", name = "Alice", seat = 1 },
        { id = "guest", name = "Bob", seat = 2 },
      },
      match = {
        id = "match_names",
        ownerId = "host",
        startedAt = 0,
        randomSeed = "00000000000000000000000000000001",
      },
    })
    setup_names = state.playerNames
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player2"
    }, {
      protocolVersion = 1,
      matchId = "match_names",
      actionId = "action_start",
      actionAt = 100,
      version = 0,
      actor = { id = "host", role = "player", seat = 1, name = "Alice", isOwner = true },
    }).state
    result = {
      setupNames = setup_names,
      names = state.playerNames,
      blackName = state.playerNames[state.blackIndex],
      whiteName = state.playerNames[(state.blackIndex % #state.players) + 1],
    }
  `);

  assert.deepEqual(result, {
    setupNames: ["Alice", "Bob"],
    names: ["Alice", "Bob"],
    blackName: "Bob",
    whiteName: "Alice",
  });
});

test("Go captures a surrounded group and alternates turns", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 1
    state.board[2][1] = 1
    state.board[2][2] = 2
    state.board[2][3] = 1
    result = on_action(state, { type = "play", row = 3, column = 2 }, { playerId = "black" })
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.state.board[1][1], 0);
  assert.equal(result.state.captures[0], 1);
  assert.equal(result.state.current, 2);
  assert.equal(result.state.lastEvent.captured, 1);
});

test("Go rejects occupied points, suicide, and out-of-turn play", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 2
    state.board[2][1] = 2
    suicide = on_action(state, { type = "play", row = 1, column = 1 }, { playerId = "black" })
    occupied = on_action(state, { type = "play", row = 1, column = 2 }, { playerId = "black" })
    wrong_turn = on_action(state, { type = "play", row = 3, column = 3 }, { playerId = "white" })
    result = {
      suicide = suicide.error.code,
      occupied = occupied.error.code,
      wrongTurn = wrong_turn.error.code,
    }
  `);

  assert.deepEqual(result, {
    suicide: "SUICIDE",
    occupied: "OCCUPIED",
    wrongTurn: "NOT_YOUR_TURN",
  });
});

test("Go enforces the simple ko rule", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 1
    state.board[2][1] = 1
    state.board[3][2] = 1
    state.board[2][2] = 2
    state.board[1][3] = 2
    state.board[3][3] = 2
    state.board[2][4] = 2
    captured = on_action(state, { type = "play", row = 2, column = 3 }, { playerId = "black" })
    rejected = on_action(captured.state, { type = "play", row = 2, column = 2 }, { playerId = "white" })
    result = { rejected = rejected, state = captured.state }
  `);

  assert.equal(result.rejected.error.code, "KO");
  assert.equal(result.state.board[1][2], 1);
  assert.equal(result.state.board[1][1], 0);
});

test("Go ends only after both players submit matching scores", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    first = on_action(state, { type = "pass" }, { playerId = "black" })
    scoring = on_action(first.state, { type = "pass" }, { playerId = "white" })
    scoring_phase = scoring.state.phase
    scoring_moves = scoring.state.moves
    scoring_ended = scoring.state.ended
    scoring_event = scoring.events[1].type
    proposal = {
      black = 0, white = 6.5,
      blackStones = 0, whiteStones = 0,
      blackTerritory = 0, whiteTerritory = 0, neutral = 81,
      komi = 6.5, rules = "chinese"
    }
    black_confirmed = on_action(scoring.state, {
      type = "score", scoreRound = scoring.state.scoreRound, score = proposal
    }, { playerId = "black" })
    first_ended = black_confirmed.state.ended
    first_event = black_confirmed.events[1].type
    first_hidden = view(black_confirmed.state, {}, {}).state.scoreProposals == nil
    white_confirmed = on_action(black_confirmed.state, {
      type = "score", scoreRound = scoring.state.scoreRound, score = proposal
    }, { playerId = "white" })
    result = {
      scoringPhase = scoring_phase,
      scoringMoves = scoring_moves,
      scoringEnded = scoring_ended,
      scoringEvent = scoring_event,
      firstEnded = first_ended,
      firstEvent = first_event,
      firstProposalHidden = first_hidden,
      finalConfirmation = white_confirmed,
    }
  `);

  assert.equal(result.scoringPhase, "scoring");
  assert.equal(result.scoringMoves, 2);
  assert.equal(result.scoringEnded, false);
  assert.equal(result.scoringEvent, "scoring_started");
  assert.equal(result.firstEnded, false);
  assert.equal(result.firstEvent, "score_submitted");
  assert.equal(result.firstProposalHidden, true);
  assert.equal(result.finalConfirmation.state.ended, true);
  assert.equal(result.finalConfirmation.state.scores.black, 0);
  assert.equal(result.finalConfirmation.state.scores.white, 6.5);
  assert.equal(result.finalConfirmation.state.winner, "white");
  assert.equal(result.finalConfirmation.events[0].type, "scored");
});

test("Go restarts confirmation when players submit different scores", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state = on_action(state, { type = "pass" }, { playerId = "black" }).state
    state = on_action(state, { type = "pass" }, { playerId = "white" }).state
    first = on_action(state, {
      type = "score", scoreRound = 1,
      score = {
        black = 0, white = 6.5,
        blackStones = 0, whiteStones = 0,
        blackTerritory = 0, whiteTerritory = 0, neutral = 81,
        komi = 6.5, rules = "chinese"
      }
    }, { playerId = "black" })
    result = on_action(first.state, {
      type = "score", scoreRound = 1,
      score = {
        black = 1, white = 6.5,
        blackStones = 0, whiteStones = 0,
        blackTerritory = 1, whiteTerritory = 0, neutral = 80,
        komi = 6.5, rules = "chinese"
      }
    }, { playerId = "white" })
  `);

  assert.equal(result.state.phase, "scoring");
  assert.equal(result.state.ended, false);
  assert.equal(result.state.scoreRound, 2);
  assert.deepEqual(result.state.scoreSubmitted, [false, false]);
  assert.equal(result.events[0].type, "score_disputed");
});

test("Go preserves board, rule, komi, colour, and handicap settings for a rematch", async () => {
  const result = await runGo(`
    state = setup({ players = { "a", "b" } })
    state = on_action(state, {
      type = "start", size = 13, rules = "japanese", komi = 0.5,
      handicap = 2, blackMode = "player2"
    }, { playerId = "a" }).state
    state.ended = true
    state.winner = "a"
    state.winnerIndex = 1
    result = on_action(state, { type = "rematch" }, { playerId = "b" })
  `);

  assert.equal(result.state.blackIndex, 2);
  assert.equal(result.state.current, 1);
  assert.equal(result.state.board.length, 13);
  assert.equal(result.state.settings.rules, "japanese");
  assert.equal(result.state.settings.komi, 0.5);
  assert.equal(result.state.settings.handicap, 2);
  assert.equal(
    result.state.board.flat().filter((point) => point === 1).length,
    2,
  );
  assert.equal(result.state.round, 2);
  assert.equal(result.events[0].type, "rematched");
});

test("Go allows only the host to submit setup", async () => {
  const result = await runGo(`
    state = setup({
      players = { "guest", "host" },
      hostId = "host",
      randomSeed = "0000000000000000000000000000000c"
    })
    denied = on_action(state, {
      type = "start", size = 19, rules = "chinese", komi = 7.5,
      handicap = 0, blackMode = "random"
    }, { playerId = "guest" })
    accepted = on_action(state, {
      type = "start", size = 19, rules = "chinese", komi = 7.5,
      handicap = 0, blackMode = "random"
    }, { playerId = "host" })
    result = {
      denied = denied.error.code,
      phase = accepted.state.phase,
      size = accepted.state.settings.size,
      hostId = accepted.state.hostId,
    }
  `);

  assert.deepEqual(result, {
    denied: "ONLY_HOST_CAN_SETUP",
    phase: "playing",
    size: 19,
    hostId: "host",
  });
});

test("Go broadcasts host setting updates while remaining in setup", async () => {
  const result = await runGo(`
    state = setup({
      players = { "host", "guest" },
      hostId = "host",
      randomSeed = "0000000000000000000000000000000c"
    })
    denied = on_action(state, {
      type = "update_settings", size = 19, rules = "japanese", komi = 7.5,
      handicap = 0, blackMode = "player2"
    }, { playerId = "guest" })
    accepted = on_action(state, {
      type = "update_settings", size = 19, rules = "japanese", komi = 7.5,
      handicap = 0, blackMode = "player2"
    }, { playerId = "host" })
    result = {
      denied = denied.error.code,
      phase = accepted.state.phase,
      size = accepted.state.settings.size,
      rules = accepted.state.settings.rules,
      komi = accepted.state.settings.komi,
      blackMode = accepted.state.settings.blackMode,
      boardSize = #accepted.state.board,
      event = accepted.events[1].type,
    }
  `);

  assert.deepEqual(result, {
    denied: "ONLY_HOST_CAN_SETUP",
    phase: "setup",
    size: 19,
    rules: "japanese",
    komi: 7.5,
    blackMode: "player2",
    boardSize: 19,
    event: "settings_updated",
  });
});

test("Go tracks each player's elapsed turn time", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" }, hostId = "black" })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black", actionAt = 1000 }).state
    state = on_action(
      state,
      { type = "play", row = 4, column = 4 },
      { playerId = "black", actionAt = 4500 }
    ).state
    result = on_action(
      state,
      { type = "pass" },
      { playerId = "white", actionAt = 7000 }
    )
  `);

  assert.equal(result.state.timeUsed[0], 3500);
  assert.equal(result.state.timeUsed[1], 2500);
  assert.equal(result.state.turnStartedAt, 7000);
});

test("Go lets either player resign and awards the game to the opponent", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" }, hostId = "black" })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black", actionAt = 1000 }).state
    resigned = on_action(
      state,
      { type = "resign" },
      { playerId = "white", actionAt = 4000 }
    )
    result = resigned
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.state.ended, true);
  assert.equal(result.state.phase, "ended");
  assert.equal(result.state.current, 0);
  assert.equal(result.state.winner, "black");
  assert.equal(result.state.winnerIndex, 1);
  assert.equal(result.state.lastEvent.kind, "resigned");
  assert.equal(result.state.lastEvent.playerIndex, 2);
  assert.equal(result.state.timeUsed[0], 3000);
  assert.equal(result.events[0].type, "resigned");
});

test("Go requires fixed black for handicap games and starts with white", async () => {
  const result = await runGo(`
    state = setup({ players = { "a", "b" }, hostId = "a" })
    denied = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 0.5,
      handicap = 4, blackMode = "random"
    }, { playerId = "a" })
    accepted = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 0.5,
      handicap = 4, blackMode = "player1"
    }, { playerId = "a" })
    result = {
      denied = denied.error.code,
      current = accepted.state.current,
      stones = accepted.state.board,
    }
  `);

  assert.equal(result.denied, "HANDICAP_REQUIRES_FIXED_BLACK");
  assert.equal(result.current, 2);
  assert.equal(result.stones.flat().filter((point) => point === 1).length, 4);
});

test("Go can return to setup after a game and keeps prior values editable by the host", async () => {
  const result = await runGo(`
    state = setup({ players = { "host", "guest" }, hostId = "host" })
    state = on_action(state, {
      type = "start", size = 13, rules = "japanese", komi = 5.5,
      handicap = 0, blackMode = "player2"
    }, { playerId = "host" }).state
    state.ended = true
    configured = on_action(state, { type = "configure" }, { playerId = "guest" })
    result = configured
  `);

  assert.equal(result.state.phase, "setup");
  assert.equal(result.state.round, 2);
  assert.equal(result.state.settings.size, 13);
  assert.equal(result.state.settings.rules, "japanese");
  assert.equal(result.state.settings.komi, 5.5);
  assert.equal(result.state.settings.blackMode, "player2");
  assert.equal(result.state.hostId, "host");
  assert.equal(result.events[0].type, "configuration_opened");
});

test("Go requires the opponent to approve a one-step undo", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" }, hostId = "black" })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black", actionAt = 1000 }).state
    played = on_action(
      state,
      { type = "play", row = 4, column = 4 },
      { playerId = "black", actionAt = 2500 }
    )
    hidden_snapshot = view(played.state, {}, {}).state.undoSnapshot == nil
    wrong_requester = on_action(
      played.state,
      { type = "request_undo" },
      { playerId = "white", actionAt = 2600 }
    )
    requested = on_action(
      played.state,
      { type = "request_undo" },
      { playerId = "black", actionAt = 2700 }
    )
    request_index = requested.state.undoRequest.requesterIndex
    blocked_move = on_action(
      requested.state,
      { type = "play", row = 5, column = 5 },
      { playerId = "white", actionAt = 2800 }
    )
    requester_response = on_action(
      requested.state,
      { type = "respond_undo", accept = true },
      { playerId = "black", actionAt = 2900 }
    )
    accepted = on_action(
      requested.state,
      { type = "respond_undo", accept = true },
      { playerId = "white", actionAt = 3000 }
    )
    result = {
      hiddenSnapshot = hidden_snapshot,
      wrongRequester = wrong_requester.error.code,
      requestEvent = requested.events[1].type,
      requesterIndex = request_index,
      blockedMove = blocked_move.error.code,
      requesterResponse = requester_response.error.code,
      acceptedEvent = accepted.events[1].type,
      moves = accepted.state.moves,
      current = accepted.state.current,
      point = accepted.state.board[4][4],
      undoAvailable = accepted.state.undoAvailable,
      requestCleared = accepted.state.undoRequest == nil,
    }
  `);

  assert.deepEqual(result, {
    hiddenSnapshot: true,
    wrongRequester: "ONLY_LAST_PLAYER_CAN_UNDO",
    requestEvent: "undo_requested",
    requesterIndex: 1,
    blockedMove: "UNDO_RESPONSE_REQUIRED",
    requesterResponse: "UNDO_REQUESTER_CANNOT_RESPOND",
    acceptedEvent: "undo_accepted",
    moves: 0,
    current: 1,
    point: 0,
    undoAvailable: false,
    requestCleared: true,
  });
});

test("room Go defaults to seven-point komi and first-pass tiebreak", async () => {
  const settings = await runGo(`result = setup({ players = { "black", "white" } }).settings`);
  assert.equal(settings.komi, 7);
  assert.equal(settings.tieBreak, "first-pass");
});

for (const tieBreak of ["draw", "white", "first-pass"]) {
  for (const blackMode of ["player1", "player2"]) {
    test(`room tied scores honor ${tieBreak} with ${blackMode}`, async () => {
      const result = await runGo(`
        state = setup({ players = { "one", "two" } })
        state = on_action(state, {
          type = "start", size = 9, rules = "chinese", komi = 7,
          handicap = 0, blackMode = "${blackMode}", tieBreak = "${tieBreak}"
        }, { playerId = "one" }).state
        for column = 1, 8 do state.board[1][column] = 1 end
        state.board[9][9] = 2
        -- Black passes first even when black belongs to player two.
        state.current = state.blackIndex
        state = on_action(state, { type = "pass" }, { playerId = state.players[state.current] }).state
        state = on_action(state, { type = "pass" }, { playerId = state.players[state.current] }).state
        score = { black = 8, white = 8, blackStones = 8, whiteStones = 1,
          blackTerritory = 0, whiteTerritory = 0, neutral = 72, komi = 7, rules = "chinese" }
        state = on_action(state, { type = "score", scoreRound = state.scoreRound, score = score }, { playerId = "one" }).state
        state = on_action(state, { type = "score", scoreRound = state.scoreRound, score = score }, { playerId = "two" }).state
        result = state
      `);
      const whiteIndex = (result.blackIndex % 2) + 1;
      assert.equal(result.firstPassIndex, result.blackIndex);
      const expected = tieBreak === "draw" ? 0 : tieBreak === "white" ? whiteIndex : result.blackIndex;
      assert.equal(result.winnerIndex, expected);
      assert.equal(result.winner, result.players[expected - 1] ?? "");
      assert.equal(result.ended, true);
    });
  }
}

test("room tiebreak settings synchronize and reject invalid values", async () => {
  const result = await runGo(`
    state = setup({ players = { "one", "two" } })
    action = { type = "update_settings", size = 9, rules = "chinese", komi = 7,
      handicap = 0, blackMode = "player1", tieBreak = "draw" }
    updated = on_action(state, action, { playerId = "one" })
    action.tieBreak = false
    invalid = on_action(state, action, { playerId = "one" })
    result = { settings = updated.state.settings, invalid = invalid }
  `);
  assert.equal(result.settings.tieBreak, "draw");
  assert.equal(result.invalid.accepted, false);
  assert.equal(result.invalid.error.code, "INVALID_TIE_BREAK");
});

test("room undo cancels a first pass and later play does not erase an earlier pass", async () => {
  const result = await runGo(`
    state = setup({ players = { "one", "two" } })
    state = on_action(state, { type = "start", size = 9, rules = "chinese", komi = 7,
      handicap = 0, blackMode = "player1", tieBreak = "first-pass" }, { playerId = "one" }).state
    state = on_action(state, { type = "pass" }, { playerId = "one" }).state
    state = on_action(state, { type = "request_undo" }, { playerId = "one" }).state
    state = on_action(state, { type = "respond_undo", accept = true }, { playerId = "two" }).state
    undone = state.firstPassIndex
    state = on_action(state, { type = "play", row = 4, column = 4 }, { playerId = "one" }).state
    state = on_action(state, { type = "pass" }, { playerId = "two" }).state
    state = on_action(state, { type = "play", row = 5, column = 5 }, { playerId = "one" }).state
    result = { undone = undone, firstPassIndex = state.firstPassIndex }
  `);
  assert.deepEqual(result, { undone: 0, firstPassIndex: 2 });
});
