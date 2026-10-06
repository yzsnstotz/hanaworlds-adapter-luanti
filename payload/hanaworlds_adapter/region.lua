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
          local rows, occupied = {}, {}, {}
          local all = {}
          for _, p in ipairs(cells) do all[#all + 1] = p end
          for _, p in ipairs(support) do all[#all + 1] = p end
          for _, p in ipairs(all) do
            local cs = state(p)
            rows[#rows + 1] = '{"position":' .. pos_json(p) .. ',"state":' .. quote(cs.kind)
              .. (cs.kind == 'OCCUPIED' and (',"nodeName":' .. quote(cs.nodeName)
                .. ',"param2":' .. int(cs.param2)) or '') .. '}'
            if body_at(body_list, p) then occupied[#occupied + 1] = p end
          end
          return '{"kind":"REGION","cells":[' .. table.concat(rows, ',') .. ']'
            .. ',"body":' .. list(occupied, pos_json)
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

-- Recheck actual body geometry immediately before the native write.
function Region:prepare_check(positions)
  local core = self.core
  if type(positions) ~= 'table' or #positions == 0 then return nil, 'SCHEMA_INVALID' end
  for _, p in ipairs(positions) do
    if type(p) ~= 'table' or #p ~= 3 then return nil, 'SCHEMA_INVALID' end
  end
  local body_list = bodies(core)
  if not body_list then return nil, 'TARGET_FACTS_INCOMPLETE' end
  for _, p in ipairs(positions) do
    if body_at(body_list, p) then return nil, 'SAFETY_INVARIANT_FAILED' end
  end
  return {checked = #positions}
end

M.pos_json = pos_json
M.quote = quote
return M
