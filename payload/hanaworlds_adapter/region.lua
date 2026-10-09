-- Local-world placement and body geometry. No account or permission source.
local M = {}
local Region = {}
Region.__index = Region

local STATE_FORMAT = 'hanaworlds-adapter-local-picks/1'
local AXES = {
  {name = '+Z', v = {0, 0, 1}}, {name = '-X', v = {-1, 0, 0}},
  {name = '-Z', v = {0, 0, -1}}, {name = '+X', v = {1, 0, 0}},
}
local RIGHT = {{1, 0, 0}, {0, 0, 1}, {-1, 0, 0}, {0, 0, -1}}
local ENTRANCE = {'-Z', '+X', '+Z', '-X'}

-- JSON helpers. Luanti's write_json turns every empty table into null, so
-- public replies are written explicitly.
local function quote(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == '\\' then return '\\\\' end
    return string.format('\\u%04x', c:byte())
  end) .. '"'
end
local function int(n) return string.format('%d', n) end
local function list(items, encode)
  local out = {}
  for i, item in ipairs(items) do out[i] = encode(item) end
  return '[' .. table.concat(out, ',') .. ']'
end
local function pos_json(p) return '[' .. int(p[1]) .. ',' .. int(p[2]) .. ',' .. int(p[3]) .. ']' end

-- Frozen facing rule (CONTRACT_RULES first-building-region-v4 "Facing").
function M.facing(yaw)
  if type(yaw) ~= 'number' or yaw ~= yaw or yaw == math.huge or yaw == -math.huge then return nil, 'INVALID' end
  local two = 2 * math.pi
  local y = yaw - two * math.floor(yaw / two)
  local q = y / (math.pi / 2)
  if q - math.floor(q) == 0.5 then return nil, 'TIE' end
  return math.floor(q + 0.5) % 4
end

local function add(a, b, k)
  return {a[1] + k * b[1], a[2] + k * b[2], a[3] + k * b[3]}
end
local function vec(p) return {x = p[1], y = p[2], z = p[3]} end
local function key(p) return p[1] .. ',' .. p[2] .. ',' .. p[3] end
local function lateral(n)
  local out = {0}
  for i = 1, n do out[#out + 1] = i; out[#out + 1] = -i end
  return out
end
local function vertical(n)
  local out = {0}
  for i = 1, n do out[#out + 1] = -i; out[#out + 1] = i end
  return out
end

function M.new(deps)
  local self = setmetatable({core = deps.core, path = deps.state_path,
    picks = {}, readable = false}, Region)
  self:load()
  return self
end

function Region:load()
  local core = self.core
  if type(self.path) ~= 'string' then self.readable = false; return end
  local file = io.open(self.path, 'rb')
  if not file then self.readable = true; return end -- no record yet
  local raw = file:read('*a')
  file:close()
  local ok, decoded = pcall(core.parse_json, raw)
  if not ok or type(decoded) ~= 'table' or decoded.format ~= STATE_FORMAT then
    self.readable = false
    return
  end
  self.picks = type(decoded.picks) == 'table' and decoded.picks or {}
  self.readable = true
end

function Region:persist()
  if not self.readable then return false end
  local ok, encoded = pcall(self.core.write_json, {format = STATE_FORMAT,
    picks = self.picks})
  if not ok or type(encoded) ~= 'string' then return false end
  return self.core.safe_file_write(self.path, encoded) == true
end

-- Private local pick geometry, bound to the issuing session and world.
function Region:record_pick(pick_ref, session_ref, world_ref, node, yaw)
  if not self.readable or self.picks[pick_ref] or type(yaw) ~= 'number' then return false end
  self.picks[pick_ref] = {sessionRef = session_ref, worldRef = world_ref,
    node = {node[1], node[2], node[3]}, pickerYaw = yaw}
  if self:persist() then return true end
  self.picks[pick_ref] = nil
  return false
end

local function cell_state(core, p)
  local ok, node = pcall(core.get_node_or_nil, vec(p))
  if not ok then return {kind = 'UNKNOWN'} end
  if not node or node.name == 'ignore' then return {kind = 'UNKNOWN'} end
  if node.name == 'air' then return {kind = 'AIR'} end
  if type(node.name) == 'string' and core.registered_nodes[node.name] then
    return {kind = 'OCCUPIED', nodeName = node.name, param2 = node.param2}
  end
  return {kind = 'UNKNOWN'}
end

-- Every connected player's actual body: position plus its own collision box.
-- Nothing is assumed: an unreadable body makes the whole read fail.
local function bodies(core)
  local out = {}
  for _, player in ipairs(core.get_connected_players()) do
    local pos = player:get_pos()
    local props = player:get_properties()
    local box = props and props.collisionbox
    if type(pos) ~= 'table' or type(box) ~= 'table' then return nil end
    for i = 1, 6 do if type(box[i]) ~= 'number' then return nil end end
    out[#out + 1] = {lo = {pos.x + box[1], pos.y + box[2], pos.z + box[3]},
      hi = {pos.x + box[4], pos.y + box[5], pos.z + box[6]}}
  end
  return out
end

-- Closed cell box [p-0.5, p+0.5] against the open body box: overlap only with
-- strictly positive volume on all three axes.
local function body_at(list_of_bodies, p)
  for _, b in ipairs(list_of_bodies) do
    if p[1] - 0.5 < b.hi[1] and b.lo[1] < p[1] + 0.5
      and p[2] - 0.5 < b.hi[2] and b.lo[2] < p[2] + 0.5
      and p[3] - 0.5 < b.hi[3] and b.lo[3] < p[3] + 0.5 then return true end
  end
  return false
end

local function nonneg(n) return type(n) == 'number' and n >= 0 and n == math.floor(n) end
local function positive(n) return nonneg(n) and n >= 1 end

-- args: worldRef, sessionRef, anchor, footprint, settings,
-- walkable (nodeName -> true/false; absent or 'null' marker = unknown),
-- limitExceeded. Returns an encoded JSON reply or nil, errorCode.
function Region:inspect(args)
  local core = self.core
  local anchor, fp, st = args.anchor, args.footprint, args.settings
  if type(anchor) ~= 'table' or type(fp) ~= 'table' or type(st) ~= 'table'
    or not positive(fp.widthCells) or not positive(fp.depthCells) or not positive(fp.heightCells)
    or not nonneg(st.frontGapCells) or not nonneg(st.forwardSearchCells)
    or not nonneg(st.lateralSearchCells) or not nonneg(st.verticalSearchCells)
    or type(args.walkable) ~= 'table' then
    return nil, 'SCHEMA_INVALID'
  end
  local function choice(reason, names)
    return '{"kind":"CHOICE","reasons":[' .. quote(reason) .. '],"names":'
      .. (names and list(names, quote) or 'null') .. '}'
  end
  local anchor_cell, yaw, picked
  if anchor.kind == 'PICKED_POINT' then
    if not self.readable then return nil, 'INSPECTION_FAILED' end
    local pick = type(anchor.pickRef) == 'string' and self.picks[anchor.pickRef] or nil
    if not pick or pick.sessionRef ~= args.sessionRef or pick.worldRef ~= args.worldRef then
      return nil, 'PICK_NOT_ISSUED'
    end
    anchor_cell = {pick.node[1], pick.node[2] + 1, pick.node[3]}
    yaw, picked = pick.pickerYaw, true
  else
    if anchor.kind ~= 'CURRENT_VIEW' then return nil, 'SCHEMA_INVALID' end
    local players = core.get_connected_players()
    if #players ~= 1 then return nil, 'INSPECTION_FAILED' end
    local player = players[1]
    local pos = player and player:get_pos()
    if type(pos) ~= 'table' then return nil, 'INSPECTION_FAILED' end
    yaw = player:get_look_horizontal()
    anchor_cell = {math.floor(pos.x + 0.5), math.floor(pos.y + 0.5), math.floor(pos.z + 0.5)}
  end
  local k, why = M.facing(yaw)
  if not k then
    if why == 'TIE' then return choice('FACING_AMBIGUOUS') end
    return nil, 'INSPECTION_FAILED'
  end
  if args.limitExceeded then return nil, 'LIMIT_EXCEEDED' end
  local body_list = bodies(core)
  if not body_list then return nil, 'INSPECTION_FAILED' end
  local f, r, up = AXES[k + 1].v, RIGHT[k + 1], {0, 1, 0}
  local b_lo = -math.floor((fp.widthCells - 1) / 2)
  local b_hi = fp.widthCells - 1 + b_lo
  local a_lo = picked and 0 or st.frontGapCells + 1
  local a_hi = a_lo + fp.depthCells - 1
  local s_max = picked and 0 or st.forwardSearchCells
  local t_seq = lateral(picked and 0 or st.lateralSearchCells)
  local v_seq = vertical(picked and 0 or st.verticalSearchCells)
  local reasons, states = {}, {}
  local function state(p)
    local id = key(p)
    if not states[id] then states[id] = cell_state(core, p) end
    return states[id]
  end
  for s = 0, s_max do
    for _, t in ipairs(t_seq) do
      for _, v in ipairs(v_seq) do
        local cells, support, bad = {}, {}, {}
        for a = a_lo, a_hi do
          for b = b_lo, b_hi do
            local base = add(add(anchor_cell, f, a + s), r, b + t)
            for c = 0, fp.heightCells - 1 do cells[#cells + 1] = add(base, up, c + v) end
            support[#support + 1] = add(base, up, v - 1)
          end
        end
        for _, p in ipairs(cells) do
          local cs = state(p)
          if cs.kind == 'UNKNOWN' then bad.FRONT_AREA_UNKNOWN = true end
          if cs.kind == 'OCCUPIED' then bad.FRONT_AREA_OCCUPIED = true end
          if body_at(body_list, p) then bad.FRONT_AREA_BODY_OCCUPIED = true end
        end
        for _, p in ipairs(support) do
          local cs = state(p)
          if cs.kind == 'UNKNOWN' then bad.FRONT_AREA_UNKNOWN = true
          elseif cs.kind == 'AIR' then bad.FRONT_AREA_NO_GROUND = true
          else
            local walkable = args.walkable[cs.nodeName]
            if walkable == false then bad.FRONT_AREA_NO_GROUND = true
            elseif walkable ~= true then bad.FRONT_AREA_UNKNOWN = true end
          end
        end
        if next(bad) == nil then
          -- Chosen footprint plus support layer: every cell of the bounding box.
          -- Bodies were checked above inside the engine; no body geometry is returned.
          local rows = {}
          local all = {}
          for _, p in ipairs(cells) do all[#all + 1] = p end
          for _, p in ipairs(support) do all[#all + 1] = p end
          for _, p in ipairs(all) do
            local cs = state(p)
            rows[#rows + 1] = '{"position":' .. pos_json(p) .. ',"state":' .. quote(cs.kind)
              .. (cs.kind == 'OCCUPIED' and (',"nodeName":' .. quote(cs.nodeName)
                .. ',"param2":' .. int(cs.param2)) or '') .. '}'
          end
          return '{"kind":"REGION","cells":[' .. table.concat(rows, ',') .. ']'
            .. ',"entranceFacing":' .. quote(ENTRANCE[k + 1]) .. '}'
        end
        for reason in pairs(bad) do reasons[reason] = true end
      end
    end
  end
  local out = {}
  for reason in pairs(reasons) do out[#out + 1] = reason end
  table.sort(out)
  return '{"kind":"CHOICE","reasons":' .. list(out, quote) .. ',"names":null}'
end

-- Engine write guards. Every refusal is SAFETY_INVARIANT_FAILED plus an
-- Adapter-private detail naming the guard; no position, yaw or box leaves.
--   BODY_OCCUPIED   a written cell overlaps a connected player's real box
--   PROTECTED_CELL  core.is_protected refuses the cell (G2)
--   PLAYER_ENCLOSED the write takes away a player's way out (G3)

-- G2. The local-world courier carries no player identity, so the cell is
-- asked for the empty name: any cell some protection mod claims is refused,
-- owner or not. Per written cell; no is_area_protected sampling.
function M.protection_capable(core) return type(core.is_protected) == 'function' end
local function protection(core, positions)
  if not M.protection_capable(core) then return nil, 'CAPABILITY_UNAVAILABLE' end
  for _, p in ipairs(positions) do
    local ok, refused = pcall(core.is_protected, vec(p), '')
    if not ok then return nil, 'TARGET_FACTS_INCOMPLETE' end
    if refused then return nil, 'SAFETY_INVARIANT_FAILED', 'PROTECTED_CELL' end
  end
  return true
end

-- G3. A player is modelled by their real box: the columns it overlaps and
-- ceil(box height) cells tall. A feet cell is standable when all those cells
-- are passable (air or a registered node with walkable == false; unknown is
-- solid). From a standable cell the player may step to a horizontal
-- neighbour, step up one cell when standing on something with headroom, or
-- fall one cell. The player is out once the feet cell leaves the write's
-- bounding box grown by one cell horizontally, rises above its top or drops
-- below its bottom: beyond that the write changes nothing. The write is
-- refused only when it turns "out" into "not out" for a connected player.
local function passable(core, name)
  if name == 'air' then return true end
  local def = type(name) == 'string' and core.registered_nodes[name]
  return type(def) == 'table' and def.walkable == false
end
-- `after(p)` gives the post-write passability of a written cell (true/false), or nil for a
-- cell the write leaves alone (read from the current world).
local function escapes(core, body, box, after)
  local h = math.max(1, math.ceil(body.hi[2] - body.lo[2]))
  local function open(p)
    local planned = after and after(p)
    if planned ~= nil then return planned end
    local ok, node = pcall(core.get_node_or_nil, vec(p))
    local name = ok and node and node.name ~= 'ignore' and node.name or nil
    return name ~= nil and passable(core, name)
  end
  local function standable(f)
    for c = 0, h - 1 do if not open({f[1], f[2] + c, f[3]}) then return false end end
    return true
  end
  local function out(f)
    return f[1] < box.min[1] - 1 or f[1] > box.max[1] + 1 or f[3] < box.min[3] - 1
      or f[3] > box.max[3] + 1 or f[2] > box.max[2] + 1 or f[2] + h - 1 < box.min[2]
  end
  local fy = math.floor(body.lo[2] + 0.5)
  local queue, seen = {}, {}
  for x = math.floor(body.lo[1] - 0.5) + 1, math.ceil(body.hi[1] + 0.5) - 1 do
    for z = math.floor(body.lo[3] - 0.5) + 1, math.ceil(body.hi[3] + 0.5) - 1 do
      local f = {x, fy, z}
      if out(f) then return true end
      queue[#queue + 1] = f; seen[key(f)] = true
    end
  end
  local head = 1
  while queue[head] do
    local f = queue[head]; head = head + 1
    local below = {f[1], f[2] - 1, f[3]}
    local supported = not open(below)
    local nexts = {}
    if not supported then nexts[#nexts + 1] = below end
    for _, d in ipairs({{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) do
      nexts[#nexts + 1] = {f[1] + d[1], f[2], f[3] + d[2]}
      if supported and open({f[1], f[2] + h, f[3]}) then
        nexts[#nexts + 1] = {f[1] + d[1], f[2] + 1, f[3] + d[2]}
      end
    end
    for _, n in ipairs(nexts) do
      local id = key(n)
      if not seen[id] then
        seen[id] = true
        if standable(n) then
          if out(n) then return true end
          queue[#queue + 1] = n
        end
      end
    end
  end
  return false
end
local function enclosure(core, body_list, effects)
  local box = {min = {math.huge, math.huge, math.huge}, max = {-math.huge, -math.huge, -math.huge}}
  local after = {}
  for _, e in ipairs(effects) do
    if type(e) ~= 'table' or type(e.position) ~= 'table' or #e.position ~= 3
      or type(e.nodeName) ~= 'string' then return nil, 'SCHEMA_INVALID' end
    after[key(e.position)] = passable(core, e.nodeName)
    for i = 1, 3 do
      box.min[i] = math.min(box.min[i], e.position[i]); box.max[i] = math.max(box.max[i], e.position[i])
    end
  end
  for _, body in ipairs(body_list) do
    if escapes(core, body, box, nil) and not escapes(core, body, box, function(p) return after[key(p)] end) then
      return nil, 'SAFETY_INVARIANT_FAILED', 'PLAYER_ENCLOSED'
    end
  end
  return true
end

local function positions_ok(positions)
  if type(positions) ~= 'table' or #positions == 0 then return false end
  for _, p in ipairs(positions) do
    if type(p) ~= 'table' or #p ~= 3 then return false end
  end
  return true
end

-- Recheck actual bodies and protection immediately before the native write.
-- With effects ({position, nodeName}) the enclosure guard runs as well.
function Region:prepare_check(positions, effects)
  local core = self.core
  if not positions_ok(positions) then return nil, 'SCHEMA_INVALID' end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  for _, p in ipairs(positions) do
    if body_at(body_list, p) then return nil, 'SAFETY_INVARIANT_FAILED', 'BODY_OCCUPIED' end
  end
  local ok, code, detail = protection(core, positions)
  if not ok then return nil, code, detail end
  if effects ~= nil then
    ok, code, detail = enclosure(core, body_list, effects)
    if not ok then return nil, code, detail end
  end
  return {checked = #positions}
end

-- G1. Before restore writes anything: every cell that would receive a
-- non-air node it does not hold now must be clear of real bodies, and every
-- restored cell must pass protection.
function Region:restore_check(records)
  local core = self.core
  if type(records) ~= 'table' or #records == 0 then return nil, 'SCHEMA_INVALID' end
  local all, solid = {}, {}
  for _, r in ipairs(records) do
    if type(r) ~= 'table' or type(r.position) ~= 'table' or #r.position ~= 3
      or type(r.nodeName) ~= 'string' then return nil, 'SCHEMA_INVALID' end
    all[#all + 1] = r.position
    if r.nodeName ~= 'air' then
      local ok, node = pcall(core.get_node_or_nil, vec(r.position))
      if not ok or not node or node.name ~= r.nodeName then solid[#solid + 1] = r.position end
    end
  end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  for _, p in ipairs(solid) do
    if body_at(body_list, p) then return nil, 'SAFETY_INVARIANT_FAILED', 'BODY_OCCUPIED' end
  end
  return protection(core, all)
end

-- Whole-request G3, with compressed planned world nodes. Real player data and passability
-- remain in the engine. Unspecified cells are read fresh, including between write batches.
function Region:region_enclosure(enc)
  local core = self.core
  if type(enc) ~= 'table' or type(enc.chunks) ~= 'table' or #enc.chunks == 0 then return nil, 'SCHEMA_INVALID' end
  local grids, box = {}, {min = {math.huge, math.huge, math.huge}, max = {-math.huge, -math.huge, -math.huge}}
  for _, c in ipairs(enc.chunks) do
    if type(c.min) ~= 'table' or type(c.max) ~= 'table' or #c.min ~= 3 or #c.max ~= 3
      or type(c.palette) ~= 'table' or type(c.contentRuns) ~= 'table' or #c.contentRuns % 2 ~= 0 then return nil, 'SCHEMA_INVALID' end
    local size, volume = {}, 1
    for i = 1, 3 do
      if type(c.min[i]) ~= 'number' or type(c.max[i]) ~= 'number' or c.min[i] ~= math.floor(c.min[i])
        or c.max[i] ~= math.floor(c.max[i]) or c.min[i] > c.max[i] then return nil, 'SCHEMA_INVALID' end
      size[i] = c.max[i] - c.min[i] + 1; volume = volume * size[i]
    end
    local cells, n = {}, 0
    for r = 1, #c.contentRuns, 2 do
      local k, count = c.contentRuns[r], c.contentRuns[r + 1]
      if type(k) ~= 'number' or k ~= math.floor(k) or (k ~= -1 and type(c.palette[k + 1]) ~= 'string')
        or type(count) ~= 'number' or count ~= math.floor(count) or count < 1 or n + count > volume then return nil, 'SCHEMA_INVALID' end
      if k ~= -1 and type(core.registered_nodes[c.palette[k + 1]]) ~= 'table' then return nil, 'UNSUPPORTED_MUTATION_SEMANTICS' end
      for _ = 1, count do n = n + 1; cells[n] = k end
    end
    if n ~= volume then return nil, 'SCHEMA_INVALID' end
    grids[#grids + 1] = {min = c.min, max = c.max, size = size, cells = cells, palette = c.palette}
    for i = 1, 3 do box.min[i] = math.min(box.min[i], c.min[i]); box.max[i] = math.max(box.max[i], c.max[i]) end
  end
  local function after(p)
    for _, g in ipairs(grids) do
      if p[1] >= g.min[1] and p[1] <= g.max[1] and p[2] >= g.min[2] and p[2] <= g.max[2]
        and p[3] >= g.min[3] and p[3] <= g.max[3] then
        local k = g.cells[(p[1] - g.min[1]) + (p[2] - g.min[2]) * g.size[1] + (p[3] - g.min[3]) * g.size[1] * g.size[2] + 1]
        if k ~= -1 then return passable(core, g.palette[k + 1]) end
      end
    end
  end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  for _, body in ipairs(body_list) do
    if escapes(core, body, box, nil) and not escapes(core, body, box, after) then
      return nil, 'SAFETY_INVARIANT_FAILED', 'PLAYER_ENCLOSED'
    end
  end
  return true
end

-- What this payload actually enforces, per guard, as the courier operations
-- that run it. A guard the engine cannot run is false, never an empty list.
function M.guards(core)
  return {
    -- Real bodies vs written solid cells: prepare_check (also run before apply and
    -- apply_state), restore_check (G1) and voxel.write for APPLY and RESTORE.
    bodyClearance = {'prepare_check', 'apply', 'apply_state', 'restore', 'region_write'},
    perCellProtection = M.protection_capable(core)
      and {'prepare_check', 'apply', 'apply_state', 'restore', 'region_write'} or false,
    playerEnclosure = {'prepare_check', 'apply', 'apply_state', 'region_write'},
  }
end

M.pos_json = pos_json
M.quote = quote
return M
