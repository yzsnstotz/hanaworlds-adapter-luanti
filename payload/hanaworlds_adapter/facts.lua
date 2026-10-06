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

-- Legal param2 values are derived only where the engine semantics are
-- verified (Luanti 5.17 lua_api.md "Nodes"/paramtype2, builtin item_place_node):
-- facedir stores one of 24 rotations; none is engine-unused mod data, so only
-- the engine placement value (place_param2, else 0) is legal for our writes.
-- Every other paramtype2 stays unknown (null), never a guessed zero.
local function legal_param2(def)
  if def.paramtype2 == 'facedir' then
    local values = {}
    for i = 0, 23 do values[#values + 1] = i end
    return values
  elseif def.paramtype2 == 'none' then
    local placed = def.place_param2
    if placed == nil then return {0} end
    if type(placed) == 'number' and placed >= 0 and placed <= 255 and placed == math.floor(placed) then
      return {placed}
    end
  end
  return nil
end

-- Catalogue revisions fingerprint the currently loaded engine registry. They
-- are deliberately not advertised as source-code/git revisions of game mods.
local function catalogue(core)
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
    local allowed = legal_param2(def)
    local fields = {'walkable', 'collisionBoxes', 'liquidType', 'damagePerSecond',
      'lightSource', 'param2Type', 'allowedParam2', 'hasCallbacks', 'hasPersistentState',
      'definitionRevision'}
    local unknown = {'collisionBoxes', 'hasPersistentState'}
    if allowed == nil then unknown[#unknown + 1] = 'allowedParam2' end
    local scalar = {}
    if type(known.walkable) ~= 'boolean' then known.walkable = nil end
    for _, field in ipairs({'walkable', 'liquidType', 'damagePerSecond', 'lightSource',
      'param2Type', 'hasCallbacks'}) do
      if known[field] == nil then unknown[#unknown + 1] = field end
      scalar[#scalar + 1] = field .. '=' .. tostring(known[field])
    end
    local allowed_json = 'null'
    if allowed then
      local parts = {}
      for i, value in ipairs(allowed) do parts[i] = json(value) end
      allowed_json = '[' .. table.concat(parts, ',') .. ']'
    end
    scalar[#scalar + 1] = 'allowedParam2=' .. allowed_json
    table.sort(unknown)
    local rev = core.sha256(name .. '|' .. table.concat(scalar, '|') .. '|'
      .. table.concat(callback_parts, '|'))
    if type(rev) ~= 'string' or rev == '' then return nil, 'CAPABILITY_UNAVAILABLE' end
    local properties = {}
    for _, field in ipairs(fields) do
      local value = field == 'definitionRevision' and rev or known[field]
      local encoded = field == 'allowedParam2' and allowed_json
        or (value == nil and 'null' or json(value))
      properties[#properties + 1] = json(field) .. ':' .. encoded
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
  return '{"profileVersion":"catalogue/v2","engineProfile":'
    .. json('luanti-runtime-registry') .. ',"gameId":' .. json(info.id)
    .. ',"gameRevision":' .. json(registry) .. ',"modRevisions":{'
    .. table.concat(mod_json, ',') .. '},"nodes":{'
    .. table.concat(node_json, ',') .. '}}', names, info
end

function M.catalogue(core)
  local raw, code = catalogue(core)
  if not raw then return nil, code end
  return {raw_json = raw}
end

-- Appearance support is deliberately narrow: an opaque "normal" cube whose
-- every tile is the same plain texture file name, with no modifier (^, [),
-- animation, tile/node colour, palette or overlay. Anything else is reported
-- unsupported; the host side then answers UNKNOWN rather than a texture.
local tile_keys = {name = true, image = true, backface_culling = true}
local function appearance(def)
  if def.drawtype ~= 'normal' or def.color ~= nil or def.palette ~= nil
    or (def.use_texture_alpha ~= nil and def.use_texture_alpha ~= 'opaque')
    or (def.overlay_tiles ~= nil and (type(def.overlay_tiles) ~= 'table' or next(def.overlay_tiles) ~= nil))
    or type(def.tiles) ~= 'table' then return nil end
  local count, texture = 0, nil
  for key in pairs(def.tiles) do
    if type(key) ~= 'number' then return nil end
    count = count + 1
  end
  if count < 1 or count > 6 or #def.tiles ~= count then return nil end
  for _, tile in ipairs(def.tiles) do
    local name = tile
    if type(tile) == 'table' then
      for key in pairs(tile) do if not tile_keys[key] then return nil end end
      if tile.name ~= nil and tile.image ~= nil and tile.name ~= tile.image then return nil end
      name = tile.name or tile.image
    end
    if type(name) ~= 'string' or not name:match('^[%w_%.%-]+$') then return nil end
    if texture ~= nil and texture ~= name then return nil end
    texture = name
  end
  return texture
end

-- One synchronous registry snapshot: Catalogue, appearance and the actual
-- native media roots (game path, user path, load-ordered mod paths and the
-- texture_path override setting). Node resolves bytes from these roots only.
function M.material_metadata(core)
  -- core.settings is the engine Settings userdata, not a Lua table.
  local settings = core.settings
  if not available(core, 'get_user_path') or not available(core, 'get_modpath')
    or settings == nil or type(settings.get) ~= 'function' then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  local raw, names, info = catalogue(core)
  if not raw then return nil, names end
  local user, ordered = core.get_user_path(), core.get_modnames(true)
  local texture_path = settings:get('texture_path')
  if type(info.path) ~= 'string' or info.path == '' or type(user) ~= 'string' or user == ''
    or type(ordered) ~= 'table' or #ordered == 0
    or (texture_path ~= nil and type(texture_path) ~= 'string') then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  local function json(value) return assert(core.write_json(value)) end
  local mods = {}
  for _, name in ipairs(ordered) do
    local path = type(name) == 'string' and core.get_modpath(name) or nil
    if type(path) ~= 'string' or path == '' then return nil, 'CAPABILITY_UNAVAILABLE' end
    mods[#mods + 1] = '{"name":' .. json(name) .. ',"path":' .. json(path) .. '}'
  end
  local looks = {}
  for _, name in ipairs(names) do
    local texture = appearance(core.registered_nodes[name])
    looks[#looks + 1] = json(name) .. ':{"supported":' .. tostring(texture ~= nil)
      .. ',"textureName":' .. (texture and json(texture) or 'null') .. '}'
  end
  return {raw_json = '{"catalogue":' .. raw .. ',"gamePath":' .. json(info.path)
    .. ',"userPath":' .. json(user) .. ',"texturePath":'
    .. (texture_path == nil and 'null' or json(texture_path))
    .. ',"mods":[' .. table.concat(mods, ',') .. '],"appearance":{'
    .. table.concat(looks, ',') .. '}}'}
end

function M.world_revision() return nil, 'CAPABILITY_UNAVAILABLE' end
function M.object_revisions() return nil, 'CAPABILITY_UNAVAILABLE' end

return M
