-- SOURCE/FIXTURE: exercise the shipped writer without any WorldEdit API.
local cells = {{0, 0, 0}, {2, 0, 0}}
local nodes, states, writes, lights, failure
-- FIXTURE map residency: an unloaded cell reads nil until load_area loads it
-- from "disk"; an ungenerated cell stays absent after loading.
local unloaded, ungenerated, loads = {}, {}, 0
local function key(p) return p.x .. ',' .. p.y .. ',' .. p.z end
local function reset()
  nodes, states, writes, lights, failure = {}, {}, 0, 0, nil
  for _, x in ipairs({0, 1, 2}) do
    nodes[x .. ',0,0'] = {name = 'air', param1 = 0, param2 = 0}
    states[x .. ',0,0'] = {fields = {}, inventory = {}, timeout = 0, elapsed = 0}
  end
end
reset()
minetest = {
  registered_nodes = {air = {}, stone = {}, brick = {}, callback = {on_construct = function() end}},
  load_area = function(p) loads = loads + 1; if not ungenerated[key(p)] then unloaded[key(p)] = nil end end,
  get_node_or_nil = function(p)
    if unloaded[key(p)] or ungenerated[key(p)] then return nil end
    local n = nodes[key(p)]
    return {name = n.name, param1 = n.param1, param2 = n.param2}
  end,
  swap_node = function(p, n)
    if failure == 'throw' then error('native write error') end
    if failure == 'false' then return false end
    writes = writes + 1
    nodes[key(p)] = {name = n.name, param1 = n.param1 or 0, param2 = n.param2 or 0}
    return true
  end,
  get_meta = function(p)
    local s = states[key(p)]
    return {to_table = function() return {fields = s.fields, inventory = s.inventory} end,
      from_table = function(_, t)
        s.fields, s.inventory = t.fields, t.inventory
        return true
      end}
  end,
  get_node_timer = function(p)
    local s = states[key(p)]
    return {get_timeout = function() return s.timeout end, get_elapsed = function() return s.elapsed end,
      set = function(_, t, e) s.timeout, s.elapsed = t, e end,
      stop = function() s.timeout, s.elapsed = 0, 0 end}
  end,
  fix_light = function(p)
    lights = lights + 1
    nodes[key(p)].param1 = 15
    return failure ~= 'light'
  end,
  get_node_light = function() return 15 end,
}
worldedit = nil
local engine_c = dofile('test/support/engine-c.lua')
local native_swap = engine_c(minetest.swap_node)
local module = dofile('payload/hanaworlds_adapter/engine.lua')
assert(module.native_writer() == true)
local engine = module.new({verifyPrepared = function() return true end,
  verifyRestore = function() return true end, restoreGuard = function() return true end})
local prepared, recovery = {status = 'PREPARED'}, {status = 'RESTORING'}
local effects = {{position = cells[1], nodeName = 'stone', param2 = 7},
  {position = cells[2], nodeName = 'brick', param2 = 255}}
local function target()
  return {coveredPositions = cells, records = {
    {position = cells[1], nodeName = 'brick', param1 = 8, param2 = 3,
      metadata = {owner = 'alice'}, inventory = {main = {'', 'stone 1'}},
      timer = {timeout = 11, elapsed = 4}},
    {position = cells[2], nodeName = 'stone', param1 = 7, param2 = 2,
      metadata = {}, inventory = {}},
  }}
end
local before = assert(engine:snapshot(cells))
local result, code = engine:apply(effects, before, prepared)
assert(result and result.writtenCells == 2, 'native apply without WorldEdit: ' .. tostring(code))
assert(nodes['0,0,0'].name == 'stone' and nodes['0,0,0'].param2 == 7)
assert(nodes['2,0,0'].name == 'brick' and nodes['2,0,0'].param2 == 255)
assert(nodes['1,0,0'].name == 'air' and writes == 2 and lights == 2, 'only requested cells written')
local image = target()
local current = assert(engine:snapshot(cells))
result, code = engine:apply_state(image, current, prepared)
assert(result and result.writtenCells == 2, 'native history: ' .. tostring(code))
assert(writes == 4 and lights == 4, 'history performs one native write per cell')
local actual = assert(engine:readback(cells)).records[1]
assert(actual.metadata.owner == 'alice' and actual.inventory.main[1] == ''
  and actual.inventory.main[2] == 'stone 1' and actual.timer.timeout == 11 and actual.timer.elapsed == 4)
assert(actual.param1 == 15 and actual.param2 == 3, 'derived lighting does not change orientation')
result, code = engine:restore(image, recovery)
assert(result and result.status == 'ROLLED_BACK', 'native restore: ' .. tostring(code))
assert(writes == 6 and lights == 6)
result, code = engine:restore(before, recovery)
assert(result and nodes['0,0,0'].name == 'air' and states['0,0,0'].timeout == 0
  and next(states['0,0,0'].fields) == nil and next(states['0,0,0'].inventory) == nil,
  'restore clears metadata, inventory and timer when the image is empty')

local operations = {
  apply = function(b) return engine:apply(effects, b, prepared) end,
  apply_state = function(b) return engine:apply_state(target(), b, prepared) end,
  restore = function(b) return engine:restore(b, recovery) end,
}
-- Engine false results and exceptions are failures, never pending successes.
for op, run in pairs(operations) do
  for _, mode in ipairs({'false', 'throw', 'light'}) do
    reset(); before = assert(engine:snapshot(cells)); failure = mode
    result, code = run(before)
    assert(not result and code == (op == 'restore' and 'RESTORE_FAILED' or 'APPLY_FAILED'), op .. ' ' .. mode)
    if mode ~= 'light' then assert(writes == 0 and lights == 0) end
  end
end
-- A game that replaces swap_node after load (VoxeLibre mcl_observers: runs observer
-- code, returns nothing) is never written through: the bound engine function is used.
local wrapper_calls = 0
minetest.swap_node = function(p, n) wrapper_calls = wrapper_calls + 1; native_swap(p, n) end
for op, run in pairs(operations) do
  reset(); before = assert(engine:snapshot(cells))
  result, code = run(before)
  assert(result and wrapper_calls == 0 and writes == 2, op .. ' writes through the bound native writer: ' .. tostring(code))
end
-- Replaced before the payload loaded, or missing: nothing is bound, nothing is written, the reason is named.
for _, case in ipairs({{swap = function(p, n) return native_swap(p, n) end, reason = 'NATIVE_WRITER_REPLACED_BEFORE_LOAD'},
  {swap = nil, reason = 'NATIVE_WRITER_MISSING'}}) do
  minetest.swap_node = case.swap
  local late = dofile('payload/hanaworlds_adapter/engine.lua')
  local bound, why = late.native_writer()
  assert(bound == false and why == case.reason, case.reason)
  local unbound = late.new({verifyPrepared = function() return true end,
    verifyRestore = function() return true end, restoreGuard = function() return true end})
  for op, run in pairs({apply = function(b) return unbound:apply(effects, b, prepared) end,
    apply_state = function(b) return unbound:apply_state(target(), b, prepared) end,
    restore = function(b) return unbound:restore(b, recovery) end}) do
    reset(); before = assert(engine:snapshot(cells))
    local detail
    result, code, detail = run(before)
    assert(not result and code == 'CAPABILITY_UNAVAILABLE' and detail == case.reason and writes == 0, op .. ' ' .. case.reason)
  end
end
minetest.swap_node = native_swap
-- Every cell is checked before writes, including a later conflict or unsafe node.
for _, op in ipairs({'apply', 'apply_state'}) do
  reset(); before = assert(engine:snapshot(cells)); nodes['2,0,0'].param2 = 1
  result, code = operations[op](before)
  assert(not result and code == 'TRANSACTION_CONFLICT' and writes == 0, op .. ' late conflict')
end
reset(); before = assert(engine:snapshot(cells))
local unsafe = {{position = cells[1], nodeName = 'stone', param2 = 0},
  {position = cells[2], nodeName = 'callback', param2 = 0}}
result, code = engine:apply(unsafe, before, prepared)
assert(not result and code == 'UNSUPPORTED_MUTATION_SEMANTICS' and writes == 0)
local guarded = module.new({verifyRestore = function() return true end,
  restoreGuard = function() return nil, nil, 'BODY_OCCUPIED' end})
local detail
result, code, detail = guarded:restore(before, recovery)
assert(not result and code == 'RESTORE_FAILED' and detail == 'BODY_OCCUPIED' and writes == 0)
-- Transaction reads load before reading: a block the engine unloaded is loaded
-- again in the same command; an ungenerated cell is reported, not invented.
reset(); unloaded['2,0,0'] = true; loads = 0
assert(engine:snapshot(cells) and loads == 1 and unloaded['2,0,0'] == nil, 'unloaded block is loaded then read')
reset(); ungenerated['2,0,0'] = true
result, code = engine:snapshot(cells)
assert(not result and code == 'TARGET_FACTS_INCOMPLETE', 'ungenerated cell stays unknown')
ungenerated['2,0,0'] = nil
assert(module.WRITE_BACKEND.backendProfileId == 'hanaworlds-luanti-native-cell-write/v1')
assert(module.WRITE_BACKEND.revision == 'native-cell-write/2')
print('Native cell writer SOURCE/FIXTURE PASS')
