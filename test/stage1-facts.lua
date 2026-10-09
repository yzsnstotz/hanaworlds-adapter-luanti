-- SOURCE/FIXTURE: payload facts with a fixture core.
_G.minetest = {}
local F = dofile('payload/hanaworlds_adapter/facts.lua')
local E = dofile('payload/hanaworlds_adapter/engine.lua')
local core = {get_modnames = function() return {'fixture_core', 'worldedit'} end,
  fix_light = function() end, get_node_light = function() end}
local we = {set = function() end, set_param2 = function() end}

-- No player/body fact is produced by the payload facts module.
assert(F.avatar_envelope == nil)
-- The declaration is the loaded engine module's own.
assert(E.WRITE_BACKEND.backendProfileId == 'hanaworlds-luanti-worldedit-cell-write/v1')
local w = assert(F.write_backend(core, E.WRITE_BACKEND, we))
assert(w.backendProfileId == E.WRITE_BACKEND.backendProfileId and w.nodeWriteSemantics == 'explicit-nodeName-param2-static-v2' and w.ready == true)
for k in pairs(w) do assert(k == 'backendProfileId' or k == 'nodeWriteSemantics' or k == 'ready', k) end
assert(F.write_backend(core, E.WRITE_BACKEND, nil).ready == false)
assert(F.write_backend({}, E.WRITE_BACKEND, we).ready == false)
assert(select(2, F.write_backend(core, nil, we)) == 'NOT_DECLARED_BY_PAYLOAD')
assert(select(2, F.write_backend(core, {backendProfileId = ''}, we)) == 'NOT_DECLARED_BY_PAYLOAD')

_G.worldedit = nil
local r = assert(F.worldedit_runtime(core))
assert(r.modListed == true and r.apiTable == false and r.versionString == nil)
_G.worldedit = {version_string = '1.3', version = {major = 1, minor = 3}}
r = assert(F.worldedit_runtime(core))
assert(r.apiTable and r.versionString == '1.3' and r.versionMajor == 1 and r.versionMinor == 3)
_G.worldedit = {}
r = assert(F.worldedit_runtime(core))
assert(r.apiTable and r.versionString == nil and r.versionMajor == nil)
assert(select(2, F.worldedit_runtime({})) == 'CAPABILITY_UNAVAILABLE')
print('Stage 1 facts payload SOURCE/FIXTURE PASS')
