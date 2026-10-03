local queued, posted, calls = {}, {}, 0
local commands = {
  {id = 'one', worldRef = 'luanti:test', operation = 'authorize', actorName = 'alice'},
  {id = 'two', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    positions = {{0, 0, 0}}},
  {id = 'three', worldRef = 'luanti:test', operation = 'authorize', actorName = 'alice'},
  {id = 'four', worldRef = 'luanti:test', operation = 'snapshot', actorName = 'alice',
    positions = {{0, 0, 0}}},
}
local granted = false
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
    scope = 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef = 'grant:one'} end
  return {current = false}
end}
local started = dofile('payload/hanaworlds_adapter/transport.lua').start(http, engine,
  {worldRef = 'luanti:test'}, function()
    return {worldRef = 'luanti:test', port = 30000, token = string.rep('a', 64)}
  end, function() end, function() return {worldeditAvailable = true} end,
  function() return true end, {}, grants)
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
print('transport grant fixture PASS')
