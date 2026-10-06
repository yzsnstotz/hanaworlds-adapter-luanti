-- Region I/O over Luanti's own bulk primitives: emerge_area (load/generate),
-- VoxelManip read_from_map/set_data/write_to_map(light) and fix_light. One
-- command handles one mapblock-aligned batch box inside a single server step.
-- No transaction decision is made here: the caller (Canvas, via the host)
-- supplies the expected per-block digests and owns rollback.
local M = {}

local BLOCK = 16
local DIGEST_FORMAT = 'hw-region-cells/1'

local forbidden_callbacks = {
  'on_construct', 'on_destruct', 'after_destruct', 'after_place_node',
  'on_timer', 'on_metadata_inventory_move', 'on_metadata_inventory_put',
  'on_metadata_inventory_take', 'allow_metadata_inventory_move',
  'allow_metadata_inventory_put', 'allow_metadata_inventory_take',
}

local function int(n) return type(n) == 'number' and n == math.floor(n) and math.abs(n) <= 31000 end
local function box(minp, maxp)
  if type(minp) ~= 'table' or type(maxp) ~= 'table' or #minp ~= 3 or #maxp ~= 3 then return nil end
  for i = 1, 3 do
    if not int(minp[i]) or not int(maxp[i]) or minp[i] > maxp[i] then return nil end
  end
  return {x = minp[1], y = minp[2], z = minp[3]}, {x = maxp[1], y = maxp[2], z = maxp[3]}
end
local function floor_block(n) return math.floor(n / BLOCK) end

-- Per-block sub-boxes of a batch box, in block z,y,x order.
local function sub_boxes(p1, p2)
  local out = {}
  for bz = floor_block(p1.z), floor_block(p2.z) do
    for by = floor_block(p1.y), floor_block(p2.y) do
      for bx = floor_block(p1.x), floor_block(p2.x) do
        out[#out + 1] = {block = {bx, by, bz},
          min = {math.max(p1.x, bx * BLOCK), math.max(p1.y, by * BLOCK), math.max(p1.z, bz * BLOCK)},
          max = {math.min(p2.x, bx * BLOCK + BLOCK - 1), math.min(p2.y, by * BLOCK + BLOCK - 1),
            math.min(p2.z, bz * BLOCK + BLOCK - 1)}}
      end
    end
  end
  return out
end

local function new_names(core)
  local names, ids = {}, {}
  return function(cid)
    local name = names[cid]
    if name == nil then name = core.get_name_from_content_id(cid); names[cid] = name end
    return name
  end, ids
end

-- Digest of one block sub-box: same canonical text as src/region-voxels.mjs.
-- Returns nil and the count of 'ignore' cells when any cell is not loaded.
local function block_digest(core, area, data, p2data, name_of, sb)
  local parts = {DIGEST_FORMAT, table.concat(sb.min, ','), table.concat(sb.max, ',')}
  local ignore = 0
  for z = sb.min[3], sb.max[3] do
    for y = sb.min[2], sb.max[2] do
      local i = area:index(sb.min[1], y, z)
      for _ = sb.min[1], sb.max[1] do
        local name = name_of(data[i])
        if name == 'ignore' then ignore = ignore + 1 end
        parts[#parts + 1] = name .. '\t' .. p2data[i]
        i = i + 1
      end
    end
  end
  if ignore > 0 then return nil, ignore end
  return core.sha256(table.concat(parts, '\n') .. '\n'), 0
end

-- Run-length encode a box of the flat arrays in x-fastest, then y, then z order.
local function encode(area, data, p2data, p1, p2, name_of)
  local palette, index, content, param2 = {}, {}, {}, {}
  local last_c, count_c, last_p, count_p = nil, 0, nil, 0
  local ignore = 0
  for z = p1.z, p2.z do
    for y = p1.y, p2.y do
      local i = area:index(p1.x, y, z)
      for _ = p1.x, p2.x do
        local name = name_of(data[i])
        if name == 'ignore' then ignore = ignore + 1 end
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
  return palette, content, param2, ignore
end

local function read_vm(core, p1, p2)
  local vm = core.get_voxel_manip()
  local e1, e2 = vm:read_from_map(p1, p2)
  local area = VoxelArea(e1, e2)
  return vm, area, vm:get_data(), vm:get_param2_data(), vm:get_light_data()
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
  return {mapblockSize = BLOCK, maxBodyBytes = body_bytes, registeredNodes = count,
    longestNodeName = longest, digestFormat = DIGEST_FORMAT}
end

-- Asynchronous: the courier replies once the engine reported every block.
function M.emerge(core, minp, maxp)
  local p1, p2 = box(minp, maxp)
  if not p1 then return nil, 'SCHEMA_INVALID' end
  local names = {
    [core.EMERGE_GENERATED] = 'GENERATED', [core.EMERGE_FROM_MEMORY] = 'FROM_MEMORY',
    [core.EMERGE_FROM_DISK] = 'FROM_DISK', [core.EMERGE_CANCELLED] = 'CANCELLED',
    [core.EMERGE_ERRORED] = 'ERRORED',
  }
  return {defer = function(done)
    local blocks = {}
    core.emerge_area(p1, p2, function(blockpos, action, remaining)
      blocks[#blocks + 1] = {blockPos = {blockpos.x, blockpos.y, blockpos.z},
        action = names[action] or 'ERRORED'}
      if remaining == 0 then done({blocks = blocks}) end
    end)
  end}
end

local function meta_count(core, p1, p2)
  local found = core.find_nodes_with_meta(p1, p2)
  return type(found) == 'table' and #found or nil, found
end

function M.read(core, minp, maxp)
  local p1, p2 = box(minp, maxp)
  if not p1 then return nil, 'SCHEMA_INVALID' end
  local _, area, data, p2data = read_vm(core, p1, p2)
  local name_of = new_names(core)
  local palette, content, param2, ignore = encode(area, data, p2data, p1, p2, name_of)
  local blocks = {}
  for _, sb in ipairs(sub_boxes(p1, p2)) do
    local digest, unknown = block_digest(core, area, data, p2data, name_of, sb)
    blocks[#blocks + 1] = {blockPos = sb.block, min = sb.min, max = sb.max,
      digest = digest, ignoreCells = unknown}
  end
  local metas = meta_count(core, p1, p2)
  return {min = minp, max = maxp, palette = palette, contentRuns = content,
    param2Runs = param2, ignoreCells = ignore, metadataCells = metas, blocks = blocks}
end

local function static_def(core, name)
  local def = core.registered_nodes[name]
  if type(def) ~= 'table' then return false end
  for _, callback in ipairs(forbidden_callbacks) do
    if def[callback] then return false end
  end
  if def.liquidtype ~= nil and def.liquidtype ~= 'none' then return false end
  return true
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

-- args: min,max (batch box), palette (node names), contentRuns
-- ([paletteIndex|-1, count]...; -1 = unspecified, keep), param2Runs, expected
-- ({min,max,digest} per block sub-box), checkOnly. Returns facts or an error.
function M.write(core, args)
  local p1, p2 = box(args.min, args.max)
  if not p1 or type(args.palette) ~= 'table' or type(args.contentRuns) ~= 'table'
    or type(args.param2Runs) ~= 'table' or type(args.expected) ~= 'table' then
    return nil, 'SCHEMA_INVALID'
  end
  local cids, solid, writable = {}, {}, {}
  for k, name in ipairs(args.palette) do
    if type(name) ~= 'string' or type(core.registered_nodes[name]) ~= 'table' then
      return nil, 'UNSUPPORTED_MUTATION_SEMANTICS'
    end
    cids[k - 1] = core.get_content_id(name)
    solid[k - 1] = name ~= 'air'
    writable[k - 1] = static_def(core, name)
  end
  local volume = (p2.x - p1.x + 1) * (p2.y - p1.y + 1) * (p2.z - p1.z + 1)
  -- Expand runs once into per-cell targets (only this batch box is in memory).
  local target, target_p2 = {}, {}
  local n = 0
  for r = 1, #args.contentRuns, 2 do
    local k, c = args.contentRuns[r], args.contentRuns[r + 1]
    if type(k) ~= 'number' or type(c) ~= 'number' or c < 1 or c ~= math.floor(c)
      or (k ~= -1 and cids[k] == nil) then return nil, 'SCHEMA_INVALID' end
    for _ = 1, c do n = n + 1; target[n] = k end
  end
  if n ~= volume then return nil, 'SCHEMA_INVALID' end
  n = 0
  for r = 1, #args.param2Runs, 2 do
    local v, c = args.param2Runs[r], args.param2Runs[r + 1]
    if type(v) ~= 'number' or v < 0 or v > 255 or v ~= math.floor(v)
      or type(c) ~= 'number' or c < 1 or c ~= math.floor(c) then return nil, 'SCHEMA_INVALID' end
    for _ = 1, c do n = n + 1; target_p2[n] = v end
  end
  if n ~= volume then return nil, 'SCHEMA_INVALID' end

  local vm, area, data, p2data = read_vm(core, p1, p2)
  local name_of = new_names(core)
  -- 1. Every cell of the batch box must be known (loaded, not ignore).
  local _, _, _, ignore = encode(area, data, p2data, p1, p2, name_of)
  if ignore > 0 then return nil, 'TARGET_FACTS_INCOMPLETE' end
  -- 2. The caller's expected before-digests must match per block sub-box.
  local boxes = sub_boxes(p1, p2)
  if #args.expected ~= #boxes then return nil, 'SCHEMA_INVALID' end
  for i, sb in ipairs(boxes) do
    local e = args.expected[i]
    if type(e) ~= 'table' or table.concat(e.min or {}, ',') ~= table.concat(sb.min, ',')
      or table.concat(e.max or {}, ',') ~= table.concat(sb.max, ',') then return nil, 'SCHEMA_INVALID' end
    if block_digest(core, area, data, p2data, name_of, sb) ~= e.digest then
      return nil, 'TRANSACTION_CONFLICT'
    end
  end
  -- 3. Only cells whose node or param2 actually changes are mutated. Those
  -- must be stateless static non-liquid nodes (current and target), and no
  -- solid may be placed into a player body. Unchanged cells (for example an
  -- unchanged chest inside a restored snapshot) are rewritten bit-identically
  -- by write_to_map, whose node blit leaves node metadata untouched.
  local _, metas = meta_count(core, p1, p2)
  if type(metas) ~= 'table' then return nil, 'CAPABILITY_UNAVAILABLE' end
  local sx, sy = p2.x - p1.x + 1, p2.y - p1.y + 1
  local function offset(x, y, z) return ((z - p1.z) * sy + (y - p1.y)) * sx + (x - p1.x) + 1 end
  local has_meta = {}
  for _, pos in ipairs(metas) do has_meta[offset(pos.x, pos.y, pos.z)] = true end
  local changes = {}
  local static_cache = {}
  local changed, j = 0, 0
  for z = p1.z, p2.z do
    for y = p1.y, p2.y do
      local i = area:index(p1.x, y, z)
      for _ = p1.x, p2.x do
        j = j + 1
        local k = target[j]
        if k ~= -1 and (data[i] ~= cids[k] or p2data[i] ~= target_p2[j]) then
          local cid = data[i]
          if static_cache[cid] == nil then static_cache[cid] = static_def(core, name_of(cid)) end
          if not static_cache[cid] or not writable[k] or has_meta[j] then
            return nil, 'UNSUPPORTED_MUTATION_SEMANTICS'
          end
          changed = changed + 1
          changes[j] = true
          if not args.checkOnly then data[i] = cids[k]; p2data[i] = target_p2[j] end
        end
        i = i + 1
      end
    end
  end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  for _, b in ipairs(body_list) do
    for x = math.max(p1.x, math.floor(b.lo[1] + 0.5)), math.min(p2.x, math.ceil(b.hi[1] - 0.5)) do
      for y = math.max(p1.y, math.floor(b.lo[2] + 0.5)), math.min(p2.y, math.ceil(b.hi[2] - 0.5)) do
        for z = math.max(p1.z, math.floor(b.lo[3] + 0.5)), math.min(p2.z, math.ceil(b.hi[3] - 0.5)) do
          local o = offset(x, y, z)
          if changes[o] and solid[target[o]] then return nil, 'SAFETY_INVARIANT_FAILED' end
        end
      end
    end
  end
  -- A check-only call proves every precondition of this batch without writing.
  if args.checkOnly then return {written = false, checked = true, changedCells = changed} end
  -- 4. Bulk write with engine lighting, then confirm the light repair.
  vm:set_data(data)
  vm:set_param2_data(p2data)
  vm:write_to_map(true)
  local b1 = {x = floor_block(p1.x) * BLOCK, y = floor_block(p1.y) * BLOCK, z = floor_block(p1.z) * BLOCK}
  local b2 = {x = floor_block(p2.x) * BLOCK + BLOCK - 1, y = floor_block(p2.y) * BLOCK + BLOCK - 1,
    z = floor_block(p2.z) * BLOCK + BLOCK - 1}
  local light = core.fix_light(b1, b2) == true
  -- 5. Read back from the map: specified cells equal targets, others unchanged.
  local _, area2, after, after_p2, after_light = read_vm(core, p1, p2)
  local matches, kept = true, true
  j = 0
  local light_parts = {}
  for z = p1.z, p2.z do
    for y = p1.y, p2.y do
      local i = area2:index(p1.x, y, z)
      local i0 = area:index(p1.x, y, z)
      for _ = p1.x, p2.x do
        j = j + 1
        local k = target[j]
        if k ~= -1 then
          if after[i] ~= cids[k] or after_p2[i] ~= target_p2[j] then matches = false end
        elseif after[i] ~= data[i0] or after_p2[i] ~= p2data[i0] then kept = false end
        light_parts[#light_parts + 1] = after_light[i]
        i = i + 1; i0 = i0 + 1
      end
    end
  end
  local after_blocks = {}
  for _, sb in ipairs(boxes) do
    after_blocks[#after_blocks + 1] = {blockPos = sb.block, min = sb.min, max = sb.max,
      digest = block_digest(core, area2, after, after_p2, name_of, sb)}
  end
  return {written = true, changedCells = changed, readbackMatches = matches,
    unspecifiedKept = kept, lightComplete = light,
    lightDigest = core.sha256(table.concat(light_parts, ',')), blocks = after_blocks}
end

M.BLOCK = BLOCK
M.DIGEST_FORMAT = DIGEST_FORMAT
return M
