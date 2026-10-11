-- SOURCE/FIXTURE: real payload declaration, no player geometry reads.
_G.minetest = {}
local F = dofile('payload/hanaworlds_adapter/facts.lua')
local E = dofile('payload/hanaworlds_adapter/engine.lua')
local core = {fix_light=function()end,get_node_light=function()end,
  get_connected_players=function()error('PLAYER_READ_FORBIDDEN')end,
  get_voxel_manip=function()end,emerge_area=function()end,find_nodes_with_meta=function()end,
  get_game_info=function()return {id='mineclone2'}end,
  get_modnames=function()return {'mcl_playerplus'}end}
local bound=function()return true end
local w=assert(F.source_declaration(core,E.WRITE_BACKEND,bound))
assert(w.ready and #w.writeMethods==2 and w.writeMethods[1]=='PER_CELL' and w.writeMethods[2]=='REGION')
assert(w.avatarEnvelope.availability=='KNOWN' and w.avatarEnvelope.basis=='WORLD_SOURCE_DECLARATION')
assert(w.avatarEnvelope.size.width==1 and w.avatarEnvelope.size.height==2 and w.avatarEnvelope.size.depth==1)
core.get_modnames=function()return {'other_game'}end
assert(F.source_declaration(core,E.WRITE_BACKEND,bound).avatarEnvelope.availability=='UNAVAILABLE')
core.fix_light=nil
w=assert(F.source_declaration(core,E.WRITE_BACKEND,bound))
assert(not w.ready and #w.writeMethods==0)
assert(select(2,F.source_declaration(core,nil,bound))=='NOT_DECLARED_BY_PAYLOAD')
core.registered_nodes={air={description='Empty',color='#ABCDEF',walkable=false,liquidtype='none',
  damage_per_second=0,light_source=0,paramtype2='none'}}
core.registered_on_mapblocks_changed={}
core.sha256=function()return string.rep('a',64)end
core.write_json=function(v)
  if type(v)=='string' then return string.format('%q',v)end
  if type(v)=='boolean' or type(v)=='number' then return tostring(v)end
  return '{}'
end
local catalogue=assert(F.catalogue(core)).raw_json
assert(catalogue:find('"displayName":"Empty"',1,true))
assert(catalogue:find('"color":"#abcdef"',1,true))
print('World source declaration SOURCE/FIXTURE PASS')
