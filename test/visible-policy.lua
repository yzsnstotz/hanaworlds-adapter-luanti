local P=dofile('payload/hanaworlds_adapter/transport-policy.lua')
assert(P.validate({}).courierBodyBytes==4194304)
assert(not P.validate({disable=true}))
assert(not P.validate({courierBodyBytes=false}))
local T=dofile('payload/hanaworlds_adapter/transport.lua')
local function exercise(body_bytes, command_size, result_size, expect)
  local scheduled, posted, logs={}, {}, {}
  local command={id='cmd',worldRef='fixture',operation='fact_catalogue'}
  local data=string.rep('x',command_size)
  local config={worldRef='fixture',port=12345,token=string.rep('a',64),settings={courierBodyBytes=body_bytes,courierResultWaitMs=30000}}
  _G.minetest={parse_json=function(raw)if raw=='config' then return config else return {worldRef='fixture',command=command} end end,
    write_json=function(v)if type(v)=='string' then return string.format('%q',v) end return 'null' end,
    after=function(_,fn)scheduled[#scheduled+1]=fn end,
    log=function(_,text)logs[#logs+1]=text end}
  local runs=0
  local http={fetch=function(q,cb)
    if q.url:match('/poll$') then cb({succeeded=true,code=200,data=data})
    else posted[#posted+1]=q.data;cb({succeeded=true,code=200}) end end}
  assert(T.start(http,{new=function()return{}end},{worldRef='fixture'},function()return'config'end,function()end,function()return{}end,nil,{},
    {catalogue=function()runs=runs+1;return {raw_json='"'..string.rep('r',result_size)..'"'}end},{},P))
  table.remove(scheduled,1)()
  assert(#posted==1)
  if expect=='command' then assert(runs==0);assert(posted[1]:find('COURIER_COMMAND_BODY',1,true))
  elseif expect=='result' then assert(runs==1);assert(posted[1]:find('COURIER_RESULT_BODY',1,true))
  else assert(runs==1);assert(posted[1]:find('"error":null',1,true)) end
  assert(#posted[1]<=body_bytes)
end
for _,bytes in ipairs({131072,4194304})do
 exercise(bytes,bytes,1,'ok');exercise(bytes,bytes+1,1,'command');exercise(bytes,1,bytes,'result')
end
local R=dofile('payload/hanaworlds_adapter/region.lua')
local original=io.open
for _,case in ipairs({{2,true},{13,false},{5,false}}) do
 io.open=function()return nil,'private error',case[1]end
 local r=R.new({core={log=function()end},state_path='test-only'})
 assert(r.readable==case[2]);if case[1]~=2 then assert(r.read_failure.nativeCode==case[1])end
end
io.open=function()return {read=function()return nil,'IO',5 end,close=function()return true end}end
assert(not R.new({core={},state_path='test-only'}).readable)
io.open=function()return {read=function()return '{}' end,close=function()return true end}end
assert(not R.new({core={parse_json=function()return {format='wrong'}end},state_path='test-only'}).readable)
io.open=original
print('Node-independent Lua config, exact command/result boundaries and state read sources PASS')
-- The actual startup boundary refuses bad paired configuration before scheduling/fetching.
for _,settings in ipairs({{},false,{courierResultWaitMs=30000,courierBodyBytes=4194305},
 {courierResultWaitMs=999,courierBodyBytes=131072},
 {courierResultWaitMs=30000,courierBodyBytes=131072,disabled=true},
 {courierResultWaitMs='30000',courierBodyBytes=131072}}) do
 local called=false
 local config={worldRef='fixture',port=12345,token=string.rep('a',64),settings=settings}
 _G.minetest={parse_json=function()return config end,log=function()end,after=function()called=true end}
 assert(not T.start({fetch=function()called=true end},{},{worldRef='fixture'},function()return 'config' end,
  function()end,function()return{}end,nil,{},{},{},P))
 assert(not called)
end
