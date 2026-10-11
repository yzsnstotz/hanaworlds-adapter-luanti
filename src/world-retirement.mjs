import { randomUUID } from 'node:crypto';
import { requireWorldRetirable, validateBoundRequest, validateBoundResponse } from '#contracts';
const fail = code => { throw Error(code); };
const original = value => value?.[Symbol.for('cordis.original')] ?? value;
function control(resolveCanvas) {
  const provider = resolveCanvas?.();
  if (typeof provider?.call !== 'function') fail('CAPABILITY_UNAVAILABLE');
  const current = () => { if (original(resolveCanvas()) !== original(provider)) fail('CURRENT_WORLD_MISMATCH'); };
  async function call(name, value) {
    current();
    const q = validateBoundRequest('canvas/v7',name,{contractVersion:'canvas/v7',requestId:randomUUID(),...value});
    const r = validateBoundResponse('canvas/v7',name,q,await provider.call(name,q));
    current();if(r.error)fail(r.error.code);if(!r.result)fail('REQUIRED_FACT_UNKNOWN');return r.result;
  }
  return {call,current};
}
export async function readWorldSelections(resolveCanvas,worldRef) {
  return control(resolveCanvas).call('ListWorldSelections',{worldRef});
}
export async function withWorldRetirement(resolveCanvas,worldRef,remove) {
  const canvas=control(resolveCanvas);
  const inventory=requireWorldRetirable(await canvas.call('ListWorldSelections',{worldRef}));
  const reservation=await canvas.call('ReserveWorldRetirement',{worldRef,expectedInventoryRevision:inventory.inventoryRevision});
  let result;
  try {canvas.current();result=await remove();}
  catch(error) {
    // Always close the public retirement sequence; abort is not a filesystem rollback.
    if(['DELETE_INCOMPLETE','READBACK_MISMATCH'].includes(error.message)) {
      error.details={...error.details,retirementReservationRef:reservation.reservationRef};
    }
    await canvas.call('ReleaseWorldRetirement',{worldRef,reservationRef:reservation.reservationRef,outcome:'ABORTED'});throw error;
  }
  await canvas.call('ReleaseWorldRetirement',{worldRef,reservationRef:reservation.reservationRef,outcome:'RETIRED'});
  return result;
}
