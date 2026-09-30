-- HanaWorlds Adapter payload 0.1.0. World mutation is unavailable until a
-- verified Canvas binding and the recoverable transport are installed.
local frames = {}
local adapter = rawget(_G, 'hanaworlds_adapter') or {}
rawset(_G, 'hanaworlds_adapter', adapter)
local http = minetest.request_http_api and minetest.request_http_api() or nil
local engine_module = dofile(minetest.get_modpath(minetest.get_current_modname()) .. '/engine.lua')
local transport_ready = false

local function read_own_file(name)
  if not io or not io.open then return nil end
  local path = minetest.get_modpath(minetest.get_current_modname()) .. '/' .. name
  local ok, file = pcall(io.open, path, 'rb')
  if not ok or not file then return nil end
  local content = file:read('*a')
  file:close()
  return content
end

local function loaded_digest()
  if not minetest.sha256 then return nil end
  local parts = {}
  for _, name in ipairs({'mod.conf', 'init.lua', 'engine.lua', 'transport.lua'}) do
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

function adapter.capabilities()
  local editing = rawget(_G, 'worldedit')
  local available = type(editing) == 'table'
    and type(editing.set) == 'function'
    and type(editing.set_param2) == 'function'
  return {
    payloadVersion = '0.1.0',
    worldeditAvailable = available,
    worldeditVersion = available and editing.version_string or nil,
    recoverableTransportAvailable = transport_ready,
    loadedSourceDigest = source_digest,
    manifestDigest = manifest and manifest.payloadDigest or nil,
    payloadMatches = identity_verified == true,
    worldRef = identity_verified and manifest.worldRef or nil,
  }
end

local function render(player_name)
  local shown = frames[player_name]
  local frame = shown and shown.projection
  local content = frame and frame.content or 'Session unavailable: Workshop is not connected.'
  local escaped = minetest.formspec_escape(content)
  local select_count = 0
  if frame then
    for _, action in ipairs(frame.actions) do
      if action.inputKinds[1] == 'SELECT_OBJECTS' then
        select_count = select_count + #action.surfaceAction.orderedTargetRefs
      end
    end
  end
  local height = frame and (7 + #frame.actions * 0.7 + select_count * 0.6) or 7
  local spec = 'formspec_version[4]size[11,' .. height .. ']label[0.5,0.5;HanaWorlds Session]'
    .. 'textarea[0.5,1.2;10,4.3;content;;' .. escaped .. ']'
  if frame then
    spec = spec .. 'field[0.5,5.3;10,0.8;message;Input;]'
    local has_decision = false
    for _, action in ipairs(frame.actions) do
      if action.inputKinds[1] == 'DECISION' then has_decision = true end
    end
    if has_decision then
      spec = spec .. 'dropdown[0.5,5.3;10,0.8;hw_decision;Choose,CONTINUE,CANCEL;1]'
    end
    local y = 5.8
    for i, action in ipairs(frame.actions) do
      if action.inputKinds[1] == 'SELECT_OBJECTS' then
        for j, object_ref in ipairs(action.surfaceAction.orderedTargetRefs) do
          spec = spec .. 'checkbox[0.6,' .. y .. ';hw_select_' .. shown.nonce .. '_'
            .. i .. '_' .. j .. ';' .. minetest.formspec_escape(object_ref) .. ';false]'
          y = y + 0.6
        end
      end
      spec = spec .. 'button[0.5,' .. y .. ';10,0.6;hw_action_'
        .. shown.nonce .. '_' .. i .. ';' .. minetest.formspec_escape(action.actionId) .. ']'
      y = y + 0.7
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

minetest.register_on_player_receive_fields(function(player, formname, fields)
  if formname ~= 'hanaworlds:session' or not player then return end
  local name = player:get_player_name()
  if not minetest.get_player_by_name(name) then return end
  local shown = frames[name]
  if not shown then return end
  local frame = shown.projection
  for i, action in ipairs(frame.actions) do
    if fields['hw_action_' .. shown.nonce .. '_' .. i] then
      if not adapter.invoke_action then render(name); return end
      local kind = action.inputKinds[1]
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
      local invocation = minetest.sha256(name .. '\n' .. frame.frameRef .. '\n'
        .. action.actionId .. '\n' .. tostring(minetest.get_us_time()))
      frames[name] = nil -- stale buttons cannot submit another action.
      adapter.invoke_action({contractVersion = 'interaction-surface/v2',
        actorRef = frame.actorRef, sessionRef = frame.sessionRef,
        requestId = invocation, authorizationRef = frame.authorizationRef,
        turnRevision = frame.turnRevision, frameRevision = frame.frameRevision,
        frameRef = frame.frameRef, actionId = action.actionId,
        invocationId = invocation, surfaceAction = action.surfaceAction,
        surfaceActionDigest = action.surfaceActionDigest, input = input}, name)
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
      or #action.inputKinds ~= 1 then return false end
    if action.surfaceAction.contractVersion ~= 'interaction-surface/v2'
      or action.surfaceAction.sessionRef ~= frame.sessionRef
      or action.surfaceAction.turnRevision ~= frame.turnRevision
      or action.surfaceAction.frameRef ~= frame.frameRef
      or action.surfaceAction.frameRevision ~= frame.frameRevision
      or action.surfaceAction.actionId ~= action.actionId then return false end
    local kind = action.inputKinds[1]
    if kind ~= 'TEXT' and kind ~= 'NAME' and kind ~= 'DECISION'
      and kind ~= 'SELECT_OBJECTS' then return false end
    if kind == 'SELECT_OBJECTS' then
      if type(action.surfaceAction.orderedTargetRefs) ~= 'table'
        or #action.surfaceAction.orderedTargetRefs == 0 then return false end
      local seen = {}
      for _, object_ref in ipairs(action.surfaceAction.orderedTargetRefs) do
        if type(object_ref) ~= 'string' or object_ref == '' or seen[object_ref] then return false end
        seen[object_ref] = true
      end
    end
    pinned.actions[#pinned.actions + 1] = {actionId = action.actionId,
      surfaceActionDigest = action.surfaceActionDigest,
      surfaceAction = action.surfaceAction, inputKinds = {kind}}
  end
  local nonce = minetest.sha256(pinned.sessionRef .. '\n' .. pinned.turnRevision .. '\n'
    .. pinned.frameRef .. '\n' .. pinned.frameRevision)
  frames[player_name] = {projection = pinned, nonce = nonce}
  render(player_name)
  return true
end

if identity_verified then
  local transport = dofile(minetest.get_modpath(minetest.get_current_modname()) .. '/transport.lua')
  local action_transport = transport.start(http, engine_module, manifest, read_own_file,
    function(ready)
      if ready and not transport_ready then
        minetest.log('action', 'HanaWorlds local courier paired on loopback')
      end
      transport_ready = ready
    end, adapter.capabilities, adapter.present_frame)
  if action_transport then adapter.invoke_action = action_transport.invoke_action end
end
local capability = adapter.capabilities()
minetest.log('action', 'HanaWorlds Adapter payload 0.1.0 loaded; WorldEdit API ' ..
  (capability.worldeditAvailable and ('available ' .. capability.worldeditVersion) or 'missing') ..
  '; payload identity ' .. (capability.payloadMatches and 'matched' or 'unverified') ..
  '; recoverable transport ' .. (capability.recoverableTransportAvailable and 'paired' or 'unavailable'))
