// Forwarding consumer of public InspectionContext, Canvas CAS and world oracle.
// The no-Inspection forwarding helper remains available for isolated dev peers;
// production always supplies resolveInspection and refuses its absence.
// No association table, object choice, generated revision, SDK export or transaction authority.
import {randomUUID} from 'node:crypto';
import {canonicalJSON,validateBoundRequest,validateBoundResponse} from '#contracts';
const fail=code=>{throw Error(code);};const original=value=>value?.[Symbol.for('cordis.original')]??value;
export function createInspectionContext({resolveCanvas,resolveOracle,resolveInspection}) {
 return {async ReadInspectionContext(input){
  const q=validateBoundRequest('world-inspection/v1','ReadInspectionContext',input);
  const canvas=resolveCanvas();if(typeof canvas?.call!=='function')fail('CAPABILITY_UNAVAILABLE');
  const request=validateBoundRequest('canvas/v7','ReadWorldSelectionContext',{contractVersion:'canvas/v7',requestId:randomUUID(),sessionRef:q.sessionRef,worldRef:q.worldRef});
  const reply=validateBoundResponse('canvas/v7','ReadWorldSelectionContext',request,await canvas.call('ReadWorldSelectionContext',request));
  if(original(resolveCanvas())!==original(canvas))fail('CURRENT_WORLD_MISMATCH');
  if(reply.error)fail(reply.error.code);
  const selection=reply.result?.selection;
  if(selection?.status!=='BOUND')fail('WORLD_NOT_BOUND');
  const c=selection.context;
  if(c.currentSession!==q.sessionRef || c.activeWorldRef!==q.worldRef)fail('WORLD_NOT_BOUND');
  return validateBoundResponse('world-inspection/v1','ReadInspectionContext',q,{contractVersion:'world-inspection/v1',requestId:q.requestId,result:{sessionRef:q.sessionRef,worldRef:q.worldRef,localContext:c.localContext,orderedSelectedObjectRefs:c.orderedSelectedObjectRefs},error:null});
 },async read(request){
  validateBoundRequest('world-adapter/v8','InspectWorld',request);
  const canvas=resolveCanvas(),oracle=resolveOracle();if(typeof canvas?.call!=='function'||typeof oracle?.read!=='function')fail('CAPABILITY_UNAVAILABLE');
  const inspection=resolveInspection?.();
  if(resolveInspection && typeof inspection?.ReadInspectionContext!=='function')throw Object.assign(Error('WORLD_INSPECTION_CONTEXT_UNAVAILABLE'),{code:'CAPABILITY_UNAVAILABLE'});
  const check=()=>{if(resolveInspection && original(resolveInspection())!==original(inspection))fail('CURRENT_WORLD_MISMATCH');if(original(resolveCanvas())!==original(canvas)||original(resolveOracle())!==original(oracle))fail('CURRENT_WORLD_MISMATCH');};
  async function call(name,extra={}){check();const q=validateBoundRequest('canvas/v7',name,{contractVersion:'canvas/v7',requestId:randomUUID(),sessionRef:request.sessionRef,worldRef:request.worldRef,...extra});const r=validateBoundResponse('canvas/v7',name,q,await canvas.call(name,q));check();if(r.error)fail(r.error.code);if(!r.result)fail('TARGET_FACTS_INCOMPLETE');return r.result;}
  const revision=await oracle.read(request.worldRef);check();if(revision!==request.expectedWorldRevision)fail('STALE_REVISION');
  async function contextRead(){
   if(!resolveInspection)return (await call('ReadWorldSelectionContext')).selection;
   check();const q=validateBoundRequest('world-inspection/v1','ReadInspectionContext',{contractVersion:'world-inspection/v1',requestId:randomUUID(),sessionRef:request.sessionRef,worldRef:request.worldRef});
   const r=validateBoundResponse('world-inspection/v1','ReadInspectionContext',q,await inspection.ReadInspectionContext(q));check();
   if(r.error)fail(r.error.code);if(!r.result)fail('TARGET_FACTS_INCOMPLETE');
   const c=r.result;return {status:'BOUND',context:{currentSession:c.sessionRef,activeWorldRef:c.worldRef,localContext:c.localContext,orderedSelectedObjectRefs:c.orderedSelectedObjectRefs}};
  }
  const selection=await contextRead();
  if(selection.status!=='BOUND'||selection.context.currentSession!==request.sessionRef||selection.context.activeWorldRef!==request.worldRef||canonicalJSON(selection.context.localContext)!==canonicalJSON(request.localContext))fail('CURRENT_WORLD_MISMATCH');
  const refs=selection.context.orderedSelectedObjectRefs;if(refs.length!==1)fail('TARGET_FACTS_INCOMPLETE');
  const inventory=await call('ListObjects',{expectedRevision:null,localContext:selection.context.localContext});
  const matches=inventory.objects.filter(o=>o.objectRef===refs[0]&&o.worldRef===request.worldRef);if(inventory.worldRef!==request.worldRef||matches.length!==1)fail('TARGET_FACTS_INCOMPLETE');
  const r2=await contextRead();if(r2.status!=='BOUND'||canonicalJSON(r2.context)!==canonicalJSON(selection.context))fail('CURRENT_WORLD_MISMATCH');
  if(await oracle.read(request.worldRef)!==revision)fail('STALE_REVISION');check();
  return {current:true,worldRef:request.worldRef,worldRevision:revision,objectRef:matches[0].objectRef,objectRevision:matches[0].objectRevision};
 }};
}
