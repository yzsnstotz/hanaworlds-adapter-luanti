// REAL_RUNTIME for adapter-07. Actual Adapter handlers/courier/payload + Luanti.
// Host is an explicit NativeControl peer that owns real headless children. Canvas/registry/history/oracle are
// explicitly labelled contract peers, not product UI. No WorldEdit is installed.
import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile,readFile,realpath,symlink,readdir,unlink,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
const root=await realpath(process.env.HW_NATIVE_E);
const source=resolve(process.env.HW_NATIVE_PACKAGE ?? '.');
const selectedPath=process.env.HW_NATIVE_PATH ?? 'ALL';assert.ok(['ALL','region','J3','J5'].includes(selectedPath),'unknown native test path');
const load=path=>import(pathToFileURL(join(source,path.replace(/^src\//,'dist/runtime/'))));
const C=await import('hanaworlds-contracts');
const {Context}=await import('@deepseek-ai/cordis');
const {createFlatWorld}=await load('src/flat-world.mjs');
const {createLocalRuntime}=await load('src/local-runtime.mjs');
const {STATE_PROFILE,WORLD_GEOMETRY,WorldVocabulary}=await load('src/world-vocabulary.mjs');
const {LocalCourier}=await load('src/local-courier.mjs');
const nativeCatalogue=LocalCourier.prototype.catalogue;let registry;
LocalCourier.prototype.catalogue=async function(){const result=await nativeCatalogue.call(this);registry=result;return result;};
const D=(kind,value)=>C.digestValue(kind,value).sha256;
const profile=join(root,'profile'),worlds=join(profile,'worlds');
for(const p of [worlds,join(profile,'games'),join(root,'logs'),join(root,'tmp'),join(root,'home')]) await mkdir(p,{recursive:true,mode:0o700});
const gameId=process.env.HW_GAME?'mineclone2':'hw_native_fixture';
if(process.env.HW_GAME) await symlink(await realpath(process.env.HW_GAME),join(profile,'games',gameId));
else {
 const game=join(profile,'games',gameId),base=join(game,'mods','base');await mkdir(base,{recursive:true});
 await writeFile(join(game,'game.conf'),'title = Adapter native COMPONENT FIXTURE\nallowed_mapgens = flat\n');
 await writeFile(join(base,'mod.conf'),'name = base\n');
 await writeFile(join(base,'init.lua'),`core.register_node('base:stone',{tiles={'unknown_node.png'}})
core.register_node('base:rotated',{paramtype2='facedir',tiles={'unknown_node.png'}})
core.register_node('base:callback',{tiles={'unknown_node.png'},on_construct=function() error('CALLBACK_MUST_NOT_RUN') end})
`);
}
const socket=createServer();await new Promise(y=>socket.listen(0,'127.0.0.1',y));const courierPort=socket.address().port;await new Promise(y=>socket.close(y));
const made=await createFlatWorld({roots:[worlds],root:worlds,userPath:profile,gameId,worldName:'native-paths',transportPort:courierPort});
assert.doesNotMatch(await readFile(join(made.worldPath,'world.mt'),'utf8'),/worldedit/i);
const probe=join(made.worldPath,'worldmods','hw_native_probe');await mkdir(probe);
await writeFile(join(probe,'mod.conf'),'name = hw_native_probe\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe,'init.lua'),`-- Test observation only, no production dependency.
local path=core.get_worldpath()
local c={swap_node=0,vm_write=0,fix_light=0,callbacks=0}
local function save() core.safe_file_write(path..'/native-counts.json',core.write_json(c)) end
local old_protected=core.is_protected
core.is_protected=function(pos,name) local f=io.open(path..'/native-protected','r');if f then f:close();return true end;return old_protected(pos,name) end
local swap=core.swap_node
core.swap_node=function(...) c.swap_node=c.swap_node+1;local r=swap(...);if r~=true then c.nativeSwapFailures=(c.nativeSwapFailures or 0)+1;c.lastSwapReturn=type(r)..':'..tostring(r) end;return r end
local light=core.fix_light
core.fix_light=function(pos,...)
 c.fix_light=c.fix_light+1;local r=light(pos,...)
 if r~=true then c.nativeLightFailures=(c.nativeLightFailures or 0)+1;c.lastLightReturn=type(r)..':'..tostring(r) end
 local f=io.open(path..'/state-fail','r')
 if f then
  f:close();os.remove(path..'/state-fail')
  core.get_meta(pos):set_string('unexpected','injected-readback-mismatch')
  core.safe_file_write(path..'/native-protected','restore must remain pending')
 end
 return r
end
local node_light=core.get_node_light
core.get_node_light=function(pos,...) local r=node_light(pos,...);if type(r)~='number' then c.nativeLightReadFailures=(c.nativeLightReadFailures or 0)+1;c.lastLightNode=core.get_node(pos).name end;return r end
core.register_on_mods_loaded(function()
 assert(rawget(_G,'worldedit')==nil,'WorldEdit API must be absent')
 for _,n in ipairs(core.get_modnames()) do assert(n~='worldedit','WorldEdit mod must be absent') end
 c.worldeditAbsent=true
end)
core.after(0,function()
 local mt=getmetatable(core.get_voxel_manip());local index=type(mt)=='table' and (type(mt.write_to_map)=='function' and mt or mt.__index)
 assert(type(index)=='table' and type(index.write_to_map)=='function','native VM observer unavailable')
 local write=index.write_to_map;index.write_to_map=function(...) c.vm_write=c.vm_write+1;return write(...) end
 save();core.log('action','HW_NATIVE_OBSERVER_READY')
 local function answer()
  local f=io.open(path..'/native-query.json','r')
  if f then
   local q=core.parse_json(f:read('*a'));f:close();os.remove(path..'/native-query.json')
   if q.seed then for _,p in ipairs(q.seedPositions or {{x=0,y=65,z=0},{x=1,y=65,z=0}}) do
    core.get_meta(p):from_table({fields={owner='native-state-fixture'},inventory={main={q.seed..' 2',''}}})
   end end
   core.safe_file_write(path..'/native-answer.json',core.write_json({id=q.id,done=true,counts=c}))
  end
  core.after(0.1,answer)
 end
 answer()
end)
`);
const evidence={requestedPath:process.env.HW_NATIVE_PATH ?? 'ALL',layers:{real:'Adapter handlers, durable journal, native courier, Luanti 5.17, '+(process.env.HW_GAME?'VoxeLibre 0.92.3 flat world':'component fixture game'),fixture:'headless NativeControl Host, Canvas/registry/history/oracle peers and hw_native_probe observer; no product UI or connected player'},steps:[],events:[]};
const step=(name,detail={})=>{evidence.steps.push({name,...detail});console.log('PASS',name);};
// Headless NativeControl fixture: the production dev host is for a client
// binary with --server. luantiserver itself rejects that option. This peer owns
// real children and reports actual pid/exit; it does not invent STOPPED evidence.
const records=new Map();
const owned={records,host:{
 async acquire(input){
  const listener=createServer();await new Promise(y=>listener.listen(0,'127.0.0.1',y));const port=listener.address().port;await new Promise(y=>listener.close(y));
  const logfile=join(root,'logs','server-'+seq+'.log'),config=join(root,'logs','server-'+seq+'.conf');
  await writeFile(config,`port = ${port}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nenable_damage = false\n`,{mode:0o600});
  const argv=[...(process.env.HW_LUANTI_MODE==='client'?['--server']:[]),'--world',input.worldPath,'--config',config,'--logfile',logfile];
  const child=spawn(process.env.HW_LUANTI,argv,{env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile,XDG_CACHE_HOME:join(profile,'cache'),TMPDIR:join(root,'tmp')},stdio:['ignore','pipe','pipe']});
  const controlRef='native-test:'+seq,record={child,input,exit:null};records.set(controlRef,record);
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>appendFileSync(join(root,'native-output.log'),data));
  child.on('exit',(code,signal)=>{record.exit={code,signal};});
  child.on('error',error=>{record.exit={error:error.message};});
  evidence.events.push({kind:'NATIVE_START',pid:child.pid,argv,worldPath:input.worldPath});
  while(!(await readFile(logfile,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).includes('HW_NATIVE_OBSERVER_READY')){
   if(record.exit)throw Error('LUANTI_EARLY_EXIT '+JSON.stringify(record.exit));
   await new Promise(y=>setTimeout(y,100));
  }
  return {controlRef,worldPath:input.worldPath};
 },
 async inspect(q){const r=records.get(q.controlRef);assert.ok(r&&!r.exit);process.kill(r.child.pid,0);return {state:'CURRENT',worldPath:r.input.worldPath,processId:r.child.pid,operationRef:r.input.operationRef};},
},async shutdown(){for(const r of records.values()){if(!r.exit){const done=once(r.child,'exit');r.child.kill('SIGINT');await done;}assert.equal(r.exit.code,0,JSON.stringify(r.exit));}}};

let runtime,query,localContext;let seq=0;
const ctx=new Context();let canvasContext;
const canvasFiber=ctx.plugin({name:'renamed-native-contract-peer',apply(c){canvasContext=c;}});await canvasFiber.await();
const canvas={async call(name,q){return C.validateBoundResponse('canvas/v7',name,q,{contractVersion:'canvas/v7',requestId:q.requestId,result:{sessionRef:q.sessionRef,worldRef:q.worldRef,inventory:{capabilityRevision:'test-peer',connections:[]},selection:{status:'BOUND',connectionRef:localContext.connectionRef,context:{currentSession:'test-session',activeWorldRef:localContext.worldRef,orderedSelectedObjectRefs:[],sessionRevision:'session-1',selectionRevision:'selection-1',localContext}}},error:null});}};
canvasContext.provide('hanaworldsCanvasV5',canvas);
canvasContext.provide('hanaworldsCanvasRegionV1',{call:()=>{}});
const history={read:async r=>({...r,current:true,durable:true,historyRevision:r.expectedHistoryRevision,worldRevision:r.expectedWorldRevision,objectRevisions:r.expectedObjectRevisions})};
const world={...made.identity,worldPath:made.worldPath,connectionRef:'native-test-connection',gameId};
async function start(){
 const input={requesterRef:'adapter-test',operationRef:'native-start-'+(++seq),worldPath:made.worldPath,userPath:profile};
 const lease=await owned.host.acquire(input);query={controlRef:lease.controlRef,requesterRef:input.requesterRef,operationRef:input.operationRef,worldPath:input.worldPath};
 runtime=createLocalRuntime({ctx,homePath:(...p)=>join(root,'home',...p),resolveCanvas:()=>canvas,resolveRegistry:()=>({}),resolveHistory:()=>history,resolveOracle:()=>({read:async()=> 'world-head-1'}),resolveInspection:()=>({}),inspectConnection:()=>owned.host.inspect(query)});
 if(ctx.get('hanaworldsWorldAdapterV6')) {ctx.set('hanaworldsWorldAdapterV6',runtime.port);ctx.set('hanaworldsWorldAdapterRegionV1',runtime.regionIO);}
 else {ctx.provide('hanaworldsWorldAdapterV6',runtime.port);ctx.provide('hanaworldsWorldAdapterRegionV1',runtime.regionIO);}
 const paired=await runtime.pairLocal(world);localContext={worldRef:world.worldRef,connectionRef:world.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef,selectionRevision:'selection-1'};
}
async function stop(){try{if(runtime)await runtime.close();}finally{runtime=null;await owned.shutdown();}}
const call=(name,extra={})=>canvasContext.get('hanaworldsWorldAdapterV6').call(name,{contractVersion:'world-adapter/v8',sessionRef:'test-session',requestId:'call-'+(++seq),...(name==='ReadLocalConnection'?{}:{worldRef:world.worldRef,localContext}),...extra});
const ok=async(name,extra)=>{const r=await call(name,extra);if(r.error)evidence.steps.push({name:'FAILED_'+name,response:r,counters:await counts()});assert.equal(r.error,null,JSON.stringify(r));return r.result;};
const region=async(name,extra)=>{const r=await canvasContext.get('hanaworldsWorldAdapterRegionV1').call(name,{contractVersion:'world-adapter-region/v3',sessionRef:'test-session',requestId:'region-'+(++seq),worldRef:world.worldRef,localContext,partition:WORLD_GEOMETRY.partition,...extra});assert.equal(r.error,null,JSON.stringify(r.error));return r;};
const read=async box=>{const r=await region('ReadRegion',{box,purpose:'BEFORE_IMAGE'});C.requireKnownRegion(r.result);return r.result;};
let probeSeq=0;
async function observe(input){const id=++probeSeq;const pending=join(made.worldPath,'native-query.pending');await writeFile(pending,JSON.stringify({id,...input}));await rename(pending,join(made.worldPath,'native-query.json'));
 while(true){const raw=await readFile(join(made.worldPath,'native-answer.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(raw){const out=JSON.parse(raw);if(out.id===id)return out;}await owned.host.inspect(query);await new Promise(y=>setTimeout(y,100));}}
const counts=async()=> (await observe({counts:true})).counts;
const digests=r=>r.chunks.map(c=>c.stateDigest);
function writesFor(snapshot,palette,rule){return snapshot.chunks.map(c=>{const size=c.box.max.map((v,i)=>v-c.box.min[i]+1),indices=new Int32Array(size.reduce((a,b)=>a*b));let i=0;
 for(let z=c.box.min[2];z<=c.box.max[2];z++)for(let y=c.box.min[1];y<=c.box.max[1];y++)for(let x=c.box.min[0];x<=c.box.max[0];x++)indices[i++]=rule(x,y,z);
 if(!indices.some(i=>i>=0))return null;
 return {chunkPos:c.chunkPos,expectedCurrentDigest:c.stateDigest,ops:C.encodeRegionBlock({origin:c.box.min,size,palette,indices}),state:null};}).filter(Boolean);}
const restoreWrites=(current,target)=>target.chunks.map((c,i)=>({chunkPos:c.chunkPos,expectedCurrentDigest:current.chunks[i].stateDigest,ops:null,state:c.state}));
async function write(purpose,writes,id){const r=await region('WriteRegion',{transactionId:id,purpose,writes});assert.ok(r.result.chunks.every(c=>c.status==='WRITTEN'),JSON.stringify(runtime.regionIO.lastFacts()));return {response:r,facts:runtime.regionIO.lastFacts()};}
try {
 await start();
 const f=await runtime.readConfigEngineFacts(world.worldRef);assert.equal(f.writeBackend.availability,'KNOWN');assert.equal(f.writeBackend.writeBackend.profileId,'hanaworlds-luanti-native-cell-write/v2');
 await assert.rejects(runtime.readWorldEditFacts(world.worldRef),/CAPABILITY_UNAVAILABLE/);
 const connection=await ok('ReadLocalConnection',{connectionRef:world.connectionRef});assert.deepEqual(JSON.parse(JSON.stringify(connection.capabilities.stateProfile)),JSON.parse(JSON.stringify(STATE_PROFILE)));
 step('NATIVE_PAIR_AND_FACTS',{writeBackend:f.writeBackend,capabilities:connection.capabilities});
 const catalogue=await runtime.readCatalogue(world.worldRef);
 // Adapter-owned translation of the registry actually read over its courier.
 const vocabulary=new WorldVocabulary(registry);const ref=name=>vocabulary.material(name,0);
 const stone=ref(process.env.HW_GAME?'mcl_core:stone':'base:stone'),air={materialRef:catalogue.emptyMaterialRef,orientation:0};
 assert.equal(catalogue.materials[stone.materialRef].placeable,true,'stone must be declared static');
 // REGION gate: load-then-know, sparse cross-partition write, neutral readback,
 // stale digest zero-write, stateful exact restore, and mandatory lighting.
 const regionBox={min:[-17,64,-17],max:[32,67,32]};await read(regionBox);
 await observe({seed:process.env.HW_GAME?'mcl_core:stone':'base:stone'});
 const before=await read(regionBox);assert.ok(before.chunks.flatMap(c=>c.state.extras).some(e=>e.state.metadata?.owner==='native-state-fixture'));
 assert.ok(before.chunks.length>4);assert.ok(before.chunks.every(c=>['ALREADY_LOADED','LOADED_ON_DEMAND'].includes(c.loadMethod)));
 const ops=writesFor(before,[stone,air],(x,y,z)=>y===65&&x%3===0?0:y===66&&z%5===0?1:-1);
 const c0=await counts(),applied=await write('APPLY',ops,'region-sparse'),after=await read(regionBox),c1=await counts();
 for(let i=0;i<before.chunks.length;i++){const w=ops.find(w=>w.chunkPos.join()===before.chunks[i].chunkPos.join());assert.equal(after.chunks[i].stateDigest,w?D('region-state',C.expectedRegionState(before.chunks[i].state,w.ops)):before.chunks[i].stateDigest);}
 assert.equal(c1.swap_node,c0.swap_node);assert.equal(c1.vm_write-c0.vm_write,applied.facts.batches.length);assert.ok(applied.response.result.lighting.status==='COMPLETE');
 const stale=await canvasContext.get('hanaworldsWorldAdapterRegionV1').call('WriteRegion',{contractVersion:'world-adapter-region/v3',sessionRef:'test-session',requestId:'stale',worldRef:world.worldRef,localContext,partition:WORLD_GEOMETRY.partition,transactionId:'stale',purpose:'APPLY',writes:ops});assert.equal(stale.error?.code,'TRANSACTION_CONFLICT');assert.deepEqual(await counts(),c1);
 await write('RESTORE',restoreWrites(after,before),'region-restore');assert.deepEqual(digests(await read(regionBox)),digests(before));
 await writeFile(join(made.worldPath,'native-protected'),'test protection fixture');
 const protectedResponse=await canvasContext.get('hanaworldsWorldAdapterRegionV1').call('WriteRegion',{contractVersion:'world-adapter-region/v3',sessionRef:'test-session',requestId:'protected',worldRef:world.worldRef,localContext,partition:WORLD_GEOMETRY.partition,transactionId:'protected',purpose:'APPLY',writes:ops});
 assert.equal(protectedResponse.guardRefusal?.guard,'CELL_PROTECTION');assert.equal(protectedResponse.error.mutationState,'NONE');
 await unlink(join(made.worldPath,'native-protected'));assert.deepEqual(digests(await read(regionBox)),digests(before));
 const callbackBox={min:[0,72,0],max:[0,72,0]},cb=await read(callbackBox),unsafe=ref(process.env.HW_GAME?'mcl_core:water_source':'base:callback');
 assert.equal(catalogue.materials[unsafe.materialRef].placeable,false);const u0=await counts();
 const rejected=await region('WriteRegion',{transactionId:'callback-refusal',purpose:'APPLY',writes:writesFor(cb,[unsafe],()=>0)}).catch(e=>e);assert.ok(rejected instanceof Error);assert.deepEqual(await counts(),u0);assert.deepEqual(digests(await read(callbackBox)),digests(cb));
 step('CALLBACK_AND_PROTECTION_ZERO_WRITE',{protectedError:protectedResponse.error,callbackError:rejected.message});
 step('REGION_IO_NATIVE',{chunks:before.chunks.length,batches:applied.facts.batches.length,light:applied.response.result.lighting,countersBefore:c0,countersAfter:c1,staleError:stale.error});
 if(!process.env.HW_NATIVE_PATH || process.env.HW_NATIVE_PATH==='ALL' || process.env.HW_NATIVE_PATH==='J3'){
 // StateProfile regression on actual Luanti: callback-free nodes can still
 // carry metadata/inventory. Ordinary writes clear them; recovery restores them.
 const statePosition=[20,80,20],stateBox={min:statePosition,max:statePosition};await read(stateBox);
 await observe({seed:process.env.HW_GAME?'mcl_core:stone':'base:stone',seedPositions:[{x:20,y:80,z:20}]});
 const statePrepare=async id=>{
  const effects=[{geometryProfile:'voxel-grid/v1',position:statePosition,...stone}];
  const facts=await runtime.readScopedState(world.connectionRef,[statePosition]);
  const operations=C.validateType('OperationsProjection',{contractVersion:'operations/v4',buildDigest:'0'.repeat(64),compilerRevision:'test-peer',compilationConfigDigest:'1'.repeat(64),worldRef:world.worldRef,frameDigest:'2'.repeat(64),catalogueDigest:D('catalogue',catalogue),targetFactsDigest:'3'.repeat(64),effects});
  const operationDigest=D('operations',operations),scope=C.validateType('ScopedWorldBinding',{transactionId:id,worldRef:world.worldRef,operationDigest,stateProfile:facts.stateProfile,checkedPositions:[statePosition],objects:[],cells:facts.cells,localContext});
  const common={transactionId:id,operations,operationDigest,scope,scopeDigest:D('scoped-world',scope),guarantee:'RECOVERABLE_VERIFIED'};
  const prepared=await ok('PrepareRecoverableTransaction',common);
  return {common,prepared};
 };
 const readState=id=>ok('Readback',{transactionId:id,coveredPositions:[statePosition],stateProfile:STATE_PROFILE});
 const clearedTx=await statePrepare('state-cleared');
 const clearedReceipt=await ok('ApplyCompiledTransaction',{...clearedTx.common,preparedTransaction:C.projectScopedPreparedTransaction(clearedTx.prepared)});
 assert.equal(clearedReceipt.status,'VERIFIED');const clearedState=await readState('state-cleared');
 assert.deepEqual(Object.keys(clearedState.projection.records[0].state),['lighting']);
 assert.equal(clearedReceipt.readbackDigest,clearedState.readbackDigest);
 await observe({seed:process.env.HW_GAME?'mcl_core:stone':'base:stone',seedPositions:[{x:20,y:80,z:20}]});
 const pendingTx=await statePrepare('state-recovery'),stateBefore=await readState('state-recovery');
 await writeFile(join(made.worldPath,'state-fail'),'test-only injection');
 const failed=await canvasContext.get('hanaworldsWorldAdapterV6').call('ApplyCompiledTransaction',{contractVersion:'world-adapter/v8',sessionRef:'test-session',requestId:'state-failed',worldRef:world.worldRef,localContext,...pendingTx.common,preparedTransaction:C.projectScopedPreparedTransaction(pendingTx.prepared)});
 assert.equal(failed.error?.code,'RESTORE_FAILED');assert.equal(failed.guardRefusal?.stage,'RESTORE');
 const pending=await readState('state-recovery');assert.equal(pending.projection.records[0].state.metadata.unexpected,'injected-readback-mismatch');
 await unlink(join(made.worldPath,'native-protected'));
 const restored=await ok('RestoreTransaction',{originTransactionId:'state-recovery',operationDigest:pendingTx.common.operationDigest,beforeImageDigest:pendingTx.prepared.beforeImageDigest,restoreAttemptIdentity:'state-restore-1',guarantee:'RECOVERABLE_VERIFIED'});
 assert.equal(restored.status,'ROLLED_BACK');assert.equal(restored.restoreStatus,'VERIFIED_RESTORED');
 const stateAfter=await readState('state-recovery');
 const withoutLight=r=>({...r,state:Object.fromEntries(Object.entries(r.state).filter(([k])=>!STATE_PROFILE.derivedFields.includes(k)))});
 assert.deepEqual(withoutLight(stateAfter.projection.records[0]),withoutLight(stateBefore.projection.records[0]));
 assert.equal(restored.readbackDigest,stateAfter.readbackDigest);assert.equal(stateAfter.readbackDigest,D('readback',stateAfter.projection));
 step('STATE_PROFILE_NATIVE_CLEAR_READBACK_RESTORE',{before:stateBefore,cleared:clearedState,failed,restored,after:stateAfter});
 // J3 adapter path: actual prepared/durable per-cell house transaction, readback,
 // process/runtime restart, then public history undo via native apply_state.
 const houseBox={min:[0,80,0],max:[11,87,11]};await read(houseBox);
 const effects=[];for(let x=0;x<12;x++)for(let y=80;y<88;y++)for(let z=0;z<12;z++)if(x===0||x===11||y===80||y===87||z===0||z===11)effects.push({geometryProfile:'voxel-grid/v1',position:[x,y,z],...stone});
 const positions=effects.map(e=>e.position),scopeFacts=await runtime.readScopedState(world.connectionRef,positions);
 const operations=C.validateType('OperationsProjection',{contractVersion:'operations/v4',buildDigest:'0'.repeat(64),compilerRevision:'test-peer',compilationConfigDigest:'1'.repeat(64),worldRef:world.worldRef,frameDigest:'2'.repeat(64),catalogueDigest:D('catalogue',catalogue),targetFactsDigest:'3'.repeat(64),effects});
 const operationDigest=D('operations',operations),scope=C.validateType('ScopedWorldBinding',{transactionId:'house',worldRef:world.worldRef,operationDigest,stateProfile:scopeFacts.stateProfile,checkedPositions:positions,objects:[],cells:scopeFacts.cells,localContext});
 const common={transactionId:'house',operations,operationDigest,scope,scopeDigest:D('scoped-world',scope),guarantee:'RECOVERABLE_VERIFIED'};
 const prepared=await ok('PrepareRecoverableTransaction',common),h0=await counts(),receipt=await ok('ApplyCompiledTransaction',{...common,preparedTransaction:C.projectScopedPreparedTransaction(prepared)}),h1=await counts();
 assert.equal(receipt.status,'VERIFIED');
 // Writes use the engine function bound at payload load; a mod-level swap_node wrapper (this probe, or
 // VoxeLibre mcl_observers) is never invoked. Every cell is proven by the readback below.
 assert.equal(h1.swap_node-h0.swap_node,0);
 await read(houseBox); // Headless world: load through the declared region port before a later scoped read.
 const readback=await ok('Readback',{transactionId:'house',coveredPositions:positions,stateProfile:STATE_PROFILE});assert.ok(readback.projection.records.every(r=>r.materialRef===stone.materialRef));
 const written=localContext;await stop();await start();await read(houseBox);
 // Real stop + reconnect: new incarnation; the durable receipt comes back as written beside the current context.
 const queryRequest={contractVersion:'world-adapter/v8',sessionRef:'test-session',requestId:'call-'+(++seq),worldRef:world.worldRef,localContext,transactionId:'house',transactionPayloadDigest:prepared.transactionPayloadDigest};
 const queried=await canvasContext.get('hanaworldsWorldAdapterV6').call('QueryTransaction',queryRequest);if(queried.error)evidence.steps.push({name:'FAILED_QueryTransaction',response:queried});
 const historical=C.readHistoricalReceipt(queryRequest,queried);
 assert.equal(historical.historical,true);assert.equal(historical.sameIncarnation,false);const plain=v=>JSON.parse(JSON.stringify(v));assert.deepEqual(plain(historical.writtenContext),plain(written));
 assert.deepEqual(plain(historical.receipt),plain(receipt));assert.equal(historical.receiptDigest,D('receipt',receipt));
 const historyOperation={contractVersion:'world-adapter/v8',worldRef:world.worldRef,originTransactionId:'house',transactionId:'house-undo',direction:'UNDO',affectedObjectRefs:[],originVerifiedReceiptDigest:D('receipt',receipt),originBeforeImageDigest:prepared.beforeImageDigest,originBeforeStateReadbackDigest:prepared.beforeStateReadbackDigest,originAfterReadbackDigest:receipt.readbackDigest,expectedCurrentStateDigest:receipt.readbackDigest,targetStateDigest:prepared.beforeStateReadbackDigest,expectedHistoryRevision:'history-1',expectedWorldRevision:receipt.observedWorldRevision,expectedObjectRevisions:{},guarantee:'RECOVERABLE_VERIFIED',localContext};
 const hist={...historyOperation,historyOperationDigest:D('history-operation',historyOperation)};delete hist.contractVersion;delete hist.worldRef;delete hist.localContext;
 const ph=await ok('PrepareHistoryTransaction',hist),undo=await ok('ApplyHistoryTransaction',{originTransactionId:'house',transactionId:'house-undo',direction:'UNDO',historyOperationDigest:hist.historyOperationDigest,preparedHistoryTransaction:ph,expectedWorldRevision:historyOperation.expectedWorldRevision,expectedObjectRevisions:{}});assert.equal(undo.status,'VERIFIED');
 await read(houseBox);
 const back=await ok('Readback',{transactionId:'house-undo',coveredPositions:positions,stateProfile:STATE_PROFILE});assert.ok(back.projection.records.every(r=>r.materialRef===air.materialRef));
 step('J3_NATIVE_HOUSE_RESTART_UNDO',{cells:effects.length,receipt,query:{response:queried,writtenContext:historical.writtenContext,currentContext:historical.currentContext,sameIncarnation:historical.sameIncarnation},undo,countersBefore:h0,countersAfter:h1});
 }
 if(!process.env.HW_NATIVE_PATH || process.env.HW_NATIVE_PATH==='ALL' || process.env.HW_NATIVE_PATH==='J5'){
 // J5 adapter path: 49 partitions force multiple native batches even with the
 // largest possible courier budget. Negative and positive boundaries are both crossed.
 const lakeBox={min:[-48,96,-48],max:[63,99,63]},lakeBefore=await read(lakeBox);
 assert.equal(lakeBefore.chunks.length,49);
 assert.ok(lakeBefore.chunks.every(c=>c.state.block.geometryProfile==='voxel-grid/v1'));
 const lakeOps=writesFor(lakeBefore,[stone,air],(x,y,z)=>y===96?0:1),l0=await counts(),lake=await write('APPLY',lakeOps,'lake'),lakeAfter=await read(lakeBox),l1=await counts();
 for(let i=0;i<lakeBefore.chunks.length;i++)assert.equal(lakeAfter.chunks[i].stateDigest,D('region-state',C.expectedRegionState(lakeBefore.chunks[i].state,lakeOps[i].ops)));
 assert.equal(l1.swap_node,l0.swap_node);assert.equal(l1.vm_write-l0.vm_write,lake.facts.batches.length);
 assert.ok(lake.facts.batches.length>1,'J5 must cross multiple native batches');
 assert.equal(lake.response.result.lighting.status,'COMPLETE');
 await stop();await start();const persisted=await read(lakeBox);assert.deepEqual(digests(persisted),digests(lakeAfter));
 const restored=await write('RESTORE',restoreWrites(persisted,lakeBefore),'lake-restore');assert.deepEqual(digests(await read(lakeBox)),digests(lakeBefore));
 assert.equal(restored.response.result.lighting.status,'COMPLETE');
 step('J5_NATIVE_BATCH_RESTART_RESTORE',{cells:112*4*112,chunks:lakeBefore.chunks.length,partition:WORLD_GEOMETRY.partition,geometryProfile:'voxel-grid/v1',applyBatches:lake.facts.batches.length,restoreBatches:restored.facts.batches.length,apply:lake.response.result,restore:restored.response.result,countersBefore:l0,countersAfter:l1});
 }
 assert.equal((await counts()).worldeditAbsent,true);assert.ok(!(await readdir(join(profile,'games',gameId,'mods'))).includes('worldedit'));
 const required=['NATIVE_PAIR_AND_FACTS','CALLBACK_AND_PROTECTION_ZERO_WRITE','REGION_IO_NATIVE',...(['ALL','J3'].includes(selectedPath)?['STATE_PROFILE_NATIVE_CLEAR_READBACK_RESTORE','J3_NATIVE_HOUSE_RESTART_UNDO']:[]),...(['ALL','J5'].includes(selectedPath)?['J5_NATIVE_BATCH_RESTART_RESTORE']:[])];
 assert.ok(required.every(name=>evidence.steps.some(s=>s.name===name)),'required path evidence missing');evidence.requiredSteps=required;
 evidence.pass=true;
} catch(error){evidence.pass=false;evidence.failure={message:error.message,stack:error.stack};throw error;
} finally {LocalCourier.prototype.catalogue=nativeCatalogue;try{await stop();await canvasFiber.dispose();}catch(error){evidence.cleanupError={message:error.message};evidence.pass=false;process.exitCode=1;}evidence.processes=[...owned.records.values()].map(r=>({pid:r.child.pid,exit:r.exit}));await writeFile(join(root,'results.json'),JSON.stringify(evidence,null,2)+'\n');}
