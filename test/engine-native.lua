-- SOURCE/FIXTURE: exercise the shipped writer without any WorldEdit API.
local cells = {{0, 0, 0}, {2, 0, 0}}
local nodes, states, writes, lights, failure
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
  get_node_or_nil = function(p)
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
local module = dofile('payload/hanaworlds_adapter/engine.lua')
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
  reset(); before = assert(engine:snapshot(cells))
  local native = minetest.swap_node; minetest.swap_node = nil
  result, code = run(before)
  assert(not result and code == 'CAPABILITY_UNAVAILABLE' and writes == 0, op .. ' unavailable native API')
  minetest.swap_node = native
end
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
assert(module.WRITE_BACKEND.backendProfileId == 'hanaworlds-luanti-native-cell-write/v1')
assert(module.WRITE_BACKEND.revision == 'native-cell-write/1')
print('Native cell writer SOURCE/FIXTURE PASS')
