-- Exercise the shipped Engine, including its native comparisons after lighting.
local node = {name='air', param1=0, param2=0}
local metadata, inventory, timeout, elapsed = {}, {}, 0, 0
local corrupt = false
local corrupt_metadata, clear_failure = false, nil
minetest = {
  registered_nodes={air={}, stone={}},
  get_node_or_nil=function() return {name=node.name,param1=node.param1,param2=node.param2} end,
  swap_node=function(_, value) node=value; return true end,
  get_meta=function() return {
    to_table=function() return {fields=metadata,inventory=inventory} end,
    from_table=function(_, value)
      if clear_failure=='metadata-false' then return false end
      if clear_failure=='metadata-throw' then error('metadata write failed') end
      metadata=value.fields; inventory=value.inventory; return true
    end,
  } end,
  get_node_timer=function() return {
    get_timeout=function() return timeout end, get_elapsed=function() return elapsed end,
    set=function(_,t,e) timeout=t; elapsed=e end, stop=function()
      if clear_failure=='timer-throw' then error('timer stop failed') end
      timeout=0; elapsed=0
    end,
  } end,
  fix_light=function()
    node.param1=15; if corrupt then node.param2=9 end
    if corrupt_metadata then metadata={owner='wrong'} end
    return true
  end,
  get_node_light=function() return 15 end,
}
worldedit = nil
dofile('test/support/engine-c.lua')(minetest.swap_node) -- FIXTURE engine function
local engine=dofile('payload/hanaworlds_adapter/engine.lua').new({
  verifyPrepared=function() return true end, verifyRestore=function() return true end,
  restoreGuard=function() return true end,
})
local cells={{0,0,0}}
-- A static node may hold user state even though its definition has no callbacks.
-- Ordinary writes clear it; restore must put the full saved state back.
metadata={owner='alice',note='before'}; inventory={main={'stone 2',''}}
timeout=60; elapsed=4
local before=assert(engine:snapshot(cells))
node.param1=8
local applied,code=engine:apply({{position=cells[1],nodeName='stone',param2=7}},before,{status='PREPARED'},before)
assert(applied, 'derived-light change before apply: '..tostring(code))
local read=assert(engine:readback(cells)).records[1]
assert(next(read.metadata)==nil and next(read.inventory)==nil and read.timer==nil,
  'StateProfile cleared fields must be absent after an ordinary write')
local current=assert(engine:snapshot(cells))
node.param1=6
local history,history_code=engine:apply_state(before,current,{status='PREPARED'})
assert(history, 'derived-light history: '..tostring(history_code))
assert(node.name=='air' and node.param2==0 and node.param1==15)
assert(metadata.owner=='alice' and metadata.note=='before' and inventory.main[1]=='stone 2'
  and inventory.main[2]=='' and timeout==60 and elapsed==4,'history restores saved state')
local restored,restore_code=engine:restore(before,{status='RESTORING'})
assert(restored, 'derived-light restore: '..tostring(restore_code))
assert(metadata.owner=='alice' and timeout==60,'restore retains cleared fields from before image')
corrupt=true
local wrong,wrong_code=engine:restore(before,{status='RESTORING'})
assert(not wrong and wrong_code=='RESTORE_FAILED','param2 mismatch must still fail')
corrupt=false
node.param2=0; metadata={owner='external'}
local conflict,conflict_code=engine:apply({{position=cells[1],nodeName='stone',param2=7}},before,{status='PREPARED'},before)
assert(not conflict and conflict_code=='TRANSACTION_CONFLICT','metadata mismatch must still fail')
corrupt_metadata=true
local bad_meta,bad_meta_code=engine:restore(before,{status='RESTORING'})
assert(not bad_meta and bad_meta_code=='RESTORE_FAILED','restore metadata mismatch must still fail')
corrupt_metadata=false
for _,mode in ipairs({'metadata-false','metadata-throw','timer-throw'}) do
  clear_failure=nil
  assert(engine:restore(before,{status='RESTORING'}))
  local prior=assert(engine:snapshot(cells)); clear_failure=mode
  local bad,bad_code=engine:apply({{position=cells[1],nodeName='stone',param2=7}},prior,{status='PREPARED'},prior)
  assert(not bad and bad_code=='APPLY_FAILED','state clearing failure: '..mode)
end
print('contracts v2 native state comparisons: passed')
