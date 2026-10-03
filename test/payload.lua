local commands = {}
local callbacks = {}
local forms = {}
local chats = {}
local world_dir = os.tmpname(); os.remove(world_dir); os.execute('mkdir -p ' .. world_dir)
local players = {alice = {get_player_name = function() return 'alice' end,
  get_pos = function() return {x = 0.2, y = 0.5, z = -0.3} end,
  get_look_dir = function() return {x = 0, y = -0.5, z = 0.8} end,
  get_look_horizontal = function() return 4.7 end,
  get_properties = function() return {eye_height = 1.5, collisionbox = {-0.3, 0, -0.3, 0.3, 1.77, 0.3}} end,
  get_wielded_item = function() return {get_name = function() return '' end} end}}
local function encode(v)
  if type(v) == 'table' then
    if #v > 0 then local out = {} for i, x in ipairs(v) do out[i] = encode(x) end
      return '[' .. table.concat(out, ',') .. ']' end
    local out = {}
    for k, x in pairs(v) do out[#out + 1] = string.format('%q', k) .. ':' .. encode(x) end
    return next(v) == nil and 'null' or '{' .. table.concat(out, ',') .. '}'
  elseif type(v) == 'string' then return string.format('%q', v) end
  return tostring(v)
end
local prefix = 'payload/hanaworlds_adapter/'
local source_bytes = ''
for _, name in ipairs({'mod.conf', 'init.lua', 'engine.lua', 'transport.lua', 'region.lua'}) do
  local f = assert(io.open(prefix .. name, 'rb'))
  source_bytes = source_bytes .. name .. '\n' .. f:read('*a')
  f:close()
end
local real_open = io.open
io.open = function(path, mode)
  if path:match('/payload%.json$') then
    return {read = function() return '{}' end, close = function() end}
  end
  return real_open(path, mode)
end
_G.worldedit = {version_string = '1.3', set = function() end, set_param2 = function() end}
_G.minetest = {
  get_modpath = function() return 'payload/hanaworlds_adapter' end,
  get_worldpath = function() return world_dir end,
  write_json = encode,
  safe_file_write = function(path, content)
    local f = assert(io.open(path, 'wb')); f:write(content); f:close(); return true
  end,
  chat_send_player = function(name, text) chats[#chats + 1] = {name, text} end,
  registered_items = {[''] = {}},
  registered_nodes = {['fixture:stone'] = {}},
  get_node_or_nil = function() return {name = 'fixture:stone', param1 = 0, param2 = 0} end,
  raycast = function(from, to)
    assert(math.abs(to.z - from.z - 3.2) < 1e-9, 'pointing range is the engine item range')
    local done = false
    return function()
      if done then return nil end
      done = true
      return {type = 'node', under = {x = 5, y = 0, z = 5}, above = {x = 5, y = 1, z = 5}}
    end
  end,
  get_current_modname = function() return 'hanaworlds_adapter' end,
  get_mod_storage = function() return {get_string = function() return '' end} end,
  register_chatcommand = function(name, spec) commands[name] = spec end,
  register_on_player_receive_fields = function(cb) callbacks[#callbacks + 1] = cb end,
  get_player_by_name = function(name) return players[name] end,
  show_formspec = function(name, form, spec) forms[#forms + 1] = {name, form, spec} end,
  formspec_escape = function(s) return s:gsub('[%[%]\\,;]', '\\%0') end,
  check_player_privs = function() return true end,
  log = function() end,
  sha256 = function(data) return tostring(#data) .. ':' .. data:sub(-8) end,
  get_us_time = function() return 123456 end,
  parse_json = function() return {payloadDigest = tostring(#source_bytes) .. ':' .. source_bytes:sub(-8), worldRef = 'luanti:test'} end,
}
dofile('payload/hanaworlds_adapter/init.lua')
local capabilities = hanaworlds_adapter.capabilities()
assert(capabilities.worldeditAvailable == true and capabilities.worldeditVersion == '1.3', 'installed WorldEdit API reported')
assert(capabilities.loadedSourceDigest ~= nil, 'loaded payload reads and hashes its own source files')
assert(commands.hanaworlds, 'native in-game entrypoint registered')
local ok = commands.hanaworlds.func('alice')
assert(ok == true and #forms == 1, 'authenticated player can open native surface')
assert(forms[1][2] == 'hanaworlds:session', 'session form only')
assert(forms[1][3]:find('Session unavailable', 1, true), 'no invented Session when Workshop is absent')
local denied = commands.hanaworlds.func('absent')
assert(denied == false and #forms == 1, 'missing player cannot open surface')
local function frame_action(frame, action_id, kind, digest)
  return {actionId = action_id, inputKinds = {kind}, surfaceActionDigest = digest,
    surfaceAction = {contractVersion = 'interaction-surface/v2', sessionRef = frame.sessionRef,
      turnRevision = frame.turnRevision, frameRef = frame.frameRef,
      frameRevision = frame.frameRevision, actionId = action_id,
      orderedTargetRefs = {}, intentDigest = digest, operationDigest = nil,
      analysisDigest = nil, decisionRevision = nil}}
end
local frame = {sessionRef = 'session-1', turnRevision = 'turn-1', frameRef = 'frame-1',
  actorRef = 'player:alice', authorizationRef = 'grant:one',
  frameRevision = 'frame-r1', content = 'Confirmed session', actions = {
  }}
frame.actions[1] = frame_action(frame, 'reply', 'TEXT', string.rep('a', 64))
assert(hanaworlds_adapter.present_frame('alice', frame), 'trusted matched payload displays provided Session frame')
local invoked
hanaworlds_adapter.invoke_action = function(request, name)
  invoked = {name = name, sessionRef = request.sessionRef, action = request.actionId,
    input = request.input, contractVersion = request.contractVersion, request = request}
end
local action_button = forms[#forms][3]:match('button%[[^;]+;[^;]+;([^;]+);reply%]')
assert(action_button, 'current revision action button rendered')
callbacks[1](players.alice, 'hanaworlds:session', {[action_button] = true, message = 'Hello'})
assert(invoked and invoked.name == 'alice' and invoked.sessionRef == 'session-1'
  and invoked.action == 'reply' and invoked.input.kind == 'TEXT' and invoked.input.text == 'Hello',
  'native action carries the actual frame and input to the owner transport')
assert(frame.nonce == nil, 'renderer never mutates the strict InteractionFrame projection')
local mutable = {sessionRef = 'session-1', turnRevision = 'turn-2', frameRef = 'frame-2',
  actorRef = 'player:alice', authorizationRef = 'grant:one',
  frameRevision = 'frame-r2', content = 'Second frame', actions = {
  }}
mutable.actions[1] = frame_action(mutable, 'original', 'TEXT', string.rep('b', 64))
assert(hanaworlds_adapter.present_frame('alice', mutable))
local second_button = forms[#forms][3]:match('button%[[^;]+;[^;]+;([^;]+);original%]')
mutable.actions[1].actionId = 'tampered'
callbacks[1](players.alice, 'hanaworlds:session', {[second_button] = true, message = 'Next'})
assert(invoked.action == 'original', 'displayed revision cannot be changed by caller table mutation')
local decision = {sessionRef = 'session-1', turnRevision = 'turn-3', frameRef = 'frame-3',
  actorRef = 'player:alice', authorizationRef = 'grant:one',
  frameRevision = 'frame-r3', content = 'Proceed?', actions = {
  }}
decision.actions[1] = frame_action(decision, 'decide', 'DECISION', string.rep('c', 64))
assert(hanaworlds_adapter.present_frame('alice', decision))
local decision_spec = forms[#forms][3]
assert(decision_spec:find('dropdown[', 1, true) and decision_spec:find('Choose,CONTINUE,CANCEL', 1, true),
  'decision action exposes the permitted choices')
local decision_button = decision_spec:match('button%[[^;]+;[^;]+;([^;]+);decide%]')
callbacks[1](players.alice, 'hanaworlds:session', {[second_button] = true, hw_decision = 'CONTINUE'})
assert(invoked.action == 'original', 'stale frame action does not invoke current action')
callbacks[1](players.alice, 'hanaworlds:session', {[decision_button] = true, hw_decision = 'CONTINUE'})
assert(invoked.action == 'decide' and invoked.input.decision == 'CONTINUE', 'decision is passed as typed input')
local selection = {sessionRef = 'session-1', turnRevision = 'turn-4', frameRef = 'frame-4',
  actorRef = 'player:alice', authorizationRef = 'grant:one',
  frameRevision = 'frame-r4', content = 'Select objects', actions = {}}
selection.actions[1] = frame_action(selection, 'select', 'SELECT_OBJECTS', string.rep('d', 64))
selection.actions[1].surfaceAction.orderedTargetRefs = {'object:a', 'object:b', 'object:c'}
assert(hanaworlds_adapter.present_frame('alice', selection))
local select_spec = forms[#forms][3]
assert(select_spec:find('checkbox[', 1, true) and select_spec:find('object:a', 1, true),
  'renderer exposes only host pinned object choices')
local select_button = select_spec:match('button%[[^;]+;[^;]+;([^;]+);select%]')
local select_nonce = select_button:match('hw_action_(.-)_1')
callbacks[1](players.alice, 'hanaworlds:session', {[select_button] = true,
  ['hw_select_' .. select_nonce .. '_1_1'] = 'true',
  ['hw_select_' .. select_nonce .. '_1_3'] = 'true'})
assert(invoked.action == 'select' and invoked.input.kind == 'SELECT_OBJECTS'
  and #invoked.input.orderedObjectRefs == 2
  and invoked.input.orderedObjectRefs[1] == 'object:a'
  and invoked.input.orderedObjectRefs[2] == 'object:c',
  'selection transmits only listed objects in owner order')
assert(invoked.contractVersion == 'interaction-surface/v3', 'in-world invocations use interaction-surface/v3')
local region = hanaworlds_adapter.region
assert(region.relays[invoked.request.invocationId].engineActorName == 'alice'
  and region.relays[invoked.request.invocationId].sessionRef == 'session-1'
  and region.relays[invoked.request.invocationId].worldRef == 'luanti:test',
  'every relayed invocation is recorded before delivery')
local state_file = assert(io.open(world_dir .. '/hanaworlds_adapter_engine_state.json', 'rb'))
assert(state_file:read('*a'):find('hanaworlds-adapter-engine-state/1', 1, true), 'relay record persisted in engine state')
state_file:close()

-- Placement ask: in-world renderer offers PICK_WORLD_POINT only; the name list is chosen in Shell.
local ask = {sessionRef = 'session-1', turnRevision = 'turn-5', frameRef = 'frame-5',
  actorRef = 'player:alice', authorizationRef = 'grant:one',
  frameRevision = 'frame-r5', content = 'Where should it go?', actions = {}}
ask.actions[1] = frame_action(ask, 'place', 'PICK_WORLD_POINT', string.rep('e', 64))
ask.actions[1].inputKinds = {'PICK_WORLD_POINT', 'SELECT_CHOICE'}
assert(hanaworlds_adapter.present_frame('alice', ask))
local ask_spec = forms[#forms][3]
assert(ask_spec:find('place: choose in Shell', 1, true), 'SELECT_CHOICE is shown as choose in Shell')
assert(not ask_spec:find('alice', 1, true) and not ask_spec:find('hw_choice_', 1, true),
  'no player list and no choice control in game')
local pick_button = ask_spec:match('button%[[^;]+;[^;]+;(hw_pick_[^;]+);')
assert(pick_button, 'pick action rendered')
local ask_nonce = pick_button:match('hw_pick_(.-)_1')
local before_choice = invoked
callbacks[1](players.alice, 'hanaworlds:session', {['hw_choice_' .. ask_nonce .. '_1'] = 'bob'})
assert(invoked == before_choice, 'an in-world SELECT_CHOICE is answered locally and never relayed')
assert(chats[#chats][2]:find('made in Shell', 1, true), 'player is told to choose in Shell')
callbacks[1](players.alice, 'hanaworlds:session', {[pick_button] = true})
assert(forms[#forms][2] == 'hanaworlds:pick', 'pick asks the player to confirm the pointed node')
assert(invoked == before_choice, 'nothing is relayed before confirmation')
callbacks[1](players.alice, 'hanaworlds:pick', {hw_pick_confirm = true})
assert(invoked ~= before_choice and invoked.input.kind == 'PICK_WORLD_POINT', 'confirmed pick is relayed')
local pick = region.picks[invoked.input.pickRef]
assert(pick and pick.node[1] == 5 and pick.node[2] == 0 and pick.node[3] == 5
  and pick.picker == 'alice' and pick.pickerYaw == 4.7 and pick.sessionRef == 'session-1'
  and pick.worldRef == 'luanti:test', 'private pick record holds node, picker, facing and world')
assert(region.relays[invoked.request.invocationId], 'pick invocation recorded before delivery')
local function has_pose(v)
  if type(v) ~= 'table' then return false end
  for k, x in pairs(v) do
    if k == 'pos' or k == 'yaw' or k == 'pickerYaw' or k == 'node' or k == 'collisionbox' or has_pose(x) then return true end
  end
  return false
end
assert(not has_pose(invoked.request), 'the relayed invocation carries no position or facing')
os.remove(world_dir .. '/hanaworlds_adapter_engine_state.json'); os.remove(world_dir)
print('payload smoke PASS')
