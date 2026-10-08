// Independent Adapter page consumer. Native leases/confirmation tokens/UI choice only;
// Session association and every selection/inventory revision are read from fixture Canvas authority.
import {randomUUID} from 'node:crypto';import {basename} from 'node:path';
import {describeSelectionConnection,validateBoundRequest,validateBoundResponse} from '#contracts';
import {createSessionSelectionConsumer} from './session-selection.mjs';
const fail=code=>{throw Error(code);};
export function createSessionManager({local,adapter,fixture,requesterRef,userPath,foreignActivity,game}) {
 let chosenSession=null,chain=Promise.resolve();const native=new Map(),confirmations=new Map();
 const serial=fn=>{const r=chain.then(fn);chain=r.catch(()=>{});return r;};
 async function adapterCall(name,value){const q=validateBoundRequest('world-adapter/v6',name,{contractVersion:'world-adapter/v6',requestId:randomUUID(),...value});const r=validateBoundResponse('world-adapter/v6',name,q,await adapter.call(name,q));if(r.error)fail(r.error.code);return r.result;}
 async function rows(){const result=await local.discover();for(const row of result)fixture.registerWorld(row);return result.map(r=>({...r,worldName:r.worldName??basename(r.worldPath)}));}
 async function world(ref){const matches=(await rows()).filter(w=>w.connectionRef===ref);if(matches.length!==1)fail('CONNECTION_NOT_FOUND');return matches[0];}
 const query=row=>({requesterRef,connectionRef:row.connectionRef,worldRef:row.worldRef});
 const consumer=createSessionSelectionConsumer({resolveCanvas:()=>fixture.canvas,ensureConnection:async(sessionRef,connectionRef)=>{
  await fixture.readIdentity(sessionRef);const row=await world(connectionRef);
  try{return await adapterCall('ReadLocalConnection',{sessionRef,connectionRef});}catch(e){
   if(e.message==='CURRENT_WORLD_MISMATCH'&&native.has(connectionRef)){
    // Invalid CURRENT cannot prove exit. Reconnect only after original Host finite STOPPED callback.
    await local.stopWorld(query(row));native.delete(connectionRef);
   }else if(e.message!=='CONNECTION_NOT_FOUND')throw e;
  }
  if(game.running()||(await foreignActivity(row.worldPath)).length)fail('WORLD_IN_USE');
  const lease=await local.acquire({requesterRef,userPath,connectionRef,action:'BIND_RUNNING_WORLD'});
  const q={requesterRef,connectionRef,leaseRef:lease.leaseRef};await local.pair(q);native.set(connectionRef,{...row,lease:q,nativeProcessId:lease.nativeProcessId});
  return adapterCall('ReadLocalConnection',{sessionRef,connectionRef});
 }});
 async function readSession(sessionRef,list){return consumer.read({sessionRef,worldRef:list[0]?.worldRef??'fixture-world-A'});}
 async function previewFacts(row){const p=await local.describeWorldDeletion(query(row));const i=await fixture.canvas.call('ListWorldSelections',{contractVersion:'canvas/v5',requestId:randomUUID(),worldRef:row.worldRef});if(i.error)fail(i.error.code);const blockers=[...p.blockers];if(i.result.sessionRefs.length||i.result.retirementReservationRef)blockers.push({code:'TRANSACTION_CONFLICT',reason:'LIVE_SESSION_BINDING_OR_RETIREMENT',sessions:i.result.sessionRefs});if((await foreignActivity(row.worldPath)).length)blockers.push({code:'WORLD_IN_USE',reason:'EXTERNAL_NATIVE_PROCESS'});return {...p,worldName:row.worldName,blockers,deletable:p.deletable&&blockers.length===0};}
 return {
  state:()=>serial(async()=>{const list=await rows(),directory=await fixture.listSessions();const inventory=await adapterCall('DiscoverConnections',{sessionRef:directory.sessions[0].sessionRef,adapterId:'hanaworlds-adapter-luanti'});const sessions=[];
   for(const identity of directory.sessions){const r=await readSession(identity.sessionRef,list);sessions.push({...identity,selection:r.selection,connectionState:describeSelectionConnection(r.selection,inventory)});}
   return {chosenSession,sessions,worlds:list.map(row=>({...row,running:inventory.connections.some(c=>c.connectionRef===row.connectionRef),nativeProcessId:native.get(row.connectionRef)?.nativeProcessId??null,selectedBy:sessions.filter(s=>s.selection.status==='BOUND'&&s.selection.context.activeWorldRef===row.worldRef).map(s=>s.sessionRef)})),inventory,prerequisites:await local.describeFlatWorldCreation({requesterRef,userPath}),gameRunning:game.running()};
  }),
  choose:sessionRef=>serial(async()=>{await fixture.readIdentity(sessionRef);const r=await readSession(sessionRef,await rows());chosenSession=sessionRef;return {chosenSession,selection:r.selection};}),
  create:worldName=>serial(async()=>{const row=await local.createFlatWorld({requesterRef,userPath,...(worldName?{worldName}:{})});fixture.registerWorld(row);return row;}),
  select:(sessionRef,connectionRef)=>serial(async()=>{await fixture.readIdentity(sessionRef);const row=await world(connectionRef);const result=await consumer.select({sessionRef,connectionRef,worldRef:row.worldRef,expectedRevision:fixture.precondition(sessionRef)});chosenSession=sessionRef;return result;}),
  unselect:sessionRef=>serial(async()=>{await fixture.readIdentity(sessionRef);const selection=await readSession(sessionRef,await rows());if(selection.selection.status!=='BOUND')fail('CURRENT_WORLD_MISMATCH');return consumer.unselect({sessionRef,worldRef:selection.selection.context.activeWorldRef,expectedRevision:fixture.precondition(sessionRef)});}),
  stop:connectionRef=>serial(async()=>{const row=await world(connectionRef);if(game.running())fail('WORLD_IN_USE');const r=await local.stopWorld(query(row));native.delete(connectionRef);return r;}),
  enter:connectionRef=>serial(async()=>{const record=native.get(connectionRef);if(!record)fail('WORLD_NOT_BOUND');await local.inspect(record.lease);return game.enter(record);}),
  preview:connectionRef=>serial(async()=>{const row=await world(connectionRef),preview=await previewFacts(row),confirmationRef=randomUUID();confirmations.set(confirmationRef,{row,preview});return {...preview,confirmationRef};}),
  cancel:token=>serial(async()=>{if(!confirmations.delete(token))fail('CONFIRMATION_NOT_FOUND');return {cancelled:true};}),
  confirm:token=>serial(async()=>{const saved=confirmations.get(token);if(!saved)fail('CONFIRMATION_NOT_FOUND');confirmations.delete(token);const row=await world(saved.row.connectionRef);if(row.worldRef!==saved.row.worldRef||row.worldPath!==saved.row.worldPath)fail('CURRENT_WORLD_MISMATCH');const p=await previewFacts(row);if(!p.deletable)fail(p.blockers[0]?.code??'WORLD_IN_USE');if(p.dataLoss.files!==saved.preview.dataLoss.files||p.dataLoss.bytes!==saved.preview.dataLoss.bytes)fail('CONFIRMATION_CHANGED');const result=await local.deleteWorld(query(row));if(!result.deleted||result.readback.listed||result.readback.pathExists||(await rows()).some(w=>w.worldRef===row.worldRef))fail('READBACK_MISMATCH');return result;}),
 };
}
