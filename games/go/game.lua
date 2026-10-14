local DEFAULT_SIZE = 19
local DEFAULT_KOMI = 6.5
local DIRECTIONS = { { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } }
local RANDOM_MODULUS = 2147483647

local function normalize_random_seed(value)
  local seed = 0
  local text = tostring(value or "")
  for index = 1, #text do
    local digit = tonumber(string.sub(text, index, index), 16)
    if digit then seed = (seed * 16 + digit) % RANDOM_MODULUS end
  end
  return seed == 0 and 1 or seed
end

local function setup_players(context)
  local players, player_names = {}, {}
  for _, player in ipairs(context.players) do
    table.insert(players, player.id)
    table.insert(
      player_names,
      type(player.name) == "string" and player.name or ""
    )
  end
  return players, player_names
end

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(state, reason)
  return {
    accepted = false,
    error = {
      code = string.upper(reason),
      message = string.gsub(reason, "_", " "),
    },
  }
end

local function point_key(row, column)
  return row .. ":" .. column
end

local function inside(board, row, column)
  local size = #board
  return row >= 1 and row <= size and column >= 1 and column <= size
end

local function empty_board(size)
  local board = {}
  for row = 1, size do
    board[row] = {}
    for column = 1, size do board[row][column] = 0 end
  end
  return board
end

local function copy_board(board)
  local copy = {}
  for row = 1, #board do
    copy[row] = {}
    for column = 1, #board do copy[row][column] = board[row][column] end
  end
  return copy
end

local function copy_list(values)
  local copy = {}
  for index, value in ipairs(values or {}) do copy[index] = value end
  return copy
end

local function copy_record(value)
  local copy = {}
  for key, field in pairs(value or {}) do copy[key] = field end
  return copy
end

local function undo_snapshot(state)
  return {
    phase = state.phase,
    board = copy_board(state.board),
    current = state.current,
    captures = copy_list(state.captures),
    timeUsed = copy_list(state.timeUsed),
    scoreRound = state.scoreRound,
    scoreSubmitted = copy_list(state.scoreSubmitted),
    consecutivePasses = state.consecutivePasses,
    moves = state.moves,
    previousBoard = state.previousBoard,
    lastMove = copy_record(state.lastMove),
    lastEvent = copy_record(state.lastEvent),
  }
end

local function restore_undo_snapshot(state, snapshot, context)
  state.phase = snapshot.phase
  state.board = copy_board(snapshot.board)
  state.current = snapshot.current
  state.captures = copy_list(snapshot.captures)
  state.timeUsed = copy_list(snapshot.timeUsed)
  local now = tonumber(context and context.actionAt)
  state.turnStartedAt = now and now >= 0 and now or 0
  state.scoreRound = snapshot.scoreRound
  state.scoreSubmitted = copy_list(snapshot.scoreSubmitted)
  state.scoreProposals = {}
  state.consecutivePasses = snapshot.consecutivePasses
  state.moves = snapshot.moves
  state.previousBoard = snapshot.previousBoard
  state.lastMove = copy_record(snapshot.lastMove)
  state.lastEvent = copy_record(snapshot.lastEvent)
  state.undoRequest = nil
  state.undoSnapshot = nil
  state.undoAvailable = false
end

local function board_signature(board)
  local parts = {}
  for row = 1, #board do
    for column = 1, #board do
      parts[#parts + 1] = tostring(board[row][column])
    end
  end
  return table.concat(parts)
end

local function collect_group(board, start_row, start_column)
  local color = board[start_row][start_column]
  local group, liberties = {}, {}
  local visited = { [point_key(start_row, start_column)] = true }
  local stack = { { row = start_row, column = start_column } }

  while #stack > 0 do
    local point = table.remove(stack)
    group[#group + 1] = point
    for _, direction in ipairs(DIRECTIONS) do
      local row = point.row + direction[1]
      local column = point.column + direction[2]
      if inside(board, row, column) then
        local value = board[row][column]
        local key = point_key(row, column)
        if value == 0 then
          liberties[key] = true
        elseif value == color and not visited[key] then
          visited[key] = true
          stack[#stack + 1] = { row = row, column = column }
        end
      end
    end
  end

  local liberty_count = 0
  for _ in pairs(liberties) do liberty_count = liberty_count + 1 end
  return group, liberty_count
end

local function remove_group(board, group)
  for _, point in ipairs(group) do board[point.row][point.column] = 0 end
end

local function color_for_player(state, index)
  return index == state.blackIndex and 1 or 2
end

local function next_seed(seed)
  return (math.floor(math.abs(seed or 1)) * 48271) % 2147483647
end

local function normalized_settings(action)
  local size = tonumber(action.size)
  local rules = action.rules
  local komi = tonumber(action.komi)
  local handicap = tonumber(action.handicap)
  local black_mode = action.blackMode

  if size ~= 9 and size ~= 13 and size ~= 19 then return nil, "invalid_size" end
  if rules ~= "chinese" and rules ~= "japanese" then return nil, "invalid_rules" end
  if not komi or komi ~= komi or komi < 0 or komi > 20 then
    return nil, "invalid_komi"
  end
  if handicap ~= 0 and (not handicap or handicap % 1 ~= 0 or handicap < 2 or handicap > 9) then
    return nil, "invalid_handicap"
  end
  if black_mode ~= "random" and black_mode ~= "player1" and black_mode ~= "player2" then
    return nil, "invalid_black_mode"
  end
  if handicap > 0 and black_mode == "random" then
    return nil, "handicap_requires_fixed_black"
  end

  return {
    size = size,
    rules = rules,
    komi = komi,
    handicap = handicap,
    blackMode = black_mode,
  }
end

local function choose_black(settings, seed)
  if settings.blackMode == "player1" then return 1, seed end
  if settings.blackMode == "player2" then return 2, seed end
  local updated_seed = next_seed(seed)
  return (updated_seed % 2) + 1, updated_seed
end

local function handicap_points(size)
  local low = size == 9 and 3 or 4
  local high = size - low + 1
  local center = (size + 1) / 2
  return {
    { low, high },
    { high, low },
    { high, high },
    { low, low },
    { center, center },
    { low, center },
    { high, center },
    { center, low },
    { center, high },
  }
end

local function place_handicap(board, count)
  if count <= 0 then return end
  local points = handicap_points(#board)
  local indexes
  if count <= 4 then
    indexes = {}
    for index = 1, count do indexes[#indexes + 1] = index end
  elseif count == 5 then
    indexes = { 1, 2, 3, 4, 5 }
  elseif count == 6 then
    indexes = { 1, 2, 3, 4, 6, 7 }
  elseif count == 7 then
    indexes = { 1, 2, 3, 4, 6, 7, 5 }
  elseif count == 8 then
    indexes = { 1, 2, 3, 4, 6, 7, 8, 9 }
  else
    indexes = { 1, 2, 3, 4, 6, 7, 8, 9, 5 }
  end
  for _, index in ipairs(indexes) do
    local point = points[index]
    board[point[1]][point[2]] = 1
  end
end

local function action_time(context, fallback)
  local value = tonumber(context and context.actionAt)
  if value and value >= 0 then return value end
  return tonumber(fallback) or 0
end

local function record_turn_time(state, index, context)
  local now = action_time(context, state.turnStartedAt)
  local started_at = tonumber(state.turnStartedAt) or now
  state.timeUsed = state.timeUsed or { 0, 0 }
  state.timeUsed[index] =
    (tonumber(state.timeUsed[index]) or 0) + math.max(0, now - started_at)
  state.turnStartedAt = now
end

local SCORE_COUNT_FIELDS = {
  "blackStones",
  "whiteStones",
  "blackTerritory",
  "whiteTerritory",
  "neutral",
}

local function valid_number(value)
  return type(value) == "number"
    and value == value
    and value ~= math.huge
    and value ~= -math.huge
end

local function normalized_score(state, proposal)
  if type(proposal) ~= "table" then return nil, "invalid_score" end
  if proposal.rules ~= state.settings.rules
    or proposal.komi ~= state.settings.komi then
    return nil, "invalid_score"
  end

  local score = {
    rules = proposal.rules,
    komi = proposal.komi,
  }
  local covered = 0
  for _, field in ipairs(SCORE_COUNT_FIELDS) do
    local value = proposal[field]
    if not valid_number(value) or value < 0 or value % 1 ~= 0 then
      return nil, "invalid_score"
    end
    score[field] = value
    covered = covered + value
  end
  if covered ~= state.settings.size * state.settings.size then
    return nil, "invalid_score"
  end

  local white_index = (state.blackIndex % #state.players) + 1
  if state.settings.rules == "japanese" then
    score.black =
      score.blackTerritory + (state.captures[state.blackIndex] or 0)
    score.white =
      score.whiteTerritory + (state.captures[white_index] or 0) + score.komi
  else
    score.black = score.blackStones + score.blackTerritory
    score.white = score.whiteStones + score.whiteTerritory + score.komi
  end
  if proposal.black ~= score.black or proposal.white ~= score.white then
    return nil, "invalid_score"
  end
  return score
end

local function same_score(left, right)
  if not left or not right then return false end
  if left.rules ~= right.rules
    or left.komi ~= right.komi
    or left.black ~= right.black
    or left.white ~= right.white then
    return false
  end
  for _, field in ipairs(SCORE_COUNT_FIELDS) do
    if left[field] ~= right[field] then return false end
  end
  return true
end

local function new_round(
  players,
  player_names,
  round,
  settings,
  seed,
  host_id,
  started_at
)
  local black_index, updated_seed = choose_black(settings, seed)
  local board = empty_board(settings.size)
  place_handicap(board, settings.handicap)
  local white_index = (black_index % #players) + 1
  return {
    players = players,
    playerNames = player_names,
    hostId = host_id,
    phase = "playing",
    settings = settings,
    board = board,
    current = settings.handicap > 0 and white_index or black_index,
    blackIndex = black_index,
    captures = { 0, 0 },
    timeUsed = { 0, 0 },
    turnStartedAt = action_time({ actionAt = started_at }, 0),
    scoreRound = 0,
    scoreSubmitted = { false, false },
    scoreProposals = {},
    consecutivePasses = 0,
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    scores = {
      black = 0,
      white = 0,
      blackStones = settings.handicap,
      whiteStones = 0,
      blackTerritory = 0,
      whiteTerritory = 0,
      neutral = 0,
      komi = settings.komi,
      rules = settings.rules,
    },
    previousBoard = "",
    undoAvailable = false,
    lastMove = { row = 0, column = 0 },
    lastEvent = {
      kind = settings.handicap > 0 and "handicap" or "start",
      playerIndex = black_index,
      captured = 0,
    },
    round = round,
    seed = updated_seed,
  }
end

local function setup_state(players, player_names, round, settings, seed, host_id)
  return {
    players = players,
    playerNames = player_names,
    hostId = host_id,
    phase = "setup",
    settings = settings,
    board = empty_board(settings.size),
    current = 0,
    blackIndex = 1,
    captures = { 0, 0 },
    timeUsed = { 0, 0 },
    turnStartedAt = 0,
    scoreRound = 0,
    scoreSubmitted = { false, false },
    scoreProposals = {},
    consecutivePasses = 0,
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    scores = {
      black = 0,
      white = 0,
      komi = settings.komi,
      rules = settings.rules,
    },
    previousBoard = "",
    undoAvailable = false,
    lastMove = { row = 0, column = 0 },
    lastEvent = { kind = "setup", playerIndex = 1, captured = 0 },
    round = round,
    seed = seed,
  }
end

function setup(context)
  local players, player_names = setup_players(context)
  local settings = {
    size = DEFAULT_SIZE,
    rules = "chinese",
    komi = DEFAULT_KOMI,
    handicap = 0,
    blackMode = "random",
  }
  return setup_state(
    players,
    player_names,
    1,
    settings,
    normalize_random_seed(context.match.randomSeed),
    context.match.ownerId
  )
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected(state, "invalid_action") end
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)

  if state.phase == "setup" then
    if not context.actor.isOwner then return rejected(state, "only_host_can_setup") end
    if action.type == "update_settings" then
      local settings, reason = normalized_settings(action)
      if not settings then return rejected(state, reason) end
      local next_state = setup_state(
        state.players,
        state.playerNames,
        state.round or 1,
        settings,
        state.seed,
        state.hostId
      )
      return {
        accepted = true,
        state = next_state,
        events = { { type = "settings_updated", player = actor_id } },
      }
    end
    if action.type ~= "start" then return rejected(state, "setup_required") end
    local settings, reason = normalized_settings(action)
    if not settings then return rejected(state, reason) end
    local next_state = new_round(
      state.players,
      state.playerNames,
      state.round or 1,
      settings,
      state.seed,
      state.hostId,
      context.actionAt
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "started", player = actor_id } },
    }
  end

  if not index then return rejected(state, "not_a_player") end

  if action.type == "rematch" then
    if not state.ended then return rejected(state, "game_not_over") end
    local next_state = new_round(
      state.players,
      state.playerNames,
      (state.round or 1) + 1,
      state.settings,
      state.seed,
      state.hostId,
      context.actionAt
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if action.type == "configure" then
    if not state.ended then return rejected(state, "game_not_over") end
    local next_state = setup_state(
      state.players,
      state.playerNames,
      (state.round or 1) + 1,
      state.settings,
      state.seed,
      state.hostId
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "configuration_opened", player = actor_id } },
    }
  end

  if action.type == "resign" then
    if state.ended then return rejected(state, "game_over") end
    if state.phase == "playing" and tonumber(state.current) and state.current > 0 then
      record_turn_time(state, state.current, context)
    end
    state.ended = true
    state.phase = "ended"
    state.current = 0
    state.winnerIndex = (index % #state.players) + 1
    state.winner = state.players[state.winnerIndex]
    state.lastEvent = { kind = "resigned", playerIndex = index, captured = 0 }
    return {
      accepted = true,
      state = state,
      events = {
        { type = "resigned", player = actor_id, winner = state.winner },
      },
    }
  end

  if action.type == "request_undo" then
    if state.ended or state.phase ~= "playing" then
      return rejected(state, "undo_unavailable")
    end
    if not state.undoAvailable or not state.undoSnapshot or (state.moves or 0) <= 0 then
      return rejected(state, "no_move_to_undo")
    end
    if state.undoRequest then return rejected(state, "undo_already_requested") end
    if tonumber(state.lastEvent and state.lastEvent.playerIndex) ~= index then
      return rejected(state, "only_last_player_can_undo")
    end
    state.undoRequest = { requesterIndex = index }
    return {
      accepted = true,
      state = state,
      events = { { type = "undo_requested", player = actor_id } },
    }
  end

  if action.type == "respond_undo" then
    if not state.undoRequest then return rejected(state, "no_undo_request") end
    if tonumber(state.undoRequest.requesterIndex) == index then
      return rejected(state, "undo_requester_cannot_respond")
    end
    if type(action.accept) ~= "boolean" then
      return rejected(state, "invalid_undo_response")
    end
    local requester_index = tonumber(state.undoRequest.requesterIndex)
    local requester_id = state.players[requester_index]
    if action.accept then
      restore_undo_snapshot(state, state.undoSnapshot, context)
      return {
        accepted = true,
        state = state,
        events = {
          { type = "undo_accepted", player = actor_id, requester = requester_id },
        },
      }
    end
    state.undoRequest = nil
    state.undoSnapshot = nil
    state.undoAvailable = false
    return {
      accepted = true,
      state = state,
      events = {
        { type = "undo_rejected", player = actor_id, requester = requester_id },
      },
    }
  end

  if state.phase == "scoring" then
    if action.type ~= "score" then return rejected(state, "scoring_required") end
    if tonumber(action.scoreRound) ~= tonumber(state.scoreRound) then
      return rejected(state, "stale_score_round")
    end
    state.scoreSubmitted = state.scoreSubmitted or { false, false }
    state.scoreProposals = state.scoreProposals or {}
    if state.scoreSubmitted[index] then
      return rejected(state, "score_already_submitted")
    end
    local score, reason = normalized_score(state, action.score)
    if not score then return rejected(state, reason) end

    state.scoreProposals[index] = score
    state.scoreSubmitted[index] = true
    if not state.scoreSubmitted[1] or not state.scoreSubmitted[2] then
      state.lastEvent = {
        kind = "score_submitted",
        playerIndex = index,
        captured = 0,
      }
      return {
        accepted = true,
        state = state,
        events = { { type = "score_submitted", player = actor_id } },
      }
    end

    if not same_score(state.scoreProposals[1], state.scoreProposals[2]) then
      state.scoreRound = state.scoreRound + 1
      state.scoreSubmitted = { false, false }
      state.scoreProposals = {}
      state.lastEvent = {
        kind = "score_disputed",
        playerIndex = index,
        captured = 0,
      }
      return {
        accepted = true,
        state = state,
        events = { { type = "score_disputed", player = actor_id } },
      }
    end

    state.scores = state.scoreProposals[1]
    state.ended = true
    state.phase = "ended"
    if state.scores.black > state.scores.white then
      state.winnerIndex = state.blackIndex
    else
      state.winnerIndex = (state.blackIndex % #state.players) + 1
    end
    state.winner = state.players[state.winnerIndex]
    state.lastEvent = { kind = "scored", playerIndex = index, captured = 0 }
    return {
      accepted = true,
      state = state,
      events = { { type = "scored", winner = state.winner } },
    }
  end

  if state.ended then return rejected(state, "game_over") end
  if state.undoRequest then return rejected(state, "undo_response_required") end
  if index ~= state.current then return rejected(state, "not_your_turn") end

  if action.type == "pass" then
    state.undoSnapshot = undo_snapshot(state)
    state.undoAvailable = true
    record_turn_time(state, index, context)
    state.moves = (state.moves or 0) + 1
    state.consecutivePasses = state.consecutivePasses + 1
    state.lastMove = { row = 0, column = 0 }
    state.lastEvent = { kind = "pass", playerIndex = index, captured = 0 }
    if state.consecutivePasses >= 2 then
      state.phase = "scoring"
      state.current = 0
      state.scoreRound = (state.scoreRound or 0) + 1
      state.scoreSubmitted = { false, false }
      state.scoreProposals = {}
      state.lastEvent = {
        kind = "scoring_started",
        playerIndex = index,
        captured = 0,
      }
      return {
        accepted = true,
        state = state,
        events = { { type = "scoring_started", player = actor_id } },
      }
    end
    state.previousBoard = board_signature(state.board)
    state.current = (state.current % #state.players) + 1
    return {
      accepted = true,
      state = state,
      events = { { type = "passed", player = actor_id } },
    }
  end

  if action.type ~= "play" then return rejected(state, "invalid_action") end
  if type(action.row) ~= "number" or action.row % 1 ~= 0
    or type(action.column) ~= "number" or action.column % 1 ~= 0
    or not inside(state.board, action.row, action.column) then
    return rejected(state, "invalid_point")
  end
  if state.board[action.row][action.column] ~= 0 then
    return rejected(state, "occupied")
  end

  local color = color_for_player(state, index)
  local opponent = color == 1 and 2 or 1
  local candidate = copy_board(state.board)
  candidate[action.row][action.column] = color
  local captured = 0
  local checked = {}

  for _, direction in ipairs(DIRECTIONS) do
    local row = action.row + direction[1]
    local column = action.column + direction[2]
    local key = point_key(row, column)
    if inside(candidate, row, column)
      and candidate[row][column] == opponent and not checked[key] then
      local group, liberties = collect_group(candidate, row, column)
      for _, point in ipairs(group) do checked[point_key(point.row, point.column)] = true end
      if liberties == 0 then
        captured = captured + #group
        remove_group(candidate, group)
      end
    end
  end

  local _, own_liberties = collect_group(candidate, action.row, action.column)
  if own_liberties == 0 then return rejected(state, "suicide") end

  local signature = board_signature(candidate)
  if state.previousBoard ~= "" and signature == state.previousBoard then
    return rejected(state, "ko")
  end

  state.undoSnapshot = undo_snapshot(state)
  state.undoAvailable = true
  record_turn_time(state, index, context)
  state.previousBoard = board_signature(state.board)
  state.board = candidate
  state.captures[index] = (state.captures[index] or 0) + captured
  state.consecutivePasses = 0
  state.moves = state.moves + 1
  state.lastMove = { row = action.row, column = action.column }
  state.lastEvent = { kind = "play", playerIndex = index, captured = captured }
  state.current = (state.current % #state.players) + 1

  return {
    accepted = true,
    state = state,
    events = {
      {
        type = "played",
        player = actor_id,
        row = action.row,
        column = action.column,
        captured = captured,
      },
    },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.ended or state.phase == "setup" then
    return { state = state, events = {} }
  end
  state.ended = true
  state.winnerIndex = (leaving_index % #state.players) + 1
  state.winner = state.players[state.winnerIndex]
  state.lastEvent = { kind = "player_left", playerIndex = leaving_index, captured = 0 }
  return {
    state = state,
    events = { { type = "player_left", player = actor_id } },
  }
end

function view(state, events, context)
  local visible = {}
  for key, value in pairs(state) do
    if key ~= "seed" and key ~= "scoreProposals" and key ~= "undoSnapshot" then
      visible[key] = value
    end
  end
  visible.canConfigure = context.viewer ~= nil and context.viewer.isOwner == true
  return { state = visible, events = events }
end

function on_return_to_room(state, context)
  return true
end
