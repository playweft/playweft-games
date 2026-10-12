local SIZE = 8
local DIRECTIONS = { {-1,-1}, {-1,0}, {-1,1}, {0,-1}, {0,1}, {1,-1}, {1,0}, {1,1} }

local function inside(r, c) return r >= 1 and r <= SIZE and c >= 1 and c <= SIZE end

local function find_flips(board, row, column, color, collect)
  if board[row][column] ~= 0 then return 0, {} end
  local total, cells = 0, {}
  for _, direction in ipairs(DIRECTIONS) do
    local dr, dc = direction[1], direction[2]
    local r, c, count = row + dr, column + dc, 0
    while inside(r, c) and board[r][c] == 3 - color do
      count = count + 1
      r, c = r + dr, c + dc
    end
    if count > 0 and inside(r, c) and board[r][c] == color then
      total = total + count
      if collect then
        for step = 1, count do
          cells[#cells + 1] = { row = row + dr * step, column = column + dc * step }
        end
      end
    end
  end
  return total, cells
end

local function legal_moves(board, color)
  local moves = {}
  for row = 1, SIZE do
    for column = 1, SIZE do
      if board[row][column] == 0 then
        local count = find_flips(board, row, column, color, false)
        if count > 0 then moves[#moves + 1] = { row = row, column = column, flips = count } end
      end
    end
  end
  return moves
end

local function count_pieces(board)
  local counts = { black = 0, white = 0, empty = 0 }
  for row = 1, SIZE do
    for column = 1, SIZE do
      local value = board[row][column]
      local key = value == 1 and "black" or value == 2 and "white" or "empty"
      counts[key] = counts[key] + 1
    end
  end
  return counts
end

local function new_round(players, round, black_index)
  local board = {}
  for row = 1, SIZE do
    board[row] = {}
    for column = 1, SIZE do board[row][column] = 0 end
  end
  board[4][4], board[5][5], board[4][5], board[5][4] = 2, 2, 1, 1
  return {
    players = players, board = board, blackIndex = black_index, current = black_index,
    round = round, moves = 0, counts = count_pieces(board), legalMoves = legal_moves(board, 1),
    ended = false, winner = "", winnerIndex = 0, draw = false, endReason = "",
    passedIndex = 0, lastMove = { row = 0, column = 0 }, lastFlipped = {},
  }
end

local function rejected(code) return { accepted = false, error = { code = code, message = code } } end

local function player_index(state, id)
  for index, player in ipairs(state.players) do if player == id then return index end end
end

function setup(context)
  local players = {}
  for _, player in ipairs(context.players) do players[#players + 1] = player.id end
  return new_round(players, 1, 1)
end

function view(state, events, context) return { state = state, events = events } end

function on_action(state, action, context)
  local index = player_index(state, context.actor.id)
  if not index then return rejected("NOT_A_PLAYER") end
  if type(action) ~= "table" then return rejected("INVALID_ACTION") end
  if action.type == "rematch" then
    if not state.ended then return rejected("GAME_NOT_OVER") end
    return { accepted = true, state = new_round(state.players, state.round + 1, 3 - state.blackIndex),
      events = { { type = "rematched", player = context.actor.id } } }
  end
  if action.type ~= "play" then return rejected("INVALID_ACTION") end
  if state.ended then return rejected("GAME_OVER") end
  if index ~= state.current then return rejected("NOT_YOUR_TURN") end
  local row, column = action.row, action.column
  if type(row) ~= "number" or type(column) ~= "number" or row % 1 ~= 0 or column % 1 ~= 0 or not inside(row, column) then
    return rejected("INVALID_COORDINATE")
  end
  local color = index == state.blackIndex and 1 or 2
  local count, flips = find_flips(state.board, row, column, color, true)
  if count == 0 then return rejected("ILLEGAL_MOVE") end
  state.board[row][column] = color
  for _, cell in ipairs(flips) do state.board[cell.row][cell.column] = color end
  state.moves = state.moves + 1
  state.lastMove = { row = row, column = column }
  state.lastFlipped = flips
  state.counts = count_pieces(state.board)
  state.passedIndex = 0
  local events = { { type = "played", player = context.actor.id, row = row, column = column, flipped = count } }
  state.current = 3 - index
  state.legalMoves = legal_moves(state.board, 3 - color)
  if #state.legalMoves == 0 then
    state.legalMoves = legal_moves(state.board, color)
    if #state.legalMoves > 0 then
      state.passedIndex = state.current
      events[#events + 1] = { type = "passed", player = state.players[state.current] }
      state.current = index
    else
      state.ended, state.current = true, 0
      state.endReason = state.counts.empty > 0 and "no_moves" or "full_board"
      state.draw = state.counts.black == state.counts.white
      state.winnerIndex = state.draw and 0 or (state.counts.black > state.counts.white and state.blackIndex or 3 - state.blackIndex)
      state.winner = state.winnerIndex > 0 and state.players[state.winnerIndex] or ""
      events[#events + 1] = { type = state.draw and "draw" or "won", player = state.winner }
    end
  end
  return { accepted = true, state = state, events = events }
end

function on_player_left(state, context)
  local index = player_index(state, context.actor.id)
  if not index or state.ended then return { state = state, events = {} } end
  state.ended, state.current, state.endReason = true, 0, "player_left"
  state.winnerIndex = 3 - index
  state.winner = state.players[state.winnerIndex]
  state.draw, state.legalMoves = false, {}
  return { state = state, events = { { type = "player_left", player = context.actor.id } } }
end

function on_return_to_room(state, context) return true end
