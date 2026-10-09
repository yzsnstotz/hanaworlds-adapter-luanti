-- FIXTURE ENGINE (input layer only). Runs the real payload facts.lua against a
-- fixture `core` built from a scenario file. Not Luanti; nothing here is a real
-- player, World or WorldEdit. Pose accessors throw: a fact that reads position
-- or look direction fails instead of silently leaking it.
-- usage: lua engine-fixture.lua <payload-dir> <scenario.lua> <operation>
local dir, scenario_path, operation = arg[1], arg[2], arg[3]
local S = dofile(scenario_path)

local function sha256(s)
  local tmp = scenario_path .. '.sha-input'; local f = assert(io.open(tmp, 'wb')); f:write(s); f:close()
  local p = assert(io.popen('shasum -a 256 "' .. tmp .. '"')); local out = p:read('*l'); p:close(); os.remove(tmp)
  return out:match('^(%x+)')
end
local function encode(v)
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    if math.type(v) == 'integer' then return string.format('%d', v) end
    local s = string.format('%.17g', v)
    for p = 1, 17 do local c = string.format('%.' .. p .. 'g', v); if tonumber(c) == v then s = c; break end end
    return s
  end
  if t == 'string' then
    return '"' .. v:gsub('[%c"\\]', function(c)
      local m = {['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t'}
      return m[c] or string.format('\\u%04x', c:byte()) end) .. '"'
  end
  if t == 'table' then
    if next(v) == nil then return 'null' end -- Luanti write_json maps empty tables to null
    if #v > 0 then local o = {}; for i, x in ipairs(v) do o[i] = encode(x) end; return '[' .. table.concat(o, ',') .. ']' end
    local keys = {}; for k in pairs(v) do keys[#keys + 1] = k end; table.sort(keys)
    local o = {}; for _, k in ipairs(keys) do o[#o + 1] = encode(tostring(k)) .. ':' .. encode(v[k]) end
    return '{' .. table.concat(o, ',') .. '}'
  end
  error('unencodable ' .. t)
end

local function pose() error('POSE_READ_FORBIDDEN_IN_FIXTURE') end
local players = {}
for i, p in ipairs(S.players or {}) do
  players[i] = { get_player_name = function() return p.name end,
    get_properties = function() return { collisionbox = p.collisionbox } end,
    get_pos = pose, get_look_horizontal = pose, get_look_dir = pose, get_rotation = pose }
end
local nodes = {}
for _, n in ipairs(S.nodes or {'air'}) do nodes[n] = { walkable = n ~= 'air', liquidtype = 'none', damage_per_second = 0, paramtype2 = 'none' } end
local core = {
  get_connected_players = function() return players end,
  get_modnames = function() return S.modnames or {} end,
  get_game_info = function() return { id = S.gameId or 'fixture_game', path = '/fixture/game' } end,
  registered_nodes = nodes, registered_on_mapblocks_changed = {},
  sha256 = sha256, write_json = function(v) return encode(v) end,
  get_node_or_nil = function() end, get_meta = function() end, get_node_timer = function() end,
  get_node_light = function() end, fix_light = function() end,
}
_G.minetest, _G.core = core, core
if S.worldedit then
  _G.worldedit = { set = function() end, set_param2 = function() end,
    version_string = S.worldedit.version_string, version = S.worldedit.version }
end

if S.writeBackendReady == false then core.fix_light = nil end
local facts = dofile(dir .. '/facts.lua')
local result, code
local engine_module = dofile(dir .. '/engine.lua')
local declaration = engine_module.WRITE_BACKEND
if S.writeBackendDeclared == false then declaration = nil end
if operation == 'fact_write_backend' then result, code = facts.write_backend(core, declaration, rawget(_G, 'worldedit'))
elseif operation == 'fact_worldedit_runtime' then result, code = facts.worldedit_runtime(core)
elseif operation == 'fact_catalogue' then result, code = facts.catalogue(core)
elseif operation == 'fact_profile' then result, code = facts.state_profile(core, rawget(_G, 'worldedit'))
elseif operation == 'engine_guards' then result = dofile(dir .. '/region.lua').guards(core) -- handshake declaration
else code = 'UNSUPPORTED_FIXTURE_OPERATION' end
if result and result.raw_json then io.write('{"result":' .. result.raw_json .. '}')
elseif result then io.write('{"result":' .. encode(result) .. '}')
else io.write('{"error":' .. encode(code) .. '}') end
