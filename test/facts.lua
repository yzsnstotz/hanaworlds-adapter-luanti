local facts = dofile('payload/hanaworlds_adapter/facts.lua')
local core = {
  get_node_or_nil = function() return {name = 'air'} end,
  get_meta = function() return {to_table = function() return {fields = {}, inventory = {}} end} end,
  get_node_timer = function() return {get_timeout = function() return 0 end,
    get_elapsed = function() return 0 end} end,
  get_node_light = function() return 15 end,
  fix_light = function() return true end,
  registered_nodes = {air = {walkable = false}},
  get_game_info = function() return {id = 'minimal'} end,
  get_modnames = function() return {'hanaworlds_adapter'} end,
  sha256 = function(value) return string.rep('a', 64) end,
  write_json = function(value)
    if type(value) == 'string' then return string.format('%q', value) end
    if type(value) == 'number' or type(value) == 'boolean' then return tostring(value) end
    return '{}'
  end,
}
local profile, code = facts.state_profile(core, {set = function() end,
  set_param2 = function() end})
assert(code == nil and profile.profileVersion == 'state-profile/v2')
assert(profile.derivedLightMode == 'recompute-with-readback')
local capacity = facts.capacity(core, 1, 4194304)
assert(capacity.allowed == true and capacity.maxCells > 1)
assert(facts.capacity(core, capacity.maxCells + 1, 4194304).allowed == false)
local catalogue, catalogue_code = facts.catalogue(core)
assert(catalogue_code == nil and catalogue.raw_json:find('"walkable":false', 1, true),
  'registered node false remains a sourced fact')
assert(catalogue.raw_json:find('"hasPersistentState":null', 1, true),
  'unknown persistent state is never fabricated as false')
assert(facts.world_revision(core) == nil, 'world revision has no native source')
assert(facts.object_revisions(core, {'building:one'}) == nil,
  'object revisions have no native object registry')
core.fix_light = nil
assert(facts.state_profile(core, {set = function() end, set_param2 = function() end}) == nil,
  'missing light recomputation fails closed')
print('facts.lua: PASS')
