local queued, posted, calls, presented = {}, {}, 0, {}
local commands = {
  {id = 'one', worldRef = 'luanti:test', operation = 'authorize', actorName = 'alice'},
  {id = 'two', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    grantRef = 'grant:one', positions = {{0, 0, 0}}},
  {id = 'three', worldRef = 'luanti:test', operation = 'authorize', actorName = 'alice'},
  {id = 'four', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    grantRef = 'grant:one', positions = {{0, 0, 0}}},
  {id = 'five', worldRef = 'luanti:test', operation = 'present_frame', actorName = 'alice',
    engineActorName = 'bob', grantRef = 'grant:one', frame = {}},
  {id = 'six', worldRef = 'luanti:test', operation = 'present_frame',
    engineActorName = 'alice', grantRef = 'grant:one', frame = {}},
  {id = 'seven', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'bob',
    engineActorName = 'alice', grantRef = 'grant:one', positions = {{0, 0, 0}}},
  {id = 'eight', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    grantRef = 'grant:one', positions = {{0, 0, 0}}},
  {id = 'nine', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    grantRef = 'grant:two', positions = {{0, 0, 0}}},
  {id = 'ten', worldRef = 'luanti:test', operation = 'list_grants'},
}
local granted, current_grant = false, 'grant:one'
local function json(v)
  if type(v) == 'string' then return string.format('%q', v) end
  if type(v) == 'boolean' then return tostring(v) end
  if type(v) == 'table' then
    local out = {}
    for key, value in pairs(v) do out[#out + 1] = json(key) .. ':' .. json(value) end
    return '{' .. table.concat(out, ',') .. '}'
  end
  return 'null'
end
_G.minetest = {
  parse_json = function(raw) return raw end,
  write_json = json,
  after = function(_, fn) queued[#queued + 1] = fn end,
  log = function() end,
}
local http = {fetch = function(request, callback)
  if request.url:match('/poll$') then
    callback({succeeded = true, code = 200, data = {worldRef = 'luanti:test',
      command = table.remove(commands, 1)}})
  elseif request.url:match('/result$') then
    posted[#posted + 1] = request.data
    callback({succeeded = true, code = 200})
  end
end}
local engine = {new = function()
  return {snapshot = function()
    calls = calls + 1
    return {worldRef = 'luanti:test', records = {}, coveredPositions = {}}
  end}
end}
local grants = {verify = function(_, name)
  if granted and name == 'alice' then return {current = true,
    worldRef = 'luanti:test', engineActorName = name,
    scope = 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef = current_grant} end
  return {current = false}
end, list_current = function(self)
  local proof = self:verify('alice')
  return proof.current and {proof} or {}
end}
local started = dofile('payload/hanaworlds_adapter/transport.lua').start(http, engine,
  {worldRef = 'luanti:test'}, function()
    return {worldRef = 'luanti:test', port = 30000, token = string.rep('a', 64)}
  end, function() end, function() return {worldeditAvailable = true} end,
  function(name)
    presented[#presented + 1] = name
    return true
  end, {}, grants)
assert(started)
for i = 1, 2 do table.remove(queued, 1)() end
assert(posted[1]:find('"current":false', 1, true), 'unconfirmed authorize denied')
assert(posted[2]:find('"PERMISSION_DENIED"', 1, true), 'unconfirmed command denied')
assert(calls == 0, 'engine was not called before confirmation')
granted = true
for i = 3, 4 do table.remove(queued, 1)() end
assert(posted[3]:find('"grantRef":"grant:one"', 1, true),
  'trusted courier returns native grant identity')
assert(calls == 1, 'engine command runs only after grant')
for i = 5, 7 do table.remove(queued, 1)() end
assert(posted[5]:find('"PERMISSION_DENIED"', 1, true),
  'Alice grant cannot authorize a frame actually presented to Bob')
assert(#presented == 1 and presented[1] == 'alice',
  'only the exact engine actor may receive a verified frame')
assert(posted[7]:find('"PERMISSION_DENIED"', 1, true),
  'an unrelated engineActorName cannot authorize a Bob snapshot')
assert(calls == 1, 'mismatched actor fields cannot reach the engine')
current_grant = 'grant:two'
for i = 8, 9 do table.remove(queued, 1)() end
assert(posted[8]:find('"PERMISSION_DENIED"', 1, true),
  'an old grant reference cannot borrow a renewed native grant')
assert(calls == 2 and posted[9]:find('"records"', 1, true),
  'only a command carrying the current native grant reaches the engine')
table.remove(queued, 1)()
assert(posted[10]:find('"grants":%[', 1) and posted[10]:find('"grantRef":"grant:two"', 1, true),
  'list reads only the current native proof over the paired courier')
commands[#commands + 1] = {id = 'eleven', worldRef = 'luanti:test', operation = 'list_grants'}
grants.list_current = nil
table.remove(queued, 1)()
assert(posted[11]:find('"CAPABILITY_UNAVAILABLE"', 1, true),
  'missing native grant listing cannot appear as zero candidates')
commands[#commands + 1] = {id = 'twelve', worldRef = 'luanti:test', operation = 'list_grants'}
local without_grants = dofile('payload/hanaworlds_adapter/transport.lua').start(http, engine,
  {worldRef = 'luanti:test'}, function()
    return {worldRef = 'luanti:test', port = 30000, token = string.rep('a', 64)}
  end, function() end, function() return {worldeditAvailable = true} end,
  function() return true end, {}, nil)
assert(without_grants)
table.remove(queued, #queued)()
assert(posted[12]:find('"CAPABILITY_UNAVAILABLE"', 1, true),
  'missing grant initializer cannot appear as zero candidates')
print('transport grant fixture PASS')
