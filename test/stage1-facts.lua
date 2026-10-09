-- SOURCE/FIXTURE: payload facts with a fixture core; pose accessors throw.
local F = dofile('payload/hanaworlds_adapter/facts.lua')
local function pose() error('POSE_READ') end
local function player(name, box)
  return {get_player_name = function() return name end,
    get_properties = function() return {collisionbox = box} end,
    get_pos = pose, get_look_horizontal = pose, get_look_dir = pose}
end
local list = {}
local core = {get_connected_players = function() return list end,
  sha256 = function(s) return string.rep('a', 63) .. tostring(#s % 10) end,
  get_modnames = function() return {'fixture_core', 'worldedit'} end}
local salt = string.rep('0', 64)

local r, code = F.avatar_envelope(core, salt)
assert(r == nil and code == 'PLAYER_NOT_CONNECTED')
list = {player('a', {-0.3, -0.5, -0.3, 0.3, 1.3, 0.3})}
r = assert(F.avatar_envelope(core, salt))
assert(math.abs(r.width - 0.6) < 1e-12 and math.abs(r.height - 1.8) < 1e-12 and math.abs(r.depth - 0.6) < 1e-12)
assert(type(r.playerRef) == 'string' and r.pos == nil and r.name == nil)
for k in pairs(r) do assert(k == 'width' or k == 'height' or k == 'depth' or k == 'playerRef', k) end
assert(select(2, F.avatar_envelope(core, 'short')) == 'SCHEMA_INVALID')
list = {player('a', {0, 0, 0, 0 / 0, 1, 1})}
assert(select(2, F.avatar_envelope(core, salt)) == 'COLLISIONBOX_UNREADABLE')
list = {player('a', {0, 0, 0, 1, 1})}
assert(select(2, F.avatar_envelope(core, salt)) == 'COLLISIONBOX_UNREADABLE')
list = {player('a', {0, 0, 0, 1, 1, 1}), player('b', {0, 0, 0, 1, 1, 1})}
assert(select(2, F.avatar_envelope(core, salt)) == 'PLAYER_NOT_SINGULAR')
assert(select(2, F.avatar_envelope({sha256 = core.sha256}, salt)) == 'CAPABILITY_UNAVAILABLE')

_G.worldedit = nil
local w = assert(F.worldedit_runtime(core))
assert(w.modListed == true and w.apiTable == false and w.versionString == nil)
_G.worldedit = {version_string = '1.3', version = {major = 1, minor = 3}}
w = assert(F.worldedit_runtime(core))
assert(w.apiTable and w.versionString == '1.3' and w.versionMajor == 1 and w.versionMinor == 3)
_G.worldedit = {}
w = assert(F.worldedit_runtime(core))
assert(w.apiTable and w.versionString == nil and w.versionMajor == nil)
assert(select(2, F.worldedit_runtime({})) == 'CAPABILITY_UNAVAILABLE')
print('Stage 1 facts payload SOURCE/FIXTURE PASS')
