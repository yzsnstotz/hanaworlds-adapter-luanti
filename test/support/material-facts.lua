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
  ['fx:plain'] = node({tiles = {'fx_plain.png'}}),
  ['fx:six'] = node({tiles = {'fx_plain.png', 'fx_plain.png', {name = 'fx_plain.png'},
    'fx_plain.png', {image = 'fx_plain.png', backface_culling = true}, 'fx_plain.png'}}),
  ['fx:facedir'] = node({paramtype2 = 'facedir', tiles = {'fx_dir.png'}}),
  ['fx:placed'] = node({place_param2 = 7, tiles = {'fx_plain.png'}}),
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
if mode == 'state' or mode == 'state-global' then
  -- Registry with engine dispatch tables: which nodes provably carry no state.
  local hook = function() end
  core.registered_nodes = {
    ['air'] = node({drawtype = 'airlike', walkable = false, pointable = false, on_punch = hook, on_dig = hook}),
    ['ignore'] = node({drawtype = 'airlike', walkable = false, pointable = false}),
    ['fx:plain'] = node({tiles = {'fx_plain.png'}}),
    ['fx:dug'] = node({tiles = {'fx_plain.png'}, after_dig_node = hook}),
    ['fx:hidden_dug'] = node({tiles = {'fx_plain.png'}, pointable = false, on_dig = hook}),
    ['fx:built'] = node({tiles = {'fx_plain.png'}, pointable = false, on_construct = hook}),
    ['fx:fields'] = node({tiles = {'fx_plain.png'}, pointable = false, on_receive_fields = hook}),
    ['fx:abm_name'] = node({tiles = {'fx_plain.png'}, pointable = false}),
    ['fx:abm_group'] = node({tiles = {'fx_plain.png'}, pointable = false, groups = {opaque = 1}}),
    ['fx:zero_group'] = node({tiles = {'fx_plain.png'}, pointable = false, groups = {opaque = 0}}),
    ['fx:lbm'] = node({tiles = {'fx_plain.png'}, pointable = false, groups = {grass_palette = 1}}),
  }
  core.registered_abms = {{nodenames = {'fx:abm_name'}}, {nodenames = 'group:opaque'}}
  core.registered_lbms = {{nodenames = {'group:grass_palette'}}}
  core.registered_on_punchnodes = mode == 'state-global' and {hook} or {}
  core.registered_on_dignodes = {}
  print(assert(facts.catalogue(core)).raw_json) return
end
if mode == 'catalogue' then print(assert(facts.catalogue(core)).raw_json) return end
if mode == 'nopath' then core.get_user_path = nil end
local result, code = facts.material_metadata(core)
if not result then print('{"error":' .. json(code) .. '}') return end
print(result.raw_json)
