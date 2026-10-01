local writes = 0
local node = {name = 'test:stone', param1 = 7, param2 = 2}
local metadata = {fields = {owner = 'alice'}, inventory = {main = {'', 'test:stone 1'}}}
local timer = {timeout = 11, elapsed = 3}
_G.minetest = {
  check_player_privs = function() return true end,
  is_protected = function() return false end,
  get_node_or_nil = function() return node end,
  get_meta = function() return {to_table = function() return metadata end,
    from_table = function(_, value) metadata = value; return true end} end,
  get_node_timer = function() return {
    get_timeout = function() return timer.timeout end,
    get_elapsed = function() return timer.elapsed end,
    set = function(_, timeout, elapsed) timer = {timeout = timeout, elapsed = elapsed} end,
    stop = function() timer = {timeout = 0, elapsed = 0} end,
  } end,
  swap_node = function(_, value) node = value end,
  registered_nodes = {air = {}, ['test:stone'] = {}, ['test:brick'] = {}}
}
_G.worldedit = {
  set = function(_, _, name) writes = writes + 1; node = {name = name, param1 = 0, param2 = 0}; return 1 end,
  set_param2 = function(_, _, value) node.param2 = value; return 1 end,
}
local module = dofile('payload/hanaworlds_adapter/engine.lua')
local engine = module.new({authorize = function() return true end,
  verifyPrepared = function(_, _, _, prepared) return prepared.status == 'PREPARED' end})
local before = engine:snapshot('alice', {{0, 0, 0}})
local target = {coveredPositions = {{0, 0, 0}}, records = {
  {position = {0, 0, 0}, nodeName = 'test:brick', param1 = 8, param2 = 3,
    metadata = {owner = 'bob'}, inventory = {main = {'', 'test:brick 1'}},
    timer = {timeout = 13, elapsed = 4}}
}}
local denied, code = engine:apply_state('alice', target, before, nil)
assert(denied == nil and code == 'CAPABILITY_UNAVAILABLE' and writes == 0)
node.param1 = 9
local conflicted, conflict = engine:apply_state('alice', target, before, {status = 'PREPARED'})
assert(conflicted == nil and conflict == 'TRANSACTION_CONFLICT' and writes == 0)
node.param1 = 7
local applied, apply_error = engine:apply_state('alice', target, before, {status = 'PREPARED'})
assert(apply_error == nil and applied.status == 'APPLIED_PENDING_READBACK' and writes == 1)
local actual = engine:readback('alice', {{0, 0, 0}})
assert(actual.records[1].nodeName == 'test:brick' and actual.records[1].param1 == 8)
assert(actual.records[1].metadata.owner == 'bob' and actual.records[1].inventory.main[1] == '')
assert(actual.records[1].timer.timeout == 13)
print('engine history PASS')
