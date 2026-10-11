-- Exercise the shipped Engine, including its native comparisons after lighting.
local node = {name='air', param1=0, param2=0}
local metadata, inventory, timeout, elapsed = {}, {}, 0, 0
local corrupt = false
minetest = {
  registered_nodes={air={}, stone={}},
  get_node_or_nil=function() return {name=node.name,param1=node.param1,param2=node.param2} end,
  swap_node=function(_, value) node=value; return true end,
  get_meta=function() return {
    to_table=function() return {fields=metadata,inventory=inventory} end,
    from_table=function(_, value) metadata=value.fields; inventory=value.inventory; return true end,
  } end,
  get_node_timer=function() return {
    get_timeout=function() return timeout end, get_elapsed=function() return elapsed end,
    set=function(_,t,e) timeout=t; elapsed=e end, stop=function() timeout=0; elapsed=0 end,
  } end,
  fix_light=function() node.param1=15; if corrupt then node.param2=9 end; return true end,
  get_node_light=function() return 15 end,
}
worldedit = nil
dofile('test/support/engine-c.lua')(minetest.swap_node) -- FIXTURE engine function
local engine=dofile('payload/hanaworlds_adapter/engine.lua').new({
  verifyPrepared=function() return true end, verifyRestore=function() return true end,
  restoreGuard=function() return true end,
})
local cells={{0,0,0}}
local before=assert(engine:snapshot(cells))
node.param1=8
local applied,code=engine:apply({{position=cells[1],nodeName='stone',param2=7}},before,{status='PREPARED'},before)
assert(applied, 'derived-light change before apply: '..tostring(code))
local current=assert(engine:snapshot(cells))
node.param1=6
local history,history_code=engine:apply_state(before,current,{status='PREPARED'})
assert(history, 'derived-light history: '..tostring(history_code))
assert(node.name=='air' and node.param2==0 and node.param1==15)
local restored,restore_code=engine:restore(before,{status='RESTORING'})
assert(restored, 'derived-light restore: '..tostring(restore_code))
corrupt=true
local wrong,wrong_code=engine:restore(before,{status='RESTORING'})
assert(not wrong and wrong_code=='RESTORE_FAILED','param2 mismatch must still fail')
corrupt=false
node.param2=0; metadata={owner='external'}
local conflict,conflict_code=engine:apply({{position=cells[1],nodeName='stone',param2=7}},before,{status='PREPARED'},before)
assert(not conflict and conflict_code=='TRANSACTION_CONFLICT','metadata mismatch must still fail')
print('contracts v2 native state comparisons: passed')
