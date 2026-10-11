-- SOURCE/FIXTURE: payload facts with a fixture core.
_G.minetest = {}
local F = dofile('payload/hanaworlds_adapter/facts.lua')
local E = dofile('payload/hanaworlds_adapter/engine.lua')
local core = {get_modnames = function() return {'fixture_core', 'worldedit'} end,
  fix_light = function() end, get_node_light = function() end, swap_node = function() return true end}
local bound = function() return true end
local unbound = function() return false, 'NATIVE_WRITER_REPLACED_BEFORE_LOAD' end

-- No player/body fact is produced by the payload facts module.
assert(F.avatar_envelope == nil)
-- The declaration is the loaded engine module's own.
assert(E.WRITE_BACKEND.backendProfileId == 'hanaworlds-luanti-native-cell-write/v2')
local w = assert(F.write_backend(core, E.WRITE_BACKEND, bound))
assert(w.writeBackend.profileId == E.WRITE_BACKEND.backendProfileId and w.writeBackend.revision == E.WRITE_BACKEND.revision and w.ready == true)
for k in pairs(w) do assert(k == 'writeBackend' or k == 'ready', k) end
assert(F.write_backend(core, E.WRITE_BACKEND, nil).ready == false, 'unknown writer binding is not ready')
assert(F.write_backend(core, E.WRITE_BACKEND, unbound).ready == false, 'game-replaced writer is not ready')
assert(F.write_backend({}, E.WRITE_BACKEND, bound).ready == false)
assert(select(2, F.write_backend(core, nil, bound)) == 'NOT_DECLARED_BY_PAYLOAD')
assert(select(2, F.write_backend(core, {backendProfileId = ''}, bound)) == 'NOT_DECLARED_BY_PAYLOAD')

assert(F.worldedit_runtime == nil, 'D-15 removes obsolete runtime diagnostics')
print('Stage 1 facts payload SOURCE/FIXTURE PASS')
