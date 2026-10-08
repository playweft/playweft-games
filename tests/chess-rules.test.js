import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const source = await readFile("games/chess/game.lua", "utf8");
const helpers = `
local ctx={players={{id="white",name="Alice"},{id="black",name="Bob"}}}
local function clone(v)
  if type(v)~="table" then return v end
  local out={} for k,x in pairs(v) do out[k]=clone(x) end return out
end
local function play(s,from,to,promotion,actor)
  return on_action(s,{type="move",fromRow=9-tonumber(string.sub(from,2)),fromColumn=string.byte(from)-96,
    toRow=9-tonumber(string.sub(to,2)),toColumn=string.byte(to)-96,promotion=promotion},
    {actor={id=actor or s.players[s.current]}})
end
local function fixture(pieces,side,rights,ep)
  local s=setup(ctx)
  for r=1,8 do for c=1,8 do s.board[r][c]="" end end
  for sq,p in pairs(pieces) do s.board[9-tonumber(string.sub(sq,2))][string.byte(sq)-96]=p end
  s.current=side=="b" and 2 or 1
  s.castling=rights or {wK=false,wQ=false,bK=false,bQ=false}
  s.enPassant=ep or {row=0,column=0}
  s.legalMoves=legal_moves(s,side or "w")
  s.positions={} s.positions[position_key(s)]=1
  return s
end
`;
async function scenario(code) {
  const lua = await new LuaFactory().createEngine({ enableProxy: false });
  try { await lua.doString(`${source}\n${helpers}\n${code}`); return lua.global.get("result"); }
  finally { lua.global.close(); }
}

test("Chess starts with 32 pieces, preserves names and has standard perft counts", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    local function perft(s,depth)
      if depth==0 then return 1 end
      local nodes=0
      for _,m in ipairs(s.legalMoves) do
        local a=clone(m) a.type="move" a.promotion="Q"
        local next=on_action(clone(s),a,{actor={id=s.players[s.current]}})
        assert(next.accepted) nodes=nodes+perft(next.state,depth-1)
      end
      return nodes
    end
    result={initial=s,depth2=perft(s,2),depth3=perft(s,3)}
  `);
  assert.equal(result.initial.legalMoves.length, 20);
  assert.equal(result.initial.board.flat().filter(Boolean).length, 32);
  assert.deepEqual(result.initial.playerNames, ["Alice", "Bob"]);
  assert.equal(result.depth2, 400);
  assert.equal(result.depth3, 8902);
});

test("Chess rejects malformed, spectator, wrong-turn, obstructed and pinned moves without mutation", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    local invalid={}
    invalid[#invalid+1]=on_action(s,{type="move"},{actor={id="white"}}).error.code
    invalid[#invalid+1]=on_action(s,{type="move",fromRow="7",fromColumn=1,toRow=6,toColumn=1},{actor={id="white"}}).error.code
    invalid[#invalid+1]=play(s,"e2","e4",nil,"spectator").error.code
    invalid[#invalid+1]=play(s,"e7","e5",nil,"black").error.code
    invalid[#invalid+1]=play(s,"a1","a4").error.code
    local pin=fixture({e1="wK",e2="wR",e8="bR",a8="bK"})
    invalid[#invalid+1]=play(pin,"e2","f2").error.code
    local king=fixture({e1="wK",e3="bK"})
    invalid[#invalid+1]=play(king,"e1","e2").error.code
    result={errors=invalid,board=s.board,moves=s.moves}
  `);
  assert.deepEqual(result.errors, ["INVALID_COORDINATE", "INVALID_COORDINATE", "NOT_A_PLAYER", "NOT_YOUR_TURN", "ILLEGAL_MOVE", "ILLEGAL_MOVE", "ILLEGAL_MOVE"]);
  assert.equal(result.board[6][4], "wP");
  assert.equal(result.moves, 0);
});

test("Chess en passant removes the passed pawn, expires and cannot expose the king", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    for _,p in ipairs({{"e2","e4"},{"a7","a6"},{"e4","e5"},{"d7","d5"}}) do s=play(s,p[1],p[2]).state end
    local captured=play(clone(s),"e5","d6")
    s=play(s,"g1","f3").state s=play(s,"a6","a5").state
    local expired=play(s,"e5","d6")
    local pinned=fixture({h5="wK",g5="wP",f5="bP",a5="bR",a8="bK"},"w",nil,{row=3,column=6})
    result={captured=captured,expired=expired.error.code,pinned=play(pinned,"g5","f6").error.code}
  `);
  assert.equal(result.captured.state.board[2][3], "wP");
  assert.equal(result.captured.state.board[3][3], "");
  assert.deepEqual(result.captured.state.captured.w, ["bP"]);
  assert.equal(result.expired, "ILLEGAL_MOVE");
  assert.equal(result.pinned, "ILLEGAL_MOVE");
});

test("Chess supports both castling wings and permanently loses rights after king or rook moves", async () => {
  const result = await scenario(`
    local s=fixture({e1="wK",a1="wR",h1="wR",e8="bK"},"w",{wK=true,wQ=true,bK=false,bQ=false})
    local short=play(clone(s),"e1","g1") local long=play(clone(s),"e1","c1")
    s=play(s,"h1","h2").state s=play(s,"e8","e7").state
    s=play(s,"h2","h1").state s=play(s,"e7","e8").state
    local lost=play(s,"e1","g1")
    local under=fixture({e1="wK",h1="wR",e8="bK",f8="bR"},"w",{wK=true})
    local into=fixture({e1="wK",h1="wR",e8="bK",g8="bR"},"w",{wK=true})
    local check=fixture({e1="wK",h1="wR",a8="bK",e8="bR"},"w",{wK=true})
    result={short=short,long=long,lost=lost.error.code,under=play(under,"e1","g1").error.code,
      into=play(into,"e1","g1").error.code,check=play(check,"e1","g1").error.code}
  `);
  assert.equal(result.short.state.board[7][6], "wK");
  assert.equal(result.short.state.board[7][5], "wR");
  assert.equal(result.short.state.board[7][7], "");
  assert.equal(result.long.state.board[7][2], "wK");
  assert.equal(result.long.state.board[7][3], "wR");
  for (const key of ["lost", "under", "into", "check"]) assert.equal(result[key], "ILLEGAL_MOVE");
});

test("Chess promotion requires a valid choice and supports all four pieces including capture", async () => {
  const result = await scenario(`
    local s=fixture({e1="wK",h8="bK",a7="wP",b8="bR"})
    local choices={}
    for _,p in ipairs({"Q","R","B","N"}) do choices[p]=play(clone(s),"a7","b8",p) end
    result={missing=play(s,"a7","a8").error.code,king=play(s,"a7","a8","K").error.code,choices=choices,source=s.board}
  `);
  assert.equal(result.missing, "PROMOTION_REQUIRED");
  assert.equal(result.king, "PROMOTION_REQUIRED");
  for (const kind of ["Q", "R", "B", "N"]) {
    assert.equal(result.choices[kind].state.board[0][1], `w${kind}`);
    assert.deepEqual(result.choices[kind].state.captured.w, ["bR"]);
  }
  assert.equal(result.source[1][0], "wP");
});

test("Chess detects Fool's Mate, stalemate and common insufficient material without misclassifying two knights", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    for _,p in ipairs({{"f2","f3"},{"e7","e5"},{"g2","g4"},{"d8","h4"}}) do s=play(s,p[1],p[2]).state end
    local stale=fixture({a8="bK",c6="wK",b5="wQ"})
    local bare=fixture({a8="bK",e1="wK"})
    result={mate=s,stale=play(stale,"b5","b6").state,bare=play(bare,"e1","e2").state,
      bishops=insufficient(fixture({a8="bK",e1="wK",c1="wB",f8="bB"}).board),
      knights=insufficient(fixture({a8="bK",e1="wK",b1="wN",g1="wN"}).board)}
  `);
  assert.equal(result.mate.winner, "black");
  assert.equal(result.mate.endReason, "checkmate");
  assert.match(result.mate.history.at(-1).notation, /#$/);
  assert.equal(result.stale.endReason, "stalemate");
  assert.equal(result.stale.draw, true);
  assert.equal(result.bare.endReason, "insufficient_material");
  assert.equal(result.bishops, true);
  assert.equal(result.knights, false);
});

test("Chess enables a threefold claim, automatically draws fivefold, and swaps sides on rematch", async () => {
  const result = await scenario(`
    local s=setup(ctx) local claim
    local cycle={{"g1","f3"},{"g8","f6"},{"f3","g1"},{"f6","g8"}}
    for n=1,4 do
      for _,p in ipairs(cycle) do s=play(s,p[1],p[2]).state end
      if n==2 then claim=on_action(clone(s),{type="claim_draw"},{actor={id="white"}}) end
    end
    local rematch=on_action(s,{type="rematch"},{actor={id="black"}})
    result={claim=claim,automatic=s,rematch=rematch}
  `);
  assert.equal(result.claim.state.endReason, "threefold");
  assert.equal(result.automatic.endReason, "fivefold");
  assert.equal(result.rematch.state.whiteIndex, 2);
  assert.equal(result.rematch.state.current, 2);
  assert.equal(result.rematch.state.round, 2);
});

test("Chess repetition identity includes castling and only legal en-passant rights", async () => {
  const result = await scenario(`
    local s=setup(ctx) local initial=position_key(s)
    s.enPassant={row=3,column=1} local irrelevant=position_key(s)
    s.castling.wK=false local changed=position_key(s)
    local ep=fixture({h5="wK",g5="wP",f5="bP",a5="bR",a8="bK"},"w",nil,{row=3,column=6})
    local pinnedKey=position_key(ep) ep.enPassant={row=0,column=0} local noEp=position_key(ep)
    ep=fixture({h4="wK",g5="wP",f5="bP",a8="bK"},"w",nil,{row=3,column=6})
    local legalEp=position_key(ep) ep.enPassant={row=0,column=0} ep.legalMoves=legal_moves(ep,"w")
    result={irrelevant=initial==irrelevant,castling=changed~=initial,pinned=pinnedKey==noEp,legal=legalEp~=position_key(ep)}
  `);
  assert.deepEqual(result, { irrelevant: true, castling: true, pinned: true, legal: true });
});

test("Chess applies fifty/seventy-five move draws, pawn resets and checkmate priority", async () => {
  const result = await scenario(`
    local s=fixture({e1="wK",a1="wR",e8="bK"}) s.halfmove=99
    local fifty=play(s,"a1","a2").state
    local claim=on_action(clone(fifty),{type="claim_draw"},{actor={id="black"}})
    s=fixture({e1="wK",a1="wR",e8="bK"}) s.halfmove=149
    local automatic=play(s,"a1","a2").state
    s=setup(ctx) s.halfmove=99 local reset=play(s,"e2","e4").state
    s=fixture({a8="bK",c6="wK",b6="wQ"}) s.halfmove=149
    local mate=play(s,"b6","b7").state
    result={fifty=fifty,claim=claim,automatic=automatic,reset=reset,mate=mate}
  `);
  assert.equal(result.fifty.canClaimDraw, true);
  assert.equal(result.fifty.draw, false);
  assert.equal(result.claim.state.endReason, "fifty_moves");
  assert.equal(result.automatic.endReason, "seventy_five_moves");
  assert.equal(result.reset.halfmove, 0);
  assert.equal(result.mate.endReason, "checkmate");
});

test("Chess draw offers require the other player, support decline, and resign/leave finish once", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    local early=on_action(s,{type="rematch"},{actor={id="white"}})
    s=on_action(s,{type="offer_draw"},{actor={id="white"}}).state
    local self=on_action(s,{type="accept_draw"},{actor={id="white"}})
    local accepted=on_action(clone(s),{type="accept_draw"},{actor={id="black"}})
    local declined=on_action(clone(s),{type="decline_draw"},{actor={id="black"}})
    local resigned=on_action(setup(ctx),{type="resign"},{actor={id="black"}})
    local left=on_player_left(setup(ctx),{actor={id="white"}})
    local late=play(resigned.state,"e2","e4")
    result={early=early.error.code,self=self.error.code,accepted=accepted.state,declined=declined.state,
      resigned=resigned.state,left=left.state,late=late.error.code}
  `);
  assert.equal(result.early, "GAME_NOT_OVER");
  assert.equal(result.self, "NO_DRAW_OFFER");
  assert.equal(result.accepted.endReason, "agreement");
  assert.equal(result.declined.drawOffer, 0);
  assert.equal(result.resigned.winner, "white");
  assert.equal(result.left.winner, "black");
  assert.equal(result.late, "GAME_OVER");
});

test("Chess opening actions fit the platform's 50,000 instruction budget", async () => {
  const result = await scenario(`
    local s=setup(ctx) local highest=0
    for _,p in ipairs({{"e2","e4"},{"e7","e5"},{"g1","f3"},{"b8","c6"},{"f1","b5"}}) do
      local instructions=0
      debug.sethook(function() instructions=instructions+100 end,"",100)
      local next=play(s,p[1],p[2])
      debug.sethook()
      assert(next.accepted) s=next.state highest=math.max(highest,instructions)
    end
    result=highest
  `);
  assert.ok(result < 50_000, `used ${result} instructions`);
});

test("Chess tactical castling position has the standard Kiwipete move count", async () => {
  const result = await scenario(`
    local s=setup(ctx)
    local fen="r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R"
    local r,c=1,1
    for i=1,#fen do
      local ch=string.sub(fen,i,i)
      if ch=="/" then r,c=r+1,1
      elseif tonumber(ch) then for j=1,tonumber(ch) do s.board[r][c]="" c=c+1 end
      else s.board[r][c]=(ch==string.upper(ch) and "w" or "b")..string.upper(ch) c=c+1 end
    end
    s.legalMoves=legal_moves(s,"w")
    local peak=0
    for _,m in ipairs(s.legalMoves) do
      local a=clone(m) a.type="move"
      local copy=clone(s) local n=0
      debug.sethook(function() n=n+100 end,"",100)
      local next=on_action(copy,a,{actor={id="white"}})
      debug.sethook()
      assert(next.accepted) peak=math.max(peak,n)
    end
    result={moves=#s.legalMoves,peak=peak}
  `);
  assert.equal(result.moves, 48);
  assert.ok(result.peak < 50_000, `tactical action used ${result.peak} instructions`);
});

test("Chess varied full games stay inside room instruction and state-size limits", async () => {
  const result = await scenario(`
    local peak,moves,states=0,0,{}
    math.randomseed(187)
    for game=1,4 do
      local s=setup(ctx)
      for ply=1,180 do
        if s.winner~="" or s.draw then break end
        local a=clone(s.legalMoves[math.random(#s.legalMoves)]) a.type="move"
        if a.promotion then a.promotion="Q" end
        local n=0
        debug.sethook(function() n=n+100 end,"",100)
        local next=on_action(s,a,{actor={id=s.players[s.current]}})
        debug.sethook()
        assert(next.accepted) s=next.state peak=math.max(peak,n) moves=moves+1
      end
      states[#states+1]=s
    end
    result={peak=peak,moves=moves,states=states}
  `);
  assert.ok(result.moves > 300);
  assert.ok(result.peak < 50_000, `varied game action used ${result.peak} instructions`);
  for (const state of result.states) {
    assert.ok(Buffer.byteLength(JSON.stringify(state)) < 64 * 1024);
    assert.ok(state.history.length <= 150);
  }
});
