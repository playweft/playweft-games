import { LuaFactory } from "wasmoon";
import { fetchGameResource } from "./game-offline-cache.js";

const LOCAL_BRIDGE = String.raw`
local __local_state = nil
local __local_events = {}
local __local_version = 0
local __local_match_id = ""
local __local_paipu_index = 1
local __local_setup_context = nil

local function __local_context(actor_id, action_at)
  local seat = nil
  for index, id in ipairs(__local_state.players or {}) do
    if id == actor_id then seat = index break end
  end
  return {
    protocolVersion = 1,
    matchId = __local_match_id,
    actionId = "local_" .. tostring(__local_version + 1),
    actionAt = action_at,
    version = __local_version,
    actor = {
      id = actor_id,
      role = "player",
      seat = seat,
      isOwner = seat == 1,
    },
  }
end

local function __local_viewer_context(viewer_id, server_time, view_options)
  local seat = nil
  for index, id in ipairs(__local_state.players or {}) do
    if id == viewer_id then seat = index break end
  end
  return {
    protocolVersion = 1,
    matchId = __local_match_id,
    version = __local_version,
    serverTime = server_time,
    viewer = {
      id = viewer_id,
      role = "player",
      seat = seat,
      isOwner = seat == 1,
      revealAllHands = type(view_options) == "table" and view_options.revealAllHands == true or false,
    },
  }
end

local function __local_start(context, match_id, server_time, viewer_id)
  __local_match_id = match_id
  __local_version = 0
  __local_events = {}
	__local_paipu_index = 1
	__local_state = setup(context)
	if type(__local_state.paipu) == "table" then
		__local_state.paipu.createdAtMs = server_time
		__local_state.paipu.recordIndex = __local_paipu_index
	end
  return {
    accepted = true,
    version = __local_version,
    projection = view(
      __local_state,
      __local_events,
      __local_viewer_context(viewer_id or context.players[1].id, server_time)
    ),
  }
end

function __playweft_local_setup(context, match_id, server_time)
  __local_setup_context = context
  return __local_start(context, match_id, server_time, context.players[1].id)
end

function __playweft_local_load_replay_hand(replay_hand, viewer_id, server_time)
  if type(__local_setup_context) ~= "table" then
    error("Local game has not been initialized")
  end
  local base_match = __local_setup_context.match or {}
  local settings = {}
  if type(base_match.settings) == "table" then
    for key, value in pairs(base_match.settings) do
      settings[key] = value
    end
  end
  settings.replayHand = replay_hand
  settings.replayWalls = nil
  return __local_start({
    protocolVersion = __local_setup_context.protocolVersion,
    players = __local_setup_context.players,
    match = {
      id = base_match.id,
      ownerId = base_match.ownerId,
      startedAt = base_match.startedAt,
      randomSeed = base_match.randomSeed,
      settings = settings,
    },
  }, __local_match_id, server_time, viewer_id)
end

function __playweft_local_view(viewer_id, server_time, view_options)
  return view(
    __local_state,
    __local_events,
    __local_viewer_context(viewer_id, server_time, view_options)
  )
end

function __playweft_local_action(action, actor_id, action_at)
  local result = on_action(
    __local_state,
    action,
    __local_context(actor_id, action_at)
  )
  if result.accepted == true then
    __local_state = result.state
    __local_events = result.events or {}
    __local_version = __local_version + 1
	if action.type == "new_match" then
		__local_paipu_index = __local_paipu_index + 1
		if type(__local_state.paipu) == "table" then
			__local_state.paipu.createdAtMs = action_at
			__local_state.paipu.recordIndex = __local_paipu_index
		end
	elseif type(record_paipu_action) == "function" then
		record_paipu_action(__local_state, action, actor_id, result.events)
	end
  end
  return {
    accepted = result.accepted == true,
    error = result.error,
    version = __local_version,
    events = result.events or {},
  }
end

function __playweft_local_ai_turn(viewer_id, server_time)
  local decision = __playweft_local_ai_decision(viewer_id)
  local projection = __playweft_local_view(viewer_id, server_time)
  if decision.status ~= "acted" then
    decision.projection = projection
    return decision
  end
  local result = __playweft_local_action(decision.action, decision.actorId, server_time)
  if result.accepted ~= true then
    error("AI action was rejected")
  end
  decision.result = result
  decision.projection = __playweft_local_view(viewer_id, server_time)
  return decision
end

function __playweft_local_ai_decision(viewer_id)
  local actor_id = nil
  if __local_state.phase == "playing" then
    actor_id = __local_state.players[__local_state.turnIndex]
  elseif __local_state.phase == "claiming" then
    local claimant = __local_state.claimants[__local_state.claimIndex]
    actor_id = claimant and claimant.playerId or nil
  end

  if not actor_id then
    return { status = "idle", version = __local_version }
  end
  if actor_id == viewer_id then
    return {
      status = "waiting_for_human",
      actorId = actor_id,
      version = __local_version,
    }
  end
  if type(ai_action) ~= "function" then
    error("Local game does not provide an AI action")
  end
  local action = ai_action(__local_state, actor_id)
  if type(action) ~= "table" then
    error("AI did not provide an action for the active player")
  end
  return {
    status = "acted",
    actorId = actor_id,
    action = action,
    version = __local_version,
  }
end

function __playweft_local_ai_review(state, actor_id, action)
  if type(ai_action_review) ~= "function" then return nil end
  return ai_action_review(state, actor_id, action)
end

function __playweft_local_ai_action(state, actor_id)
  if type(state) ~= "table" or type(actor_id) ~= "string" then
    error("AI action requires a state and actor id")
  end
  if type(ai_action) ~= "function" then
    error("Local game does not provide an AI action")
  end
  local action = ai_action(state, actor_id)
  if type(action) ~= "table" then
    return { status = "idle", actorId = actor_id }
  end
  return { status = "acted", actorId = actor_id, action = action }
end

function __playweft_local_legal_actions(state, viewer_id)
  if type(state) ~= "table" or type(viewer_id) ~= "string" then
    error("Legal-action preview requires a state and viewer id")
  end
  local legal = legal_actions(state, viewer_id)
  legal.furiten = is_furiten(state, viewer_id)
  return legal
end

local function __playweft_local_tenpai_witness(hand, melds, waits)
  local winning_kind = waits[1]
  if not winning_kind then return nil end
  local candidate = copy_array(hand)
  candidate[#candidate + 1] = (winning_kind - 1) * 4 + 1
  -- The room verifier intentionally accepts only standard-hand witnesses.
  -- Special-hand waits simply omit a report and use the server fallback.
  for _, decomposition in ipairs(standard_decompositions(candidate, melds)) do
    local groups = {}
    for _, group in ipairs(decomposition.groups) do
      groups[#groups + 1] = { kind = group.kind, tile = group.tile }
    end
    return {
      kind = winning_kind,
      form = "standard",
      pair = decomposition.pair,
      groups = groups,
    }
  end
  return nil
end

function __playweft_local_tenpai_reports(state, viewer_id)
  if type(state) ~= "table" or type(viewer_id) ~= "string" then
    error("Tenpai reports require a state and viewer id")
  end
  if state.phase ~= "playing" or state.players[state.turnIndex] ~= viewer_id then
    return {}
  end
  local melds = state.melds[viewer_id] or {}
  local hand = copy_array(state.hands[viewer_id] or {})
  if (tonumber(state.drawnTile) or 0) > 0 then
    hand[#hand + 1] = state.drawnTile
  end
  local reports = {}
  for index, tile in ipairs(hand) do
    local after = copy_array(hand)
    table.remove(after, index)
    local waits = waiting_types(after, melds)
    if #waits == 0 then
      reports[tile] = { key = tenpai_hand_key(after, melds), tenpai = false }
    else
      local witness = __playweft_local_tenpai_witness(after, melds, waits)
      if witness then
        reports[tile] = {
          key = tenpai_hand_key(after, melds),
          tenpai = true,
          waits = waits,
          witness = witness,
        }
      end
    end
  end
  return reports
end

function __playweft_local_tenpai_report(state, viewer_id, discarded_tile)
  if type(state) ~= "table" or type(viewer_id) ~= "string" then
    error("Tenpai report requires a state and viewer id")
  end
  if state.phase ~= "playing" or state.players[state.turnIndex] ~= viewer_id then
    return nil
  end
  local melds = state.melds[viewer_id] or {}
  local hand = copy_array(state.hands[viewer_id] or {})
  if (tonumber(state.drawnTile) or 0) > 0 then
    hand[#hand + 1] = state.drawnTile
  end
  local removed = false
  for index, tile in ipairs(hand) do
    if tile == discarded_tile then
      table.remove(hand, index)
      removed = true
      break
    end
  end
  if not removed then return nil end
  local waits = waiting_types(hand, melds)
  if #waits == 0 then
    return { key = tenpai_hand_key(hand, melds), tenpai = false }
  end
  local witness = __playweft_local_tenpai_witness(hand, melds, waits)
  if not witness then return nil end
  return {
    key = tenpai_hand_key(hand, melds),
    tenpai = true,
    waits = waits,
    witness = witness,
  }
end

function __playweft_local_current_tenpai_report(state, viewer_id)
  if type(state) ~= "table" or type(viewer_id) ~= "string" then
    error("Current tenpai report requires a state and viewer id")
  end
  local melds = state.melds[viewer_id] or {}
  local hand = copy_array(state.hands[viewer_id] or {})
  local riichi_locked = state.riichi and state.riichi[viewer_id] == true
  if state.players[state.turnIndex] == viewer_id
    and (tonumber(state.drawnTile) or 0) > 0
    and not riichi_locked then
    return nil
  end
  local waits = waiting_types(hand, melds)
  if #waits == 0 then
    return { key = tenpai_hand_key(hand, melds), tenpai = false }
  end
  return {
    key = tenpai_hand_key(hand, melds),
    tenpai = true,
    waits = waits,
    furiten = is_furiten(state, viewer_id),
  }
end

-- Riichi waits are locked when the declaration succeeds.  Rebuilding this
-- small report must work from a room projection on every later turn, where
-- the normal legal-action context (including private furiten flags) is not
-- intentionally available.
function __playweft_local_riichi_wait_report(state, viewer_id)
  if type(state) ~= "table" or type(viewer_id) ~= "string" then
    error("Riichi wait report requires a state and viewer id")
  end
  local melds = state.melds[viewer_id] or {}
  local hand = copy_array(state.hands[viewer_id] or {})
  local waits = waiting_types(hand, melds)
  if #waits == 0 then
    return { key = tenpai_hand_key(hand, melds), tenpai = false }
  end
  return {
    key = tenpai_hand_key(hand, melds),
    tenpai = true,
    waits = waits,
  }
end

function __playweft_local_current_game_tenpai_report(viewer_id)
  return __playweft_local_current_tenpai_report(__local_state, viewer_id)
end

function __playweft_local_checkpoint()
  return {
    state = __local_state,
    events = __local_events,
    version = __local_version,
  }
end

function __playweft_local_paipu(server_time)
	if type(export_paipu) ~= "function" then
		error("Local game does not provide a paipu exporter")
	end
	local record = export_paipu(__local_state)
	if type(record) ~= "table" then
		return nil
	end
	record.id = __local_match_id .. ":" .. tostring(__local_paipu_index)
	record.createdAtMs = __local_state.paipu and __local_state.paipu.createdAtMs or nil
	if record.status == "completed" then
		record.completedAtMs = server_time
	end
	return record
end

function __playweft_local_restore(checkpoint, viewer_id, server_time)
  if type(checkpoint) ~= "table" or type(checkpoint.state) ~= "table" then
    error("Invalid local game checkpoint")
  end
  __local_state = checkpoint.state
  __local_events = type(checkpoint.events) == "table" and checkpoint.events or {}
  __local_version = math.max(0, math.floor(tonumber(checkpoint.version) or 0))
	__local_paipu_index = math.max(1, math.floor(tonumber(__local_state.paipu and __local_state.paipu.recordIndex) or 1))
  return __playweft_local_view(viewer_id, server_time)
end
`;

/**
 * Runs a Playweft Lua game entirely in the browser while retaining the same
 * setup/on_action/view contract used by the room runtime.
 */
export async function createLocalLuaGame({
  sourceUrl,
  extraSourceUrls = [],
  players,
  playerId = players?.[0]?.id,
  randomSeed = crypto.randomUUID().replaceAll("-", ""),
  matchId = `solo-${crypto.randomUUID()}`,
  settings = {},
  resourcePolicy,
  resourceMode,
  buildVersion,
} = {}) {
  if (!sourceUrl || !Array.isArray(players) || players.length === 0) {
    throw new TypeError("sourceUrl and at least one player are required");
  }

  const sourceUrls = [sourceUrl, ...extraSourceUrls];
  const sources = await Promise.all(
    sourceUrls.map(async (url) => {
      const response = await fetchGameResource(url, {
        gameId: "mahjong",
        mode: resourceMode,
        policy: resourcePolicy,
        buildVersion,
      });
      if (!response.ok) {
        throw new Error(`Unable to load Lua rules (${response.status})`);
      }
      return response.text();
    }),
  );
  // Keep the sources in one Lua chunk. The shared rules deliberately use
  // local helpers, so executing the files separately would hide them from
  // an appended solo AI or replay extension.
  const source = sources.join("\n");
  // Materialize JS objects as Lua tables. Wasmoon's proxy mode exposes them as
  // userdata, which would not match the room runtime's ordinary action tables.
  const lua = await new LuaFactory().createEngine({ enableProxy: false });
  let closed = false;

  try {
    await lua.doString(`${source}\n${LOCAL_BRIDGE}`);
    const setupLocal = lua.global.get("__playweft_local_setup");
    const readView = lua.global.get("__playweft_local_view");
    const applyAction = lua.global.get("__playweft_local_action");
    const loadReplayHand = lua.global.get("__playweft_local_load_replay_hand");
    const advanceAiTurn = lua.global.get("__playweft_local_ai_turn");
    const decideCurrentAiAction = lua.global.get("__playweft_local_ai_decision");
    const decideAiAction = lua.global.get("__playweft_local_ai_action");
    const reviewAiAction = lua.global.get("__playweft_local_ai_review");
    const readLegalActions = lua.global.get("__playweft_local_legal_actions");
    const readTenpaiReports = lua.global.get("__playweft_local_tenpai_reports");
    const readTenpaiReport = lua.global.get("__playweft_local_tenpai_report");
    const readCurrentTenpaiReport = lua.global.get("__playweft_local_current_tenpai_report");
    const readRiichiWaitReport = lua.global.get("__playweft_local_riichi_wait_report");
    const readCurrentGameTenpaiReport = lua.global.get("__playweft_local_current_game_tenpai_report");
    const createCheckpoint = lua.global.get("__playweft_local_checkpoint");
    const restoreCheckpoint = lua.global.get("__playweft_local_restore");
    const exportPaipu = lua.global.get("__playweft_local_paipu");
    const context = {
      protocolVersion: 1,
      players: players.map((player, index) => ({
        id: player.id,
        name: player.name ?? "",
        seat: index + 1,
      })),
      match: {
        id: matchId,
        ownerId: players[0].id,
        startedAt: Date.now(),
        randomSeed: normalizeSeed(randomSeed),
        settings,
      },
    };

    setupLocal(context, matchId, Date.now());

    return {
      matchId,
      playerId,
      view(viewerId = playerId, viewOptions = {}) {
        ensureOpen(closed);
        return readView(viewerId, Date.now(), viewOptions);
      },
      action(action, actorId = playerId) {
        ensureOpen(closed);
        return applyAction(action, actorId, Date.now());
      },
      restart(viewerId = playerId) {
        ensureOpen(closed);
        setupLocal(context, matchId, Date.now());
        return readView(viewerId, Date.now());
      },
      loadReplayHand(replayHand, viewerId = playerId) {
        ensureOpen(closed);
        return loadReplayHand(replayHand, viewerId, Date.now()).projection;
      },
      aiTurn(viewerId = playerId) {
        ensureOpen(closed);
        return advanceAiTurn(viewerId, Date.now());
      },
      aiDecision(viewerId = playerId) {
        ensureOpen(closed);
        return decideCurrentAiAction(viewerId);
      },
      aiActionReview(state, actorId, action) {
        ensureOpen(closed);
        return reviewAiAction(state, actorId, action);
      },
      aiAction(state, actorId) {
        ensureOpen(closed);
        return decideAiAction(state, actorId);
      },
      legalActions(state, viewerId = playerId) {
        ensureOpen(closed);
        return readLegalActions(state, viewerId);
      },
      tenpaiReports(state, viewerId = playerId) {
        ensureOpen(closed);
        return readTenpaiReports(state, viewerId);
      },
      tenpaiReport(state, tileId, viewerId = playerId) {
        ensureOpen(closed);
        return readTenpaiReport(state, viewerId, Number(tileId));
      },
      currentTenpaiReport(state, viewerId = playerId) {
        ensureOpen(closed);
        return readCurrentTenpaiReport(state, viewerId);
      },
      riichiWaitReport(state, viewerId = playerId) {
        ensureOpen(closed);
        return readRiichiWaitReport(state, viewerId);
      },
      currentGameTenpaiReport(viewerId = playerId) {
        ensureOpen(closed);
        return readCurrentGameTenpaiReport(viewerId);
      },
      checkpoint() {
        ensureOpen(closed);
        return createCheckpoint();
      },
      exportPaipu() {
        ensureOpen(closed);
        return exportPaipu(Date.now());
      },
      restoreCheckpoint(checkpoint, viewerId = playerId) {
        ensureOpen(closed);
        return restoreCheckpoint(
          {
            state: checkpoint?.state,
            events: checkpoint?.events,
            version: checkpoint?.stateVersion,
          },
          viewerId,
          Date.now(),
        );
      },
      close() {
        if (closed) return;
        closed = true;
        lua.global.close();
      },
    };
  } catch (error) {
    lua.global.close();
    throw error;
  }
}

function normalizeSeed(seed) {
  const text = String(seed ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(text)) return text;
  throw new TypeError("randomSeed must be a 32-character lowercase hexadecimal string");
}

function ensureOpen(closed) {
  if (closed) throw new Error("The local Lua game is closed");
}
