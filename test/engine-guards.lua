-- v1 engine guards (G1 restore body recheck, G2 per-cell protection, G3 no
-- enclosure) through the shipped courier, engine, region and voxel modules.
-- SOURCE/FIXTURE: the Luanti API is a test double; this is not a runtime proof.
local nodes, protected, players, writes = {}, {}, {}, 0
local function key(p) return p.x .. ',' .. p.y .. ',' .. p.z end
local function node_at(p)
  local n = nodes[key(p)]
  if n then return n end
  return {name = p.y <= 0 and 'test:stone' or 'air', param1 = 0, param2 = 0}
end
local ids, names = {air = 0, ['test:stone'] = 1, ['test:flower'] = 2, ignore = 3}, {}
for n, i in pairs(ids) do names[i] = n end

local function encode(v)
  local t = type(v)
  if t == 'string' then return '"' .. v:gsub('["\\]', '\\%0') .. '"' end
  if t == 'number' or t == 'boolean' then return tostring(v) end
  if t ~= 'table' or next(v) == nil then return 'null' end
  if #v > 0 then
    local out = {}
    for i, x in ipairs(v) do out[i] = encode(x) end
    return '[' .. table.concat(out, ',') .. ']'
  end
  local out = {}
  for k, x in pairs(v) do out[#out + 1] = encode(k) .. ':' .. encode(x) end
  table.sort(out)
  return '{' .. table.concat(out, ',') .. '}'
end

local scheduled = {}
_G.VoxelArea = function(e1, e2)
  local nx, ny = e2.x - e1.x + 1, e2.y - e1.y + 1
  return {index = function(_, x, y, z) return (z - e1.z) * ny * nx + (y - e1.y) * nx + (x - e1.x) + 1 end}
end
local core
core = {
  registered_nodes = {air = {}, ['test:stone'] = {}, ['test:flower'] = {walkable = false}},
  parse_json = function(raw) return raw end,
  write_json = function(v) return encode(v) end,
  log = function() end,
  after = function(_, fn) scheduled[#scheduled + 1] = fn end,
  sha256 = function(s) return s end,
  get_connected_players = function()
    local out = {}
    for _, p in ipairs(players) do
      out[#out + 1] = {get_pos = function() return {x = p[1], y = p[2], z = p[3]} end,
        get_properties = function() return {collisionbox = {-0.3, 0, -0.3, 0.3, 1.77, 0.3}} end}
    end
    return out
  end,
  is_protected = function(p, name)
    assert(name == '', 'no player identity in the local courier')
    return protected[key(p)] == true
  end,
  get_node_or_nil = function(p) return node_at(p) end,
  get_meta = function() return {to_table = function() return {fields = {}, inventory = {}} end,
    from_table = function() return true end} end,
  get_node_timer = function() return {get_timeout = function() return 0 end,
    get_elapsed = function() return 0 end, set = function() end, stop = function() end} end,
  swap_node = function(p, n) nodes[key(p)] = {name = n.name, param1 = n.param1 or 0, param2 = n.param2 or 0} end,
  fix_light = function() return true end,
  get_node_light = function() return 15 end,
  get_content_id = function(n) return ids[n] end,
  get_name_from_content_id = function(i) return names[i] end,
  find_nodes_with_meta = function() return {} end,
  get_voxel_manip = function()
    local vm, lo, hi, data, p2 = {}, nil, nil, {}, {}
    function vm:read_from_map(a, b)
      lo, hi = a, b
      local area = VoxelArea(a, b)
      for z = a.z, b.z do for y = a.y, b.y do for x = a.x, b.x do
        local n = node_at({x = x, y = y, z = z})
        data[area:index(x, y, z)] = ids[n.name]; p2[area:index(x, y, z)] = n.param2
      end end end
      return a, b
    end
    function vm:get_data() return data end
    function vm:get_param2_data() return p2 end
    function vm:set_data(d) data = d end
    function vm:set_param2_data(d) p2 = d end
    function vm:write_to_map()
      local area = VoxelArea(lo, hi)
      for z = lo.z, hi.z do for y = lo.y, hi.y do for x = lo.x, hi.x do
        local i = area:index(x, y, z)
        nodes[key({x = x, y = y, z = z})] = {name = names[data[i]], param1 = 0, param2 = p2[i]}
        writes = writes + 1
      end end end
    end
    return vm
  end,
}
_G.minetest = core
_G.worldedit = {
  set = function(p, _, name) writes = writes + 1; nodes[key(p)] = {name = name, param1 = 0, param2 = 0}; return 1 end,
  set_param2 = function(p, _, v) nodes[key(p)].param2 = v; return 1 end,
}

local region_module = dofile('payload/hanaworlds_adapter/region.lua')
local region = region_module.new({core = core})
local voxel = dofile('payload/hanaworlds_adapter/voxel.lua')
local engine_module = dofile('payload/hanaworlds_adapter/engine.lua')
local transport = dofile('payload/hanaworlds_adapter/transport.lua')

-- Courier double: one queued command per poll; every reply is kept raw.
local queue, replies = {}, {}
local http = {fetch = function(request, callback)
  if request.url:match('/poll$') then
    callback({succeeded = true, code = 200, data = {worldRef = 'w', command = table.remove(queue, 1)}})
  else
    replies[#replies + 1] = request.data
    callback({succeeded = true, code = 200})
  end
end}
local function capabilities()
  return {worldRef = 'w', engineGuards = region_module.guards(core)}
end
assert(transport.start(http, engine_module, {worldRef = 'w'},
  function() return {worldRef = 'w', port = 30000, token = string.rep('a', 64)} end,
  function() end, capabilities, nil, region, {}, voxel))
local function call(command)
  command.id = 'c' .. (#replies + 1); command.worldRef = 'w'
  queue[#queue + 1] = command
  local before = #replies
  while #replies == before do
    local fn = table.remove(scheduled, 1)
    assert(fn, 'courier stopped polling')
    fn()
  end
  return replies[#replies]
end
local function refused(reply, code, detail)
  return reply:find('"error":"' .. code .. '"', 1, true) ~= nil
    and reply:find('"detail":' .. (detail and ('"' .. detail .. '"') or 'null'), 1, true) ~= nil
end
local function reset() nodes, protected, players, writes = {}, {}, {}, 0 end
local function stone(p) return {position = p, nodeName = 'test:stone', param2 = 0} end
local function state(name, p)
  return {position = p, nodeName = name, param1 = 0, param2 = 0, metadata = {}, inventory = {}}
end
local function prepared() return {status = 'PREPARED', operationDigest = 'd'} end
local function apply_cmd(effects)
  local records, covered = {}, {}
  for i, e in ipairs(effects) do
    local n = node_at({x = e.position[1], y = e.position[2], z = e.position[3]})
    records[i] = state(n.name, e.position); covered[i] = e.position
  end
  local p = prepared()
  return {operation = 'apply', effects = effects, beforeImage = {coveredPositions = covered, records = records},
    operationDigest = 'd', prepared = p}
end
local function apply_state_cmd(targets)
  local before, covered = {}, {}
  for i, t in ipairs(targets) do
    local n = node_at({x = t.position[1], y = t.position[2], z = t.position[3]})
    before[i] = state(n.name, t.position); covered[i] = t.position
  end
  return {operation = 'apply_state', operationDigest = 'd', prepared = prepared(),
    targetImage = {coveredPositions = covered, records = targets},
    beforeImage = {coveredPositions = covered, records = before}}
end
local function restore_cmd(records)
  local covered = {}
  for i, r in ipairs(records) do covered[i] = r.position end
  return {operation = 'restore', beforeImage = {coveredPositions = covered, records = records},
    recovery = {status = 'RESTORING', transactionId = 't'}}
end
-- A wall ring of the given height around (0,1,0) on the stone floor.
local function ring(height, gap)
  local out = {}
  for x = -1, 1 do for z = -1, 1 do
    if not (x == 0 and z == 0) and not (gap and x == 1 and z == 0) then
      for y = 1, height do out[#out + 1] = stone({x, y, z}) end
    end
  end end
  return out
end

-- Declaration: exactly what the payload enforces, read from the handshake.
local g = region_module.guards(core)
assert(table.concat(g.restoreBodyRecheck, ',') == 'restore')
assert(table.concat(g.perCellProtection, ',') == 'prepare_check,apply,apply_state,restore,region_write')
assert(table.concat(g.playerEnclosure, ',') == 'prepare_check,apply,apply_state')
local hs = call({operation = 'handshake'})
assert(hs:find('"engineGuards":{', 1, true) and hs:find('"playerEnclosure":["prepare_check","apply","apply_state"]', 1, true), hs)

-- G1 restore: a real body in a cell that would receive a solid node blocks
-- the whole restore before the first write; it stays RESTORE_FAILED.
reset(); players = {{0, 0.5, 0}}
local r = call(restore_cmd({state('test:stone', {0, 1, 0}), state('test:stone', {3, 1, 0})}))
assert(refused(r, 'RESTORE_FAILED', 'BODY_OCCUPIED') and writes == 0, r)
-- Restoring air (or the node already there) into the body cell is not a solid write.
nodes['0,1,0'] = {name = 'test:stone', param1 = 0, param2 = 0}
r = call(restore_cmd({state('test:stone', {0, 1, 0}), state('test:stone', {3, 1, 0})}))
assert(r:find('"status":"ROLLED_BACK"', 1, true) and writes == 2, r)
reset(); players = {{20, 0.5, 0}}
r = call(restore_cmd({state('test:stone', {0, 1, 0})}))
assert(r:find('"status":"ROLLED_BACK"', 1, true) and writes == 1, r)

-- G2 per-cell protection on every declared operation; nothing is written.
for _, op in ipairs({'prepare_check', 'apply', 'apply_state', 'restore', 'region_write'}) do
  reset(); protected['5,1,0'] = true
  local cmd
  if op == 'prepare_check' then cmd = {operation = op, positions = {{4, 1, 0}, {5, 1, 0}}}
  elseif op == 'apply' then cmd = apply_cmd({stone({4, 1, 0}), stone({5, 1, 0})})
  elseif op == 'apply_state' then cmd = apply_state_cmd({state('test:stone', {4, 1, 0}), state('test:stone', {5, 1, 0})})
  elseif op == 'restore' then cmd = restore_cmd({state('test:stone', {4, 1, 0}), state('test:stone', {5, 1, 0})})
  else
    local read = voxel.read(core, {min = {4, 1, 0}, max = {5, 1, 0}})
    cmd = {operation = op, purpose = 'APPLY', min = {4, 1, 0}, max = {5, 1, 0}, chunks = {{
      min = {4, 1, 0}, max = {5, 1, 0}, palette = {'test:stone'}, contentRuns = {0, 2},
      param2Runs = {0, 2}, guard = read.boxes[1].guard}}}
  end
  r = call(cmd)
  local code = op == 'restore' and 'RESTORE_FAILED' or 'SAFETY_INVARIANT_FAILED'
  assert(refused(r, code, 'PROTECTED_CELL') and writes == 0, op .. ' ' .. r)
end
-- Unprotected region write goes through (the guard is per cell, not a ban).
reset(); protected['9,1,0'] = true
local read = voxel.read(core, {min = {4, 1, 0}, max = {5, 1, 0}})
r = call({operation = 'region_write', purpose = 'APPLY', min = {4, 1, 0}, max = {5, 1, 0}, chunks = {{
  min = {4, 1, 0}, max = {5, 1, 0}, palette = {'test:stone'}, contentRuns = {0, 2},
  param2Runs = {0, 2}, guard = read.boxes[1].guard}}})
assert(r:find('"written":true', 1, true) and r:find('"error":null', 1, true), r)

-- G3 enclosure on every declared operation.
for _, op in ipairs({'prepare_check', 'apply', 'apply_state'}) do
  local function cmd_for(effects)
    if op == 'prepare_check' then
      local positions = {}
      for i, e in ipairs(effects) do positions[i] = e.position end
      return {operation = op, positions = positions, effects = effects}
    elseif op == 'apply' then return apply_cmd(effects) end
    local t = {}
    for i, e in ipairs(effects) do t[i] = state(e.nodeName, e.position) end
    return apply_state_cmd(t)
  end
  reset(); players = {{0, 0.5, 0}}
  r = call(cmd_for(ring(3)))
  assert(refused(r, 'SAFETY_INVARIANT_FAILED', 'PLAYER_ENCLOSED') and writes == 0, op .. ' sealed ' .. r)
  reset(); players = {{0, 0.5, 0}}
  r = call(cmd_for(ring(3, true)))
  assert(r:find('"error":null', 1, true), op .. ' gap ' .. r)
  reset(); players = {{0, 0.5, 0}}
  r = call(cmd_for(ring(1)))
  assert(r:find('"error":null', 1, true), op .. ' step-up ' .. r)
  reset(); players = {{30, 0.5, 30}}
  r = call(cmd_for(ring(3)))
  assert(r:find('"error":null', 1, true), op .. ' far ' .. r)
end
-- A non-walkable node (flower) does not seal; a walkable one does.
reset(); players = {{0, 0.5, 0}}
local flowers = ring(3)
for _, e in ipairs(flowers) do if e.position[1] == 1 and e.position[3] == 0 then e.nodeName = 'test:flower' end end
assert(region:prepare_check({{1, 1, 0}}, flowers), 'passable node keeps the exit')

-- Engine without protection API: guard declared false and every write refused.
reset()
local saved = core.is_protected; core.is_protected = nil
assert(region_module.guards(core).perCellProtection == false)
local _, code = region:prepare_check({{4, 1, 0}})
assert(code == 'CAPABILITY_UNAVAILABLE')
core.is_protected = saved
-- Engine module used without a restore guard never restores silently.
local bare = engine_module.new({verifyRestore = function() return true end})
local none, rcode, rdetail = bare:restore({coveredPositions = {{0, 1, 0}}, records = {state('test:stone', {0, 1, 0})}},
  {status = 'RESTORING'})
assert(none == nil and rcode == 'RESTORE_FAILED' and rdetail == 'RESTORE_GUARD_UNAVAILABLE')
print('engine guards G1/G2/G3 SOURCE/FIXTURE PASS')
