-- Shared authoritative rules for room and local play. Coordinates: a8 = (1, 1).
local KNIGHT = {{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}}
local DIAGONAL = {{-1,-1},{-1,1},{1,-1},{1,1}}
local STRAIGHT = {{-1,0},{1,0},{0,-1},{0,1}}
local KING = {{-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}}
local function inside(r,c) return r >= 1 and r <= 8 and c >= 1 and c <= 8 end
local function color(p) return string.sub(p,1,1) end
local function kind(p) return string.sub(p,2,2) end
local function enemy(side) return side == "w" and "b" or "w" end
local function reject(code) return {accepted=false,error={code=code,message=code}} end
local function square(r,c) return string.char(96+c)..tostring(9-r) end
local function side_for(s,i) return i == s.whiteIndex and "w" or "b" end

-- Attack maps include pinned pieces, and pawn attacks never depend on occupancy.
local function attacked(b,r,c,by)
  local pawn,knight,king,queen,bishop,rook = by.."P",by.."N",by.."K",by.."Q",by.."B",by.."R"
  local pr = r + (by == "w" and 1 or -1)
  if pr>=1 and pr<=8 then
    if c>1 and b[pr][c-1]==pawn then return true end
    if c<8 and b[pr][c+1]==pawn then return true end
  end
  for _,d in ipairs(KNIGHT) do
    local rr,cc = r+d[1],c+d[2]
    if inside(rr,cc) and b[rr][cc] == knight then return true end
  end
  for _,d in ipairs(KING) do
    local rr,cc = r+d[1],c+d[2]
    local slider = d[1]~=0 and d[2]~=0 and bishop or rook
    local adjacent = true
    while inside(rr,cc) do
      local p = b[rr][cc]
      if p ~= "" then
        if p==queen or p==slider or (adjacent and p==king) then return true end
        break
      end
      adjacent=false
      rr,cc = rr+d[1],cc+d[2]
    end
  end
  return false
end
local function in_check(b,side)
  for r=1,8 do for c=1,8 do
    if b[r][c] == side.."K" then return attacked(b,r,c,enemy(side)) end
  end end
  return true
end

local function legal_moves(s,side,wanted)
  local b,moves = s.board,{}
  local opponent,ownKing = enemy(side),side.."K"
  local kingRow,kingColumn
  for r=1,8 do for c=1,8 do if b[r][c] == ownKing then kingRow,kingColumn=r,c end end end
  if not kingRow then return moves end
  local checked = attacked(b,kingRow,kingColumn,opponent)
  local function add(fr,fc,tr,tc,special)
    if wanted and (fr~=wanted.fromRow or fc~=wanted.fromColumn or tr~=wanted.toRow or tc~=wanted.toColumn) then return end
    if not inside(tr,tc) or color(b[tr][tc]) == side or kind(b[tr][tc]) == "K" then return end
    local p,taken = b[fr][fc],b[tr][tc]
    local ep = special == "en_passant"
    local safe = true
    -- Only aligned pieces can uncover a sliding attack on a safe king.
    -- Checks, king moves and en passant always need a full attack test.
    if checked or p==ownKing or ep or fr==kingRow or fc==kingColumn
      or math.abs(fr-kingRow)==math.abs(fc-kingColumn) then
      local epPiece = ep and b[fr][tc] or ""
      b[fr][fc],b[tr][tc] = "",p
      if ep then b[fr][tc] = "" end
      local kr,kc = p == ownKing and tr or kingRow,p == ownKing and tc or kingColumn
      safe = not attacked(b,kr,kc,opponent)
      b[fr][fc],b[tr][tc] = p,taken
      if ep then b[fr][tc] = epPiece end
    end
    if safe then
      local m = {fromRow=fr,fromColumn=fc,toRow=tr,toColumn=tc,special=special or ""}
      if kind(p) == "P" and (tr == 1 or tr == 8) then m.promotion = true end
      moves[#moves+1] = m
    end
  end
  for r=1,8 do for c=1,8 do
    local p = b[r][c]
    if color(p) == side then
      local k = kind(p)
      if k == "P" then
        local step,start = side == "w" and -1 or 1,side == "w" and 7 or 2
        if inside(r+step,c) and b[r+step][c] == "" then
          add(r,c,r+step,c)
          if r == start and b[r+2*step][c] == "" then add(r,c,r+2*step,c) end
        end
        for _,dc in ipairs({-1,1}) do
          local tr,tc = r+step,c+dc
          if inside(tr,tc) then
            if color(b[tr][tc]) == enemy(side) then add(r,c,tr,tc)
            elseif s.enPassant.row == tr and s.enPassant.column == tc and b[r][tc] == enemy(side).."P" then
              add(r,c,tr,tc,"en_passant")
            end
          end
        end
      elseif k == "N" or k == "K" then
        for _,d in ipairs(k == "N" and KNIGHT or KING) do add(r,c,r+d[1],c+d[2]) end
        local home = side == "w" and 8 or 1
        if k == "K" and r == home and c == 5 and not in_check(b,side) then
          for _,wing in ipairs({{8,7,6,"K"},{1,3,4,"Q"}}) do
            local rook,dest,through,flag = wing[1],wing[2],wing[3],wing[4]
            if s.castling[side..flag] and b[home][rook] == side.."R" then
              local clear = true
              for cc=math.min(5,rook)+1,math.max(5,rook)-1 do if b[home][cc] ~= "" then clear = false end end
              -- Remove the king while checking the transit square (discovered rays).
              b[home][5] = ""
              local danger = attacked(b,home,through,opponent)
              b[home][5] = p
              if clear and not danger then add(r,c,home,dest,"castle") end
            end
          end
        end
      else
        local dirs = k == "B" and DIAGONAL or k == "R" and STRAIGHT or KING
        for _,d in ipairs(dirs) do
          local tr,tc = r+d[1],c+d[2]
          while inside(tr,tc) do
            add(r,c,tr,tc)
            if b[tr][tc] ~= "" then break end
            tr,tc = tr+d[1],tc+d[2]
          end
        end
      end
    end
  end end
  return moves
end

local function position_key(s)
  local parts = {}
  for r=1,8 do parts[#parts+1] = table.concat(s.board[r],",") end
  parts[#parts+1] = side_for(s,s.current)
  for _,flag in ipairs({"wK","wQ","bK","bQ"}) do parts[#parts+1] = s.castling[flag] and flag or "-" end
  -- Only a legally available en-passant capture differentiates repeated positions.
  local ep = "-"
  for _,m in ipairs(s.legalMoves) do if m.special == "en_passant" then ep = square(m.toRow,m.toColumn) break end end
  parts[#parts+1] = ep
  return table.concat(parts,"/")
end
local function insufficient(b)
  local count,bishops,shade = 0,true,nil
  for r=1,8 do for c=1,8 do
    local k = kind(b[r][c])
    if k ~= "" and k ~= "K" then
      if k ~= "B" and k ~= "N" then return false end
      count = count+1
      if k ~= "B" then bishops = false
      elseif shade == nil then shade = (r+c)%2
      elseif shade ~= (r+c)%2 then bishops = false end
    end
  end end
  return count <= 1 or bishops
end
local function finish(s,reason,winnerIndex)
  s.endReason,s.legalMoves,s.drawOffer = reason,{},0
  if winnerIndex then s.winnerIndex,s.winner = winnerIndex,s.players[winnerIndex]
  else s.draw = true end
  return {accepted=true,state=s,events={{type=winnerIndex and "won" or "draw",reason=reason}}}
end
local function new_round(players,names,round,whiteIndex)
  local board,rank = {},{"R","N","B","Q","K","B","N","R"}
  for r=1,8 do board[r]={} for c=1,8 do board[r][c]="" end end
  for c=1,8 do board[1][c],board[2][c],board[7][c],board[8][c] = "b"..rank[c],"bP","wP","w"..rank[c] end
  local s = {players=players,playerNames=names,board=board,current=whiteIndex,whiteIndex=whiteIndex,
    moves=0,halfmove=0,winner="",winnerIndex=0,draw=false,endReason="",inCheck=false,
    castling={wK=true,wQ=true,bK=true,bQ=true},enPassant={row=0,column=0},
    lastMove={fromRow=0,fromColumn=0,toRow=0,toColumn=0},history={},positions={},
    captured={w={},b={}},round=round,drawOffer=0,canClaimDraw=false}
  s.legalMoves = legal_moves(s,"w")
  s.positions[position_key(s)] = 1
  return s
end
function setup(context)
  local players,names = {},{}
  for _,p in ipairs(context.players) do players[#players+1]=p.id names[#names+1]=p.name or "" end
  return new_round(players,names,1,1)
end
function view(state,events,context) return {state=state,events=events} end
function on_action(s,a,context)
  if type(a) ~= "table" then return reject("INVALID_ACTION") end
  local index
  for i,id in ipairs(s.players) do if id == context.actor.id then index=i end end
  if not index then return reject("NOT_A_PLAYER") end
  if a.type == "rematch" then
    if s.winner == "" and not s.draw then return reject("GAME_NOT_OVER") end
    return {accepted=true,state=new_round(s.players,s.playerNames,s.round+1,3-s.whiteIndex),events={{type="rematched"}}}
  end
  if s.winner ~= "" or s.draw then return reject("GAME_OVER") end
  if a.type == "resign" then return finish(s,"resigned",3-index) end
  if a.type == "offer_draw" then
    if s.drawOffer ~= 0 then return reject("DRAW_ALREADY_OFFERED") end
    s.drawOffer=index
    return {accepted=true,state=s,events={{type="draw_offered"}}}
  end
  if a.type == "accept_draw" or a.type == "decline_draw" then
    if s.drawOffer == 0 or s.drawOffer == index then return reject("NO_DRAW_OFFER") end
    if a.type == "accept_draw" then return finish(s,"agreement") end
    s.drawOffer=0
    return {accepted=true,state=s,events={{type="draw_declined"}}}
  end
  if index ~= s.current then return reject("NOT_YOUR_TURN") end
  if a.type == "claim_draw" then
    if not s.canClaimDraw then return reject("DRAW_NOT_AVAILABLE") end
    return finish(s,s.halfmove >= 100 and "fifty_moves" or "threefold")
  end
  if a.type ~= "move" then return reject("INVALID_ACTION") end
  for _,field in ipairs({"fromRow","fromColumn","toRow","toColumn"}) do
    local v=a[field]
    if type(v) ~= "number" or v%1 ~= 0 or v<1 or v>8 then return reject("INVALID_COORDINATE") end
  end
  local side=side_for(s,index)
  if color(s.board[a.fromRow][a.fromColumn]) ~= side then return reject("NOT_YOUR_PIECE") end
  local chosen
  -- Never trust a cached client-supplied legal-move list.
  for _,m in ipairs(legal_moves(s,side,a)) do
    if m.fromRow==a.fromRow and m.fromColumn==a.fromColumn and m.toRow==a.toRow and m.toColumn==a.toColumn then chosen=m break end
  end
  if not chosen then return reject("ILLEGAL_MOVE") end
  if chosen.promotion and a.promotion~="Q" and a.promotion~="R" and a.promotion~="B" and a.promotion~="N" then return reject("PROMOTION_REQUIRED") end
  local b,fr,fc,tr,tc=s.board,a.fromRow,a.fromColumn,a.toRow,a.toColumn
  local p,taken=b[fr][fc],b[tr][tc]
  if chosen.special == "en_passant" then taken=b[fr][tc] b[fr][tc]="" end
  b[fr][fc],b[tr][tc]="",chosen.promotion and side..a.promotion or p
  if chosen.special == "castle" then
    local rc,dc=tc==7 and 8 or 1,tc==7 and 6 or 4
    b[tr][rc],b[tr][dc]="",side.."R"
  end
  if kind(p)=="K" then s.castling[side.."K"],s.castling[side.."Q"]=false,false end
  for _,home in ipairs({{8,1,"wQ"},{8,8,"wK"},{1,1,"bQ"},{1,8,"bK"}}) do
    if (fr==home[1] and fc==home[2]) or (tr==home[1] and tc==home[2]) then s.castling[home[3]]=false end
  end
  s.enPassant={row=0,column=0}
  if kind(p)=="P" and math.abs(tr-fr)==2 then s.enPassant={row=(fr+tr)/2,column=fc} end
  s.halfmove=(kind(p)=="P" or taken~="") and 0 or s.halfmove+1
  if taken~="" then table.insert(s.captured[side],taken) end
  s.moves,s.current,s.lastMove=s.moves+1,3-index,chosen
  if s.drawOffer~=index then s.drawOffer=0 end
  s.inCheck=in_check(b,enemy(side))
  s.legalMoves=legal_moves(s,enemy(side))
  local notation=chosen.special=="castle" and (tc==7 and "O-O" or "O-O-O")
    or square(fr,fc)..(taken~="" and "×" or "–")..square(tr,tc)..(chosen.promotion and "="..a.promotion or "")
  if s.inCheck then notation=notation..(#s.legalMoves==0 and "#" or "+") end
  table.insert(s.history,{notation=notation,color=side})
  -- Bound the visible ledger and repetition map to the platform's state limits.
  if #s.history>150 then table.remove(s.history,1) end
  if kind(p)=="P" or taken~="" then s.positions={} end
  local key=position_key(s)
  s.positions[key]=(s.positions[key] or 0)+1
  s.canClaimDraw=s.halfmove>=100 or s.positions[key]>=3
  if #s.legalMoves==0 then return finish(s,s.inCheck and "checkmate" or "stalemate",s.inCheck and index or nil) end
  if insufficient(b) then return finish(s,"insufficient_material") end
  if s.positions[key]>=5 then return finish(s,"fivefold") end
  if s.halfmove>=150 then return finish(s,"seventy_five_moves") end
  return {accepted=true,state=s,events={{type=taken~="" and "captured" or "moved",captured=taken}}}
end
function on_player_left(s,context)
  if s.winner=="" and not s.draw then
    for i,id in ipairs(s.players) do if id==context.actor.id then
      local result=finish(s,"player_left",3-i) return {state=result.state,events=result.events}
    end end
  end
  return {state=s,events={}}
end
function on_return_to_room(state,context) return true end
