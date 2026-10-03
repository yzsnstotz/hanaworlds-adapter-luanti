-- Private loopback courier. It never accepts world commands from a player
-- form or arbitrary HTTP caller; the host must possess the per-world secret.
local M = {}

-- Error text for the server log without positions, yaw or box values.
function M.redact(message)
  local text = tostring(message)
  local tuple = '%-?[%d%.]+%s*,%s*%-?[%d%.]+%s*,%s*%-?[%d%.]+'
  text = text:gsub('%(%s*' .. tuple .. '%s*%)', '(<redacted>)')
  text = text:gsub('{[^{}]*}', '{<redacted>}')
  text = text:gsub(tuple, '<redacted>')
  text = text:gsub('%-?%d+%.%d+', '<redacted>')
  return text
end

function M.start(http, engine_module, manifest, read_own_file, on_ready, capabilities, present_frame,
  region, grants)
  local raw = read_own_file('transport.json')
  local config = raw and minetest.parse_json(raw) or nil
  if not http then
    minetest.log('warning', 'HanaWorlds local courier unavailable: HTTP mod permission missing')
    return false
  end
  if type(config) ~= 'table' or config.worldRef ~= manifest.worldRef
    or type(config.port) ~= 'number' or config.port < 1 or config.port > 65535
    or config.port ~= math.floor(config.port)
    or type(config.token) ~= 'string' or not config.token:match('^[0-9a-f]+$')
    or #config.token ~= 64 then
    minetest.log('warning', 'HanaWorlds local courier unavailable: pairing configuration invalid')
    return false
  end

  local base = 'http://127.0.0.1:' .. config.port
  local header = {'Authorization: Bearer ' .. config.token, 'Content-Type: application/json'}
  local current
  local engine = engine_module.new({
    authorize = function(name, action)
      return current and name == current.actorName and action == current.action
    end,
    verifyPrepared = function(_, _, _, prepared)
      return current and (current.operation == 'apply' or current.operation == 'apply_state')
        and prepared == current.prepared
        and prepared.status == 'PREPARED'
        and prepared.operationDigest == current.operationDigest
    end,
    verifyRestore = function(name, _, recovery)
      return current and current.operation == 'restore' and name == current.serviceName
        and recovery == current.recovery and recovery.status == 'RESTORING'
    end,
  })

  local function run(command)
    if type(command) ~= 'table' or type(command.id) ~= 'string'
      or command.worldRef ~= manifest.worldRef then return nil, 'CONNECTION_UNAUTHORIZED' end
    -- The paired host cannot nominate an unconsenting player. Every new
    -- player command rechecks the engine's current grant, session and privs.
    local player_operation = {
      present_frame = true, snapshot = true, inspect = true,
      prepare_check = true, inspect_region = true, apply = true,
      apply_state = true, readback = true,
    }
    if player_operation[command.operation] then
      local actor
      if command.operation == 'present_frame' then actor = command.engineActorName
      else actor = command.actorName end
      -- An unused second name must never select another player's grant.
      if type(actor) ~= 'string' or actor == ''
        or (command.actorName ~= nil and command.actorName ~= actor)
        or (command.engineActorName ~= nil and command.engineActorName ~= actor) then
        return nil, 'PERMISSION_DENIED'
      end
      local proof = grants and grants:verify(actor)
      if not proof or proof.current ~= true or proof.worldRef ~= manifest.worldRef
        or proof.engineActorName ~= actor
        or proof.scope ~= 'WORLD_BUILD_WITH_ENGINE_PROTECTION'
        or type(command.grantRef) ~= 'string' or command.grantRef == ''
        or command.grantRef ~= proof.grantRef then
        return nil, 'PERMISSION_DENIED'
      end
    end
    current = command
    local result, code
    if command.operation == 'present_frame' then
      result = present_frame(command.engineActorName, command.frame)
      if not result then code = 'INVALID_FRAME' end
    elseif command.operation == 'handshake' then
      result = capabilities()
    elseif command.operation == 'authorize' then
      local name = command.actorName
      local proof = grants and grants:verify(name) or {current = false}
      result = {current = proof.current == true, engineActorName = name,
        worldRef = manifest.worldRef, scope = proof.scope, grantRef = proof.grantRef,
        worldeditAvailable = capabilities().worldeditAvailable}
    elseif command.operation == 'list_grants' then
      if capabilities().worldeditAvailable ~= true then code = 'CAPABILITY_UNAVAILABLE'
      else result = {grants = grants and grants:list_current() or {}} end
    elseif command.operation == 'snapshot' then
      result, code = engine:snapshot(command.actorName, command.positions)
      if result then result.worldRef = manifest.worldRef end
    elseif command.operation == 'inspect' then
      result, code = engine:inspect(command.actorName, command.positions)
    elseif command.operation == 'prepare_check' then
      result, code = region:prepare_check(command.actorName, command.positions)
    elseif command.operation == 'inspect_region' then
      if type(command.actorName) ~= 'string' or command.actorName == ''
        or (minetest.player_exists and not minetest.player_exists(command.actorName)) then
        code = 'PRINCIPAL_UNKNOWN'
      elseif command.worldRef ~= manifest.worldRef then
        code = 'CONNECTION_UNAUTHORIZED'
      else
        local raw
        raw, code = region:inspect({worldRef = command.worldRef, sessionRef = command.sessionRef,
          anchor = command.anchor, footprint = command.footprint, settings = command.settings,
          actorName = command.actorName, walkable = command.walkable or {},
          limitExceeded = command.limitExceeded == true})
        if raw then result = {raw_json = raw} end
      end
    elseif command.operation == 'apply' then
      result, code = engine:apply(command.actorName, command.effects,
        command.beforeImage, command.prepared)
    elseif command.operation == 'apply_state' then
      result, code = engine:apply_state(command.actorName, command.targetImage,
        command.beforeImage, command.prepared)
    elseif command.operation == 'readback' then
      result, code = engine:readback(command.actorName, command.positions)
      if result then result.worldRef = manifest.worldRef end
    elseif command.operation == 'restore' then
      result, code = engine:restore(command.serviceName,
        command.beforeImage, command.recovery)
    else code = 'UNKNOWN_ACTION' end
    current = nil
    return result, code
  end

  -- Luanti write_json maps every empty Lua table to JSON null. Build the
  -- state-profile containers explicitly so an empty inventory/map/list is not
  -- mistaken for missing or unknown state at the host durable barrier.
  local function json(value) return assert(minetest.write_json(value)) end
  local function array(values, encode)
    local out = {}
    for i, value in ipairs(values) do out[i] = encode(value) end
    return '[' .. table.concat(out, ',') .. ']'
  end
  local function object(values, encode)
    local out = {}
    for key, value in pairs(values) do
      out[#out + 1] = json(key) .. ':' .. encode(value)
    end
    table.sort(out)
    return '{' .. table.concat(out, ',') .. '}'
  end
  local function encode_state(state)
    local records = array(state.records, function(record)
      local inventory = object(record.inventory, function(slots)
        return array(slots, json)
      end)
      return '{"position":' .. array(record.position, json)
        .. ',"nodeName":' .. json(record.nodeName)
        .. ',"param1":' .. json(record.param1)
        .. ',"param2":' .. json(record.param2)
        .. ',"metadata":' .. object(record.metadata, json)
        .. ',"inventory":' .. inventory
        .. ',"timer":' .. (record.timer and json(record.timer) or 'null') .. '}'
    end)
    return '{"worldRef":' .. json(state.worldRef)
      .. ',"coveredPositions":' .. array(state.coveredPositions,
        function(position) return array(position, json) end)
      .. ',"records":' .. records .. '}'
  end

  local function encode_reply(id, result, code)
    -- Only a table result can carry shaped fields; present_frame replies with
    -- a boolean, and indexing it would raise inside the poll callback and stop
    -- the server.
    local shaped = type(result) == 'table'
    local encoded
    if shaped and result.raw_json then encoded = result.raw_json
    elseif result ~= nil then encoded = json(result)
    else encoded = 'null' end
    if shaped and result.raw_json then -- already explicit JSON
    elseif shaped and result.occupiedCells then
      encoded = '{"occupiedCells":' .. array(result.occupiedCells, json)
        .. ',"knownEmptyCells":' .. array(result.knownEmptyCells,
          function(cell) return array(cell, json) end)
        .. ',"unknownCells":' .. array(result.unknownCells, json) .. '}'
    elseif shaped and result.grants then
      encoded = '{"grants":' .. array(result.grants, json) .. '}'
    elseif shaped and result.records then
      encoded = encode_state(result)
    end
    return '{"id":' .. json(id) .. ',"worldRef":' .. json(manifest.worldRef)
      .. ',"result":' .. encoded
      .. ',"error":' .. (code and json(code) or 'null') .. '}'
  end

  local function poll()
    http.fetch({url = base .. '/poll', method = 'GET', extra_headers = header, quiet = true},
      function(response)
        local decoded = response.succeeded and response.code == 200
          and minetest.parse_json(response.data or '') or nil
        if type(decoded) ~= 'table' or decoded.worldRef ~= manifest.worldRef then
          on_ready(false)
          minetest.after(1, poll)
          return
        end
        on_ready(true)
        if not decoded.command then minetest.after(0.2, poll); return end
        local ok, result, code = pcall(run, decoded.command)
        if not ok then
          -- Fail closed but keep the root cause: log the operation and the Lua
          -- error (file:line kept; coordinate tuples and fractional numbers,
          -- which could carry pose, are redacted).
          current = nil
          minetest.log('error', 'HanaWorlds courier operation '
            .. tostring(decoded.command.operation) .. ' failed: ' .. M.redact(result))
          result, code = nil, 'CAPABILITY_UNAVAILABLE'
        end
        local body = encode_reply(decoded.command.id, result, code)
        http.fetch({url = base .. '/result', method = 'POST', data = body,
          extra_headers = header, quiet = true}, function()
          minetest.after(0.2, poll)
        end)
      end)
  end
  minetest.after(0, poll)
  return {invoke_action = function(request, engine_actor_name)
    if type(request) ~= 'table' or type(engine_actor_name) ~= 'string' then return false end
    http.fetch({url = base .. '/action', method = 'POST', data = json({
      worldRef = manifest.worldRef, engineActorName = engine_actor_name, request = request}),
      extra_headers = header, quiet = true}, function(response)
      if not response.succeeded or response.code ~= 200 then
        minetest.log('warning', 'HanaWorlds action transport unavailable')
      end
    end)
    return true
  end}
end

return M
