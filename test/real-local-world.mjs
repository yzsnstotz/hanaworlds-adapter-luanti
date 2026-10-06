// Own actual package + fixed Cordis + real Luanti. Host/Canvas are explicit public peer fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, cp, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = await realpath(process.env.HW_LOCAL_E);
const installed = process.env.HW_LOCAL_PACKAGE;
assert.ok(installed, 'extract the actual npm package first');
const { apply, inject, payloadDigest } = await import(pathToFileURL(join(installed,'src/index.mjs')));
const C = await import(pathToFileURL(join(installed,'vendor/hanaworlds-contracts/dist/local/index.mjs')));
// HW_CORDIS_MODULE (an installed @deepseek-ai/cordis lib/index.js) or the fixed App's copy.
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE ?? join(process.env.HW_CORDIS_APP,
  'Contents/Resources/hanaworlds-dsh/node_modules/@deepseek-ai/cordis/lib/index.js')));
const D=(kind,v)=>C.digestValue(kind,v).sha256;
const profile=join(root,'profile'),world=join(profile,'worlds','current'),home=join(root,'home');
for(const p of [world,home,join(profile,'games','hw_local','mods','base'),join(root,'tmp')]) await mkdir(p,{recursive:true,mode:0o700});
await writeFile(join(profile,'games/hw_local/game.conf'),'title = HanaWorlds local component runtime\n');
await writeFile(join(profile,'games/hw_local/mods/base/mod.conf'),'name = base\n');
await writeFile(join(profile,'games/hw_local/mods/base/init.lua'),"minetest.register_node('base:stone',{description='Static stone',tiles={'unknown_node.png'},paramtype='none',walkable=true})\n");
await writeFile(join(world,'world.mt'),'gameid = hw_local\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
await mkdir(join(world,'worldmods'),{recursive:true});
await cp(process.env.HW_WORLDEDIT,join(world,'worldmods/worldedit'),{recursive:true});
const probe=join(world,'worldmods/hw_probe');await mkdir(probe);
await writeFile(join(probe,'mod.conf'),'name = hw_probe\ndepends = worldedit\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe,'init.lua'),`
local path=minetest.get_worldpath()
local writes=0
local original=worldedit.set
worldedit.set=function(p,q,name)
  writes=writes+1
  minetest.safe_file_write(path .. '/probe-writes',tostring(writes))
  local f=io.open(path .. '/probe-fail','r')
  if f then local target=tonumber(f:read('*a'));f:close()
    if writes==target then os.remove(path .. '/probe-fail');return 0 end end
  local result=original(p,q,name)
  minetest.log('action','HW_WRITE=' .. tostring(writes) .. ':' .. tostring(result))
  return result
end
local old_light=minetest.fix_light
minetest.fix_light=function(p,q)
  local result=old_light(p,q)
  local n=minetest.get_node_or_nil(p)
  minetest.log('action','HW_LIGHT=' .. tostring(result) .. ':' .. tostring(n and n.name) .. ':' .. tostring(n and n.param1))
  return result
end
local storage=minetest.get_mod_storage()
minetest.after(0,function()
minetest.emerge_area({x=-16,y=-16,z=-16},{x=31,y=31,z=31},function(_,_,remaining)
  if remaining~=0 then return end
  if storage:get_string('initialized')~='yes' then
    for x=0,5 do minetest.set_node({x=x,y=0,z=0},{name='air'})
      minetest.set_node({x=x,y=-1,z=0},{name='base:stone'}) end
    storage:set_string('initialized','yes')
  end
  local a=rawget(_G,'hanaworlds_adapter')
  if a then local f=io.open(minetest.get_modpath('hanaworlds_adapter') .. '/payload.json','r')
    local m=minetest.parse_json(f:read('*a'));f:close()
    assert(a.record_pick('fixture-pick','fixture-session',m.worldRef,{0,-1,0},0))
  end
  minetest.log('action','HW_LOCAL_READY=' .. tostring(a~=nil))
end)
end)
`);
async function port(){const s=createServer();await new Promise(y=>s.listen(0,'127.0.0.1',y));const n=s.address().port;await new Promise(y=>s.close(y));return n;}
const serverPort=await port(),config=join(root,'luanti.conf');
await writeFile(config,`port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nmg_name = singlenode\nenable_damage = false\n`);
const processes=[],protocol=[],events=[];let child,stage=0,hostInput;
async function waitReady(log,ready){const until=Date.now()+20000;while(Date.now()<until){
  const s=await readFile(log,'utf8').catch(()=> '');if(s.includes(ready))return;
  if(child.exitCode!==null||child.signalCode!==null)throw Error('LUANTI_EARLY_EXIT');
  await new Promise(y=>setTimeout(y,100));}throw Error('LUANTI_READY_TIMEOUT');}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const pending=once(child,'exit');child.kill('SIGINT');const [code,signal]=await pending;
 processes.at(-1).exitCode=code;processes.at(-1).signal=signal;assert.equal(code,0);}
const host={ // Public NativeControl peer fixture controlling the real own process.
 async acquire(input){C.validateType('NativeControlInput',input);assert.equal(input.worldPath,world);assert.equal(input.userPath,profile);
   const log=join(root,`luanti-${++stage}.log`),out=join(root,`luanti-${stage}-stdio.log`);let text='';
   child=spawn('/Applications/luanti.app/Contents/MacOS/luanti',['--server','--world',world,'--config',config,'--logfile',log],
     {env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile,XDG_CACHE_HOME:join(profile,'cache'),TMPDIR:join(root,'tmp')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});child.on('exit',(code,signal)=>{void writeFile(out,text);const item=processes.find(p=>p.pid===child.pid);if(item){item.exitCode=code;item.signal=signal;}});
   processes.push({pid:child.pid,worldPath:world,operationRef:input.operationRef,argv:['--server','--world',world,'--config',config,'--logfile',log]});
   await waitReady(log,`HW_LOCAL_READY=${stage>1}`);hostInput=input;return {controlRef:`real:${child.pid}`,worldPath:world};
 },
 async inspect(q){assert.equal(q.controlRef,`real:${child.pid}`);assert.equal(q.operationRef,hostInput.operationRef);assert.equal(q.worldPath,world);
   process.kill(child.pid,0);assert.equal(child.exitCode,null);return C.validateType('NativeControlEvidence',{state:'CURRENT',worldPath:world,processId:child.pid,operationRef:q.operationRef});},
 async withStoppedWorld(q,consume){await this.inspect(q);const pid=child.pid;await stop();events.push({event:'STOPPED_CALLBACK',pid,worldPath:world});
   return consume(C.validateType('NativeControlEvidence',{state:'STOPPED',worldPath:world,processId:pid,operationRef:q.operationRef}));}
};
const ctx=new Context();let localContext,footprints=[],history;
ctx.provide('webServer',{register(){return ()=>{};}});
ctx.provide('dshHomePath',(...parts)=>join(home,...parts));
ctx.provide('hanaworldsNativeEngineControl',host);
ctx.provide('hanaworldsWorldRevisionOracle',{read:async()=> 'fixture-canvas-world-head-1'});
ctx.provide('hanaworldsCanvasFootprintRegistry',{readFootprints:async(worldRef)=>({current:true,durable:true,worldRef,objects:footprints})});
ctx.provide('hanaworldsCanvasHistoryFacts',{read:async()=>history});
let service,canvas;
const adapterFiber=ctx.plugin({name:'hanaworlds-adapter-luanti',inject,apply(c){service=apply(c,{localWorldRoots:[join(profile,'worlds')]});}});
await adapterFiber.await();
const canvasFiber=ctx.plugin({name:'hanaworlds-canvas',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(name,r){
 assert.equal(name,'ReadWorldSelectionContext');C.validateBoundRequest('canvas/v5',name,r);
 return C.validateBoundResponse('canvas/v5',name,r,{contractVersion:'canvas/v5',requestId:r.requestId,error:null,result:{
   sessionRef:r.sessionRef,worldRef:r.worldRef,inventory:{capabilityRevision:'fixture-inventory-1',connections:[]},
   selection:{status:'BOUND',connectionRef:localContext.connectionRef,context:{currentSession:r.sessionRef,activeWorldRef:localContext.worldRef,
     orderedSelectedObjectRefs:[],sessionRevision:'fixture-session-1',selectionRevision:localContext.selectionRevision,localContext}}}});
}});}});
// Fixture supplies the same origin metadata as Host Loader. Caller fiber and root are real Cordis objects.
await canvasFiber.await();
canvas.fiber.entry={options:{name:'hanaworlds-canvas'}};
const local=ctx.get('hanaworldsLuantiLocalWorlds'),native=ctx.get('hanaworldsLuantiNativeFacts');
const base=()=>({contractVersion:'world-adapter/v6',sessionRef:'fixture-session',worldRef:localContext.worldRef,localContext});
const invoke=async(name,input,caller=canvas)=>{const r=await caller.get('hanaworldsWorldAdapterV6').call(name,input);protocol.push({name,request:input,response:r});return r;};
const success=async(name,input)=>{const r=await invoke(name,input);assert.equal(r.error,null,JSON.stringify(r));return r.result;};
const writes=async()=>Number(await readFile(join(world,'probe-writes'),'utf8').catch(()=> '0'));
try {
 const [found]=await local.discover();const acquire=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'PROVISION_PAYLOAD'});
 const query=x=>({connectionRef:found.connectionRef,requesterRef:'fixture-host',leaseRef:x.leaseRef});
 const provision=await local.provision(query(acquire));assert.equal(provision.payloadDigest,await payloadDigest());
 const opened=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair(query(opened));localContext={connectionRef:paired.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef,worldRef:paired.worldRef,selectionRevision:'fixture-selection-1'};
 const connection=await success('ReadLocalConnection',{contractVersion:'world-adapter/v6',sessionRef:'fixture-session',requestId:'connection',connectionRef:paired.connectionRef});
 assert.equal(connection.worldRef,paired.worldRef);assert.equal('engineActorName' in connection,false);
 const region=await success('InspectRegion',{...base(),requestId:'region',inspectionId:'region-1',expectedWorldRevision:'fixture-canvas-world-head-1',anchor:{kind:'PICKED_POINT',pickRef:'fixture-pick'},
   footprint:{widthCells:1,depthCells:1,heightCells:1},placementSettings:{frontGapCells:2,forwardSearchCells:16,lateralSearchCells:8,verticalSearchCells:4,settingsRevision:'fixture-settings-1'}});
 assert.equal(region.outcome,'REGION_INSPECTED');
 async function prepare(id,positions,objects=[]){const covered=[...new Map([...positions,...objects.flatMap(o=>o.positions)].map(p=>[JSON.stringify(p),p])).values()].sort(C.comparePosition);
 const actual=await native.readScopedState(paired.connectionRef,covered);
 const operations={contractVersion:'operations/v3',buildDigest:'1'.repeat(64),compilerRevision:'fixture-brush',compilationConfigDigest:'2'.repeat(64),worldRef:paired.worldRef,
  frameDigest:region.inspection.targetFacts.frameDigest,catalogueDigest:region.inspection.targetFacts.catalogueDigest,targetFactsDigest:region.inspection.targetFactsDigest,
  effects:positions.map(position=>({position,nodeName:'base:stone',param2:0}))};
 const operationDigest=D('operations',operations),scope={transactionId:id,worldRef:paired.worldRef,operationDigest,stateProfile:actual.stateProfile,
  checkedPositions:positions,objects,cells:actual.cells,localContext};
 const request={...base(),requestId:`prepare-${id}`,transactionId:id,operationDigest,operations,scope,scopeDigest:D('scoped-world',scope),guarantee:'RECOVERABLE_VERIFIED'};
 const prepared=await success('PrepareRecoverableTransaction',request);return {request,prepared,apply:{...request,requestId:`apply-${id}`,preparedTransaction:C.projectScopedPreparedTransaction(prepared)}};}
 footprints=[{objectRef:'fixture-existing-object',worldRef:paired.worldRef,footprintRevision:'footprint-1',provenance:'CANVAS_REGISTERED',positions:[[5,0,0]]}];
 const objectTx=await prepare('object-scope',[[4,0,0]],structuredClone(footprints));
 const oldCount=await writes();footprints=[{...footprints[0],footprintRevision:'footprint-changed'}];
 const conflict=await invoke('ApplyCompiledTransaction',objectTx.apply);assert.equal(conflict.error.code,'TRANSACTION_CONFLICT');assert.equal(await writes(),oldCount);
 await success('AbortPreparedTransaction',{...base(),requestId:'abort-object',transactionId:'object-scope',operationDigest:objectTx.request.operationDigest});
 footprints=[{...footprints[0],footprintRevision:'footprint-1'}];
 const tx=await prepare('build-1' ,[[0,0,0],[1,0,0]]);
 const count0=await writes();const outsider=await invoke('ApplyCompiledTransaction',tx.apply,ctx);assert.equal(outsider.error.code,'CAPABILITY_UNAVAILABLE');assert.equal(await writes(),count0);
 const wrong={...tx.apply,requestId:'wrong-world',worldRef:'other-world',localContext:{...localContext,worldRef:'other-world'}};
 // The contract binding rejects the wrong world before any native mutation.
 await assert.rejects(()=>invoke('ApplyCompiledTransaction',wrong));assert.equal(await writes(),count0);
 const receipt=await success('ApplyCompiledTransaction',tx.apply);assert.equal(receipt.status,'VERIFIED');const count1=await writes();assert.equal(count1-count0,2);
 assert.equal(C.canonicalJSON(await success('ApplyCompiledTransaction',tx.apply)),C.canonicalJSON(receipt));assert.equal(await writes(),count1);
 const readback=await success('Readback',{...base(),requestId:'readback-build',transactionId:'build-1',coveredPositions:[[0,0,0],[1,0,0]],stateProfile:tx.prepared.stateProfile});
 assert.ok(readback.projection.records.every(r=>r.nodeName==='base:stone'));assert.equal(readback.readbackDigest,receipt.readbackDigest);
 const undo={...base(),requestId:'prepare-undo',originTransactionId:'build-1',transactionId:'undo-1',direction:'UNDO',affectedObjectRefs:[],
  originVerifiedReceiptDigest:D('receipt',receipt),originBeforeImageDigest:tx.prepared.beforeImageDigest,originBeforeStateReadbackDigest:tx.prepared.beforeStateReadbackDigest,
  originAfterReadbackDigest:receipt.readbackDigest,expectedHistoryRevision:'fixture-history-1',expectedWorldRevision:'fixture-canvas-world-head-1',expectedObjectRevisions:{},
  expectedCurrentStateDigest:receipt.readbackDigest,targetStateDigest:tx.prepared.beforeStateReadbackDigest,guarantee:'RECOVERABLE_VERIFIED'};
 undo.historyOperationDigest=D('history-operation',Object.fromEntries(Object.keys(C.schemaBundle.definitions.HistoryOperationProjection.properties).map(k=>[k,undo[k]])));
 history={current:true,durable:true,worldRef:paired.worldRef,originTransactionId:'build-1',historyRevision:undo.expectedHistoryRevision,worldRevision:undo.expectedWorldRevision,
  objectRevisions:{},affectedObjectRefs:[],originVerifiedReceiptDigest:undo.originVerifiedReceiptDigest};
 const up=await success('PrepareHistoryTransaction',undo);
 const ur=await success('ApplyHistoryTransaction',{...base(),requestId:'apply-undo',originTransactionId:'build-1',transactionId:'undo-1',direction:'UNDO',historyOperationDigest:undo.historyOperationDigest,
  expectedWorldRevision:undo.expectedWorldRevision,expectedObjectRevisions:{},preparedHistoryTransaction:up});assert.equal(ur.status,'VERIFIED');assert.equal(ur.readbackDigest,undo.targetStateDigest);
 const failed=await prepare('fail-1',[[2,0,0],[3,0,0]],structuredClone(footprints));await writeFile(join(world,'probe-fail'),String(await writes()+2));
 const rolled=await success('ApplyCompiledTransaction',failed.apply);assert.equal(rolled.status,'ROLLED_BACK');assert.equal(rolled.restoreStatus,'VERIFIED_RESTORED');
 const restored=await success('Readback',{...base(),requestId:'readback-fail',transactionId:'fail-1',coveredPositions:[[2,0,0],[3,0,0],[5,0,0]],stateProfile:failed.prepared.stateProfile});
 assert.ok(restored.projection.records.every(r=>r.nodeName==='air'));assert.equal(restored.readbackDigest,failed.prepared.beforeStateReadbackDigest);
 const directory=join(home,'data/hanaworlds-adapter-luanti/journal');const [key]=await readdir(directory);const durable=JSON.parse(await readFile(join(directory,key,'local-world-state'),'utf8'));
 assert.equal(durable.transactions['build-1'].status,'VERIFIED');assert.equal(durable.transactions['undo-1'].status,'VERIFIED');assert.equal(durable.transactions['fail-1'].status,'ROLLED_BACK');
 assert.ok(durable.transactions['build-1'].before.records.every(r=>r.nodeName==='air'));
 events.push({event:'PASS',gates:['connection','real-region','existing-footprint-conflict-no-write','canvas-only','wrong-world','write-readback','exact-repeat-no-write','same-origin-undo','partial-write-whole-rollback','durable-before-and-outcomes','full-footprint-union-restoration'],writes:await writes()});
} finally {
 await adapterFiber.dispose();await canvasFiber.dispose();await stop();
 await writeFile(join(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
 await writeFile(join(root,'processes.json'),JSON.stringify(processes,null,2)+'\n');
 await writeFile(join(root,'events.json'),JSON.stringify(events,null,2)+'\n');
}
console.log('REAL_RUNTIME own package/fixed Cordis/Luanti PASS; Canvas and Host public peer FIXTURE');
