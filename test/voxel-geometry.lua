-- SOURCE/FIXTURE: rejected geometry must never access the native map.
local voxel = dofile('payload/hanaworlds_adapter/voxel.lua')
local touched = 0
local core = {MAP_BLOCKSIZE=16,get_voxel_manip=function() touched=touched+1; error('MAP_ACCESS') end,
  emerge_area=function() touched=touched+1; error('MAP_ACCESS') end}
local function args(profile,partition)
  return {geometryProfile=profile,partition=partition,min={-1,0,0},max={16,0,0},purpose='APPLY',chunks={{}}}
end
for _, a in ipairs({args('unsupported/v1',{edge={16,16,16}}),args('voxel-grid/v1',{edge={8,16,16}}),
  args(nil,{edge={16,16,16}}),args('voxel-grid/v1',nil)}) do
  for _, method in ipairs({'read','write','emerge'}) do
    local ok, value, code = pcall(function()
      if method=='emerge' then return voxel.emerge(core,a.min,a.max,a) end
      return voxel[method](core,a)
    end)
    assert(ok and value==nil and code=='CAPABILITY_GAP',method..' must refuse invalid geometry before native access')
  end
end
assert(touched==0)
-- Positive native partition: a different engine edge must be read from its API,
-- including floor division on the negative side. This does not advertise it as
-- supported by this Adapter's public (16x16x16) declaration.
core.MAP_BLOCKSIZE=32
core.registered_nodes={air={}}
core.fix_light=function() return true end
core.find_nodes_with_meta=function() return {} end
core.sha256=function() return string.rep('a',64) end
core.get_name_from_content_id=function() return 'air' end
_G.VoxelArea=function(lo,hi)
  return {index=function(_,x,y,z) return ((z-lo.z)*(hi.y-lo.y+1)+(y-lo.y))*(hi.x-lo.x+1)+(x-lo.x)+1 end}
end
core.get_voxel_manip=function()
  local count
  local function data() local out={} for i=1,count do out[i]=0 end return out end
  return {read_from_map=function(_,lo,hi) count=(hi.x-lo.x+1)*(hi.y-lo.y+1)*(hi.z-lo.z+1);return lo,hi end,
    get_data=data,get_param2_data=data}
end
assert(voxel.limits(core,265000).mapblockSize==32)
local read=assert(voxel.read(core,{geometryProfile='voxel-grid/v1',partition={edge={32,32,32}},min={-1,0,0},max={32,0,0}}))
assert(#read.boxes==3)
assert(read.boxes[1].min[1]==-1 and read.boxes[1].max[1]==-1)
assert(read.boxes[2].min[1]==0 and read.boxes[2].max[1]==31)
assert(read.boxes[3].min[1]==32 and read.boxes[3].max[1]==32)
print('Voxel geometry SOURCE/FIXTURE PASS')
