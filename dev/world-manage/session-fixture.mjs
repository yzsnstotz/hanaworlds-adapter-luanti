// Development-only Canvas and Workshop FIXTURE. The maps below belong to the fixture Canvas,
// never the Adapter manager/Host. No real Core, persistent Session delete, peer import or world write.
import {randomUUID} from 'node:crypto';
import * as C from '#contracts';
import published from 'hanaworlds-contracts/fixtures/session-world' with {type:'json'};
const fail=code=>{throw Error(code);};const same=(a,b)=>C.canonicalJSON(a)===C.canonicalJSON(b);
export function createSessionWorldFixture({resolveAdapter}) {
 const directory=C.validateType('SessionDirectory',structuredClone(published.sessionDirectory.list.response.result));
 const contexts=new Map(),worlds=new Map(),reservations=new Map(),retired=new Set();
 for(const identity of directory.sessions)contexts.set(identity.sessionRef,{currentSession:identity.sessionRef,activeWorldRef:null,orderedSelectedObjectRefs:[],sessionRevision:identity.sessionRevision,selectionRevision:`fixture-canvas:${randomUUID()}`,localContext:null});
 const identity=ref=>{const value=directory.sessions.find(s=>s.sessionRef===ref);if(!value)fail('SESSION_NOT_FOUND');return value;};
 const context=ref=>{identity(ref);return contexts.get(ref);};
 const world=ref=>{if(!worlds.has(ref)||retired.has(ref))fail('WORLD_NOT_FOUND');return worlds.get(ref);};
 const bump=ref=>{if(ref&&worlds.has(ref))worlds.get(ref).inventoryRevision=`fixture-world-inventory:${randomUUID()}`;};
 const wrap=(wire,name,q,result,error=null)=>C.validateBoundResponse(wire,name,q,{contractVersion:wire,requestId:q.requestId,result,error});
 function error(wire,name,q,e){const code=C.schemaBundle.definitions.ErrorCode.enum.includes(e.message)?e.message:'CAPABILITY_UNAVAILABLE';return wrap(wire,name,q,null,{code,phase:'validate',retryability:'AFTER_NEW_FACTS',mutationState:'NONE',transactionRef:null,causeCode:null,reason:code==='SESSION_DELETE_UNSUPPORTED'?'DELETE_SEAM_ABSENT':'REQUIRED_FACT_UNKNOWN'});}
 const workshop={contractHandshake:C.contractHandshake,async call(name,input){const q=C.validateBoundRequest('session/v5',name,input);try{
  if(name==='ListSessions')return wrap('session/v5',name,q,directory);
  if(name==='ReadSessionIdentity')return wrap('session/v5',name,q,identity(q.sessionRef));
  if(name==='DeleteSession'){identity(q.sessionRef);fail('SESSION_DELETE_UNSUPPORTED');}
  fail('UNSUPPORTED_OPERATION');
 }catch(e){return error('session/v5',name,q,e);}}};
 async function sessionCall(name,input){const q={contractVersion:'session/v5',requestId:randomUUID(),...input};const r=C.validateBoundResponse('session/v5',name,q,await workshop.call(name,q));if(r.error)fail(r.error.code);return r.result;}
 async function adapterCall(name,input){const q={contractVersion:'world-adapter/v7',requestId:randomUUID(),...input};const provider=resolveAdapter();const r=C.validateBoundResponse('world-adapter/v7',name,q,await provider.call(name,q));if(r.error)fail(r.error.code);return r.result;}
 const inventoryFor=async(sessionRef,worldRef)=>{const i=await adapterCall('DiscoverConnections',{sessionRef,adapterId:'hanaworlds-adapter-luanti'});return {...i,connections:i.connections.filter(c=>c.worldRef===worldRef)};};
 const selectionInventory=worldRef=>({worldRef,inventoryRevision:world(worldRef).inventoryRevision,sessionRefs:[...contexts].filter(([,c])=>c.activeWorldRef===worldRef).map(([ref])=>ref).sort(),retirementReservationRef:reservations.get(worldRef)?.reservationRef??null});
 const canvas={contractHandshake:C.contractHandshake,async call(name,input){const q=C.validateBoundRequest('canvas/v7',name,input);try{let result;
  if(name==='ReadWorldSelectionContext'){
   await sessionCall('ReadSessionIdentity',{sessionRef:q.sessionRef});const current=context(q.sessionRef);
   result={sessionRef:q.sessionRef,worldRef:q.worldRef,inventory:await inventoryFor(q.sessionRef,q.worldRef),selection:current.activeWorldRef===null?{status:'UNBOUND',...identity(q.sessionRef)}:{status:'BOUND',connectionRef:current.localContext.connectionRef,context:current}};
  }else if(['SelectWorldConnection','SwitchWorldConnection'].includes(name)){
   const trusted=await sessionCall('ReadSessionIdentity',{sessionRef:q.sessionRef}),before=context(q.sessionRef);
   if(q.expectedRevision!==before.selectionRevision||!same(q.expectedContext,before.localContext))fail('STALE_REVISION');
   const ref=name==='SwitchWorldConnection'?q.toWorldRef:q.worldRef,connectionRef=name==='SwitchWorldConnection'?q.toConnectionRef:q.connectionRef;world(ref);
   if(reservations.has(ref))fail('TRANSACTION_CONFLICT');
   if(name==='SwitchWorldConnection'&&(before.activeWorldRef!==q.fromWorldRef||q.worldRef!==q.fromWorldRef))fail('CURRENT_WORLD_MISMATCH');
   const actual=await adapterCall('ReadLocalConnection',{sessionRef:q.sessionRef,connectionRef});
   if(actual.worldRef!==ref||(name==='SelectWorldConnection'&&actual.connectionIncarnationRef!==q.connectionIncarnationRef))fail('CURRENT_WORLD_MISMATCH');
   const revision=`fixture-canvas:${randomUUID()}`;
   result={currentSession:q.sessionRef,activeWorldRef:ref,orderedSelectedObjectRefs:[],sessionRevision:trusted.sessionRevision,selectionRevision:revision,localContext:{worldRef:ref,connectionRef,connectionIncarnationRef:actual.connectionIncarnationRef,selectionRevision:revision}};
   contexts.set(q.sessionRef,result);bump(before.activeWorldRef);bump(ref);
  }else if(name==='UnselectWorldConnection'){
   const before=context(q.sessionRef);
   if(before.activeWorldRef!==q.worldRef||q.expectedRevision!==before.selectionRevision||!same(q.expectedContext,before.localContext))fail('STALE_REVISION');
   result={...before,activeWorldRef:null,localContext:null,orderedSelectedObjectRefs:[],selectionRevision:`fixture-canvas:${randomUUID()}`};contexts.set(q.sessionRef,result);bump(q.worldRef);
  }else if(name==='ListWorldSelections')result=selectionInventory(q.worldRef);
  else if(name==='ReserveWorldRetirement'){
   const i=C.requireWorldRetirable(selectionInventory(q.worldRef));if(i.inventoryRevision!==q.expectedInventoryRevision)fail('STALE_REVISION');
   result={worldRef:q.worldRef,inventoryRevision:i.inventoryRevision,reservationRef:`fixture-retirement:${randomUUID()}`};reservations.set(q.worldRef,result);
  }else if(name==='ReleaseWorldRetirement'){
   const r=reservations.get(q.worldRef);if(!r||r.reservationRef!==q.reservationRef)fail('CURRENT_WORLD_MISMATCH');reservations.delete(q.worldRef);bump(q.worldRef);if(q.outcome==='RETIRED')retired.add(q.worldRef);
   result={worldRef:q.worldRef,reservationRef:r.reservationRef,outcome:q.outcome,inventoryRevision:worlds.get(q.worldRef).inventoryRevision};
  }else if(name==='ListObjects'){
   const current=context(q.sessionRef);if(current.activeWorldRef!==q.worldRef||!same(current.localContext,q.localContext))fail('CURRENT_WORLD_MISMATCH');
   result={worldRef:q.worldRef,registryRevision:'fixture-empty-registry:1',objects:[]};
  }else fail('UNSUPPORTED_OPERATION');
  return wrap('canvas/v7',name,q,result);
 }catch(e){return error('canvas/v7',name,q,e);}}};
 return {canvas,workshop,directory,
  // Fixture Canvas-owned precondition only; not a new public SDK operation or Adapter authority.
  precondition:ref=>context(ref).selectionRevision,
  registerWorld(row){if(!worlds.has(row.worldRef))worlds.set(row.worldRef,{...row,inventoryRevision:`fixture-world-inventory:${randomUUID()}`,worldRevision:`fixture-world-head:${randomUUID()}`});},
  oracle:{async read(ref){return world(ref).worldRevision;}},
  listSessions:()=>sessionCall('ListSessions',{}),readIdentity:sessionRef=>sessionCall('ReadSessionIdentity',{sessionRef}),
 };
}
