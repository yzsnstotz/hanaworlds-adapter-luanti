-- Engine-side primitives. This module is held privately by init.lua; no
-- world mutation is exposed until a verified Adapter transport supplies authority
-- and a host-fsynced PREPARED record.
local M = {}
local Engine = {}
Engine.__index = Engine

local function position(cell)
  if type(cell) ~= 'table' or #cell ~= 3 then return nil end
  for i = 1, 3 do
    if type(cell[i]) ~= 'number' or cell[i] ~= math.floor(cell[i])
      or math.abs(cell[i]) > 9007199254740991 then return nil end
  end
  return {x = cell[1], y = cell[2], z = cell[3]}
end

local function has_privilege(name)
  return type(name) == 'string' and name ~= ''
    and minetest.check_player_privs(name, {worldedit = true})
end

local function public_record(cell)
  local pos = position(cell)
  if not pos then return nil, 'SCHEMA_INVALID' end
  local node = minetest.get_node_or_nil(pos)
  if not node or node.name == 'ignore' then return nil, 'TARGET_FACTS_INCOMPLETE' end
  local meta = minetest.get_meta(pos):to_table()
  if not meta or type(meta.fields) ~= 'table' or type(meta.inventory) ~= 'table' then
    return nil, 'UNSUPPORTED_MUTATION_SEMANTICS'
  end
  local inventory = {}
  for list, slots in pairs(meta.inventory) do
    if type(list) ~= 'string' or type(slots) ~= 'table' then
      return nil, 'UNSUPPORTED_MUTATION_SEMANTICS'
    end
    inventory[list] = {}
    for i, stack in ipairs(slots) do
      inventory[list][i] = type(stack) == 'string' and stack or stack:to_string()
    end
    if #inventory[list] ~= #slots then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
  end
  local timer = minetest.get_node_timer(pos)
  if not timer or type(timer.get_timeout) ~= 'function' or type(timer.get_elapsed) ~= 'function' then
    return nil, 'UNSUPPORTED_MUTATION_SEMANTICS'
  end
  local timeout, elapsed = timer:get_timeout(), timer:get_elapsed()
  return {
    position = {cell[1], cell[2], cell[3]},
    nodeName = node.name,
    param1 = node.param1,
    param2 = node.param2,
    metadata = meta.fields,
    inventory = inventory,
    timer = timeout > 0 and {timeout = timeout, elapsed = elapsed} or nil,
  }
end

local function equal(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  for k, v in pairs(a) do if not equal(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

function M.new(dependencies)
  return setmetatable({authorize = dependencies.authorize, verifyPrepared = dependencies.verifyPrepared,
    verifyRestore = dependencies.verifyRestore}, Engine)
end

local function capture(self, player_name, positions, action)
  if not self.authorize or not self.authorize(player_name, action) or not has_privilege(player_name) then
    return nil, 'PERMISSION_DENIED'
  end
  if type(positions) ~= 'table' or #positions == 0 then return nil, 'SCHEMA_INVALID' end
  local records, covered, seen = {}, {}, {}
  for _, cell in ipairs(positions) do
    local pos = position(cell)
    if not pos then return nil, 'SCHEMA_INVALID' end
    local key = table.concat(cell, ',')
    if seen[key] then return nil, 'SCHEMA_INVALID' end
    seen[key] = true
    if minetest.is_protected(pos, player_name) then return nil, 'PERMISSION_DENIED' end
    local record, code = public_record(cell)
    if not record then return nil, code end
    records[#records + 1] = record
    covered[#covered + 1] = {cell[1], cell[2], cell[3]}
  end
  return {coveredPositions = covered, records = records}
end

function Engine:snapshot(player_name, positions)
  return capture(self, player_name, positions, 'INSPECT')
end

function Engine:readback(player_name, positions)
  return capture(self, player_name, positions, 'READBACK')
end

function Engine:inspect(player_name, positions)
  if not self.authorize or not self.authorize(player_name, 'INSPECT')
    or not has_privilege(player_name) then return nil, 'PERMISSION_DENIED' end
  if type(positions) ~= 'table' or #positions == 0 then return nil, 'SCHEMA_INVALID' end
  local occupied, empty, unknown, seen = {}, {}, {}, {}
  for _, cell in ipairs(positions) do
    local pos = position(cell)
    if not pos then return nil, 'SCHEMA_INVALID' end
    local key = table.concat(cell, ',')
    if seen[key] then return nil, 'SCHEMA_INVALID' end
    seen[key] = true
    if minetest.is_protected(pos, player_name) then return nil, 'PERMISSION_DENIED' end
    local ok, node = pcall(minetest.get_node_or_nil, pos)
    if not ok then
      unknown[#unknown + 1] = {position = cell, reason = 'READ_FAILED'}
    elseif not node then
      unknown[#unknown + 1] = {position = cell, reason = 'UNLOADED'}
    elseif node.name == 'ignore' then
      unknown[#unknown + 1] = {position = cell, reason = 'IGNORE'}
    elseif node.name == 'air' then
      empty[#empty + 1] = cell
    elseif type(node.name) == 'string' and minetest.registered_nodes[node.name] then
      occupied[#occupied + 1] = {position = cell, nodeName = node.name, param2 = node.param2}
    else
      unknown[#unknown + 1] = {position = cell, reason = 'READ_FAILED'}
    end
  end
  return {occupiedCells = occupied, knownEmptyCells = empty, unknownCells = unknown}
end

local forbidden_callbacks = {
  'on_construct', 'on_destruct', 'after_destruct', 'after_place_node',
  'on_timer', 'on_metadata_inventory_move', 'on_metadata_inventory_put',
  'on_metadata_inventory_take', 'allow_metadata_inventory_move',
  'allow_metadata_inventory_put', 'allow_metadata_inventory_take',
}

local function static_node(name)
  local def = minetest.registered_nodes[name]
  if not def then return false end
  for _, callback in ipairs(forbidden_callbacks) do
    if def[callback] then return false end
  end
  return true
end

local function stateless(record)
  return type(record.metadata) == 'table' and next(record.metadata) == nil
    and type(record.inventory) == 'table' and next(record.inventory) == nil
    and record.timer == nil
end

local function light_capable()
  return type(minetest.fix_light) == 'function'
    and type(minetest.get_node_light) == 'function'
end

local function refresh_light(positions)
  for _, cell in ipairs(positions) do
    local pos = position(cell)
    if not pos or minetest.fix_light(pos, pos) ~= true
      or type(minetest.get_node_light(pos)) ~= 'number' then return false end
  end
  return true
end

function Engine:apply(player_name, effects, before_image, prepared)
  if not self.authorize or not self.authorize(player_name, 'APPLY_RECOVERABLE') or
      not has_privilege(player_name) then return nil, 'PERMISSION_DENIED' end
  if not prepared or prepared.status ~= 'PREPARED' or not self.verifyPrepared
      or not self.verifyPrepared(player_name, effects, before_image, prepared) then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  if type(effects) ~= 'table' or #effects == 0 or type(before_image) ~= 'table'
    or type(before_image.records) ~= 'table' or #before_image.records ~= #effects
    or type(before_image.coveredPositions) ~= 'table'
    or #before_image.coveredPositions ~= #effects then
    return nil, 'SCHEMA_INVALID'
  end
  for i, effect in ipairs(effects) do
    local pos = position(effect.position)
    if not pos then return nil, 'SCHEMA_INVALID' end
    if not equal(effect.position, before_image.coveredPositions[i])
      or not equal(effect.position, before_image.records[i].position) then
      return nil, 'SCHEMA_INVALID'
    end
    if minetest.is_protected(pos, player_name) then return nil, 'PERMISSION_DENIED' end
    if not static_node(effect.nodeName) or not static_node(before_image.records[i].nodeName)
      or not stateless(before_image.records[i]) then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
    if type(effect.param2) ~= 'number' or effect.param2 < 0 or effect.param2 > 255
      or effect.param2 ~= math.floor(effect.param2) then return nil, 'SCHEMA_INVALID' end
    local current, code = public_record(effect.position)
    if not current then return nil, code end
    if not equal(current, before_image.records[i]) then
      return nil, 'TRANSACTION_CONFLICT'
    end
  end
  local editing = rawget(_G, 'worldedit')
  if type(editing) ~= 'table' or type(editing.set) ~= 'function'
    or type(editing.set_param2) ~= 'function' or not light_capable() then
    return nil, 'CAPABILITY_UNAVAILABLE' end
  local count = 0
  for _, effect in ipairs(effects) do
    local pos = position(effect.position)
    if not self.authorize(player_name, 'APPLY_RECOVERABLE') or not has_privilege(player_name)
      or minetest.is_protected(pos, player_name) then return nil, 'APPLY_FAILED' end
    local ok, changed = pcall(editing.set, pos, pos, effect.nodeName)
    if not ok or changed ~= 1 then return nil, 'APPLY_FAILED' end
    local param_ok, param_changed = pcall(editing.set_param2, pos, pos, effect.param2)
    if not param_ok or param_changed ~= 1 then return nil, 'APPLY_FAILED' end
    count = count + 1
  end
  if not refresh_light(before_image.coveredPositions) then return nil, 'APPLY_FAILED' end
  return {status = 'APPLIED_PENDING_READBACK', writtenCells = count}
end

-- History targets are Adapter-private full-state images. The host has already
-- fsynced PREPARED and proved the current author/source transaction; the Lua
-- courier additionally binds this call to its one in-flight command.
function Engine:apply_state(player_name, target_image, before_image, prepared)
  if not self.authorize or not self.authorize(player_name, 'APPLY_RECOVERABLE')
    or not has_privilege(player_name) then return nil, 'PERMISSION_DENIED' end
  if not prepared or prepared.status ~= 'PREPARED' or not self.verifyPrepared
    or not self.verifyPrepared(player_name, target_image, before_image, prepared) then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  if type(target_image) ~= 'table' or type(before_image) ~= 'table'
    or type(target_image.records) ~= 'table' or type(before_image.records) ~= 'table'
    or type(target_image.coveredPositions) ~= 'table'
    or type(before_image.coveredPositions) ~= 'table'
    or #target_image.records == 0 or #target_image.records ~= #before_image.records
    or #target_image.records ~= #target_image.coveredPositions
    or #target_image.records ~= #before_image.coveredPositions then
    return nil, 'SCHEMA_INVALID'
  end
  local editing = rawget(_G, 'worldedit')
  if type(editing) ~= 'table' or type(editing.set) ~= 'function'
    or type(editing.set_param2) ~= 'function' or not light_capable() then
    return nil, 'CAPABILITY_UNAVAILABLE' end
  -- Check every cell and exact current state before the first write.
  for i, target in ipairs(target_image.records) do
    local prior = before_image.records[i]
    local cell = target_image.coveredPositions[i]
    local pos = position(cell)
    if not pos or not equal(cell, target.position)
      or not equal(cell, before_image.coveredPositions[i])
      or not equal(cell, prior.position) then return nil, 'SCHEMA_INVALID' end
    if minetest.is_protected(pos, player_name) then return nil, 'PERMISSION_DENIED' end
    if not static_node(target.nodeName) or not static_node(prior.nodeName)
      or type(target.param1) ~= 'number' or target.param1 < 0 or target.param1 > 255
      or target.param1 ~= math.floor(target.param1)
      or type(target.param2) ~= 'number' or target.param2 < 0 or target.param2 > 255
      or target.param2 ~= math.floor(target.param2)
      or type(target.metadata) ~= 'table' or type(target.inventory) ~= 'table'
      or (target.timer ~= nil and (type(target.timer) ~= 'table'
        or type(target.timer.timeout) ~= 'number' or target.timer.timeout < 0
        or type(target.timer.elapsed) ~= 'number' or target.timer.elapsed < 0)) then
      return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
    for k, v in pairs(target.metadata) do
      if type(k) ~= 'string' or type(v) ~= 'string' then
        return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
    end
    for k, slots in pairs(target.inventory) do
      if type(k) ~= 'string' or type(slots) ~= 'table' then
        return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
      for _, stack in ipairs(slots) do
        if type(stack) ~= 'string' then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
      end
    end
    local current, code = public_record(cell)
    if not current then return nil, code end
    if not equal(current, prior) then return nil, 'TRANSACTION_CONFLICT' end
  end
  local count = 0
  for _, target in ipairs(target_image.records) do
    local pos = position(target.position)
    if not self.authorize(player_name, 'APPLY_RECOVERABLE')
      or not has_privilege(player_name) or minetest.is_protected(pos, player_name) then
      return nil, 'APPLY_FAILED' end
    local ok, changed = pcall(editing.set, pos, pos, target.nodeName)
    if not ok or changed ~= 1 then return nil, 'APPLY_FAILED' end
    local p_ok, p_changed = pcall(editing.set_param2, pos, pos, target.param2)
    if not p_ok or p_changed ~= 1 then return nil, 'APPLY_FAILED' end
    local state_ok = pcall(function()
      minetest.swap_node(pos, {name = target.nodeName,
        param1 = target.param1, param2 = target.param2})
      assert(minetest.get_meta(pos):from_table({fields = target.metadata,
        inventory = target.inventory}) ~= false)
      local timer = minetest.get_node_timer(pos)
      if target.timer then timer:set(target.timer.timeout, target.timer.elapsed)
      else timer:stop() end
    end)
    if not state_ok then return nil, 'APPLY_FAILED' end
    count = count + 1
  end
  if not refresh_light(target_image.coveredPositions) then return nil, 'APPLY_FAILED' end
  for _, target in ipairs(target_image.records) do
    local current = public_record(target.position)
    if not current or not equal(current, target) then return nil, 'READBACK_MISMATCH' end
  end
  return {status = 'APPLIED_PENDING_READBACK', writtenCells = count}
end

function Engine:restore(service_name, before_image, recovery)
  if not self.verifyRestore or not self.verifyRestore(service_name, before_image, recovery)
    or not recovery or recovery.status ~= 'RESTORING' then return nil, 'CAPABILITY_UNAVAILABLE' end
  if not minetest.check_player_privs(service_name, {worldedit = true}) then return nil, 'PERMISSION_DENIED' end
  if type(before_image) ~= 'table' or type(before_image.records) ~= 'table'
    or #before_image.records == 0 then return nil, 'SCHEMA_INVALID' end
  local editing = rawget(_G, 'worldedit')
  if type(editing) ~= 'table' or type(editing.set) ~= 'function'
    or type(editing.set_param2) ~= 'function' or not light_capable() then
    return nil, 'CAPABILITY_UNAVAILABLE' end
  for _, record in ipairs(before_image.records) do
    local pos = position(record.position)
    if not pos or minetest.is_protected(pos, service_name) then return nil, 'RESTORE_FAILED' end
    if not static_node(record.nodeName) then return nil, 'RESTORE_FAILED' end
  end
  for _, record in ipairs(before_image.records) do
    local pos = position(record.position)
    if not self.verifyRestore(service_name, before_image, recovery)
      or not minetest.check_player_privs(service_name, {worldedit = true})
      or minetest.is_protected(pos, service_name) then return nil, 'RESTORE_FAILED' end
    local ok, changed = pcall(editing.set, pos, pos, record.nodeName)
    if not ok or changed ~= 1 then return nil, 'RESTORE_FAILED' end
    local param_ok, param_changed = pcall(editing.set_param2, pos, pos, record.param2)
    if not param_ok or param_changed ~= 1 then return nil, 'RESTORE_FAILED' end
    local swap_ok = pcall(minetest.swap_node, pos, {name = record.nodeName,
      param1 = record.param1, param2 = record.param2})
    if not swap_ok then return nil, 'RESTORE_FAILED' end
    local meta_ok, restored = pcall(function()
      return minetest.get_meta(pos):from_table({fields = record.metadata, inventory = record.inventory})
    end)
    if not meta_ok or restored == false then return nil, 'RESTORE_FAILED' end
    local timer_ok = pcall(function()
      local timer = minetest.get_node_timer(pos)
      if record.timer then timer:set(record.timer.timeout, record.timer.elapsed)
      else timer:stop() end
    end)
    if not timer_ok then return nil, 'RESTORE_FAILED' end
  end
  if not refresh_light(before_image.coveredPositions) then return nil, 'RESTORE_FAILED' end
  for _, record in ipairs(before_image.records) do
    local current = public_record(record.position)
    if not current or not equal(current, record) then return nil, 'RESTORE_FAILED' end
  end
  return {status = 'ROLLED_BACK'}
end

return M
