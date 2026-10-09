-- world-adapter-region/v1 engine side, on Luanti's own bulk primitives:
-- emerge_area (load or generate), VoxelManip read_from_map / set_data /
-- write_to_map(light) and fix_light. One command handles one batch inside a
-- single server step. No transaction decision is made here: the host compares
-- the caller's expectedCurrentDigest and Canvas owns commit and rollback.
local M = {}

local BLOCK = 16
local GUARD_FORMAT = 'hw-region-guard/1'

local forbidden_callbacks = {
  'on_construct', 'on_destruct', 'after_destruct', 'after_place_node',
  'on_timer', 'on_metadata_inventory_move', 'on_metadata_inventory_put',
  'on_metadata_inventory_take', 'allow_metadata_inventory_move',
  'allow_metadata_inventory_put', 'allow_metadata_inventory_take',
}

local function int(n) return type(n) == 'number' and n == math.floor(n) and math.abs(n) <= 31000 end
local function vbox(minp, maxp)
  if type(minp) ~= 'table' or type(maxp) ~= 'table' or #minp ~= 3 or #maxp ~= 3 then return nil end
  for i = 1, 3 do
    if not int(minp[i]) or not int(maxp[i]) or minp[i] > maxp[i] then return nil end
  end
  return {x = minp[1], y = minp[2], z = minp[3]}, {x = maxp[1], y = maxp[2], z = maxp[3]}
end
local function within(p, b) -- p {x,y,z} table, b {min={}, max={}}
  return p.x >= b.min[1] and p.x <= b.max[1] and p.y >= b.min[2] and p.y <= b.max[2]
    and p.z >= b.min[3] and p.z <= b.max[3]
end
local function floor_block(n) return math.floor(n / BLOCK) end

local function names_of(core)
  local cache = {}
  return function(cid)
    local name = cache[cid]
    if name == nil then name = core.get_name_from_content_id(cid); cache[cid] = name end
    return name
  end
end

local function static_def(def)
  if type(def) ~= 'table' then return false end
  for _, callback in ipairs(forbidden_callbacks) do
    if def[callback] then return false end
  end
  return def.liquidtype == nil or def.liquidtype == 'none'
end

local function read_vm(core, p1, p2)
  local vm = core.get_voxel_manip()
  local e1, e2 = vm:read_from_map(p1, p2)
  return vm, VoxelArea(e1, e2), vm:get_data(), vm:get_param2_data()
end

-- Node metadata (fields, inventory as stack strings) and started timers of the
-- box, keyed "x,y,z". Timers are read only on nodes that define on_timer: the
-- engine runs a node timer only through that callback.
local function extras_of(core, p1, p2, area, data, name_of)
  local out = {}
  local function entry(pos)
    local key = pos.x .. ',' .. pos.y .. ',' .. pos.z
    out[key] = out[key] or {position = {pos.x, pos.y, pos.z}, fields = {}, inventory = {}}
    return out[key]
  end
  local metas = core.find_nodes_with_meta(p1, p2)
  if type(metas) ~= 'table' then return nil end
  for _, pos in ipairs(metas) do
    local t = core.get_meta(pos):to_table()
    if type(t) ~= 'table' then return nil end
    local fields, inventory, any = {}, {}, false
    for k, v in pairs(t.fields or {}) do fields[k] = tostring(v); any = true end
    for list, slots in pairs(t.inventory or {}) do
      local stacks = {}
      for i, stack in ipairs(slots) do stacks[i] = type(stack) == 'string' and stack or stack:to_string() end
      inventory[list] = stacks; any = true
    end
    if any then local e = entry(pos); e.fields = fields; e.inventory = inventory end
  end
  local timed = {}
  for z = p1.z, p2.z do
    for y = p1.y, p2.y do
      local i = area:index(p1.x, y, z)
      for x = p1.x, p2.x do
        local cid = data[i]
        if timed[cid] == nil then
          local def = core.registered_nodes[name_of(cid)]
          timed[cid] = type(def) == 'table' and def.on_timer ~= nil
        end
        if timed[cid] then
          local pos = {x = x, y = y, z = z}
          local timer = core.get_node_timer(pos)
          local timeout = timer:get_timeout()
          if timeout > 0 then entry(pos).timer = {timeout = timeout, elapsed = timer:get_elapsed()} end
        end
        i = i + 1
      end
    end
  end
  return out
end

local function sorted_keys(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys)
  return keys
end

-- Private same-process guard of one box: nodes, param2 and extras. It only has
-- to be stable between a read and the following write of this process.
local function guard(core, area, data, p2data, name_of, extras, b)
  local parts = {GUARD_FORMAT, table.concat(b.min, ','), table.concat(b.max, ',')}
  local ignore = 0
  for z = b.min[3], b.max[3] do
    for y = b.min[2], b.max[2] do
      local i = area:index(b.min[1], y, z)
      for x = b.min[1], b.max[1] do
        local name = name_of(data[i])
        if name == 'ignore' then ignore = ignore + 1 end
        parts[#parts + 1] = name .. '\t' .. p2data[i]
        local e = extras[x .. ',' .. y .. ',' .. z]
        if e then
          for _, k in ipairs(sorted_keys(e.fields)) do parts[#parts + 1] = 'f\t' .. k .. '\t' .. e.fields[k] end
          for _, k in ipairs(sorted_keys(e.inventory)) do
            parts[#parts + 1] = 'i\t' .. k .. '\t' .. table.concat(e.inventory[k], '\t')
          end
          if e.timer then parts[#parts + 1] = 't\t' .. e.timer.timeout .. '\t' .. e.timer.elapsed end
        end
        i = i + 1
      end
    end
  end
  return core.sha256(table.concat(parts, '\n') .. '\n'), ignore
end

local function box_list(boxes, p1, p2)
  if boxes == nil then
    local out = {}
    for bz = floor_block(p1.z), floor_block(p2.z) do
      for by = floor_block(p1.y), floor_block(p2.y) do
        for bx = floor_block(p1.x), floor_block(p2.x) do
          out[#out + 1] = {min = {math.max(p1.x, bx * BLOCK), math.max(p1.y, by * BLOCK), math.max(p1.z, bz * BLOCK)},
            max = {math.min(p2.x, bx * BLOCK + BLOCK - 1), math.min(p2.y, by * BLOCK + BLOCK - 1),
              math.min(p2.z, bz * BLOCK + BLOCK - 1)}}
        end
      end
    end
    return out
  end
  if type(boxes) ~= 'table' then return nil end
  for _, b in ipairs(boxes) do
    local q1, q2 = vbox(b.min, b.max)
    if not q1 or q1.x < p1.x or q1.y < p1.y or q1.z < p1.z or q2.x > p2.x or q2.y > p2.y or q2.z > p2.z then
      return nil
    end
  end
  return boxes
end

function M.limits(core, body_bytes)
  if type(core.registered_nodes) ~= 'table' or type(core.get_voxel_manip) ~= 'function'
    or type(core.emerge_area) ~= 'function' or type(core.fix_light) ~= 'function'
    or type(core.find_nodes_with_meta) ~= 'function' or type(core.sha256) ~= 'function' then
    return nil, 'CAPABILITY_UNAVAILABLE'
  end
  local count, longest = 0, 0
  for name in pairs(core.registered_nodes) do
    count = count + 1
    longest = math.max(longest, #name)
  end
  local limit = tonumber(core.get_mapgen_setting and core.get_mapgen_setting('mapgen_limit') or nil)
  return {mapblockSize = BLOCK, maxBodyBytes = body_bytes, registeredNodes = count,
    longestNodeName = longest, mapgenLimit = limit}
end

-- Asynchronous: the courier replies once the engine reported every block.
function M.emerge(core, minp, maxp)
  local p1, p2 = vbox(minp, maxp)
  if not p1 then return nil, 'SCHEMA_INVALID' end
  local names = {
    [core.EMERGE_GENERATED] = 'GENERATED', [core.EMERGE_FROM_MEMORY] = 'FROM_MEMORY',
    [core.EMERGE_FROM_DISK] = 'FROM_DISK', [core.EMERGE_CANCELLED] = 'CANCELLED',
    [core.EMERGE_ERRORED] = 'ERRORED',
  }
  -- Whether each block was already in memory before this request: the emerge
  -- action alone cannot say it (blocks generated within the same mapchunk are
  -- reported FROM_MEMORY by the same emerge).
  local before = {}
  if type(core.compare_block_status) == 'function' then
    for bz = floor_block(p1.z), floor_block(p2.z) do
      for by = floor_block(p1.y), floor_block(p2.y) do
        for bx = floor_block(p1.x), floor_block(p2.x) do
          before[bx .. ',' .. by .. ',' .. bz] = core.compare_block_status(
            {x = bx * BLOCK, y = by * BLOCK, z = bz * BLOCK}, 'loaded') == true
        end
      end
    end
  end
  return {defer = function(done)
    local blocks = {}
    core.emerge_area(p1, p2, function(blockpos, action, remaining)
      local loaded = before[blockpos.x .. ',' .. blockpos.y .. ',' .. blockpos.z]
      blocks[#blocks + 1] = {blockPos = {blockpos.x, blockpos.y, blockpos.z},
        action = names[action] or 'ERRORED', loadedBefore = loaded}
      if remaining == 0 then done({blocks = blocks}) end
    end)
  end}
end

-- Bulk read of a box: run-length node names and param2 in x-fastest, then y,
-- then z order, extras, and a guard plus ignore count per listed box.
function M.read(core, args)
  local p1, p2 = vbox(args.min, args.max)
  if not p1 then return nil, 'SCHEMA_INVALID' end
  local boxes = box_list(args.boxes, p1, p2)
  if not boxes then return nil, 'SCHEMA_INVALID' end
  local _, area, data, p2data = read_vm(core, p1, p2)
  local name_of = names_of(core)
  local palette, index, content, param2 = {}, {}, {}, {}
  local last_c, count_c, last_p, count_p = nil, 0, nil, 0
  for z = p1.z, p2.z do
    for y = p1.y, p2.y do
      local i = area:index(p1.x, y, z)
      for _ = p1.x, p2.x do
        local name = name_of(data[i])
        local k = index[name]
        if not k then palette[#palette + 1] = name; k = #palette - 1; index[name] = k end
        if k == last_c then count_c = count_c + 1
        else
          if last_c then content[#content + 1] = last_c; content[#content + 1] = count_c end
          last_c, count_c = k, 1
        end
        local v = p2data[i]
        if v == last_p then count_p = count_p + 1
        else
          if last_p then param2[#param2 + 1] = last_p; param2[#param2 + 1] = count_p end
          last_p, count_p = v, 1
        end
        i = i + 1
      end
    end
  end
  content[#content + 1] = last_c; content[#content + 1] = count_c
  param2[#param2 + 1] = last_p; param2[#param2 + 1] = count_p
  local extras = extras_of(core, p1, p2, area, data, name_of)
  if not extras then return nil, 'CAPABILITY_UNAVAILABLE' end
  local guards = {}
  for _, b in ipairs(boxes) do
    local g, ignore = guard(core, area, data, p2data, name_of, extras, b)
    guards[#guards + 1] = {min = b.min, max = b.max, guard = g, ignoreCells = ignore}
  end
  local list = {}
  for _, key in ipairs(sorted_keys(extras)) do list[#list + 1] = extras[key] end
  return {min = args.min, max = args.max, palette = palette, contentRuns = content,
    param2Runs = param2, boxes = guards, extras = list, extrasCount = #list}
end

-- Every connected player's actual collision box (same rule as region.lua).
local function bodies(core)
  local out = {}
  for _, player in ipairs(core.get_connected_players()) do
    local pos, props = player:get_pos(), player:get_properties()
    local b = props and props.collisionbox
    if type(pos) ~= 'table' or type(b) ~= 'table' then return nil end
    out[#out + 1] = {lo = {pos.x + b[1], pos.y + b[2], pos.z + b[3]},
      hi = {pos.x + b[4], pos.y + b[5], pos.z + b[6]}}
  end
  return out
end

local function expand(runs, volume, check)
  local out, n = {}, 0
  if type(runs) ~= 'table' then return nil end
  for r = 1, #runs, 2 do
    local v, c = runs[r], runs[r + 1]
    if not check(v) or type(c) ~= 'number' or c < 1 or c ~= math.floor(c) then return nil end
    for _ = 1, c do n = n + 1; out[n] = v end
  end
  if n ~= volume then return nil end
  return out
end

-- args: purpose (APPLY | RESTORE), min/max (batch bounding box), chunks
-- [{min, max, palette (names), contentRuns ([index | -1, count]...; -1 is
-- UNSPECIFIED, APPLY only), param2Runs, guard, extras (RESTORE)}], checkOnly.
function M.write(core, args)
  local p1, p2 = vbox(args.min, args.max)
  if not p1 or type(args.chunks) ~= 'table' or #args.chunks == 0
    or (args.purpose ~= 'APPLY' and args.purpose ~= 'RESTORE') then return nil, 'SCHEMA_INVALID' end
  local restore = args.purpose == 'RESTORE'
  local vm, area, data, p2data = read_vm(core, p1, p2)
  local name_of = names_of(core)
  local extras = extras_of(core, p1, p2, area, data, name_of)
  if not extras then return nil, 'CAPABILITY_UNAVAILABLE' end
  local plans = {}
  for ci, chunk in ipairs(args.chunks) do
    local q1, q2 = vbox(chunk.min, chunk.max)
    if not q1 or q1.x < p1.x or q1.y < p1.y or q1.z < p1.z or q2.x > p2.x or q2.y > p2.y or q2.z > p2.z
      or type(chunk.palette) ~= 'table' or #chunk.palette == 0 then return nil, 'SCHEMA_INVALID' end
    local cids, solid, writable = {}, {}, {}
    for k, name in ipairs(chunk.palette) do
      local def = type(name) == 'string' and core.registered_nodes[name]
      if type(def) ~= 'table' then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
      cids[k - 1] = core.get_content_id(name)
      solid[k - 1] = name ~= 'air'
      -- APPLY targets must be static (contract validateRegionPalette); RESTORE
      -- puts back exactly what was read, extras included.
      writable[k - 1] = restore or static_def(def)
    end
    local volume = (q2.x - q1.x + 1) * (q2.y - q1.y + 1) * (q2.z - q1.z + 1)
    local target = expand(chunk.contentRuns, volume, function(v)
      return type(v) == 'number' and ((v == -1 and not restore) or cids[v] ~= nil) end)
    local target_p2 = expand(chunk.param2Runs, volume, function(v)
      return type(v) == 'number' and v >= 0 and v <= 255 and v == math.floor(v) end)
    if not target or not target_p2 then return nil, 'SCHEMA_INVALID' end
    -- Same-step recheck: the box is loaded and still exactly what the host read.
    local g, ignore = guard(core, area, data, p2data, name_of, extras, chunk)
    if ignore > 0 then return nil, 'TARGET_FACTS_INCOMPLETE' end
    if g ~= chunk.guard then return nil, 'TRANSACTION_CONFLICT' end
    plans[ci] = {q1 = q1, q2 = q2, cids = cids, solid = solid, writable = writable,
      target = target, target_p2 = target_p2, extras = chunk.extras}
  end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  -- G2: every cell this batch modifies (content, param2 or cleared extras) is
  -- asked core.is_protected for the empty name, as region.lua does.
  if type(core.is_protected) ~= 'function' then return nil, 'CAPABILITY_UNAVAILABLE' end
  local function refused(x, y, z)
    local ok, yes = pcall(core.is_protected, {x = x, y = y, z = z}, '')
    if not ok then return 'TARGET_FACTS_INCOMPLETE' end
    if yes then return 'SAFETY_INVARIANT_FAILED' end
  end
  local changed, clears, sets = 0, {}, {}
  for _, plan in ipairs(plans) do
    local q1, q2, j = plan.q1, plan.q2, 0
    for z = q1.z, q2.z do
      for y = q1.y, q2.y do
        local i = area:index(q1.x, y, z)
        for x = q1.x, q2.x do
          j = j + 1
          local k = plan.target[j]
          if k ~= -1 then
            local key = x .. ',' .. y .. ',' .. z
            if data[i] ~= plan.cids[k] or p2data[i] ~= plan.target_p2[j] then
              if not plan.writable[k] then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
              if plan.solid[k] then
                for _, b in ipairs(body_list) do
                  if x - 0.5 < b.hi[1] and b.lo[1] < x + 0.5 and y - 0.5 < b.hi[2] and b.lo[2] < y + 0.5
                    and z - 0.5 < b.hi[3] and b.lo[3] < z + 0.5 then return nil, 'SAFETY_INVARIANT_FAILED', 'BODY_OCCUPIED' end
                end
              end
              local denied = refused(x, y, z)
              if denied then return nil, denied, denied == 'SAFETY_INVARIANT_FAILED' and 'PROTECTED_CELL' or nil end
              changed = changed + 1
              if not args.checkOnly then data[i] = plan.cids[k]; p2data[i] = plan.target_p2[j] end
            elseif extras[key] then
              local denied = refused(x, y, z)
              if denied then return nil, denied, denied == 'SAFETY_INVARIANT_FAILED' and 'PROTECTED_CELL' or nil end
            end
            -- A specified cell loses its extras (APPLY) or gets exactly the
            -- restored ones (RESTORE, below).
            if extras[key] then clears[#clears + 1] = {x = x, y = y, z = z} end
          end
          i = i + 1
        end
      end
    end
    if restore then
      if type(plan.extras) ~= 'table' then return nil, 'SCHEMA_INVALID' end
      for _, e in ipairs(plan.extras) do
        local q = type(e.position) == 'table' and {x = e.position[1], y = e.position[2], z = e.position[3]}
        if not q or not within(q, {min = {q1.x, q1.y, q1.z}, max = {q2.x, q2.y, q2.z}})
          or type(e.metadata) ~= 'table' or type(e.inventory) ~= 'table' then return nil, 'SCHEMA_INVALID' end
        sets[#sets + 1] = {pos = q, metadata = e.metadata, inventory = e.inventory, timer = e.timer}
      end
    end
  end
  -- A check-only call proves every precondition of the batch without writing.
  if args.checkOnly then return {written = false, checked = true, changedCells = changed} end
  vm:set_data(data)
  vm:set_param2_data(p2data)
  vm:write_to_map(true)
  -- Extras are per-position engine state; only stateful cells are touched.
  for _, pos in ipairs(clears) do
    core.get_meta(pos):from_table(nil)
    core.get_node_timer(pos):stop()
  end
  for _, s in ipairs(sets) do
    local fields = {}
    for k, v in pairs(s.metadata) do fields[k] = v end
    local inventory = {}
    for k, v in pairs(s.inventory) do inventory[k] = v end
    if next(fields) ~= nil or next(inventory) ~= nil then
      core.get_meta(s.pos):from_table({fields = fields, inventory = inventory})
    end
    if type(s.timer) == 'table' then core.get_node_timer(s.pos):set(s.timer.timeout, s.timer.elapsed) end
  end
  local b1 = {x = floor_block(p1.x) * BLOCK, y = floor_block(p1.y) * BLOCK, z = floor_block(p1.z) * BLOCK}
  local b2 = {x = floor_block(p2.x) * BLOCK + BLOCK - 1, y = floor_block(p2.y) * BLOCK + BLOCK - 1,
    z = floor_block(p2.z) * BLOCK + BLOCK - 1}
  local light = core.fix_light(b1, b2) == true
  return {written = true, changedCells = changed, extrasCleared = #clears, extrasSet = #sets,
    lightComplete = light, lightBox = {min = {b1.x, b1.y, b1.z}, max = {b2.x, b2.y, b2.z}}}
end

M.BLOCK = BLOCK
return M
