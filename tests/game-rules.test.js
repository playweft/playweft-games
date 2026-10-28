import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";
import {
  SIZE,
  cloneGrid,
  countSolutions,
  generatePuzzleForDifficulty,
  generateVeryHardPuzzle,
  isValidGrid,
} from "../games/sudoku/sudoku.js";

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
      actionAt = 0,
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

local __protocol_view = view
view = function(state, events, context)
  if context == nil then
    context = {
      protocolVersion = 1,
      matchId = "match_test",
      version = events.version or 0,
      serverTime = 0,
      viewer = {
        id = events.playerId,
        role = "player",
        isOwner = events.playerId == state.hostId,
      },
    }
    events = {}
  end
  return __protocol_view(state, events, context)
end
`;

async function runLua(gamePath, scenario, resultName = "result") {
  const source = await readFile(gamePath, "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${LEGACY_SCENARIO_ADAPTER}\n${scenario}`);
    return lua.global.get(resultName);
  } finally {
    lua.global.close();
  }
}

test("Sudoku generator creates a valid unique very-hard puzzle", () => {
  const random = seededRandom(20260723);
  const { puzzle, solution, clues, difficulty } = generateVeryHardPuzzle({
    random,
    targetClues: 23,
    maxAttempts: 8,
  });

  assert.equal(solution.length, SIZE);
  assert.ok(solution.every((row) => row.length === SIZE));
  assert.ok(isValidGrid(cloneGrid(solution)));
  assert.equal(countSolutions(cloneGrid(solution)), 1);
  assert.equal(countSolutions(cloneGrid(puzzle)), 1);
  assert.ok(clues <= 27, `expected a sparse puzzle, got ${clues} clues`);
  assert.equal(
    difficulty.requiresAdvancedTechniques,
    true,
    "expected a puzzle that cannot be completed with intermediate techniques alone",
  );
});

test("Sudoku generator supports medium and hard difficulty", () => {
  for (const difficulty of ["medium", "hard"]) {
    const generated = generatePuzzleForDifficulty(difficulty, {
      random: seededRandom(1),
    });
    const rating = generated.difficulty.analysis.difficulty;

    assert.equal(countSolutions(cloneGrid(generated.puzzle)), 1);
    assert.equal(generated.difficulty.requiresAdvancedTechniques, false);
    if (difficulty === "medium") {
      assert.equal(rating, "medium");
    } else {
      assert.ok(rating, "expected hard puzzles to avoid advanced techniques");
      assert.ok(
        generated.difficulty.analysis.usedStrategies.every((strategy) =>
          [
            "Open Singles Strategy",
            "Visual Elimination Strategy",
            "Single Candidate Strategy",
            "Naked Pair Strategy",
          ].includes(strategy.title),
        ),
        "expected hard puzzles to avoid pointing and hidden-pair techniques",
      );
    }
  }
});

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

test("All room games implement the current Playweft protocol contract", async () => {
  const games = new Map([
    ["games/pig-dice/game.lua", 2],
    ["games/connect-four/game.lua", 2],
    ["games/texas-holdem/game.lua", 2],
    ["games/dou-dizhu/game.lua", 3],
    ["games/werewolf-dealer/game.lua", 6],
    ["games/uno/game.lua", 2],
    ["games/go/game.lua", 2],
    ["games/reversi/game.lua", 2],
    ["games/gomoku/game.lua", 2],
    ["games/xiangqi/game.lua", 2],
    ["games/chess/game.lua", 2],
  ]);

  for (const [gamePath, playerCount] of games) {
    const source = await readFile(gamePath, "utf8");
    const players = Array.from(
      { length: playerCount },
      (_, index) => `{ id = "p${index + 1}", seat = ${index + 1} }`,
    ).join(", ");
    const lua = await new LuaFactory().createEngine();
    try {
      await lua.doString(`
        ${source}
        state = setup({
          protocolVersion = 1,
          players = { ${players} },
          match = {
            id = "match_contract",
            ownerId = "p1",
            startedAt = 100,
            randomSeed = "0000000000000000000000000000007b",
          },
        })
        rejection = on_action(state, {}, {
          protocolVersion = 1,
          matchId = "match_contract",
          actionId = "action_contract",
          actionAt = 200,
          version = 0,
          actor = {
            id = "p1",
            role = "player",
            seat = 1,
            isOwner = true,
          },
        })
        projection = view(state, { { type = "contract_probe" } }, {
          protocolVersion = 1,
          matchId = "match_contract",
          version = 0,
          serverTime = 200,
          viewer = {
            id = "p1",
            role = "player",
            seat = 1,
            isOwner = true,
          },
        })
        result = {
          players = state.players,
          rejection = rejection,
          projection = projection,
        }
      `);
      const result = lua.global.get("result");

      assert.equal(
        result.players[0],
        "p1",
        `${gamePath} should normalize players`,
      );
      assert.equal(
        result.rejection.accepted,
        false,
        `${gamePath} should reject explicitly`,
      );
      assert.match(result.rejection.error.code, /^[A-Z][A-Z0-9_]{0,63}$/);
      assert.ok(result.rejection.error.message.length > 0);
      assert.ok(
        result.projection.state,
        `${gamePath} view should return state`,
      );
      assert.equal(result.projection.events[0].type, "contract_probe");
    } finally {
      lua.global.close();
    }
  }
});

test("Pig Dice produces a deterministic server-side roll", async () => {
  const result = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      result = on_action(state, { type = "roll" }, { playerId = "a", version = 0 })
    `,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.lastRoll, 4);
  assert.equal(result.state.turnTotal, 4);
  assert.equal(result.state.seed, 5937333);
  assert.equal(result.state.turnIndex, 1);
});

test("Pig Dice clears the turn total on a one and advances the turn", async () => {
  const result = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "00000000000000000000000000000006" })
      state.turnTotal = 18
      result = on_action(state, { type = "roll" }, { playerId = "a", version = 0 })
    `,
  );

  assert.equal(result.state.lastRoll, 1);
  assert.equal(result.state.turnTotal, 0);
  assert.equal(result.state.turnIndex, 2);
  assert.equal(result.events[0].type, "bust");
});

test("Pig Dice banks a winning score and rejects out-of-turn actions", async () => {
  const result = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      rejected = on_action(state, { type = "roll" }, { playerId = "b", version = 0 })
      state.scores.a = 49
      state.turnTotal = 3
      result = on_action(state, { type = "bank" }, { playerId = "a", version = 1 })
    `,
  );
  const rejected = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      result = on_action(state, { type = "roll" }, { playerId = "b", version = 0 })
    `,
  );

  assert.equal(rejected.error.code, "NOT_YOUR_TURN");
  assert.equal(result.state.scores.a, 52);
  assert.equal(result.state.winner, "a");
  assert.equal(result.events[0].type, "won");
});

test("Pig Dice starts a fresh rematch with the other player going first", async () => {
  const result = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      state.scores.a = 52
      state.scores.b = 31
      state.winner = "a"
      state.seed = 456
      result = on_action(state, { type = "rematch" }, { playerId = "b", version = 9 })
    `,
  );

  assert.deepEqual(result.state.scores, { a: 0, b: 0 });
  assert.equal(result.state.winner, "");
  assert.equal(result.state.turnIndex, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.state.seed, 456);
  assert.equal(result.events[0].type, "rematched");
});

test("Connect Four applies gravity and alternates turns", async () => {
  const result = await runLua(
    "games/connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      result = on_action(state, { type = "drop", column = 4 }, { playerId = "red", version = 0 })
    `,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.board[5][3], 1);
  assert.equal(result.state.lastMove.row, 6);
  assert.equal(result.state.lastMove.column, 4);
  assert.equal(result.state.current, 2);
});

test("Connect Four rejects invalid columns and the wrong player", async () => {
  const invalid = await runLua(
    "games/connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      result = on_action(state, { type = "drop", column = 8 }, { playerId = "red", version = 0 })
    `,
  );
  const wrongTurn = await runLua(
    "games/connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      result = on_action(state, { type = "drop", column = 1 }, { playerId = "yellow", version = 0 })
    `,
  );

  assert.equal(invalid.error.code, "INVALID_COLUMN");
  assert.equal(wrongTurn.error.code, "NOT_YOUR_TURN");
});

test("Connect Four detects vertical, horizontal, and diagonal wins", async () => {
  const winners = await runLua(
    "games/connect-four/game.lua",
    `
      vertical = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      vertical.board[6][1] = 1
      vertical.board[5][1] = 1
      vertical.board[4][1] = 1
      vertical.moves = 3
      vertical_result = on_action(vertical, { type = "drop", column = 1 }, { playerId = "red", version = 0 })

      horizontal = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      horizontal.board[6][1] = 1
      horizontal.board[6][2] = 1
      horizontal.board[6][3] = 1
      horizontal.moves = 3
      horizontal_result = on_action(horizontal, { type = "drop", column = 4 }, { playerId = "red", version = 0 })

      diagonal = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      diagonal.board[6][1] = 1
      diagonal.board[5][2] = 1
      diagonal.board[4][3] = 1
      diagonal.board[6][4] = 2
      diagonal.board[5][4] = 2
      diagonal.board[4][4] = 2
      diagonal.moves = 6
      diagonal_result = on_action(diagonal, { type = "drop", column = 4 }, { playerId = "red", version = 0 })

      result = {
        vertical = vertical_result.state,
        horizontal = horizontal_result.state,
        diagonal = diagonal_result.state,
      }
    `,
  );

  for (const state of Object.values(winners)) {
    assert.equal(state.winner, "red");
    assert.equal(state.winnerIndex, 1);
    assert.ok(state.winningCells.length >= 4);
  }
});

test("Connect Four clears the board and rotates the starter for a rematch", async () => {
  const result = await runLua(
    "games/connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = "00000000000000000000000000000001" })
      state.board[6][1] = 1
      state.moves = 1
      state.winner = "red"
      state.winnerIndex = 1
      result = on_action(state, { type = "rematch" }, { playerId = "yellow", version = 8 })
    `,
  );

  assert.equal(result.state.board[5][0], 0);
  assert.equal(result.state.moves, 0);
  assert.equal(result.state.winner, "");
  assert.equal(result.state.current, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.events[0].type, "rematched");
});

test("Dou Dizhu deals a complete deck and awards the bottom cards", async () => {
  const result = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      first = on_action(state, { type = "bid", score = 1 }, { playerId = "a", version = 0 })
      second = on_action(first.state, { type = "bid", score = 0 }, { playerId = "b", version = 1 })
      result = on_action(second.state, { type = "bid", score = 2 }, { playerId = "c", version = 2 })
    `,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "playing");
  assert.equal(result.state.landlord, "c");
  assert.equal(result.state.turnIndex, 3);
  assert.equal(result.state.hands.a.length, 17);
  assert.equal(result.state.hands.b.length, 17);
  assert.equal(result.state.hands.c.length, 20);
  assert.equal(result.state.bottomCards.length, 3);
  assert.equal(result.state.multiplier, 2);
});

test("Dou Dizhu preserves every player's display name", async () => {
  const result = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({
        protocolVersion = 1,
        players = {
          { id = "a", name = "Alice", seat = 1 },
          { id = "b", name = "Bob", seat = 2 },
          { id = "c", name = "Carol", seat = 3 },
        },
        match = {
          id = "match_names",
          ownerId = "a",
          startedAt = 0,
          randomSeed = "0000000000000000000000000000007b",
        },
      })
      setup_names = state.playerNames
      state.winner = "a"
      rematch = on_action(
        state,
        { type = "rematch" },
        { playerId = "a", version = 0 }
      ).state
      result = { setupNames = setup_names, rematchNames = rematch.playerNames }
    `,
  );

  assert.deepEqual(result.setupNames, ["Alice", "Bob", "Carol"]);
  assert.deepEqual(result.rematchNames, ["Alice", "Bob", "Carol"]);
});

test("Dou Dizhu accepts bombs over ordinary hands and rejects lower cards", async () => {
  const result = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "00000000000000000000000000000001" })
      state.phase = "playing"
      state.turnIndex = 1
      state.hands.a = { 1, 2, 3, 4, 5 }
      state.hands.b = { 5, 6, 7, 8, 10 }
      state.hands.c = { 11, 12, 13, 14, 15 }
      first = on_action(state, { type = "play", cards = { 1 } }, { playerId = "a", version = 0 })
      result = on_action(first.state, { type = "play", cards = { 5, 6, 7, 8 } }, { playerId = "b", version = 1 })
    `,
  );

  assert.equal(result.state.lastPlay.type, "bomb");
  assert.equal(result.state.multiplier, 2);
  assert.equal(result.events[0].type, "played");

  const rejected = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "00000000000000000000000000000001" })
      state.phase = "playing"
      state.turnIndex = 1
      state.hands.a = { 9, 10, 11, 12, 13 }
      state.hands.b = { 5, 6, 7, 8, 10 }
      state.hands.c = { 11, 12, 13, 14, 15 }
      first = on_action(state, { type = "play", cards = { 9 } }, { playerId = "a", version = 0 })
      result = on_action(first.state, { type = "play", cards = { 5 } }, { playerId = "b", version = 1 })
    `,
  );
  assert.equal(rejected.error.code, "DOES_NOT_BEAT");
});

test("Dou Dizhu returns the lead after the other two players pass", async () => {
  const result = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "00000000000000000000000000000001" })
      state.phase = "playing"
      state.turnIndex = 1
      state.hands.a = { 1, 2 }
      state.hands.b = { 5, 6 }
      state.hands.c = { 9, 10 }
      played = on_action(state, { type = "play", cards = { 1 } }, { playerId = "a", version = 0 })
      first_pass = on_action(played.state, { type = "pass" }, { playerId = "b", version = 1 })
      result = on_action(first_pass.state, { type = "pass" }, { playerId = "c", version = 2 })
    `,
  );

  assert.equal(result.state.turnIndex, 1);
  assert.equal(result.state.lastPlay, undefined);
  assert.equal(result.events[0].type, "new_trick");
});

test("Dou Dizhu starts a fresh deal with the next player after a rematch", async () => {
  const result = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "00000000000000000000000000000141" })
      state.winner = "a"
      state.winnerIndex = 1
      state.seed = 999
      result = on_action(state, { type = "rematch" }, { playerId = "b", version = 9 })
    `,
  );

  assert.equal(result.state.phase, "bidding");
  assert.equal(result.state.round, 2);
  assert.equal(result.state.starter, 2);
  assert.equal(result.state.turnIndex, 2);
  assert.equal(result.state.hands.a.length, 17);
  assert.equal(result.state.hands.b.length, 17);
  assert.equal(result.state.hands.c.length, 17);
  assert.equal(result.events[0].type, "rematched");
});

test("Werewolf dealer includes the four supported special roles and deals deterministically", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      config = { name = "六人局", roles = {
        { id = "werewolf", name = "狼人", count = 2 },
        { id = "seer", name = "预言家", count = 1 },
        { id = "witch", name = "女巫", count = 1 },
        { id = "hunter", name = "猎人", count = 1 },
        { id = "white_god", name = "白神", count = 1 }
      } }
      first_setup = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      second_setup = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      first = on_action(first_setup, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } }).state
      second = on_action(second_setup, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } }).state
      result = { first = first, second = second }
    `,
  );

  const roles = Object.values(result.first.roles);
  assert.deepEqual(result.first.roles, result.second.roles);
  for (const role of ["seer", "witch", "hunter", "white_god"]) {
    assert.equal(roles.filter((candidate) => candidate.id === role).length, 1);
  }
  assert.equal(
    roles.filter((candidate) => candidate.id === "werewolf").length,
    2,
  );
  assert.equal(result.first.status.a, "alive");
});

test("Werewolf dealer accepts and deals a complete 15-player role pool", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      players = { "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o" }
      state = setup({ players = players, randomSeed = "00000000000000000000000000000141" })
      config = { presetId = "basic-15", name = "十五人局", rules = "十五人规则", roles = {
        { id = "werewolf", name = "狼人", team = "wolf", count = 5 },
        { id = "villager", name = "平民", team = "villager", count = 5 },
        { id = "seer", name = "预言家", team = "god", count = 1 },
        { id = "witch", name = "女巫", team = "god", count = 1 },
        { id = "hunter", name = "猎人", team = "god", count = 1 },
        { id = "guard", name = "守卫", team = "god", count = 1 },
        { id = "white_god", name = "白神", team = "god", count = 1 }
      } }
      dealt = on_action(state, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } })
      result = dealt
    `,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "playing");
  assert.equal(Object.keys(result.state.roles).length, 15);
  assert.equal(result.state.config.rules, "十五人规则");
});

test("Werewolf dealer shares the host preset before dealing", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      config = { presetId = "basic-6", name = "六人局", roles = {
        { id = "werewolf", name = "狼人", team = "wolf", count = 2 },
        { id = "villager", name = "平民", team = "villager", count = 3 },
        { id = "seer", name = "预言家", team = "god", count = 1 }
      } }
      configured = on_action(state, { type = "configure", config = config }, { actor = { id = "a", isOwner = true } })
      guest_view = view(configured.state, {}, { viewer = { id = "b", isOwner = false } }).state
      result = { configured = configured, guest = guest_view }
    `,
  );

  assert.equal(result.configured.accepted, true);
  assert.equal(result.configured.state.phase, "setup");
  assert.equal(result.guest.config.name, "六人局");
  assert.equal(result.guest.config.roles[0].count, 2);
  assert.equal(result.guest.canConfigure, false);
});

test("Werewolf dealer resolves a unanimous vote and removes White God from the field after flipping", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      config = { name = "六人局", roles = {
        { id = "werewolf", name = "狼人", count = 2 },
        { id = "seer", name = "预言家", count = 1 },
        { id = "witch", name = "女巫", count = 1 },
        { id = "hunter", name = "猎人", count = 1 },
        { id = "white_god", name = "白神", count = 1 }
      } }
      state = on_action(state, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } }).state
      state.roles.a = { id = "white_god", name = "白神", mark = "B", team = "god", copy = "" }
      first = on_action(state, { type = "vote", target = "a" }, { playerId = "a", version = 0 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "b", version = 1 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "c", version = 2 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "d", version = 3 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "e", version = 4 })
      final = on_action(state, { type = "vote", target = "a" }, { playerId = "f", version = 5 })
      result = { first = first, final = final }
    `,
  );

  assert.equal(result.first.events[0].type, "vote_cast");
  assert.equal(result.final.accepted, true);
  assert.equal(result.final.events[0].type, "eliminated");
  assert.equal(result.final.state.status.a, "eliminated");
  assert.equal(result.final.state.flips[0].role.id, "white_god");
  assert.equal(result.final.state.flips[0].whiteGod, true);
  assert.deepEqual(result.final.state.votes, {});
});

test("Werewolf dealer clears votes after a tie and starts the next vote round", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      config = { name = "六人局", roles = {
        { id = "werewolf", name = "狼人", count = 2 },
        { id = "seer", name = "预言家", count = 1 },
        { id = "witch", name = "女巫", count = 1 },
        { id = "hunter", name = "猎人", count = 1 },
        { id = "white_god", name = "白神", count = 1 }
      } }
      state = on_action(state, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } }).state
      on_action(state, { type = "vote", target = "a" }, { playerId = "a", version = 0 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "b", version = 1 })
      on_action(state, { type = "vote", target = "a" }, { playerId = "c", version = 2 })
      on_action(state, { type = "vote", target = "b" }, { playerId = "d", version = 3 })
      on_action(state, { type = "vote", target = "b" }, { playerId = "e", version = 4 })
      result = on_action(state, { type = "vote", target = "b" }, { playerId = "f", version = 5 })
    `,
  );

  assert.equal(result.events[0].type, "vote_tied");
  assert.equal(result.state.lastEvent.kind, "tied");
  assert.equal(result.state.voteRound, 2);
  assert.deepEqual(result.state.votes, {});
  assert.equal(result.state.status.a, "alive");
  assert.equal(result.state.status.b, "alive");
});

test("Texas Hold'em deals two unique cards to every seated player and posts blinds", async () => {
  const result = await runLua(
    "games/texas-holdem/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      result = state
    `,
  );

  const dealt = [...Object.values(result.hands).flat(), ...result.board];
  assert.equal(dealt.length, 17);
  assert.equal(new Set(dealt).size, 17);
  assert.equal(result.smallBlind, 2);
  assert.equal(result.bigBlind, 3);
  assert.equal(result.current, 4);
  assert.equal(result.chips.b, 99);
  assert.equal(result.chips.c, 98);
  assert.equal(result.pot, 3);
});

test("Texas Hold'em closes each multi-player betting street only after every player acts", async () => {
  const result = await runLua(
    "games/texas-holdem/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      first = on_action(state, { type = "call" }, { playerId = "a", version = 0 })
      second = on_action(first.state, { type = "call" }, { playerId = "b", version = 1 })
      third = on_action(second.state, { type = "check" }, { playerId = "c", version = 2 })
      flop_first = on_action(third.state, { type = "check" }, { playerId = "b", version = 3 })
      flop_second = on_action(flop_first.state, { type = "check" }, { playerId = "c", version = 4 })
      result = on_action(flop_second.state, { type = "check" }, { playerId = "a", version = 5 })
    `,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.street, 2);
  assert.equal(result.state.revealed, 4);
  assert.equal(result.state.current, 2);
  assert.equal(result.state.pot, 6);
  assert.equal(result.state.chips.a, 98);
  assert.equal(result.state.chips.b, 98);
  assert.equal(result.state.chips.c, 98);
});

test("Texas Hold'em settles main and side pots after multiple all-ins", async () => {
  const result = await runLua(
    "games/texas-holdem/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.chips.a, state.chips.b, state.chips.c = 3, 8, 8
      state.hands.a, state.hands.b, state.hands.c = { 12, 11 }, { 0, 1 }, { 14, 27 }
      state.board = { 8, 9, 10, 26, 39 }
      state.contributions = { a = 0, b = 0, c = 0 }
      state.streetBets = { a = 0, b = 0, c = 0 }
      state.acted = { a = false, b = false, c = false }
      state.allIn = { a = false, b = false, c = false }
      state.folded = { a = false, b = false, c = false }
      state.current, state.currentBet, state.pot, state.street, state.revealed = 1, 0, 0, 0, 0
      first = on_action(state, { type = "all_in" }, { playerId = "a", version = 0 })
      second = on_action(first.state, { type = "all_in" }, { playerId = "b", version = 1 })
      result = on_action(second.state, { type = "call" }, { playerId = "c", version = 2 })
    `,
  );

  assert.equal(result.state.ended, true);
  assert.equal(result.state.revealed, 5);
  assert.equal(result.state.lastPot, 19);
  assert.deepEqual(result.state.payouts, { a: 9, b: 10 });
  assert.equal(result.state.showdownRanks.a, "straight_flush");
  assert.equal(result.state.showdownRanks.b, "flush");
  assert.equal(result.state.showdownRanks.c, "two_pair");
});

test("UNO deals seven cards to each player and uses a coloured opening card", async () => {
  const state = await runLua(
    "games/uno/game.lua",
    `
      result = setup({ players = { "a", "b", "c", "d" }, randomSeed = "0000000000000000000000000000007b" })
    `,
  );

  assert.equal(state.players.length, 4);
  assert.equal(state.hands.a.length, 7);
  assert.equal(state.hands.b.length, 7);
  assert.equal(state.hands.c.length, 7);
  assert.equal(state.hands.d.length, 7);
  assert.notEqual(state.discard[0].color, "wild");
  assert.equal(state.activeColor, state.discard[0].color);
  assert.equal(state.direction, 1);
});

test("UNO advances through four players and skips the next player", async () => {
  const result = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.a = { { id = "red-five", color = "red", value = "5" }, { id = "red-two", color = "red", value = "2" } }
      state.hands.b = { { id = "blue-skip", color = "blue", value = "skip" }, { id = "blue-one", color = "blue", value = "1" } }
      state.discard = { { id = "top-red", color = "red", value = "1" } }
      state.activeColor = "red"
      first = on_action(state, { type = "play", cardId = "red-five" }, { playerId = "a" })
      first.state.discard = { { id = "top-blue", color = "blue", value = "skip" } }
      first.state.activeColor = "blue"
      result = on_action(first.state, { type = "play", cardId = "blue-skip" }, { playerId = "b" })
    `,
  );

  assert.equal(result.state.current, 4);
  assert.equal(result.state.lastEvent.kind, "skip");
});

test("UNO reverse changes direction in multiplayer and acts as a skip with two players", async () => {
  const multiplayer = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.b = { { id = "red-reverse", color = "red", value = "reverse" }, { id = "red-two", color = "red", value = "2" } }
      state.current = 2
      state.discard = { { id = "top-red", color = "red", value = "1" } }
      state.activeColor = "red"
      result = on_action(state, { type = "play", cardId = "red-reverse" }, { playerId = "b" })
    `,
  );
  const twoPlayer = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.a = { { id = "red-reverse", color = "red", value = "reverse" }, { id = "red-two", color = "red", value = "2" } }
      state.discard = { { id = "top-red", color = "red", value = "1" } }
      state.activeColor = "red"
      result = on_action(state, { type = "play", cardId = "red-reverse" }, { playerId = "a" })
    `,
  );

  assert.equal(multiplayer.state.direction, -1);
  assert.equal(multiplayer.state.current, 1);
  assert.equal(twoPlayer.state.direction, -1);
  assert.equal(twoPlayer.state.current, 1);
});

test("UNO applies draw penalties and rejects an illegal wild draw four", async () => {
  const penalty = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.a = { { id = "red-draw2", color = "red", value = "draw2" }, { id = "red-two", color = "red", value = "2" } }
      state.hands.b = {}
      state.discard = { { id = "top-red", color = "red", value = "7" } }
      state.activeColor = "red"
      result = on_action(state, { type = "play", cardId = "red-draw2" }, { playerId = "a" })
    `,
  );
  const illegalWild = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.a = {
        { id = "wild-four", color = "wild", value = "wild4" },
        { id = "red-three", color = "red", value = "3" },
      }
      state.discard = { { id = "top-red", color = "red", value = "7" } }
      state.activeColor = "red"
      result = on_action(state, { type = "play", cardId = "wild-four", color = "blue" }, { playerId = "a" })
    `,
  );

  assert.equal(penalty.accepted, true);
  assert.equal(penalty.state.hands.b.length, 2);
  assert.equal(penalty.state.current, 3);
  assert.equal(penalty.state.lastEvent.kind, "penalty");
  assert.equal(illegalWild.error.code, "CARD_NOT_PLAYABLE");
});

test("UNO accepts a wild colour choice and rotates the rematch starter", async () => {
  const wild = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.hands.a = {
        { id = "wild-card", color = "wild", value = "wild" },
        { id = "red-three", color = "red", value = "3" },
      }
      state.discard = { { id = "top-blue", color = "blue", value = "7" } }
      state.activeColor = "blue"
      result = on_action(state, { type = "play", cardId = "wild-card", color = "green" }, { playerId = "a" })
    `,
  );
  const rematch = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.winner = "a"
      state.starter = 1
      result = on_action(state, { type = "rematch" }, { playerId = "c" })
    `,
  );

  assert.equal(wild.state.activeColor, "green");
  assert.equal(wild.state.current, 2);
  assert.equal(rematch.state.starter, 2);
  assert.equal(rematch.state.current, 2);
  assert.equal(rematch.state.round, 2);
});

test("UNO view exposes only the recipient's cards and public table state", async () => {
  const result = await runLua(
    "games/uno/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      result = view(state, { playerId = "a", version = 0 }).state
    `,
  );

  assert.ok(result.hands.a.every((card) => typeof card.id === "string"));
  assert.ok(result.hands.b.every((card) => card === false));
  assert.ok(result.hands.c.every((card) => card === false));
  assert.equal(result.hands.a.length, 7);
  assert.equal(result.hands.b.length, 7);
  assert.equal(result.deck, undefined);
  assert.equal(result.seed, undefined);
  assert.equal(typeof result.discard.at(-1).id, "string");
});

test("Dou Dizhu view hides other hands and unrevealed bottom cards", async () => {
  const bidding = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      result = view(state, { playerId = "a", version = 0 }).state
    `,
  );
  const playing = await runLua(
    "games/dou-dizhu/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.phase = "playing"
      result = view(state, { playerId = "a", version = 1 }).state
    `,
  );

  assert.ok(bidding.hands.a.every((card) => typeof card === "number"));
  assert.ok(bidding.hands.b.every((card) => card === false));
  assert.ok(bidding.hands.c.every((card) => card === false));
  assert.deepEqual(bidding.bottomCards, [false, false, false]);
  assert.ok(playing.bottomCards.every((card) => typeof card === "number"));
  assert.equal(bidding.seed, undefined);
});

test("Texas Hold'em view hides hole cards and unrevealed community cards", async () => {
  const playing = await runLua(
    "games/texas-holdem/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      result = view(state, { playerId = "a", version = 0 }).state
    `,
  );
  const showdown = await runLua(
    "games/texas-holdem/game.lua",
    `
      state = setup({ players = { "a", "b", "c" }, randomSeed = "0000000000000000000000000000007b" })
      state.ended = true
      state.revealed = 5
      state.folded.c = true
      state.lastEvent = { kind = "showdown" }
      result = view(state, { playerId = "a", version = 1 }).state
    `,
  );

  assert.ok(playing.hands.a.every((card) => typeof card === "number"));
  assert.deepEqual(playing.hands.b, [false, false]);
  assert.deepEqual(playing.hands.c, [false, false]);
  assert.deepEqual(playing.board, [false, false, false, false, false]);
  assert.equal(playing.seed, undefined);
  assert.ok(showdown.hands.b.every((card) => typeof card === "number"));
  assert.deepEqual(showdown.hands.c, [false, false]);
  assert.ok(showdown.board.every((card) => typeof card === "number"));
});

test("Werewolf dealer view hides roles and other players' vote targets", async () => {
  const result = await runLua(
    "games/werewolf-dealer/game.lua",
    `
      state = setup({ players = { "a", "b", "c", "d", "e", "f" }, randomSeed = "0000000000000000000000000000007b" })
      config = { name = "六人局", roles = {
        { id = "werewolf", name = "狼人", count = 2 },
        { id = "seer", name = "预言家", count = 1 },
        { id = "witch", name = "女巫", count = 1 },
        { id = "hunter", name = "猎人", count = 1 },
        { id = "white_god", name = "白神", count = 1 }
      } }
      state = on_action(state, { type = "deal", config = config }, { actor = { id = "a", isOwner = true } }).state
      state.votes.a = "b"
      state.votes.b = "c"
      result = view(state, { playerId = "a", version = 2 }).state
    `,
  );

  assert.equal(typeof result.roles.a, "object");
  assert.equal(result.roles.b, undefined);
  assert.equal(Object.keys(result.roles).length, 1);
  assert.equal(result.votes.a, "b");
  assert.equal(result.votes.b, true);
  assert.equal(result.seed, undefined);
});

test("Pig Dice view hides the random seed used for future rolls", async () => {
  const result = await runLua(
    "games/pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = "0000000000000000000000000000007b" })
      result = view(state, { playerId = "a", version = 0 }).state
    `,
  );

  assert.equal(result.seed, undefined);
  assert.deepEqual(result.scores, { a: 0, b: 0 });
  assert.equal(result.turnIndex, 1);
});
