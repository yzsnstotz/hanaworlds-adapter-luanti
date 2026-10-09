-- Prints facts.material_metadata(core) raw JSON for a registry-shaped stub.
-- The stub mimics Luanti registered_nodes after builtin defaults were applied.
local facts = dofile('payload/hanaworlds_adapter/facts.lua')
local function json(v)
  if type(v) == 'string' then return '"' .. v:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"' end
  if type(v) == 'number' or type(v) == 'boolean' then return tostring(v) end
  return 'null'
end
local function node(over)
  local d = {drawtype = 'normal', paramtype2 = 'none', walkable = true, liquidtype = 'none',
    damage_per_second = 0, light_source = 0}
  for k, v in pairs(over) do d[k] = v end
  return d
end
local nodes = {
  ['air'] = node({drawtype = 'airlike', walkable = false}),
  ['fx:noncolliding'] = node({walkable = false, collision_box = {type = 'fixed', fixed = {-0.5,-0.5,-0.5,0.5,0.5,0.5}}}),
  ['fx:airlike_solid'] = node({drawtype = 'airlike', walkable = true}),
  ['ignore'] = node({drawtype = 'airlike', walkable = false}),
  ['fx:plain'] = node({tiles = {'fx_plain.png'}}),
  ['fx:six'] = node({tiles = {'fx_plain.png', 'fx_plain.png', {name = 'fx_plain.png'},
    'fx_plain.png', {image = 'fx_plain.png', backface_culling = true}, 'fx_plain.png'}}),
  ['fx:facedir'] = node({paramtype2 = 'facedir', tiles = {'fx_dir.png'}}),
  ['fx:placed'] = node({place_param2 = 7, tiles = {'fx_plain.png'}}),
  ['fx:glass'] = node({paramtype2 = 'glasslikeliquidlevel', drawtype = 'glasslike_framed', tiles = {'fx_plain.png'}}),
  ['fx:glass_optional'] = node({paramtype2 = 'glasslikeliquidlevel', drawtype = 'glasslike_framed_optional', tiles = {'fx_plain.png'}}),
  ['fx:glass_wrong_drawtype'] = node({paramtype2 = 'glasslikeliquidlevel', tiles = {'fx_plain.png'}}),
  ['fx:glass_state'] = node({paramtype2 = 'glasslikeliquidlevel', drawtype = 'glasslike_framed', on_construct = function() end}),
  ['fx:faces'] = node({tiles = {'fx_top.png', 'fx_side.png'}}),
  ['fx:modifier'] = node({tiles = {'fx_plain.png^[colorize:#ff0000:128'}}),
  ['fx:anim'] = node({tiles = {{name = 'fx_plain.png', animation = {type = 'vertical_frames'}}}}),
  ['fx:tinted'] = node({color = '#ff0000', tiles = {'fx_plain.png'}}),
  ['fx:tile_tint'] = node({tiles = {{name = 'fx_plain.png', color = '#00ff00'}}}),
  ['fx:overlay'] = node({tiles = {'fx_plain.png'}, overlay_tiles = {'fx_dot.png'}}),
  ['fx:palette'] = node({paramtype2 = 'color', palette = 'fx_pal.png', tiles = {'fx_plain.png'}}),
  ['fx:mesh'] = node({drawtype = 'mesh', mesh = 'fx.obj', tiles = {'fx_plain.png'}}),
  ['fx:wall'] = node({paramtype2 = 'wallmounted', tiles = {'fx_plain.png'}}),
  ['fx:blend'] = node({use_texture_alpha = 'blend', tiles = {'fx_plain.png'}}),
  ['fx:notiles'] = node({}),
}
local core = {
  registered_nodes = nodes,
  get_game_info = function() return {id = 'fx_game', path = '/abs/games/fx_game'} end,
  get_modnames = function(load_order)
    if load_order == true then return {'fx_b', 'fx_a', 'hanaworlds_adapter'} end
    return {'fx_a', 'fx_b', 'hanaworlds_adapter'}
  end,
  get_modpath = function(name) return '/abs/mods/' .. name end,
  get_user_path = function() return '/abs/user' end,
  settings = {get = function(_, key) assert(key == 'texture_path'); return '' end},
  sha256 = function(value)
    -- deterministic stand-in digest; real runs use the engine's sha256
    local h = 0
    for i = 1, #value do h = (h * 31 + value:byte(i)) % 4294967296 end
    return string.format('%064x', h)
  end,
  write_json = json,
}
local mode = arg and arg[1]
if mode == 'collision-air-solid' then core.registered_nodes.air.walkable = true end
if mode == 'collision-air-unknown' then core.registered_nodes.air.walkable = nil end
if mode == 'collision-air-nonbool' then core.registered_nodes.air.walkable = 'false' end
if mode == 'glass' then core.registered_on_mapblocks_changed = {} end
if mode == 'glass-global' then core.registered_on_mapblocks_changed = {function() end} end
if mode == 'state' or mode == 'state-global' or mode == 'state-unknown' then
  -- write-path-init/v1: only initialization/state-indicator callbacks and the
  -- write-path global registry decide; player hooks/ABM/LBM are out of scope.
  local hook = function() end
  core.registered_nodes = {
    ['air'] = node({drawtype = 'airlike', walkable = false, pointable = false, on_punch = hook, on_dig = hook}),
    ['ignore'] = node({drawtype = 'airlike', walkable = false, pointable = false}),
    ['fx:stone'] = node({tiles = {'fx_plain.png'}, after_dig_node = hook, on_punch = hook, on_dig = hook, on_blast = hook}),
    ['fx:chest'] = node({tiles = {'fx_plain.png'}, on_construct = hook, on_metadata_inventory_put = hook}),
    ['fx:timer'] = node({tiles = {'fx_plain.png'}, on_timer = hook}),
    ['fx:form'] = node({tiles = {'fx_plain.png'}, on_receive_fields = hook}),
    ['fx:keep'] = node({tiles = {'fx_plain.png'}, preserve_metadata = hook}),
  }
  core.registered_abms = {{nodenames = {'group:opaque'}}}
  core.registered_on_mapblocks_changed = mode == 'state-global' and {hook} or {}
  if mode == 'state-unknown' then core.registered_on_mapblocks_changed = nil end
  if arg[2] == 'write_path' then print(assert(facts.write_path(core)).raw_json) return end
  print(assert(facts.catalogue(core)).raw_json) return
end
if mode == 'catalogue' then print(assert(facts.catalogue(core)).raw_json) return end
if mode == 'nopath' then core.get_user_path = nil end
local result, code = facts.material_metadata(core)
if not result then print('{"error":' .. json(code) .. '}') return end
print(result.raw_json)
