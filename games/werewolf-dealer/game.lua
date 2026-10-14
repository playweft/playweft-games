local RANDOM_MODULUS=2147483647
local RANDOM_MULTIPLIER=48271
local function normalize_random_seed(value)
 local seed=0
 for i=1,#tostring(value or "") do
  local digit=tonumber(string.sub(tostring(value),i,i),16)
  if digit then seed=(seed*16+digit)%RANDOM_MODULUS end
 end
 return seed==0 and 1 or seed
end
local function setup_players(context)local players={} for _,p in ipairs(context.players)do table.insert(players,p.id)end return players end
local function rejected(state,reason)return{accepted=false,error={code=string.upper(reason),message=string.gsub(reason,"_"," ")}}end
local function player_index(state,id)for i,p in ipairs(state.players)do if p==id then return i end end return nil end
local function next_seed(seed)return(seed*RANDOM_MULTIPLIER)%RANDOM_MODULUS end
local function copy_role(role)return{id=role.id,name=role.name,mark=role.mark,team=role.team,copy=role.copy}end
local LEGACY_WHITE_GOD_NAME=string.char(0xE7,0x99,0xBD,0xE7,0x97,0xB4)
local function platform_safe_text(value)return string.gsub(tostring(value or ""),LEGACY_WHITE_GOD_NAME,"白神")end
local function sanitize_config(input,player_count)
 if type(input)~="table" or type(input.roles)~="table" then return nil end
 local config={presetId=tostring(input.presetId or "custom"),name=platform_safe_text(input.name or "自定义版型"),rules=platform_safe_text(input.rules or ""),roles={}}
 if #config.name>80 or #config.rules>3000 then return nil end
 local total=0
 for _,role in ipairs(input.roles)do
  if type(role)~="table" then return nil end
  local count=tonumber(role.count) or 0
  if count<0 or count>15 or count~=math.floor(count) then return nil end
  if count>0 then
   local name=platform_safe_text(role.name or "") local id=tostring(role.id or "custom")
   if id=="white_god"then name="白神"end
   if name=="" or #name>72 or #id>80 then return nil end
   local clean={id=id,name=name,mark=tostring(role.mark or string.sub(name,1,1)),team=tostring(role.team or "god"),copy=platform_safe_text(role.copy or ""),count=count}
   if #clean.copy>500 then return nil end
   table.insert(config.roles,clean) total=total+count
  end
 end
 if total~=player_count then return nil end
 return config
end
local function shuffled_roles(deck,seed)
 local roles={} for i,role in ipairs(deck)do roles[i]=copy_role(role)end
 for i=#roles,2,-1 do seed=next_seed(seed)local j=(seed%i)+1 roles[i],roles[j]=roles[j],roles[i]end
 return roles,seed
end
local function expand_roles(roles)local deck={} for _,role in ipairs(roles)do for _=1,role.count do table.insert(deck,copy_role(role))end end return deck end
local function deal_game(base,config,round)
 local deck,next_seed_value=shuffled_roles(expand_roles(config.roles),base.seed)
 local roles,status={},{}
 for i,id in ipairs(base.players)do roles[id]=deck[i] status[id]="alive" end
 return{phase="playing",players=base.players,roles=roles,status=status,votes={},flips={},seed=next_seed_value,round=round,voteRound=1,config=config,lastEvent={kind="dealt",round=round}}
end
local function alive_players(state)local result={} for _,id in ipairs(state.players)do if state.status[id]=="alive"then table.insert(result,id)end end return result end
local function resolve_vote(state)
 local tally={} local highest=0
 for _,target in pairs(state.votes)do tally[target]=(tally[target]or 0)+1 if tally[target]>highest then highest=tally[target]end end
 local tied={} for _,id in ipairs(alive_players(state))do if tally[id]==highest then table.insert(tied,id)end end state.votes={}
 if #tied~=1 then state.lastEvent={kind="tied",players=tied,voteRound=state.voteRound} state.voteRound=state.voteRound+1 return{accepted=true,state=state,events={{type="vote_tied",players=tied}}}end
 local eliminated=tied[1] local role=state.roles[eliminated] state.status[eliminated]="eliminated"
 table.insert(state.flips,{player=eliminated,role=copy_role(role),whiteGod=role.id=="white_god"})
 state.lastEvent={kind="eliminated",player=eliminated,role=copy_role(role),whiteGod=role.id=="white_god",voteRound=state.voteRound} state.voteRound=state.voteRound+1
 return{accepted=true,state=state,events={{type="eliminated",player=eliminated,role=copy_role(role)}}}
end
function setup(context)return{phase="setup",players=setup_players(context),seed=normalize_random_seed(context.match.randomSeed),round=1,lastEvent={kind="setup"}}end
function view(state,events,context)
 state.seed=nil state.canConfigure=context.viewer.isOwner==true
 if state.phase=="setup" then return{state=state,events=events}end
 local viewer=context.viewer.id local own=state.roles[viewer] state.roles={} if own then state.roles[viewer]=own end
 local visible={} for voter,target in pairs(state.votes)do visible[voter]=voter==viewer and target or true end state.votes=visible
 return{state=state,events=events}
end
function on_action(state,action,context)
 if type(action)~="table"then return rejected(state,"invalid_action")end
 local actor=context.actor.id
 if state.phase=="setup" then
  if not context.actor.isOwner then return rejected(state,"host_only")end
  if action.type=="clear_config"then state.config=nil state.lastEvent={kind="configuration_cleared",player=actor}return{accepted=true,state=state,events={{type="configuration_cleared",player=actor}}}end
  if action.type~="configure"and action.type~="deal"then return rejected(state,"configuration_required")end
  local config=sanitize_config(action.config,#state.players) if not config then return rejected(state,"invalid_role_pool")end
  if action.type=="configure"then state.config=config state.lastEvent={kind="configured",player=actor}return{accepted=true,state=state,events={{type="configured",player=actor}}}end
  local next_state=deal_game(state,config,state.round or 1) return{accepted=true,state=next_state,events={{type="dealt",player=actor}}}
 end
 if not player_index(state,actor)then return rejected(state,"not_a_player")end
 if action.type=="rematch"then local next_state=deal_game(state,state.config,(state.round or 1)+1)return{accepted=true,state=next_state,events={{type="redealt",player=actor}}}end
 if action.type~="vote"then return rejected(state,"unknown_action")end
 if state.status[actor]~="alive"then return rejected(state,"not_alive")end
 if type(action.target)~="string"or not player_index(state,action.target)then return rejected(state,"invalid_target")end
 if state.status[action.target]~="alive"then return rejected(state,"target_not_alive")end
 state.votes[actor]=action.target local active=alive_players(state)local cast=0 for _,id in ipairs(active)do if state.votes[id]then cast=cast+1 end end
 if cast<#active then state.lastEvent={kind="vote_cast",player=actor,votesCast=cast,voters=#active}return{accepted=true,state=state,events={{type="vote_cast",player=actor}}}end
 return resolve_vote(state)
end
function on_player_left(state,context)
 if state.phase=="setup"then return{state=state,events={}}end
 local actor=context.actor.id if not player_index(state,actor)or state.status[actor]~="alive"then return{state=state,events={}}end
 state.status[actor]="left" state.votes={} state.lastEvent={kind="left",player=actor} return{state=state,events={{type="player_left",player=actor}}}
end
function on_return_to_room(state,context)return true end
