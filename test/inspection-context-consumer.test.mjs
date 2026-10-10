import test from 'node:test';import assert from 'node:assert/strict';import * as C from '#contracts';
const module=await import('../dev/world-manage/inspection-context.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function setup(refs=['o1']){assert.ok(module,'singular CAS inspection consumer missing');
 let provider,revision='head:1',calls=0;let after=()=>{};
 const context={currentSession:'S1',activeWorldRef:'A',orderedSelectedObjectRefs:refs,sessionRevision:'session:1',selectionRevision:'selection:1',localContext:{worldRef:'A',connectionRef:'c:A',connectionIncarnationRef:'inc:A',selectionRevision:'selection:1'}};
 provider={async call(name,q){const result=name==='ListObjects'?{worldRef:'A',registryRevision:'registry:1',objects:refs.map((objectRef,i)=>({worldRef:'A',objectRef,objectRevision:'object:'+objectRef,displayName:null,nameRevision:null,creationSequence:i,status:'READY'}))}:{sessionRef:'S1',worldRef:'A',inventory:{capabilityRevision:'cap',connections:[]},selection:{status:'BOUND',connectionRef:'c:A',context:structuredClone(context)}};calls++;after(name);return C.validateBoundResponse('canvas/v6',name,q,{contractVersion:'canvas/v6',requestId:q.requestId,result,error:null});}};
 const oracle={read:async()=>revision};
 const read=module.createInspectionContext({resolveCanvas:()=>provider,resolveOracle:()=>oracle}).read;
 const request={contractVersion:'world-adapter/v7',sessionRef:'S1',requestId:'inspect',worldRef:'A',expectedWorldRevision:'head:1',sampledBounds:{min:[0,0,0],max:[0,0,0]},localContext:context.localContext};
 return {read:()=>read(request),context,changeRevision:()=>revision='head:2',onCall:fn=>after=fn,replace:()=>provider={...provider}};
}
test('singular bridge reads authoritative CAS ObjectRecord and world oracle, without request-created revisions',async()=>{const f=setup();assert.deepEqual(await f.read(),{current:true,worldRef:'A',worldRevision:'head:1',objectRef:'o1',objectRevision:'object:o1'});});
for(const refs of [[],['o1','o2']])test('zero/multiple selection rejects singular Inspector',async()=>{const f=setup(refs);await assert.rejects(f.read(),/TARGET_FACTS_INCOMPLETE/);});
test('R2 changed context refuses the whole read',async()=>{const f=setup();f.onCall(name=>{if(name==='ListObjects')f.context.sessionRevision='session:2';});await assert.rejects(f.read(),/CURRENT_WORLD_MISMATCH/);});
test('oracle advances during CAS read and refuses stale output',async()=>{const f=setup();f.onCall(name=>{if(name==='ListObjects')f.changeRevision();});await assert.rejects(f.read(),/STALE_REVISION/);});
test('same-name Canvas provider replacement refuses facts',async()=>{const f=setup();f.onCall(name=>{if(name==='ListObjects')f.replace();});await assert.rejects(f.read(),/CURRENT_WORLD_MISMATCH/);});
