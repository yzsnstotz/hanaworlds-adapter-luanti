// Canvas/Session contracts FIXTURE; consumer stores no association or generated revision.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as C from '#contracts';
const mod=await import('../dev/world-manage/session-selection.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function setup(){
 const selections=new Map(), calls=[],nativeStarts=[];let revision=0,failSwitch=false;
 const connection=world=>({connectionRef:`connection:${world}`,connectionIncarnationRef:`incarnation:${world}`,worldRef:world,payloadVersion:'0.6.0',payloadDigest:'0'.repeat(64),capabilities:{providerRef:'hanaworlds-adapter-luanti',capabilityRevision:'cap:1',worldRef:world,engineBounds:null,limits:[],recoveryGuarantee:'RECOVERABLE_VERIFIED',stateProfile:{profileVersion:'state-profile/v2',nodeFields:['nodeName','param1','param2'],metadataMode:'exact',inventoryMode:'exact',timerMode:'exact',derivedLightMode:'recompute-with-readback'},sessionDeleteSupported:true,imageMediaTypes:[],model:null}});
 const canvas={async call(name,input){C.validateBoundRequest('canvas/v5',name,input);calls.push({name,input});
  if(!['S1','S2'].includes(input.sessionRef))throw Error('SESSION_NOT_FOUND');
  let result;
  if(name==='ReadWorldSelectionContext')result={sessionRef:input.sessionRef,worldRef:input.worldRef,inventory:{capabilityRevision:'cap:1',connections:[]},selection:selections.get(input.sessionRef)??{status:'UNBOUND',sessionRef:input.sessionRef,sessionRevision:'fixture-session:1'}};
  else {
   if(name==='SwitchWorldConnection'&&failSwitch)throw Error('STALE_REVISION');
   const world=name==='SwitchWorldConnection'?input.toWorldRef:input.worldRef,ref=name==='SwitchWorldConnection'?input.toConnectionRef:input.connectionRef;
   const rev=`fixture-canvas-selection:${++revision}`;
   result={currentSession:input.sessionRef,activeWorldRef:world,orderedSelectedObjectRefs:[],sessionRevision:'fixture-session:1',selectionRevision:rev,localContext:{connectionRef:ref,connectionIncarnationRef:`incarnation:${world}`,worldRef:world,selectionRevision:rev}};
   selections.set(input.sessionRef,{status:'BOUND',connectionRef:ref,context:result});
  }
  return C.validateBoundResponse('canvas/v5',name,input,{contractVersion:'canvas/v5',requestId:input.requestId,result,error:null});
 }};
 assert.ok(mod,'existing-route Session selection consumer is missing');
 const consumer=mod.createSessionSelectionConsumer({resolveCanvas:()=>canvas,ensureConnection:async(sessionRef,connectionRef)=>{nativeStarts.push({sessionRef,connectionRef});return C.validateType('LocalConnectionReadback',connection(connectionRef.replace('connection:','')));}});
 return {consumer,selections,calls,nativeStarts,setFailSwitch:v=>{failSwitch=v;}};
}
test('known unbound Session read stays UNBOUND and does not start a native connection',async()=>{
 const f=setup(),s=await f.consumer.read({sessionRef:'S1',worldRef:'A'});assert.equal(s.selection.status,'UNBOUND');assert.deepEqual(f.nativeStarts,[]);
});
test('Canvas-only selections retain S2 A while S1 switches A to B to A',async()=>{
 const f=setup();const select=(s,w)=>f.consumer.select({sessionRef:s,worldRef:w,connectionRef:`connection:${w}`,expectedRevision:'fixture-authoritative-precondition:1'});
 await select('S1','A');await select('S2','A');const s2=structuredClone(f.selections.get('S2'));
 await select('S1','B');assert.deepEqual(f.selections.get('S2'),s2);await select('S1','A');assert.deepEqual(f.selections.get('S2'),s2);
 const switches=f.calls.filter(c=>c.name==='SwitchWorldConnection');assert.equal(switches.length,2);
 assert.equal(switches[0].input.expectedContext.worldRef,'A');assert.equal(switches[1].input.expectedContext.worldRef,'B');
 assert.equal(switches[0].input.expectedRevision,'fixture-authoritative-precondition:1');
});
test('unknown Session and failed Canvas switch preserve existing selections',async()=>{
 const f=setup();await assert.rejects(f.consumer.read({sessionRef:'unknown',worldRef:'A'}),/SESSION_NOT_FOUND/);
 await f.consumer.select({sessionRef:'S1',worldRef:'A',connectionRef:'connection:A',expectedRevision:'fixture-authoritative-precondition:1'});
 const before=structuredClone(f.selections.get('S1'));f.setFailSwitch(true);
 await assert.rejects(f.consumer.select({sessionRef:'S1',worldRef:'B',connectionRef:'connection:B',expectedRevision:'fixture-authoritative-precondition:1'}),/STALE_REVISION/);
 assert.deepEqual(f.selections.get('S1'),before);
});
