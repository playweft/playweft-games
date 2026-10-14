local BOARD_SIZE = 15
local DIRECTIONS = { { 0, 1 }, { 1, 0 }, { 1, 1 }, { 1, -1 } }
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
  local players = {}
  for _, player in ipairs(context.players) do table.insert(players, player.id) end
  return players
end

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(reason)
  return {
    accepted = false,
    error = {
      code = string.upper(reason),
      message = string.gsub(reason, "_", " "),
    },
  }
end

local function empty_board(size)
  local board = {}
  for row = 1, size do
    board[row] = {}
    for column = 1, size do board[row][column] = 0 end
  end
  return board
end

local function inside(board, row, column)
  local size = #board
  return row >= 1 and row <= size and column >= 1 and column <= size
end

local function next_seed(seed)
  return (math.floor(math.abs(seed or 1)) * 48271) % 2147483647
end

local function normalized_settings(action)
  local black_mode = action.blackMode
  local forbidden_moves = action.forbiddenMoves
  if black_mode ~= "random"
    and black_mode ~= "player1"
    and black_mode ~= "player2" then
    return nil, "invalid_black_mode"
  end
  if type(forbidden_moves) ~= "boolean" then
    return nil, "invalid_forbidden_moves"
  end
  return {
    size = BOARD_SIZE,
    blackMode = black_mode,
    forbiddenMoves = forbidden_moves,
  }
end

local function choose_black(settings, seed)
  if settings.blackMode == "player1" then return 1, seed end
  if settings.blackMode == "player2" then return 2, seed end
  local updated_seed = next_seed(seed)
  return (updated_seed % 2) + 1, updated_seed
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

local function winning_line(board, row, column, piece)
  for _, direction in ipairs(DIRECTIONS) do
    local row_step, column_step = direction[1], direction[2]
    local start_row, start_column = row, column
    while inside(board, start_row - row_step, start_column - column_step)
      and board[start_row - row_step][start_column - column_step] == piece do
      start_row = start_row - row_step
      start_column = start_column - column_step
    end

    local cells = {}
    local check_row, check_column = start_row, start_column
    while inside(board, check_row, check_column)
      and board[check_row][check_column] == piece do
      cells[#cells + 1] = { row = check_row, column = check_column }
      check_row = check_row + row_step
      check_column = check_column + column_step
    end
    if #cells >= 5 then return cells end
  end
  return nil
end

local function line_length(board, row, column, piece, row_step, column_step)
  local count = 1
  local check_row, check_column = row + row_step, column + column_step
  while inside(board, check_row, check_column)
    and board[check_row][check_column] == piece do
    count = count + 1
    check_row = check_row + row_step
    check_column = check_column + column_step
  end
  check_row, check_column = row - row_step, column - column_step
  while inside(board, check_row, check_column)
    and board[check_row][check_column] == piece do
    count = count + 1
    check_row = check_row - row_step
    check_column = check_column - column_step
  end
  return count
end

local function creates_exact_five(
  board,
  anchor_row,
  anchor_column,
  row,
  column,
  direction
)
  if not inside(board, row, column) or board[row][column] ~= 0 then
    return false
  end
  board[row][column] = 1
  local length = line_length(
    board,
    anchor_row,
    anchor_column,
    1,
    direction[1],
    direction[2]
  )
  board[row][column] = 0
  return length == 5
end

local function winning_extensions(
  board,
  anchor_row,
  anchor_column,
  direction
)
  local count = 0
  for offset = -5, 5 do
    local row = anchor_row + direction[1] * offset
    local column = anchor_column + direction[2] * offset
    if creates_exact_five(
      board,
      anchor_row,
      anchor_column,
      row,
      column,
      direction
    ) then
      count = count + 1
    end
  end
  return count
end

local function open_three_in_direction(
  board,
  anchor_row,
  anchor_column,
  direction
)
  local original_length = line_length(
    board,
    anchor_row,
    anchor_column,
    1,
    direction[1],
    direction[2]
  )
  if original_length >= 4 then return false end

  for offset = -4, 4 do
    local row = anchor_row + direction[1] * offset
    local column = anchor_column + direction[2] * offset
    if inside(board, row, column) and board[row][column] == 0 then
      board[row][column] = 1
      -- A three must become a straight four containing the added stone.
      -- Completing a five, or leaving an unrelated four intact, is not a three.
      local length = line_length(
        board,
        anchor_row,
        anchor_column,
        1,
        direction[1],
        direction[2]
      )
      local extensions = 0
      if length == 4 then
        extensions = winning_extensions(board, anchor_row, anchor_column, direction)
      end
      board[row][column] = 0
      if extensions >= 2 then return true end
    end
  end
  return false
end

local function forbidden_reason(board, row, column)
  for _, direction in ipairs(DIRECTIONS) do
    if line_length(
      board,
      row,
      column,
      1,
      direction[1],
      direction[2]
    ) > 5 then
      return "forbidden_overline"
    end
  end

  for _, direction in ipairs(DIRECTIONS) do
    if line_length(
      board,
      row,
      column,
      1,
      direction[1],
      direction[2]
    ) == 5 then
      return nil
    end
  end

  local fours = 0
  for _, direction in ipairs(DIRECTIONS) do
    if winning_extensions(board, row, column, direction) > 0 then
      fours = fours + 1
    end
  end
  if fours >= 2 then return "forbidden_double_four" end

  local threes = 0
  for _, direction in ipairs(DIRECTIONS) do
    if open_three_in_direction(board, row, column, direction) then
      threes = threes + 1
    end
  end
  if threes >= 2 then return "forbidden_double_three" end
  return nil
end

local function setup_state(players, round, settings, seed, host_id)
  return {
    players = players,
    hostId = host_id,
    phase = "setup",
    settings = settings,
    board = empty_board(settings.size),
    current = 0,
    blackIndex = 1,
    timeUsed = { 0, 0 },
    turnStartedAt = 0,
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    draw = false,
    winningCells = {},
    lastMove = { row = 0, column = 0 },
    lastEvent = { kind = "setup", playerIndex = 1 },
    round = round,
    seed = seed,
  }
end

local function new_round(
  players,
  round,
  settings,
  seed,
  host_id,
  started_at,
  forced_black_index
)
  local black_index, updated_seed
  if forced_black_index then
    black_index, updated_seed = forced_black_index, seed
  else
    black_index, updated_seed = choose_black(settings, seed)
  end
  return {
    players = players,
    hostId = host_id,
    phase = "playing",
    settings = settings,
    board = empty_board(settings.size),
    current = black_index,
    blackIndex = black_index,
    timeUsed = { 0, 0 },
    turnStartedAt = action_time({ actionAt = started_at }, 0),
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    draw = false,
    winningCells = {},
    lastMove = { row = 0, column = 0 },
    lastEvent = { kind = "start", playerIndex = black_index },
    round = round,
    seed = updated_seed,
  }
end

function setup(context)
  local players = setup_players(context)
  local settings = {
    size = BOARD_SIZE,
    blackMode = "random",
    forbiddenMoves = false,
  }
  return setup_state(
    players,
    1,
    settings,
    normalize_random_seed(context.match.randomSeed),
    context.match.ownerId
  )
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected("invalid_action") end
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)

  if state.phase == "setup" then
    if not context.actor.isOwner then return rejected("only_host_can_setup") end
    if action.type == "update_settings" then
      local settings, reason = normalized_settings(action)
      if not settings then return rejected(reason) end
      return {
        accepted = true,
        state = setup_state(
          state.players,
          state.round or 1,
          settings,
          state.seed,
          state.hostId
        ),
        events = { { type = "settings_updated", player = actor_id } },
      }
    end
    if action.type ~= "start" then return rejected("setup_required") end
    local settings, reason = normalized_settings(action)
    if not settings then return rejected(reason) end
    return {
      accepted = true,
      state = new_round(
        state.players,
        state.round or 1,
        settings,
        state.seed,
        state.hostId,
        context.actionAt
      ),
      events = { { type = "started", player = actor_id } },
    }
  end

  if not index then return rejected("not_a_player") end

  if action.type == "rematch" then
    if not state.ended then return rejected("game_not_over") end
    local next_black_index = (state.blackIndex % #state.players) + 1
    return {
      accepted = true,
      state = new_round(
        state.players,
        (state.round or 1) + 1,
        state.settings,
        state.seed,
        state.hostId,
        context.actionAt,
        next_black_index
      ),
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if action.type == "configure" then
    if not state.ended then return rejected("game_not_over") end
    return {
      accepted = true,
      state = setup_state(
        state.players,
        (state.round or 1) + 1,
        state.settings,
        state.seed,
        state.hostId
      ),
      events = { { type = "configuration_opened", player = actor_id } },
    }
  end

  if state.ended then return rejected("game_over") end
  if action.type ~= "play" then return rejected("invalid_action") end
  if index ~= state.current then return rejected("not_your_turn") end
  if type(action.row) ~= "number" or action.row % 1 ~= 0
    or type(action.column) ~= "number" or action.column % 1 ~= 0
    or not inside(state.board, action.row, action.column) then
    return rejected("invalid_point")
  end
  if state.board[action.row][action.column] ~= 0 then
    return rejected("occupied")
  end

  local piece = index == state.blackIndex and 1 or 2
  state.board[action.row][action.column] = piece
  if piece == 1 and state.settings.forbiddenMoves then
    local reason = forbidden_reason(state.board, action.row, action.column)
    if reason then
      state.board[action.row][action.column] = 0
      return rejected(reason)
    end
  end
  record_turn_time(state, index, context)
  state.moves = state.moves + 1
  state.lastMove = { row = action.row, column = action.column }
  state.lastEvent = { kind = "play", playerIndex = index }

  local line = winning_line(
    state.board,
    action.row,
    action.column,
    piece
  )
  if line then
    state.phase = "ended"
    state.ended = true
    state.winner = actor_id
    state.winnerIndex = index
    state.winningCells = line
    state.lastEvent = { kind = "won", playerIndex = index }
    return {
      accepted = true,
      state = state,
      events = { { type = "won", player = actor_id } },
    }
  end

  if state.moves == #state.board * #state.board then
    state.phase = "ended"
    state.ended = true
    state.draw = true
    state.lastEvent = { kind = "draw", playerIndex = index }
    return {
      accepted = true,
      state = state,
      events = { { type = "draw" } },
    }
  end

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
  record_turn_time(state, state.current, context)
  state.phase = "ended"
  state.ended = true
  state.winnerIndex = (leaving_index % #state.players) + 1
  state.winner = state.players[state.winnerIndex]
  state.lastEvent = { kind = "player_left", playerIndex = leaving_index }
  return {
    state = state,
    events = { { type = "player_left", player = actor_id } },
  }
end

function view(state, events, context)
  local visible = {}
  for key, value in pairs(state) do
    if key ~= "seed" then visible[key] = value end
  end
  visible.canConfigure = context.viewer ~= nil and context.viewer.isOwner == true
  return { state = visible, events = events }
end

function on_return_to_room(state, context)
  return true
end
