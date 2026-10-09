local R=dofile('payload/hanaworlds_adapter/region.lua')
local player={get_pos=function() return {x=0,y=0,z=0} end,
  get_properties=function() return {collisionbox={-0.3,-0.5,-0.3,0.3,1.3,0.3}} end,
  get_look_horizontal=function() return 0 end,
  get_player_name=function() error('No identity lookup in geometry') end}
local core={get_connected_players=function() return {player} end,
  registered_nodes={stone={}},get_node_or_nil=function(p)
    if p.y<0 then return {name='stone',param2=0} end
    return {name='air',param2=0}
  end,is_protected=function() error('Inspection asks no protection') end}
local region=R.new({core=core})
-- Payload 0.7.0: prepare_check asks per-cell protection for the empty name (G2).
core.is_protected=function(p,name) assert(name=='');return p.x==4 end
assert(region:prepare_check({{0,0,0}})==nil)
assert(region:prepare_check({{3,0,0}}).checked==1)
assert(select(3,region:prepare_check({{4,0,0}}))=='PROTECTED_CELL')
core.is_protected=function() error('Inspection asks no protection') end
local result=assert(region:inspect({worldRef='local',sessionRef='s',anchor={kind='CURRENT_VIEW',invocationId='i'},
  footprint={widthCells=1,depthCells=1,heightCells=1},settings={frontGapCells=2,forwardSearchCells=16,lateralSearchCells=8,verticalSearchCells=4},walkable={stone=true}}))
assert(result:find('"kind":"REGION"',1,true));assert(not result:find('protected',1,true))
core.get_connected_players=function() return {} end
local none,code=region:inspect({worldRef='local',sessionRef='s',anchor={kind='CURRENT_VIEW',invocationId='i'},
  footprint={widthCells=1,depthCells=1,heightCells=1},settings={frontGapCells=2,forwardSearchCells=16,lateralSearchCells=8,verticalSearchCells=4},walkable={stone=true}})
assert(none==nil and code=='INSPECTION_FAILED')
print('Local geometry/body SOURCE/FIXTURE PASS')
