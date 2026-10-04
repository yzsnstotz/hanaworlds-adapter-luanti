-- Read-only facts from the paired Luanti process. A missing native source is
-- an error, never an invented revision, unbounded capacity or empty catalogue.
local M = {}

local function available(core, name) return type(core[name]) == 'function' end

function M.state_profile(core, worldedit)
  for _, name in ipairs({'get_node_or_nil', 'get_meta', 'get_node_timer',
    'get_node_light', 'fix_light'}) do
    if not available(core, name) then return nil, 'CAPABILITY_UNAVAILABLE' end
  end
  if type(worldedit) ~= 'table' or type(worldedit.set) ~= 'function'
    or type(worldedit.set_param2) ~= 'function' then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  return {profileVersion = 'state-profile/v2',
    nodeFields = {'nodeName', 'param1', 'param2'}, metadataMode = 'exact',
    inventoryMode = 'exact', timerMode = 'exact',
    derivedLightMode = 'recompute-with-readback'}
end

-- This is the courier's actual maximum response body, not an arbitrary build
-- quota. A conservative bound covers coordinates, registered node names and
-- JSON escaping for region cells. Stateful snapshots still require an exact
-- size check at serialization because metadata size is not bounded by cells.
function M.capacity(core, cell_count, body_bytes)
  if type(cell_count) ~= 'number' or cell_count < 0 or
    cell_count ~= math.floor(cell_count) or type(body_bytes) ~= 'number' or
    body_bytes < 1 or body_bytes ~= math.floor(body_bytes) or
    type(core.registered_nodes) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
  local longest = 0
  for name in pairs(core.registered_nodes) do
    if type(name) ~= 'string' then return nil, 'CAPABILITY_UNAVAILABLE' end
    longest = math.max(longest, #name)
  end
  if longest == 0 then return nil, 'CAPABILITY_UNAVAILABLE' end
  local per_cell = 1024 + 6 * longest
  local max_cells = math.floor(math.max(0, body_bytes - 4096) / per_cell)
  return {allowed = cell_count <= max_cells, maxCells = max_cells,
    source = 'PAIRED_COURIER_RESPONSE_BYTES'}
end

local callbacks = {'on_construct', 'on_destruct', 'after_destruct',
  'after_place_node', 'on_timer', 'on_metadata_inventory_move',
  'on_metadata_inventory_put', 'on_metadata_inventory_take',
  'allow_metadata_inventory_move', 'allow_metadata_inventory_put',
  'allow_metadata_inventory_take'}

-- Catalogue revisions fingerprint the currently loaded engine registry. They
-- are deliberately not advertised as source-code/git revisions of game mods.
function M.catalogue(core)
  if not available(core, 'get_game_info') or not available(core, 'get_modnames')
    or not available(core, 'sha256') or not available(core, 'write_json')
    or type(core.registered_nodes) ~= 'table' then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  local info, mods = core.get_game_info(), core.get_modnames()
  if type(info) ~= 'table' or type(info.id) ~= 'string' or info.id == ''
    or type(mods) ~= 'table' or #mods == 0 then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  local names, mod_names = {}, {}
  for name in pairs(core.registered_nodes) do
    if type(name) ~= 'string' or name == '' then return nil, 'CAPABILITY_UNAVAILABLE' end
    names[#names + 1] = name
  end
  for _, name in ipairs(mods) do
    if type(name) ~= 'string' or name == '' then return nil, 'CAPABILITY_UNAVAILABLE' end
    mod_names[#mod_names + 1] = name
  end
  table.sort(names)
  table.sort(mod_names)
  if #names == 0 then return nil, 'CAPABILITY_UNAVAILABLE' end
  local function json(value) return assert(core.write_json(value)) end
  local node_json, registry_parts = {}, {}
  for _, name in ipairs(names) do
    local def = core.registered_nodes[name]
    if type(def) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
    local has_callbacks = false
    local callback_parts = {}
    for _, key in ipairs(callbacks) do
      if def[key] ~= nil then
        has_callbacks = true
        callback_parts[#callback_parts + 1] = key .. '=' .. tostring(def[key])
      end
    end
    local known = {
      walkable = def.walkable,
      liquidType = ({none = 'none', source = 'source', flowing = 'flowing'})[def.liquidtype],
      damagePerSecond = type(def.damage_per_second) == 'number'
        and def.damage_per_second >= 0 and def.damage_per_second or nil,
      lightSource = type(def.light_source) == 'number' and def.light_source >= 0
        and def.light_source <= 255 and def.light_source == math.floor(def.light_source)
        and def.light_source or nil,
      param2Type = type(def.paramtype2) == 'string' and def.paramtype2 ~= ''
        and def.paramtype2 or nil,
      hasCallbacks = has_callbacks,
    }
    local fields = {'walkable', 'collisionBoxes', 'liquidType', 'damagePerSecond',
      'lightSource', 'param2Type', 'allowedParam2', 'hasCallbacks', 'hasPersistentState',
      'definitionRevision'}
    local unknown = {'collisionBoxes', 'allowedParam2', 'hasPersistentState'}
    local scalar = {}
    if type(known.walkable) ~= 'boolean' then known.walkable = nil end
    for _, field in ipairs({'walkable', 'liquidType', 'damagePerSecond', 'lightSource',
      'param2Type', 'hasCallbacks'}) do
      if known[field] == nil then unknown[#unknown + 1] = field end
      scalar[#scalar + 1] = field .. '=' .. tostring(known[field])
    end
    table.sort(unknown)
    local rev = core.sha256(name .. '|' .. table.concat(scalar, '|') .. '|'
      .. table.concat(callback_parts, '|'))
    if type(rev) ~= 'string' or rev == '' then return nil, 'CAPABILITY_UNAVAILABLE' end
    local properties = {}
    for _, field in ipairs(fields) do
      local value = field == 'definitionRevision' and rev or known[field]
      properties[#properties + 1] = json(field) .. ':' .. (value == nil and 'null' or json(value))
    end
    local unknown_json = {}
    for _, field in ipairs(unknown) do unknown_json[#unknown_json + 1] = json(field) end
    properties[#properties + 1] = '"unknownFields":[' .. table.concat(unknown_json, ',') .. ']'
    node_json[#node_json + 1] = json(name) .. ':{' .. table.concat(properties, ',') .. '}'
    registry_parts[#registry_parts + 1] = name .. '=' .. rev
  end
  local registry = core.sha256(info.id .. '|' .. table.concat(mod_names, '|') .. '|'
    .. table.concat(registry_parts, '|'))
  local mod_json = {}
  for _, name in ipairs(mod_names) do
    mod_json[#mod_json + 1] = json(name) .. ':' .. json(core.sha256(name .. '|' .. registry))
  end
  return {raw_json = '{"profileVersion":"catalogue/v2","engineProfile":'
    .. json('luanti-runtime-registry') .. ',"gameId":' .. json(info.id)
    .. ',"gameRevision":' .. json(registry) .. ',"modRevisions":{'
    .. table.concat(mod_json, ',') .. '},"nodes":{'
    .. table.concat(node_json, ',') .. '}}'}
end

function M.world_revision() return nil, 'CAPABILITY_UNAVAILABLE' end
function M.object_revisions() return nil, 'CAPABILITY_UNAVAILABLE' end

return M
