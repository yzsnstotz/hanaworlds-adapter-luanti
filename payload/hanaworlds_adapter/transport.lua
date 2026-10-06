-- Private loopback courier. It never accepts world commands from a player
-- form or arbitrary HTTP caller; the host must possess the per-world secret.
local M = {}
local MAX_BODY_BYTES = 4 * 1024 * 1024

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
  region, facts, voxel)
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
    verifyPrepared = function(_, _, prepared)
      return current and (current.operation == 'apply' or current.operation == 'apply_state')
        and prepared == current.prepared
        and prepared.status == 'PREPARED'
        and prepared.operationDigest == current.operationDigest
    end,
    verifyRestore = function(_, recovery)
      return current and current.operation == 'restore'
        and recovery == current.recovery and recovery.status == 'RESTORING'
    end,
  })

  local function run(command)
    if type(command) ~= 'table' or type(command.id) ~= 'string'
      or command.worldRef ~= manifest.worldRef then return nil, 'CURRENT_WORLD_MISMATCH' end
    current = command
    local result, code
    if command.operation == 'handshake' then
      result = capabilities()
    elseif command.operation == 'fact_profile' then
      if type(facts) ~= 'table' or type(facts.state_profile) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.state_profile(minetest, rawget(_G, 'worldedit')) end
    elseif command.operation == 'fact_capacity' then
      if type(facts) ~= 'table' or type(facts.capacity) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.capacity(minetest, command.cellCount, MAX_BODY_BYTES) end
    elseif command.operation == 'fact_catalogue' then
      if type(facts) ~= 'table' or type(facts.catalogue) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.catalogue(minetest) end
    elseif command.operation == 'fact_write_path' then
      if type(facts) ~= 'table' or type(facts.write_path) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.write_path(minetest) end
    elseif command.operation == 'fact_material_metadata' then
      if type(facts) ~= 'table' or type(facts.material_metadata) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.material_metadata(minetest) end
    elseif command.operation == 'fact_world_revision' then
      if type(facts) ~= 'table' or type(facts.world_revision) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.world_revision(minetest) end
    elseif command.operation == 'fact_object_revisions' then
      if type(facts) ~= 'table' or type(facts.object_revisions) ~= 'function' then
        code = 'CAPABILITY_UNAVAILABLE'
      else result, code = facts.object_revisions(minetest, command.objectRefs) end
    elseif command.operation == 'region_limits' or command.operation == 'region_emerge'
      or command.operation == 'region_read' or command.operation == 'region_write' then
      if type(voxel) ~= 'table' then code = 'CAPABILITY_UNAVAILABLE'
      elseif command.operation == 'region_limits' then result, code = voxel.limits(minetest, MAX_BODY_BYTES)
      elseif command.operation == 'region_emerge' then result, code = voxel.emerge(minetest, command.min, command.max)
      elseif command.operation == 'region_read' then result, code = voxel.read(minetest, command)
      else result, code = voxel.write(minetest, command) end
    elseif command.operation == 'snapshot' then
      result, code = engine:snapshot(command.positions)
      if result then result.worldRef = manifest.worldRef end
    elseif command.operation == 'inspect' then
      result, code = engine:inspect(command.positions)
    elseif command.operation == 'prepare_check' then
      result, code = region:prepare_check(command.positions)
    elseif command.operation == 'inspect_region' then
      local raw
      raw, code = region:inspect({worldRef = command.worldRef, sessionRef = command.sessionRef,
        anchor = command.anchor, footprint = command.footprint, settings = command.settings,
        walkable = command.walkable or {}, limitExceeded = command.limitExceeded == true})
      if raw then result = {raw_json = raw} end
    elseif command.operation == 'apply' then
      local positions = {}
      for _, e in ipairs(command.effects) do positions[#positions+1] = e.position end
      local checked
      checked, code = region:prepare_check(positions)
      if checked then result, code = engine:apply(command.effects,
        command.beforeImage, command.prepared, command.scopeBeforeImage) end
    elseif command.operation == 'apply_state' then
      local checked
      checked, code = region:prepare_check(command.targetImage.coveredPositions)
      if checked then result, code = engine:apply_state(command.targetImage,
        command.beforeImage, command.prepared) end
    elseif command.operation == 'readback' then
      result, code = engine:readback(command.positions)
      if result then result.worldRef = manifest.worldRef end
    elseif command.operation == 'restore' then
      result, code = engine:restore(command.beforeImage, command.recovery)
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
        local function send(result, code)
          local body = encode_reply(decoded.command.id, result, code)
          if #body > MAX_BODY_BYTES then
            minetest.log('warning', 'HanaWorlds courier reply exceeds paired host body limit')
            body = encode_reply(decoded.command.id, nil, 'LIMIT_EXCEEDED')
          end
          http.fetch({url = base .. '/result', method = 'POST', data = body,
            extra_headers = header, quiet = true}, function()
            minetest.after(0.2, poll)
          end)
        end
        -- An engine-asynchronous command (emerge_area) replies from its own
        -- completion callback; polling resumes only after that reply.
        if ok and type(result) == 'table' and type(result.defer) == 'function' then
          local deferred_ok, err = pcall(result.defer, function(value) send(value, nil) end)
          if not deferred_ok then
            minetest.log('error', 'HanaWorlds courier operation '
              .. tostring(decoded.command.operation) .. ' failed: ' .. M.redact(err))
            send(nil, 'CAPABILITY_UNAVAILABLE')
          end
          return
        end
        if not ok then
          -- Fail closed but keep the root cause: log the operation and the Lua
          -- error (file:line kept; coordinate tuples and fractional numbers,
          -- which could carry pose, are redacted).
          current = nil
          minetest.log('error', 'HanaWorlds courier operation '
            .. tostring(decoded.command.operation) .. ' failed: ' .. M.redact(result))
          result, code = nil, 'CAPABILITY_UNAVAILABLE'
        end
        send(result, code)
      end)
  end
  minetest.after(0, poll)
  return true
end

return M
