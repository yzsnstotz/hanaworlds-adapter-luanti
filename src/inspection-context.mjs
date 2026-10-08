// Development-only forwarding consumer of existing public Canvas CAS and world oracle.
// No association table, object choice, generated revision, SDK export or transaction authority.
import {randomUUID} from 'node:crypto';
import {canonicalJSON,validateBoundRequest,validateBoundResponse} from '#contracts';
const fail=code=>{throw Error(code);};const original=value=>value?.[Symbol.for('cordis.original')]??value;
export function createInspectionContext({resolveCanvas,resolveOracle}) {
 return {async read(request){
  validateBoundRequest('world-adapter/v6','InspectWorld',request);
  const canvas=resolveCanvas(),oracle=resolveOracle();if(typeof canvas?.call!=='function'||typeof oracle?.read!=='function')fail('CAPABILITY_UNAVAILABLE');
  const check=()=>{if(original(resolveCanvas())!==original(canvas)||original(resolveOracle())!==original(oracle))fail('CURRENT_WORLD_MISMATCH');};
  async function call(name,extra={}){check();const q=validateBoundRequest('canvas/v5',name,{contractVersion:'canvas/v5',requestId:randomUUID(),sessionRef:request.sessionRef,worldRef:request.worldRef,...extra});const r=validateBoundResponse('canvas/v5',name,q,await canvas.call(name,q));check();if(r.error)fail(r.error.code);if(!r.result)fail('TARGET_FACTS_INCOMPLETE');return r.result;}
  const revision=await oracle.read(request.worldRef);check();if(revision!==request.expectedWorldRevision)fail('STALE_REVISION');
  const r1=await call('ReadWorldSelectionContext'),selection=r1.selection;
  if(selection.status!=='BOUND'||selection.context.currentSession!==request.sessionRef||selection.context.activeWorldRef!==request.worldRef||canonicalJSON(selection.context.localContext)!==canonicalJSON(request.localContext))fail('CURRENT_WORLD_MISMATCH');
  const refs=selection.context.orderedSelectedObjectRefs;if(refs.length!==1)fail('TARGET_FACTS_INCOMPLETE');
  const inventory=await call('ListObjects',{expectedRevision:null,localContext:selection.context.localContext});
  const matches=inventory.objects.filter(o=>o.objectRef===refs[0]&&o.worldRef===request.worldRef);if(inventory.worldRef!==request.worldRef||matches.length!==1)fail('TARGET_FACTS_INCOMPLETE');
  const r2=await call('ReadWorldSelectionContext');if(r2.selection.status!=='BOUND'||canonicalJSON(r2.selection.context)!==canonicalJSON(selection.context))fail('CURRENT_WORLD_MISMATCH');
  if(await oracle.read(request.worldRef)!==revision)fail('STALE_REVISION');check();
  return {current:true,worldRef:request.worldRef,worldRevision:revision,objectRef:matches[0].objectRef,objectRevision:matches[0].objectRevision};
 }};
}
