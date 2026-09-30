local writes = 0
local nodes = {['0,0,0'] = {name = 'air', param1 = 0, param2 = 0}}
local meta_state = {fields = {}, inventory = {}}
local function key(p) return p.x .. ',' .. p.y .. ',' .. p.z end
_G.minetest = {
  get_player_by_name = function(name) if name == 'alice' then return {get_player_name = function() return name end} end end,
  check_player_privs = function() return true end,
  is_protected = function(p) return p.x == 1 end,
  get_node_or_nil = function(p) return nodes[key(p)] end,
  get_meta = function() return {to_table = function() return meta_state end, from_table = function(_, value) meta_state = value; return true end} end,
  get_node_timer = function() return {get_timeout = function() return 0 end, get_elapsed = function() return 0 end, stop = function() end} end,
  swap_node = function(p, node) nodes[key(p)] = node end,
  registered_nodes = {air = {}, ['test:stone'] = {}}
}
_G.worldedit = {
  set = function(p, _, name) writes = writes + 1; nodes[key(p)] = {name = name, param1 = 0, param2 = 0}; return 1 end,
  set_param2 = function(p, _, param2) nodes[key(p)].param2 = param2; return 1 end,
}
local module = dofile('payload/hanaworlds_adapter/engine.lua')
local denied = module.new({authorize = function() return false end})
local no_snapshot, denied_code = denied:snapshot('alice', {{0, 0, 0}})
assert(no_snapshot == nil and denied_code == 'PERMISSION_DENIED', 'unverified call denied')

local engine = module.new({authorize = function() return true end})
local snapshot, code = engine:snapshot('alice', {{0, 0, 0}})
assert(code == nil and #snapshot.records == 1, 'full preimage captured')
assert(snapshot.records[1].inventory ~= nil and snapshot.records[1].metadata ~= nil, 'complete state containers captured')
local mutable_positions = {{0, 0, 0}}
local isolated = engine:snapshot('alice', mutable_positions)
mutable_positions[1][1] = 9
assert(isolated.coveredPositions[1][1] == 0 and isolated.records[1].position[1] == 0,
  'captured positions cannot be changed by the caller after capture')
local rejected, missing = engine:apply('alice', {{position = {0, 0, 0}, nodeName = 'air', param2 = 0}}, snapshot, nil)
assert(rejected == nil and missing == 'CAPABILITY_UNAVAILABLE' and writes == 0, 'no write without durable prepared receipt')
local forged, forged_code = engine:apply('alice', {{position = {0, 0, 0}, nodeName = 'air', param2 = 0}}, snapshot, {status = 'PREPARED'})
assert(forged == nil and forged_code == 'CAPABILITY_UNAVAILABLE' and writes == 0, 'caller JSON cannot assert durable preparation')
local trusted = module.new({authorize = function() return true end, verifyPrepared = function() return true end})
local protected, protected_code = trusted:apply('alice', {
  {position = {0, 0, 0}, nodeName = 'air', param2 = 0},
  {position = {1, 0, 0}, nodeName = 'air', param2 = 0},
}, {coveredPositions = {{0, 0, 0}, {1, 0, 0}}, records = {snapshot.records[1],
  {position = {1, 0, 0}, nodeName = 'air', param1 = 0, param2 = 0, metadata = {}, inventory = {}, timer = nil}}}, {status = 'PREPARED'})
assert(protected == nil and protected_code == 'PERMISSION_DENIED' and writes == 0, 'every affected cell checked before first write')
local mismatched, mismatch_code = trusted:apply('alice', {{position = {0, 0, 0}, nodeName = 'test:stone', param2 = 3}},
  {coveredPositions = {{1, 0, 0}}, records = snapshot.records}, {status = 'PREPARED'})
assert(mismatched == nil and mismatch_code == 'SCHEMA_INVALID' and writes == 0, 'prepared coverage must match every effect')
meta_state = {fields = {owner = 'private'}, inventory = {}}
local stateful = trusted:snapshot('alice', {{0, 0, 0}})
local rejected_stateful, state_code = trusted:apply('alice', {{position = {0, 0, 0}, nodeName = 'test:stone', param2 = 3}},
  stateful, {status = 'PREPARED'})
assert(rejected_stateful == nil and state_code == 'UNSUPPORTED_MUTATION_SEMANTICS' and writes == 0,
  'persistent state is refused before WorldEdit mutation')
meta_state = {fields = {}, inventory = {main = {'', 'test:stone 1'}}}
local inventory_image = trusted:snapshot('alice', {{0, 0, 0}})
assert(inventory_image.records[1].inventory.main[1] == '' and inventory_image.records[1].inventory.main[2] == 'test:stone 1',
  'snapshot preserves empty slots and stack strings')
local rejected_inventory, inventory_code = trusted:apply('alice', {{position = {0, 0, 0}, nodeName = 'test:stone', param2 = 3}},
  inventory_image, {status = 'PREPARED'})
assert(rejected_inventory == nil and inventory_code == 'UNSUPPORTED_MUTATION_SEMANTICS' and writes == 0)
meta_state = {fields = {}, inventory = {}}
local applied, apply_code = trusted:apply('alice', {{position = {0, 0, 0}, nodeName = 'test:stone', param2 = 3}}, snapshot, {status = 'PREPARED'})
assert(apply_code == nil and applied.status == 'APPLIED_PENDING_READBACK' and writes == 1, 'WorldEdit set and param2 execute only after checks')
local readback = trusted:readback('alice', {{0, 0, 0}})
assert(readback.records[1].nodeName == 'test:stone' and readback.records[1].param2 == 3, 'complete post-write state read back')
local no_restore, no_restore_code = trusted:restore('operator', snapshot, {status = 'RESTORING'})
assert(no_restore == nil and no_restore_code == 'CAPABILITY_UNAVAILABLE', 'caller cannot assert service recovery')
local recovery = module.new({authorize = function() return true end, verifyRestore = function() return true end})
local restored, restore_code = recovery:restore('operator', snapshot, {status = 'RESTORING'})
assert(restore_code == nil and restored.status == 'ROLLED_BACK' and nodes['0,0,0'].name == 'air', 'trusted service restores and verifies full before state')
print('engine smoke PASS')
