-- Current local-world payload. No user permission, grant or account source.
local path = minetest.get_modpath(minetest.get_current_modname())
local function read(name)
  local f = io.open(path .. '/' .. name, 'rb')
  if not f then return nil end
  local bytes = f:read('*a'); f:close(); return bytes
end
local manifest = assert(minetest.parse_json(assert(read('payload.json'))))
local files = {'mod.conf', 'init.lua', 'engine.lua', 'transport.lua', 'region.lua', 'facts.lua', 'voxel.lua'}
local bytes = ''
for _, name in ipairs(files) do bytes = bytes .. name .. '\n' .. assert(read(name)) end
local digest = minetest.sha256(bytes)
local engine = dofile(path .. '/engine.lua')
local facts = dofile(path .. '/facts.lua')
local voxel = dofile(path .. '/voxel.lua')
local region = dofile(path .. '/region.lua').new({core=minetest,state_path=minetest.get_worldpath() .. '/hanaworlds-local-picks'})
_G.hanaworlds_adapter = {record_pick=function(ref,session,world,node,yaw)
  if world ~= manifest.worldRef then return false end
  return region:record_pick(ref,session,world,node,yaw)
end}
local transport = dofile(path .. '/transport.lua')
local function capabilities()
  return {worldRef=manifest.worldRef,payloadVersion=manifest.payloadVersion,
    loadedSourceDigest=digest,manifestDigest=manifest.payloadDigest,
    payloadMatches=digest==manifest.payloadDigest,
    worldeditAvailable=type(rawget(_G,'worldedit'))=='table',worldeditVersion='local-static'}
end
local was_ready=false
transport.start(minetest.request_http_api(), engine, manifest, read,
  function(ready) if ready and not was_ready then minetest.log('action','HanaWorlds local courier ready') end; was_ready=ready end,
  capabilities, nil, region, facts, voxel)
