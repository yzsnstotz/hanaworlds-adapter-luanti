// Actual adapter handlers and durable records; native engine and Canvas are explicit fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import * as C from '#contracts';
import {LocalCourier} from '../src/local-courier.mjs';
import {createLocalRuntime} from '../src/local-runtime.mjs';
import {ENGINE_GUARDS} from '../src/safety-capabilities.mjs';
import {WORLD_GEOMETRY,STATE_PROFILE} from '../src/world-vocabulary.mjs';
import {cellDigest} from '../src/local-transactions.mjs';
const plain=v=>JSON.parse(JSON.stringify(v));
const digest=(k,v)=>C.digestValue(k,v).sha256;
async function fixture(t,{mismatch=false,initialState={},root:reuse=null,incarnation='fixture-incarnation'}={}) {
 const base=process.env.HW_ADAPTER_TEST_ROOT ?? join(tmpdir(),'hanaworlds-adapter-tests');
 await mkdir(base,{recursive:true});const root=reuse ?? await mkdtemp(join(base,'v2-runtime-'));
 const catalogue=JSON.parse(execFileSync('lua',['test/support/material-facts.lua','glass'],{encoding:'utf8'})).catalogue;
 let record={position:[0,0,0],nodeName:'air',param1:0,param2:0,metadata:{},inventory:{},timer:null,...plain(initialState)};
 let restoreBlocked=false,restoreCorrupt=false;
 const calls=[];
 const image=()=>({worldRef:'fixture-world',coveredPositions:[[0,0,0]],records:[plain(record)]});
 const native={closed:false,engineGuards:ENGINE_GUARDS,connectionIncarnationRef:incarnation,
  handshake:async()=>{},close:async()=>{native.closed=true;},catalogue:async()=>plain(catalogue),profile:async()=>({profileVersion:'state-profile/v2'}),
  regionLimits:async()=>({mapblockSize:16,mapgenLimit:31000}),capacity:async()=>({allowed:true}),
  snapshot:async()=>image(),prepareCheck:async(positions,effects)=>{calls.push({kind:'check',effects:plain(effects)});},
  apply:async(effects,before,scope)=>{calls.push({kind:'apply',effects:plain(effects),before:plain(before),scope:plain(scope)});
    record={...record,...effects[0],param1:15,param2:mismatch?0:effects[0].param2,metadata:{},inventory:{},timer:null};return {status:'APPLIED_PENDING_READBACK'};},
  applyState:async(target,before)=>{calls.push({kind:'history',target:plain(target),before:plain(before)});record={...plain(target.records[0]),param1:12};return {status:'APPLIED_PENDING_READBACK'};},
  restore:async(before)=>{calls.push({kind:'restore',before:plain(before)});if(restoreBlocked)throw Error('RESTORE_FAILED');
    record={...plain(before.records[0]),param1:14};if(restoreCorrupt)record.metadata={owner:'wrong'};return {status:'ROLLED_BACK'};},
  inspect:async positions=>({occupiedCells:record.nodeName==='air'?[]:[{position:record.position,nodeName:record.nodeName,param2:record.param2}],knownEmptyCells:record.nodeName==='air'?positions:[],unknownCells:[]})};
 t.mock.method(LocalCourier,'open',async()=>native);
 const localContext={worldRef:'fixture-world',connectionRef:'fixture-connection',connectionIncarnationRef:incarnation,selectionRevision:'selection-1'};
 const context={currentSession:'fixture-session',activeWorldRef:localContext.worldRef,orderedSelectedObjectRefs:[],sessionRevision:'session-1',selectionRevision:'selection-1',localContext};
 const rootCtx={}; const ctx={root:rootCtx,fiber:{state:2,entry:{options:{name:'hanaworlds-canvas'}},ctx:{root:rootCtx}}};
 const canvas={async call(name,q){return C.validateBoundResponse('canvas/v7',name,q,{contractVersion:'canvas/v7',requestId:q.requestId,result:{sessionRef:q.sessionRef,worldRef:q.worldRef,inventory:{capabilityRevision:'fixture',connections:[]},selection:{status:'BOUND',connectionRef:localContext.connectionRef,context}},error:null});}};
 const oracle={read:async()=> 'revision-1'};
 const inspection={read:async()=>({current:true,worldRef:localContext.worldRef,worldRevision:'revision-1',objectRef:'fixture-object',objectRevision:'object-1'})};
 const history={read:async r=>({...r,current:true,durable:true,historyRevision:r.expectedHistoryRevision,worldRevision:r.expectedWorldRevision,objectRevisions:r.expectedObjectRevisions})};
 const runtime=createLocalRuntime({ctx,homePath:(...p)=>join(root,...p),resolveCanvas:()=>canvas,resolveRegistry:()=>({}),resolveHistory:()=>history,resolveOracle:()=>oracle,resolveInspection:()=>inspection,inspectConnection:async()=>({state:'CURRENT'})});
 t.after(()=>runtime.close());
 await runtime.pairLocal({worldRef:localContext.worldRef,connectionRef:localContext.connectionRef,worldPath:root,payloadVersion:'fixture-payload',payloadDigest:'0'.repeat(64),gameId:'fixture'});
 let seq=0;
 const call=(name,extra={})=>runtime.port.call(name,{contractVersion:'world-adapter/v8',sessionRef:'fixture-session',requestId:`request-${++seq}`,worldRef:localContext.worldRef,localContext,...extra});
 return {root,runtime,call,localContext,calls,recomputeLight:()=>{record.param1=10;},
  editMetadata:value=>{record.metadata=plain(value);},blockRestore:value=>{restoreBlocked=value;},corruptRestore:value=>{restoreCorrupt=value;}};
}
test('existing catalogue supplier and ReadLocalConnection expose complete v2 material/geometry facts',async t=>{
 const f=await fixture(t),catalogue=await f.runtime.readCatalogue(f.localContext.worldRef);
 C.validateType('Catalogue',catalogue);assert.equal(catalogue.profileVersion,'catalogue/v3');
 const response=await f.runtime.port.call('ReadLocalConnection',{contractVersion:'world-adapter/v8',sessionRef:'fixture-session',requestId:'connection',connectionRef:f.localContext.connectionRef});
 assert.equal(response.error,null);const capabilities=response.result.capabilities;
 assert.deepEqual(plain(capabilities.worldGeometry),plain(WORLD_GEOMETRY));assert.deepEqual(plain(capabilities.stateProfile),plain(STATE_PROFILE));
 assert.deepEqual(plain(capabilities.engineBounds),{min:[-31000,-31000,-31000],max:[31000,31000,31000]});
 assert.ok(C.regionCapabilities.filter(c=>c.id.startsWith('world-adapter')).every(c=>c.owner==='world-source'));
});
async function transaction(f,id='tx'){
 const catalogue=await f.runtime.readCatalogue(f.localContext.worldRef);
 const materialRef=Object.keys(catalogue.materials).find(ref=>catalogue.materials[ref].extension.native.allowedParam2?.[0]===7);
 const effects=[{geometryProfile:'voxel-grid/v1',position:[0,0,0],materialRef,orientation:0}];
 const operations=C.validateType('OperationsProjection',{contractVersion:'operations/v4',buildDigest:'0'.repeat(64),compilerRevision:'fixture-compiler',compilationConfigDigest:'1'.repeat(64),worldRef:f.localContext.worldRef,frameDigest:'2'.repeat(64),catalogueDigest:digest('catalogue',catalogue),targetFactsDigest:'3'.repeat(64),effects});
 const {stateProfile,cells}=await f.runtime.readScopedState(f.localContext.connectionRef,[[0,0,0]]);
 const operationDigest=digest('operations',operations);
 const scope=C.validateType('ScopedWorldBinding',{transactionId:id,worldRef:f.localContext.worldRef,operationDigest,stateProfile,checkedPositions:[[0,0,0]],objects:[],cells,localContext:f.localContext});
 const common={transactionId:id,operations,operationDigest,scope,scopeDigest:digest('scoped-world',scope),guarantee:'RECOVERABLE_VERIFIED'};
 const prepared=await f.call('PrepareRecoverableTransaction',common);assert.equal(prepared.error,null);
 const preparedTransaction=C.projectScopedPreparedTransaction(prepared.result);
 const apply=await f.call('ApplyCompiledTransaction',{...common,preparedTransaction});
 return {apply,common,prepared};
}
test('v8 prepare/apply/readback converts neutral orientation 0 to native param2 7 and back',async t=>{
 const f=await fixture(t),{apply}=await transaction(f);
 assert.equal(apply.error,null);assert.equal(apply.result.status,'VERIFIED');
 assert.equal(f.calls.find(c=>c.kind==='apply').effects[0].param2,7);
 assert.equal('materialRef' in f.calls.find(c=>c.kind==='apply').effects[0],false);
 const read=await f.call('Readback',{transactionId:'tx',coveredPositions:[[0,0,0]],stateProfile:STATE_PROFILE});
 assert.equal(read.error,null);assert.equal(read.result.projection.records[0].orientation,0);
 assert.equal(read.result.projection.records[0].state.lighting,15);
 assert.equal('param2' in read.result.projection.records[0],false);
 assert.equal(read.result.readbackDigest,digest('readback',read.result.projection));
});
test('mismatched native readback restores saved neutral image with derived light excluded from equality',async t=>{
 const f=await fixture(t,{mismatch:true}),{apply}=await transaction(f);
 assert.equal(apply.error,null);assert.equal(apply.result.status,'ROLLED_BACK');
 assert.equal(f.calls.find(c=>c.kind==='restore').before.records[0].nodeName,'air');
 assert.equal(apply.result.restoreStatus,'VERIFIED_RESTORED');
});

test('Readback returns current derived light and complete metadata without applying write rules to reads',async t=>{
 const f=await fixture(t,{initialState:{metadata:{owner:'before'},inventory:{main:['item','']},timer:{timeout:60,elapsed:4}}});
 const {apply}=await transaction(f);assert.equal(apply.result.status,'VERIFIED');
 const cleared=await f.call('Readback',{transactionId:'tx',coveredPositions:[[0,0,0]],stateProfile:STATE_PROFILE});
 assert.deepEqual(plain(cleared.result.projection.records[0].state),{lighting:15});
 f.recomputeLight();
 const relit=await f.call('Readback',{transactionId:'tx',coveredPositions:[[0,0,0]],stateProfile:STATE_PROFILE});
 assert.equal(relit.error,null);assert.equal(relit.result.projection.records[0].state.lighting,10);
 assert.equal(cellDigest(STATE_PROFILE,relit.result.projection.records[0]),cellDigest(STATE_PROFILE,cleared.result.projection.records[0]));
 assert.notEqual(relit.result.readbackDigest,cleared.result.readbackDigest,'the digest still covers actual derived values');
 f.editMetadata({owner:'external'});
 const read=await f.call('Readback',{transactionId:'tx',coveredPositions:[[0,0,0]],stateProfile:STATE_PROFILE});
 assert.equal(read.error,null);assert.deepEqual(plain(read.result.projection.records[0].state),{lighting:10,metadata:{owner:'external'}});
 assert.equal(read.result.readbackDigest,digest('readback',read.result.projection));
 assert.notEqual(read.result.readbackDigest,apply.result.readbackDigest);
 assert.notEqual(cellDigest(STATE_PROFILE,read.result.projection.records[0]),cellDigest(STATE_PROFILE,relit.result.projection.records[0]));
});

test('RestoreTransaction verifies saved metadata, inventory and timer exactly while accepting recomputed light',async t=>{
 const state={metadata:{owner:'before',note:'saved'},inventory:{main:['item','']},timer:{timeout:60,elapsed:4}};
 const f=await fixture(t,{mismatch:true,initialState:state});f.blockRestore(true);
 const {apply,common,prepared}=await transaction(f);assert.equal(apply.error.code,'RESTORE_FAILED');
 const restore=()=>f.call('RestoreTransaction',{originTransactionId:'tx',operationDigest:common.operationDigest,
  beforeImageDigest:prepared.result.beforeImageDigest,restoreAttemptIdentity:'attempt-1',guarantee:'RECOVERABLE_VERIFIED'});
 f.blockRestore(false);f.corruptRestore(true);
 const corrupt=await restore();assert.equal(corrupt.error.code,'RESTORE_FAILED');
 f.corruptRestore(false);
 const restored=await restore();assert.equal(restored.error,null);assert.equal(restored.result.status,'ROLLED_BACK');
 assert.equal(restored.result.restoreStatus,'VERIFIED_RESTORED');
 const read=await f.call('Readback',{transactionId:'tx',coveredPositions:[[0,0,0]],stateProfile:STATE_PROFILE});
 assert.equal(read.error,null);assert.deepEqual(plain(read.result.projection.records[0].state),{lighting:14,...state});
 assert.equal(restored.result.readbackDigest,read.result.readbackDigest);
 assert.notEqual(read.result.readbackDigest,prepared.result.beforeStateReadbackDigest,'digest describes actual light, not the saved light');
 assert.deepEqual(plain((await restore()).result),plain(restored.result),'settled recovery returns the issued receipt');
});

test('InspectWorld returns target-facts/v5 with neutral material and geometry profile',async t=>{
 const f=await fixture(t);await transaction(f);
 const response=await f.call('InspectWorld',{expectedWorldRevision:'revision-1',sampledBounds:{min:[0,0,0],max:[0,0,0]}});
 assert.equal(response.error,null);assert.equal(response.result.geometryProfile,'voxel-grid/v1');
 assert.equal(response.result.profileVersion,'target-facts/v5');
 assert.equal(response.result.occupiedCells[0].orientation,0);
 assert.equal('nodeName' in response.result.occupiedCells[0],false);
});
test('v8 history transport restores the original material without exposing native param2',async t=>{
 const f=await fixture(t),{apply,prepared}=await transaction(f);
 const receipt=apply.result;
 f.recomputeLight(); // Derived light may change after the durable verified image.
 const operation={contractVersion:'world-adapter/v8',worldRef:f.localContext.worldRef,originTransactionId:'tx',transactionId:'undo',direction:'UNDO',
 affectedObjectRefs:[],originVerifiedReceiptDigest:digest('receipt',receipt),originBeforeImageDigest:prepared.result.beforeImageDigest,
 originBeforeStateReadbackDigest:prepared.result.beforeStateReadbackDigest,originAfterReadbackDigest:receipt.readbackDigest,
 expectedCurrentStateDigest:receipt.readbackDigest,targetStateDigest:prepared.result.beforeStateReadbackDigest,
 expectedHistoryRevision:'history-1',expectedWorldRevision:receipt.observedWorldRevision,expectedObjectRevisions:{},guarantee:'RECOVERABLE_VERIFIED',localContext:f.localContext};
 const common={...operation,historyOperationDigest:digest('history-operation',operation)};
 delete common.contractVersion;delete common.worldRef;delete common.localContext;
 const before=await f.call('PrepareHistoryTransaction',common);assert.equal(before.error,null);
 const done=await f.call('ApplyHistoryTransaction',{originTransactionId:'tx',transactionId:'undo',direction:'UNDO',
 historyOperationDigest:common.historyOperationDigest,preparedHistoryTransaction:before.result,
 expectedWorldRevision:operation.expectedWorldRevision,expectedObjectRevisions:{}});
 assert.equal(done.error,null);assert.equal(done.result.status,'VERIFIED');
 assert.equal(f.calls.find(c=>c.kind==='history').target.records[0].nodeName,'air');
});
test('QueryTransaction after reconnect returns the durable receipt as written, beside the current context',async t=>{
 const f=await fixture(t),{apply,prepared}=await transaction(f);
 assert.equal(apply.error,null);assert.equal(apply.result.status,'VERIFIED');await f.runtime.close();
 // Same world, same durable journal, new connection incarnation (server stop + reconnect).
 const g=await fixture(t,{root:f.root,incarnation:'fixture-incarnation-2'});
 const request={contractVersion:'world-adapter/v8',sessionRef:'fixture-session',requestId:'query-after-reconnect',worldRef:g.localContext.worldRef,localContext:g.localContext,
  transactionId:'tx',transactionPayloadDigest:prepared.result.transactionPayloadDigest};
 const response=await g.runtime.port.call('QueryTransaction',request);
 assert.equal(response.error,null,JSON.stringify(response.error));
 const read=C.readHistoricalReceipt(request,response);
 assert.equal(read.historical,true);assert.equal(read.sameIncarnation,false);
 assert.deepEqual(plain(read.receipt),plain(apply.result));assert.equal(read.receiptDigest,digest('receipt',apply.result));
 assert.deepEqual(plain(read.writtenContext),plain(f.localContext));assert.deepEqual(plain(read.currentContext),plain(g.localContext));
 // The receipt was not re-bound, and another transaction payload is still refused.
 const other=await g.runtime.port.call('QueryTransaction',{...request,requestId:'query-other-payload',transactionPayloadDigest:'f'.repeat(64)});
 assert.equal(other.result,null);assert.equal(other.error.code,'REPLAY_MISMATCH');
});
