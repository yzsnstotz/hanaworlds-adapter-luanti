local commands = {}
local callbacks = {}
local forms = {}
local players = {alice = {get_player_name = function() return 'alice' end}}
local prefix = 'payload/hanaworlds_adapter/'
local source_bytes = ''
for _, name in ipairs({'mod.conf', 'init.lua', 'engine.lua', 'transport.lua'}) do
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
    input = request.input, contractVersion = request.contractVersion}
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
print('payload smoke PASS')
