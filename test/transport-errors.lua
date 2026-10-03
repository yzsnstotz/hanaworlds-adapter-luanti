-- QR-ADV4-01: a Lua error inside a courier command fails closed with a typed
-- code, is logged with its operation and cause (pose-like values redacted),
-- and leaves no in-flight command state behind.
local logs, posted, scheduled = {}, {}, {}
local token = string.rep('a', 64)
_G.minetest = {
  parse_json = function(raw) return raw end, -- the http double hands over tables
  write_json = function(v)
    if type(v) == 'string' then return string.format('%q', v) end
    if type(v) == 'boolean' then return tostring(v) end
    return 'null'
  end,
  log = function(level, text) logs[#logs + 1] = {level, text} end,
  after = function(_, fn) scheduled[#scheduled + 1] = fn end,
  get_player_by_name = function() return nil end,
}
local manifest = {worldRef = 'luanti:test'}
local polls = 0
local http = {fetch = function(request, callback)
  if request.url:match('/poll$') then
    polls = polls + 1
    if polls == 2 then
      callback({succeeded = true, code = 200, data = {worldRef = 'luanti:test',
        command = {id = 'cmd-2', worldRef = 'luanti:test', operation = 'present_frame',
          engineActorName = 'alice', frame = {}}}})
    elseif polls == 1 then
      callback({succeeded = true, code = 200, data = {worldRef = 'luanti:test',
        command = {id = 'cmd-1', worldRef = 'luanti:test', operation = 'prepare_check',
          actorName = 'alice', positions = {{0, 1, 3}}}}})
    end
  elseif request.url:match('/result$') then
    posted[#posted + 1] = request.data
    callback({succeeded = true, code = 200})
  end
end}
local transport = dofile('payload/hanaworlds_adapter/transport.lua')
local region = {prepare_check = function()
  error('mods/protector/init.lua:12: protector failed at (0.2, 1.5, -3.25) yaw 4.7')
end}
local started = transport.start(http, {new = function() return {} end}, manifest,
  function() return {worldRef = 'luanti:test', port = 30000, token = token} end,
  function() end, function() return {} end,
  function(name, frame) return name == 'alice' and type(frame) == 'table' end, region,
  {verify = function() return {current = true, worldRef = 'luanti:test'} end})
assert(started, 'courier started')
-- Run the scheduled poll and the follow-up callbacks once.
local fn = table.remove(scheduled, 1); fn()
assert(#posted == 1, 'a typed reply is still sent')
assert(posted[1]:find('"CAPABILITY_UNAVAILABLE"', 1, true), 'fails closed with the typed code')
local line
for _, entry in ipairs(logs) do
  if entry[1] == 'error' then line = entry[2] end
end
assert(line, 'the failure is logged')
assert(line:find('prepare_check', 1, true), 'log names the operation')
assert(line:find('mods/protector/init.lua:12', 1, true), 'log keeps the root cause location')
assert(not line:find('0.2', 1, true) and not line:find('4.7', 1, true)
  and not line:find('3.25', 1, true), 'no pose-like values in the log')
-- A boolean result (present_frame) is encoded, not indexed (the real engine
-- stopped the server on 'attempt to index a boolean value').
local errors_before = #logs
fn = table.remove(scheduled, 1); fn()
assert(#posted == 2, 'present_frame reply posted')
assert(posted[2]:find('"result":true', 1, true), 'boolean result encoded as true: ' .. posted[2])
assert(posted[2]:find('"error":null', 1, true), 'no error for a delivered frame')
for i = errors_before + 1, #logs do assert(logs[i][1] ~= 'error', 'no error logged') end
print('transport error handling PASS')
