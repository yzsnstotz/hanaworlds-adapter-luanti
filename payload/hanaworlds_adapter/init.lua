-- HanaWorlds Adapter payload 0.2.3. World mutation is unavailable until a
-- verified Canvas binding and the recoverable transport are installed.
local frames = {}
local pending_picks = {}
local adapter = rawget(_G, 'hanaworlds_adapter') or {}
rawset(_G, 'hanaworlds_adapter', adapter)
local http = minetest.request_http_api and minetest.request_http_api() or nil
local modpath = minetest.get_modpath(minetest.get_current_modname())
local engine_module = dofile(modpath .. '/engine.lua')
local region_module = dofile(modpath .. '/region.lua')
local grant_module = dofile(modpath .. '/grant.lua')
local facts_module = dofile(modpath .. '/facts.lua')
local transport_ready = false
local SURFACE = 'interaction-surface/v3'
local RENDERED_KINDS = {TEXT = true, NAME = true, DECISION = true, SELECT_OBJECTS = true,
  PICK_WORLD_POINT = true, SELECT_CHOICE = true}

local function read_own_file(name)
  if not io or not io.open then return nil end
  local path = modpath .. '/' .. name
  local ok, file = pcall(io.open, path, 'rb')
  if not ok or not file then return nil end
  local content = file:read('*a')
  file:close()
  return content
end

local function loaded_digest()
  if not minetest.sha256 then return nil end
  local parts = {}
  for _, name in ipairs({'mod.conf', 'init.lua', 'engine.lua', 'transport.lua', 'region.lua',
    'grant.lua', 'facts.lua'}) do
    local content = read_own_file(name)
    if not content then return nil end
    parts[#parts + 1] = name .. '\n' .. content
  end
  return minetest.sha256(table.concat(parts))
end

local source_digest = loaded_digest()
local manifest_bytes = read_own_file('payload.json')
local manifest = manifest_bytes and minetest.parse_json and minetest.parse_json(manifest_bytes) or nil
local identity_verified = source_digest and manifest and source_digest == manifest.payloadDigest
local world_name = minetest.get_worldpath():match('[^/\\]+$') or 'Unknown world'
local grants = identity_verified and grant_module.new(minetest, manifest.worldRef, world_name) or nil

-- Relay and pick records live in this world's own Adapter engine state.
local region = region_module.new({core = minetest,
  state_path = minetest.get_worldpath() .. '/hanaworlds_adapter_engine_state.json'})
adapter.region = region

function adapter.capabilities()
  local editing = rawget(_G, 'worldedit')
  local available = type(editing) == 'table'
    and type(editing.set) == 'function'
    and type(editing.set_param2) == 'function'
  return {
    payloadVersion = '0.2.3',
    worldeditAvailable = available,
    worldeditVersion = available and editing.version_string or nil,
    recoverableTransportAvailable = transport_ready,
    loadedSourceDigest = source_digest,
    manifestDigest = manifest and manifest.payloadDigest or nil,
    payloadMatches = identity_verified == true,
    worldRef = identity_verified and manifest.worldRef or nil,
    engineStateReadable = region.readable == true,
  }
end

local function has_kind(action, kind)
  for _, k in ipairs(action.inputKinds) do if k == kind then return true end end
  return false
end
-- The one in-world input an action button submits, besides picking.
local function primary_kind(action)
  for _, k in ipairs({'TEXT', 'NAME', 'DECISION', 'SELECT_OBJECTS'}) do
    if has_kind(action, k) then return k end
  end
  return nil
end

local function render(player_name)
  local shown = frames[player_name]
  local frame = shown and shown.projection
  local content = frame and frame.content or 'Session unavailable: Workshop is not connected.'
  local escaped = minetest.formspec_escape(content)
  local rows = 0
  if frame then
    for _, action in ipairs(frame.actions) do
      rows = rows + 1
      if has_kind(action, 'PICK_WORLD_POINT') then rows = rows + 1 end
      if has_kind(action, 'SELECT_CHOICE') then rows = rows + 1 end
      if has_kind(action, 'SELECT_OBJECTS') then
        rows = rows + #action.surfaceAction.orderedTargetRefs
      end
    end
  end
  local height = frame and (7 + rows * 0.7) or 7
  local spec = 'formspec_version[4]size[11,' .. height .. ']label[0.5,0.5;HanaWorlds Session]'
    .. 'textarea[0.5,1.2;10,4.3;content;;' .. escaped .. ']'
  if frame then
    spec = spec .. 'field[0.5,5.3;10,0.8;message;Input;]'
    local has_decision = false
    for _, action in ipairs(frame.actions) do
      if primary_kind(action) == 'DECISION' then has_decision = true end
    end
    if has_decision then
      spec = spec .. 'dropdown[0.5,5.3;10,0.8;hw_decision;Choose,CONTINUE,CANCEL;1]'
    end
    local y = 5.8
    for i, action in ipairs(frame.actions) do
      local label = minetest.formspec_escape(action.actionId)
      if primary_kind(action) == 'SELECT_OBJECTS' then
        for j, object_ref in ipairs(action.surfaceAction.orderedTargetRefs) do
          spec = spec .. 'checkbox[0.6,' .. y .. ';hw_select_' .. shown.nonce .. '_'
            .. i .. '_' .. j .. ';' .. minetest.formspec_escape(object_ref) .. ';false]'
          y = y + 0.6
        end
      end
      if primary_kind(action) then
        spec = spec .. 'button[0.5,' .. y .. ';10,0.6;hw_action_'
          .. shown.nonce .. '_' .. i .. ';' .. label .. ']'
        y = y + 0.7
      end
      if has_kind(action, 'PICK_WORLD_POINT') then
        spec = spec .. 'button[0.5,' .. y .. ';10,0.6;hw_pick_' .. shown.nonce .. '_' .. i
          .. ';' .. label .. ': pick the point you are looking at]'
        y = y + 0.7
      end
      if has_kind(action, 'SELECT_CHOICE') then
        -- rc.9: this list is chosen in Shell; the in-world renderer does not offer it.
        spec = spec .. 'label[0.6,' .. (y + 0.3) .. ';' .. label .. ': choose in Shell]'
        y = y + 0.7
      end
    end
  end
  minetest.show_formspec(player_name, 'hanaworlds:session', spec)
end

minetest.register_chatcommand('hanaworlds', {
  description = 'Open the HanaWorlds Session',
  func = function(name)
    if not minetest.get_player_by_name(name) then return false, 'Player is unavailable' end
    render(name)
    return true, ''
  end,
})

-- Every in-world invocation is durably recorded before it is delivered.
local function relay(name, frame, action, input, invocation)
  local request = {contractVersion = SURFACE,
    actorRef = frame.actorRef, sessionRef = frame.sessionRef,
    requestId = invocation, authorizationRef = frame.authorizationRef,
    turnRevision = frame.turnRevision, frameRevision = frame.frameRevision,
    frameRef = frame.frameRef, actionId = action.actionId,
    invocationId = invocation, surfaceAction = action.surfaceAction,
    surfaceActionDigest = action.surfaceActionDigest, input = input}
  if input.kind == 'SELECT_CHOICE' then
    -- Answered here, never relayed: RENDERER_CAPABILITY_UNAVAILABLE/validate/SCOPE_DENIED.
    minetest.chat_send_player(name, 'HanaWorlds: this choice is made in Shell.')
    return false, 'RENDERER_CAPABILITY_UNAVAILABLE'
  end
  if not adapter.invoke_action then return false, 'RENDERER_CAPABILITY_UNAVAILABLE' end
  if not region:record_relay(invocation, frame.sessionRef, manifest and manifest.worldRef or '', name) then
    minetest.chat_send_player(name, 'HanaWorlds: the request could not be recorded; nothing was sent.')
    return false, 'RENDERER_CAPABILITY_UNAVAILABLE'
  end
  adapter.invoke_action(request, name)
  return true
end

local function new_invocation(name, frame, action)
  return minetest.sha256(name .. '\n' .. frame.frameRef .. '\n'
    .. action.actionId .. '\n' .. tostring(minetest.get_us_time()))
end

-- The pointed node along the player's look direction within the wielded
-- item's own pointing range (engine item definition; lua_api "range").
local function pointed_node(player)
  local props = player:get_properties()
  local pos = player:get_pos()
  local dir = player:get_look_dir()
  if type(props) ~= 'table' or type(pos) ~= 'table' or type(dir) ~= 'table'
    or type(props.eye_height) ~= 'number' then return nil end
  local item = player:get_wielded_item():get_name()
  local def = minetest.registered_items[item] or minetest.registered_items['']
  local range = def and def.range
  if type(range) ~= 'number' then
    local hand = minetest.registered_items['']
    range = hand and hand.range
  end
  -- An item definition without `range` points 4 nodes far in the engine
  -- itself (ItemDefinition default, lua_api.md "range = 4.0"); the pick
  -- reaches exactly what the player can point at in game.
  if range == nil then range = 4.0 end
  if type(range) ~= 'number' or range <= 0 then return nil end
  local eye = {x = pos.x, y = pos.y + props.eye_height, z = pos.z}
  local finish = {x = eye.x + dir.x * range, y = eye.y + dir.y * range, z = eye.z + dir.z * range}
  for pointed in minetest.raycast(eye, finish, false, false) do
    if pointed.type == 'node' then return pointed.under end
  end
  return nil
end

local function show_pick_confirm(name, pending)
  local node = minetest.get_node_or_nil(pending.node)
  local label = node and node.name or 'unloaded node'
  minetest.show_formspec(name, 'hanaworlds:pick', 'formspec_version[4]size[9,3.4]'
    .. 'label[0.5,0.6;Build on top of the pointed node (' .. minetest.formspec_escape(label) .. ')?]'
    .. 'button_exit[0.5,1.8;3.8,0.8;hw_pick_confirm;Confirm]'
    .. 'button_exit[4.7,1.8;3.8,0.8;hw_pick_cancel;Cancel]')
end

minetest.register_on_player_receive_fields(function(player, formname, fields)
  if not player then return end
  local name = player:get_player_name()
  if not minetest.get_player_by_name(name) then return end
  if formname == 'hanaworlds:pick' then
    local pending = pending_picks[name]
    pending_picks[name] = nil
    if not pending or not fields.hw_pick_confirm then return end
    local shown = frames[name]
    if not shown or shown.nonce ~= pending.nonce then
      minetest.chat_send_player(name, 'HanaWorlds: the request changed; open /hanaworlds again.')
      return
    end
    local frame = shown.projection
    local action = frame.actions[pending.index]
    local invocation = new_invocation(name, frame, action)
    local pick_ref = 'luanti-pick:' .. minetest.sha256(invocation .. '\npick')
    if not region:record_pick(pick_ref, frame.sessionRef, manifest and manifest.worldRef or '',
      name, {pending.node.x, pending.node.y, pending.node.z}, pending.yaw) then
      minetest.chat_send_player(name, 'HanaWorlds: the point could not be recorded; nothing was sent.')
      return
    end
    frames[name] = nil
    relay(name, frame, action, {kind = 'PICK_WORLD_POINT', pickRef = pick_ref}, invocation)
    return
  end
  if formname ~= 'hanaworlds:session' then return end
  local shown = frames[name]
  if not shown then return end
  local frame = shown.projection
  for i, action in ipairs(frame.actions) do
    if fields['hw_pick_' .. shown.nonce .. '_' .. i] and has_kind(action, 'PICK_WORLD_POINT') then
      local node = pointed_node(player)
      if not node then
        minetest.chat_send_player(name, 'HanaWorlds: point at a node, then open /hanaworlds and pick again.')
        return
      end
      -- Facing at pick time stays inside the engine (pick record only).
      pending_picks[name] = {nonce = shown.nonce, index = i, node = node,
        yaw = player:get_look_horizontal()}
      show_pick_confirm(name, pending_picks[name])
      return
    end
    if fields['hw_choice_' .. shown.nonce .. '_' .. i] then
      relay(name, frame, action, {kind = 'SELECT_CHOICE', value = tostring(fields['hw_choice_'
        .. shown.nonce .. '_' .. i])}, new_invocation(name, frame, action))
      return
    end
    if fields['hw_action_' .. shown.nonce .. '_' .. i] then
      if not adapter.invoke_action then render(name); return end
      local kind = primary_kind(action)
      local input
      if kind == 'TEXT' then input = {kind = 'TEXT', text = fields.message or ''}
      elseif kind == 'NAME' then input = {kind = 'NAME', name = fields.message or ''}
      elseif kind == 'DECISION' and (fields.hw_decision == 'CONTINUE' or fields.hw_decision == 'CANCEL') then
        input = {kind = 'DECISION', decision = fields.hw_decision}
      elseif kind == 'SELECT_OBJECTS' then
        local selected = {}
        for j, object_ref in ipairs(action.surfaceAction.orderedTargetRefs) do
          if fields['hw_select_' .. shown.nonce .. '_' .. i .. '_' .. j] == 'true' then
            selected[#selected + 1] = object_ref
          end
        end
        if #selected == 0 then return end
        input = {kind = 'SELECT_OBJECTS', orderedObjectRefs = selected}
      else return end
      frames[name] = nil -- stale buttons cannot submit another action.
      relay(name, frame, action, input, new_invocation(name, frame, action))
      return
    end
  end
end)

function adapter.present_frame(player_name, frame)
  if not identity_verified then return false end
  if not minetest.get_player_by_name(player_name) then return false end
  if type(frame) ~= 'table' or type(frame.sessionRef) ~= 'string'
    or type(frame.actorRef) ~= 'string' or type(frame.authorizationRef) ~= 'string'
    or type(frame.frameRef) ~= 'string' or type(frame.frameRevision) ~= 'string'
    or type(frame.turnRevision) ~= 'string' or type(frame.content) ~= 'string'
    or type(frame.actions) ~= 'table' then return false end
  local pinned = {sessionRef = frame.sessionRef, turnRevision = frame.turnRevision,
    frameRef = frame.frameRef, frameRevision = frame.frameRevision,
    actorRef = frame.actorRef, authorizationRef = frame.authorizationRef,
    content = frame.content, actions = {}}
  for _, action in ipairs(frame.actions) do
    if type(action.actionId) ~= 'string' or type(action.surfaceActionDigest) ~= 'string'
      or type(action.surfaceAction) ~= 'table' or type(action.inputKinds) ~= 'table'
      or #action.inputKinds == 0 then return false end
    if action.surfaceAction.contractVersion ~= 'interaction-surface/v2'
      or action.surfaceAction.sessionRef ~= frame.sessionRef
      or action.surfaceAction.turnRevision ~= frame.turnRevision
      or action.surfaceAction.frameRef ~= frame.frameRef
      or action.surfaceAction.frameRevision ~= frame.frameRevision
      or action.surfaceAction.actionId ~= action.actionId then return false end
    local kinds, seen = {}, {}
    for _, kind in ipairs(action.inputKinds) do
      if not RENDERED_KINDS[kind] or seen[kind] then return false end
      seen[kind] = true
      kinds[#kinds + 1] = kind
    end
    if seen.SELECT_OBJECTS then
      if type(action.surfaceAction.orderedTargetRefs) ~= 'table'
        or #action.surfaceAction.orderedTargetRefs == 0 then return false end
      local refs = {}
      for _, object_ref in ipairs(action.surfaceAction.orderedTargetRefs) do
        if type(object_ref) ~= 'string' or object_ref == '' or refs[object_ref] then return false end
        refs[object_ref] = true
      end
    end
    pinned.actions[#pinned.actions + 1] = {actionId = action.actionId,
      surfaceActionDigest = action.surfaceActionDigest,
      surfaceAction = action.surfaceAction, inputKinds = kinds}
  end
  local nonce = minetest.sha256(pinned.sessionRef .. '\n' .. pinned.turnRevision .. '\n'
    .. pinned.frameRef .. '\n' .. pinned.frameRevision)
  frames[player_name] = {projection = pinned, nonce = nonce}
  pending_picks[player_name] = nil
  render(player_name)
  return true
end

if identity_verified then
  local transport = dofile(modpath .. '/transport.lua')
  local action_transport = transport.start(http, engine_module, manifest, read_own_file,
    function(ready)
      if ready and not transport_ready then
        minetest.log('action', 'HanaWorlds local courier paired on loopback')
      end
      transport_ready = ready
    end, adapter.capabilities, adapter.present_frame, region, grants, facts_module)
  if action_transport then adapter.invoke_action = action_transport.invoke_action end
end
local capability = adapter.capabilities()
minetest.log('action', 'HanaWorlds Adapter payload 0.2.3 loaded; WorldEdit API ' ..
  (capability.worldeditAvailable and ('available ' .. capability.worldeditVersion) or 'missing') ..
  '; payload identity ' .. (capability.payloadMatches and 'matched' or 'unverified') ..
  '; engine state ' .. (capability.engineStateReadable and 'readable' or 'UNREADABLE') ..
  '; recoverable transport ' .. (capability.recoverableTransportAvailable and 'paired' or 'unavailable'))
