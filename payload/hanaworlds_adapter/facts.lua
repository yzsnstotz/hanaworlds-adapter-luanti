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

-- Catalogue hasCallbacks/hasPersistentState follow Contracts scope write-path-init/v1:
-- they describe the declared CALLBACK_FREE_NODE_DATA write/restore path (VoxelManip
-- node data via WorldEdit set/set_param2 and this payload's region writer, swap_node
-- for restores), on which the engine runs no node-definition callback. Player
-- callbacks, ABM/LBM and other later world dynamics are out of that scope and are
-- caught by full-state readback digests, not claimed absent.
-- Engine-documented node-definition callback fields (Luanti 5.17 lua_api.md,
-- "Node definition"); definedCallbacks lists those present on a definition.
local node_callbacks = {'after_destruct', 'after_dig_node', 'after_place_node',
  'allow_metadata_inventory_move', 'allow_metadata_inventory_put', 'allow_metadata_inventory_take',
  'can_dig', 'on_blast', 'on_construct', 'on_destruct', 'on_dig', 'on_flood',
  'on_metadata_inventory_move', 'on_metadata_inventory_put', 'on_metadata_inventory_take',
  'on_punch', 'on_receive_fields', 'on_rightclick', 'on_timer', 'preserve_metadata'}
local initialization = {after_destruct = true, after_place_node = true, on_construct = true,
  on_destruct = true, on_timer = true}
local state_indicator = {allow_metadata_inventory_move = true, allow_metadata_inventory_put = true,
  allow_metadata_inventory_take = true, on_metadata_inventory_move = true,
  on_metadata_inventory_put = true, on_metadata_inventory_take = true,
  on_receive_fields = true, preserve_metadata = true}
-- Engine global registries that fire on this write path (map modification events of
-- VoxelManip write_to_map and swap_node). nil = registry not readable = unknown.
local function global_write_callbacks(core)
  local list = core.registered_on_mapblocks_changed
  if type(list) ~= 'table' then return nil end
  if #list > 0 then return {'register_on_mapblocks_changed'} end
  return {}
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
  local globals = global_write_callbacks(core)
  local clean = globals ~= nil and #globals == 0
  local node_json, registry_parts, evidence_json = {}, {}, {}
  for _, name in ipairs(names) do
    local def = core.registered_nodes[name]
    if type(def) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
    -- Defined callback names only: a function's identity is not stable across runs.
    local defined, has_init, has_state = {}, false, false
    for _, key in ipairs(node_callbacks) do
      if def[key] ~= nil then
        defined[#defined + 1] = key
        has_init = has_init or initialization[key] == true
        has_state = has_state or state_indicator[key] == true
      end
    end
    local has_callbacks, persistent = nil, nil
    -- 'ignore' is the engine's not-loaded placeholder, never a cell's node: kept
    -- unknown (stricter than the derivation) so it can never become writable.
    if clean and name ~= 'ignore' then
      has_callbacks = has_init
      if not has_init and not has_state then persistent = false end
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
      hasPersistentState = persistent,
    }
    local allowed = legal_param2(def)
    local fields = {'walkable', 'collisionBoxes', 'liquidType', 'damagePerSecond',
      'lightSource', 'param2Type', 'allowedParam2', 'hasCallbacks', 'hasPersistentState',
      'definitionRevision'}
    local unknown = {'collisionBoxes'}
    if allowed == nil then unknown[#unknown + 1] = 'allowedParam2' end
    local scalar = {}
    if type(known.walkable) ~= 'boolean' then known.walkable = nil end
    for _, field in ipairs({'walkable', 'liquidType', 'damagePerSecond', 'lightSource',
      'param2Type', 'hasCallbacks', 'hasPersistentState'}) do
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
      .. table.concat(defined, '|'))
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
    local defined_json = {}
    for i, key in ipairs(defined) do defined_json[i] = json(key) end
    evidence_json[#evidence_json + 1] = '{"nodeName":' .. json(name) .. ',"definitionRevision":'
      .. json(rev) .. ',"definedCallbacks":[' .. table.concat(defined_json, ',') .. ']}'
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
    .. table.concat(node_json, ',') .. '}}', names, info, evidence_json, globals
end

function M.catalogue(core)
  local raw, code = catalogue(core)
  if not raw then return nil, code end
  return {raw_json = raw}
end

-- One registry snapshot: the Catalogue and its write-path-init/v1 inventory
-- (WritePathEvidence without catalogueDigest, which the host computes).
function M.write_path(core)
  local raw, names, _, evidence, globals = catalogue(core)
  if not raw then return nil, names end
  local function json(value) return assert(core.write_json(value)) end
  local globals_json = 'null'
  if globals then
    local parts = {}
    for i, name in ipairs(globals) do parts[i] = json(name) end
    globals_json = '[' .. table.concat(parts, ',') .. ']'
  end
  return {raw_json = '{"catalogue":' .. raw .. ',"evidence":{"profileVersion":"write-path-evidence/v1",'
    .. '"scope":"write-path-init/v1","writePath":"CALLBACK_FREE_NODE_DATA","globalWriteCallbacks":'
    .. globals_json .. ',"nodes":[' .. table.concat(evidence, ',') .. ']}}'}
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

-- The write backend this loaded payload declares for compiled transactions
-- (engine.lua WRITE_BACKEND), and whether the engine can run it now. The
-- declaration comes only from the loaded payload, never from Adapter/package
-- identity or a default. Player bodies stay engine-only (INV-POSE-STAYS-IN-ENGINE):
-- no collision box, size, position or yaw is produced here.
function M.write_backend(core, declaration, worldedit)
  if type(declaration) ~= 'table' or type(declaration.backendProfileId) ~= 'string'
    or declaration.backendProfileId == '' or type(declaration.nodeWriteSemantics) ~= 'string' then
    return nil, 'NOT_DECLARED_BY_PAYLOAD'
  end
  local ready = type(worldedit) == 'table' and type(worldedit.set) == 'function'
    and type(worldedit.set_param2) == 'function' and available(core, 'fix_light')
    and available(core, 'get_node_light')
  return {backendProfileId = declaration.backendProfileId,
    nodeWriteSemantics = declaration.nodeWriteSemantics, ready = ready}
end

-- What the running engine actually loaded for WorldEdit: the mod name in the
-- loaded mod list, its runtime API table and the version the loaded mod itself
-- exposes. Package/Git versions are never substituted for a missing value.
function M.worldedit_runtime(core)
  if not available(core, 'get_modnames') then return nil, 'CAPABILITY_UNAVAILABLE' end
  local mods = core.get_modnames()
  if type(mods) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
  local listed = false
  for _, name in ipairs(mods) do if name == 'worldedit' then listed = true end end
  local api = rawget(_G, 'worldedit')
  local version, major, minor = nil, nil, nil
  if type(api) == 'table' then
    if type(api.version_string) == 'string' and api.version_string ~= '' then version = api.version_string end
    local v = api.version
    if type(v) == 'table' and math.type and math.type(v.major) == 'integer' and math.type(v.minor) == 'integer' then
      major, minor = v.major, v.minor
    elseif type(v) == 'table' and type(v.major) == 'number' and type(v.minor) == 'number'
      and v.major == math.floor(v.major) and v.minor == math.floor(v.minor) then
      major, minor = v.major, v.minor
    end
  end
  return {modListed = listed, apiTable = type(api) == 'table', versionString = version,
    versionMajor = major, versionMinor = minor}
end

function M.world_revision() return nil, 'CAPABILITY_UNAVAILABLE' end
function M.object_revisions() return nil, 'CAPABILITY_UNAVAILABLE' end

return M
