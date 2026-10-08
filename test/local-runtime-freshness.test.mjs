// SOURCE/FIXTURE: actual runtime with contract-shaped Canvas/engine fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import * as C from '#contracts';
import {LocalCourier} from '../src/local-courier.mjs';
import {createLocalRuntime} from '../src/local-runtime.mjs';
const base=process.env.HW_BIND_TEST_ROOT;if(!base)throw Error('own root required');
const profile={profileVersion:'state-profile/v2',nodeFields:['nodeName','param1','param2'],metadataMode:'exact',inventoryMode:'exact',timerMode:'exact',derivedLightMode:'recompute-with-readback'};
async function setup(t){
 await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'freshness-'));const exits=new Set();
 let context,oracle,inspection,afterOracle=()=>{},afterInspection=()=>{},afterSample=()=>{},beforeCanvas=async()=>{};
 const goodOracle={async read(){afterOracle();return 'world-rev:1';}};
 const goodInspection={async read(){await afterInspection();return {current:true,worldRef:'A',worldRevision:'world-rev:1',objectRef:'obj',objectRevision:'object-rev:1'};}};
 oracle=goodOracle;inspection=goodInspection;
 t.mock.method(LocalCourier,'open',async w=>({closed:false,connectionIncarnationRef:'inc:'+w.worldRef,handshake:async()=>{},profile:async()=>profile,close:async()=>{},catalogue:async()=>({profileVersion:'catalogue/v2',engineProfile:'fixture',gameId:'fixture',gameRevision:'fixture:1',modRevisions:{},nodes:{}}),capacity:async()=>({allowed:true}),inspect:async positions=>{afterSample();return {occupiedCells:[],knownEmptyCells:positions,unknownCells:[]};}}));
 const canvas={async call(name,q){await beforeCanvas();return C.validateBoundResponse('canvas/v5',name,q,{contractVersion:'canvas/v5',requestId:q.requestId,result:{sessionRef:q.sessionRef,worldRef:q.worldRef,inventory:{capabilityRevision:'fixture',connections:[]},selection:{status:'BOUND',connectionRef:context.localContext.connectionRef,context}},error:null});}};
 const runtime=createLocalRuntime({ctx:{},homePath:(...parts)=>join(root,...parts),resolveOracle:()=>oracle,resolveInspection:()=>inspection,resolveCanvas:()=>canvas,inspectConnection:async ref=>{if(exits.has(ref))throw Error('CURRENT_WORLD_MISMATCH');return {state:'CURRENT'};}});
 const pair=async worldRef=>runtime.pairLocal({worldRef,worldPath:join(root,worldRef),connectionRef:'c:'+worldRef,payloadVersion:'0.6.0',payloadDigest:'0'.repeat(64),gameId:'fixture'});
 await pair('A');context={currentSession:'S1',activeWorldRef:'A',orderedSelectedObjectRefs:['obj'],sessionRevision:'session:1',selectionRevision:'selection:1',localContext:{connectionRef:'c:A',worldRef:'A',connectionIncarnationRef:'inc:A',selectionRevision:'selection:1'}};
 const inspect=()=>runtime.port.call('InspectWorld',{contractVersion:'world-adapter/v6',requestId:Math.random().toString(),sessionRef:'S1',worldRef:'A',expectedWorldRevision:'world-rev:1',sampledBounds:{min:[0,0,0],max:[0,0,0]},localContext:context.localContext});
 const inventory=()=>runtime.port.call('DiscoverConnections',{contractVersion:'world-adapter/v6',requestId:Math.random().toString(),sessionRef:'S1',adapterId:'hanaworlds-adapter-luanti'});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true});});
 return {runtime,pair,exits,inventory,inspect,replaceOracle:()=>{oracle={...goodOracle};},replaceInspection:()=>{inspection={...goodInspection};},onOracle:f=>afterOracle=f,onInspection:f=>afterInspection=f,onSample:f=>afterSample=f,onCanvas:f=>beforeCanvas=f};
}
test('C3 native exit removes only failed connection and changes stable aggregate inventory revision',async t=>{
 const f=await setup(t);await f.pair('B');const before=(await f.inventory()).result;f.exits.add('c:A');const after=await f.inventory();assert.equal(after.error,null);assert.deepEqual(after.result.connections.map(x=>x.worldRef),['B']);assert.notEqual(after.result.capabilityRevision,before.capabilityRevision);assert.equal((await f.inventory()).result.capabilityRevision,after.result.capabilityRevision);
});
for(const phase of ['oracle-read','inspection-read','native-sample'])test('provider replacement at '+phase+' rejects Inspection instead of returning facts',async t=>{
 const f=await setup(t);if(phase==='oracle-read')f.onOracle(f.replaceOracle);if(phase==='inspection-read')f.onInspection(f.replaceInspection);if(phase==='native-sample')f.onSample(f.replaceInspection);
 const r=await f.inspect();assert.equal(r.result,null);assert.equal(r.error.code,'CURRENT_WORLD_MISMATCH');
});

for(const phase of ['Canvas-current-read','Inspection-provider-read'])test('read-only Adapter inventory completes inside '+phase+' without queuing behind its caller',async t=>{
 const f=await setup(t);let completed=false;
 const nested=async()=>{let timer;try{completed=await Promise.race([f.inventory().then(r=>r.error===null&&r.result.connections.length===1),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),100);})]);}finally{clearTimeout(timer);}};
 if(phase==='Canvas-current-read')f.onCanvas(nested);else f.onInspection(nested);
 const r=await f.inspect();assert.equal(r.error,null);assert.equal(completed,true,'nested read must complete before outer Inspection; deadline is test diagnosis only');
});
