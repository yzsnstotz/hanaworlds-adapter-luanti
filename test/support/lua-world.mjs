// Runs the shipped payload region.lua under the local `lua` interpreter
// against a synthetic engine world (FIXTURE). This exercises the real search
// code; the engine API itself is a test double.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function toLua(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite');
    return Number.isInteger(value) ? String(value) : value.toPrecision(17);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `{${value.map(toLua).join(',')}}`;
  return `{${Object.entries(value).filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `[${JSON.stringify(k)}]=${toLua(v)}`).join(',')}}`;
}

const harness = `
local world, online, call = ...
local function in_box(p, b)
  return b.min[1] <= p[1] and p[1] <= b.max[1] and b.min[2] <= p[2] and p[2] <= b.max[2]
    and b.min[3] <= p[3] and p[3] <= b.max[3]
end
local is_online = {}
for _, n in ipairs(online) do is_online[n] = true end
local function object(pl)
  return {
    get_player_name = function() return pl.name end,
    get_pos = function() return {x = pl.pos[1], y = pl.pos[2], z = pl.pos[3]} end,
    get_look_horizontal = function() return pl.yaw end,
    get_properties = function() return {collisionbox = pl.collisionbox} end,
  }
end
local core = {registered_nodes = {['fixture:stone'] = {}, ['fixture:grass'] = {}, air = {}}}
function core.get_connected_players()
  local out = {}
  for _, pl in ipairs(world.players or {}) do if is_online[pl.name] then out[#out + 1] = object(pl) end end
  return out
end
function core.get_player_by_name(name)
  for _, pl in ipairs(world.players or {}) do
    if pl.name == name and is_online[name] then return object(pl) end
  end
  return nil
end
function core.get_node_or_nil(pos)
  local p = {pos.x, pos.y, pos.z}
  local state = p[2] <= 0 and {kind = 'OCCUPIED', nodeName = 'fixture:stone'} or {kind = 'AIR'}
  for _, o in ipairs(world.overrides or {}) do if in_box(p, o) then state = o.state end end
  if state.kind == 'UNKNOWN' then return nil end
  if state.kind == 'AIR' then return {name = 'air', param1 = 0, param2 = 0} end
  return {name = state.nodeName, param1 = 0, param2 = 0}
end
function core.is_protected(pos, name)
  local p = {pos.x, pos.y, pos.z}
  for _, b in ipairs(world.protected or {}) do
    if b.principal == name and in_box(p, b) then return true end
  end
  return false
end
local region = dofile(${JSON.stringify(root + 'payload/hanaworlds_adapter/region.lua')}).new({
  core = core, state_path = '/nonexistent-hanaworlds-test/state.json'})
for _, r in ipairs(world.relayRecords or {}) do
  region.relays[r.invocationId] = {sessionRef = r.sessionRef, worldRef = r.worldRef,
    engineActorName = r.engineActorName}
end
for _, p in ipairs(world.picks or {}) do
  region.picks[p.pickRef] = {sessionRef = p.sessionRef, worldRef = p.worldRef,
    picker = p.picker, node = p.node, pickerYaw = p.pickerYaw}
end
if world.unreadable then region.readable = false end
local result, code
if call.op == 'inspect' then result, code = region:inspect(call.args)
else
  result, code = region:prepare_check(call.actorName, call.positions)
  if result then result = '{"checked":' .. result.checked .. '}' end
end
io.write(result and ('OK ' .. result) or ('ERR ' .. tostring(code)))
`;

function run(world, online, call) {
  const script = `return (function(...)${harness}\nend)(${toLua(world)}, ${toLua(online)}, ${toLua(call)})`;
  const out = execFileSync('lua', ['-e', script], { cwd: root, encoding: 'utf8' });
  if (out.startsWith('OK ')) return JSON.parse(out.slice(3));
  if (out.startsWith('ERR ')) throw new Error(out.slice(4));
  throw new Error(`unexpected harness output ${out}`);
}

/** Engine double for V4TransactionBackend: search and recheck run in Lua. */
export function luaEngine(world, online, extra = {}) {
  return {
    inspectRegion: async (args, binding) => run(world, online, { op: 'inspect',
      args: { ...args, actorName: binding.engineActorName } }),
    prepareCheck: async (positions, binding) => run(world, online, { op: 'prepare_check',
      actorName: binding.engineActorName, positions }),
    ...extra,
  };
}
