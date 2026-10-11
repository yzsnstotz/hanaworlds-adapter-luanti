import { resourceFailure } from './resource-errors.mjs';
export const TRANSPORT_DEFAULTS=Object.freeze({courierResultWaitMs:30000,courierBodyBytes:4194304});
export const TRANSPORT_RANGES=Object.freeze({courierResultWaitMs:[1000,120000],courierBodyBytes:[131072,4194304]});
export const BATCH_ENVELOPE_RESERVE_BYTES=65536;
export function validateTransportSettings(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!Object.hasOwn(TRANSPORT_DEFAULTS,k)))
    throw resourceFailure('SCHEMA_INVALID','configure','courier-settings','INVALID_CONFIG');
  const values={...TRANSPORT_DEFAULTS,...input};
  for(const [key,[min,max]] of Object.entries(TRANSPORT_RANGES))
    if(!Number.isSafeInteger(values[key]) || values[key]<min || values[key]>max)
      throw resourceFailure('SCHEMA_INVALID','configure',key,'INVALID_CONFIG');
  return Object.freeze(values);
}
export function transportPolicy(input={}) {
  const values=validateTransportSettings(input);
  const text={
    courierResultWaitMs:['Time from command queueing to receiving its result. Expiry means RECOVERY_PENDING; it does not cancel engine execution.',
      'A larger budget delays uncertainty reporting; it does not repair execution or permit retry.'],
    courierBodyBytes:['Maximum UTF-8 bytes of complete JSON poll or result body, including envelope, in either direction. The 4 MiB hard ceiling cannot be disabled.',
      'Smaller bodies reduce memory use and region batch size; a single large record may be refused.'],
  };
  const settings=Object.entries(values).map(([name,value])=>({name,unit:name.endsWith('Ms')?'ms':'byte',defaultValue:TRANSPORT_DEFAULTS[name],value,
    min:TRANSPORT_RANGES[name][0],max:TRANSPORT_RANGES[name][1],editable:true,meaning:text[name][0],tradeoff:text[name][1],
    validation:'Inclusive integer range; no coercion, zero, disabling, or unknown keys. Changes require a fresh paired payload and matching handshake.'}));
  settings.push({name:'regionBatchEnvelopeReserveBytes',unit:'byte',defaultValue:BATCH_ENVELOPE_RESERVE_BYTES,value:BATCH_ENVELOPE_RESERVE_BYTES,
    min:BATCH_ENVELOPE_RESERVE_BYTES,max:BATCH_ENVELOPE_RESERVE_BYTES,editable:false,
    meaning:'Conservative region batch sizing reserve for JSON framing and guards. It is not a maximum envelope size or a business cell quota.',
    tradeoff:'Reserve lowers estimated blocks per batch; metadata is unbounded by cell count, so exact serialization still refuses oversized results.',
    validation:'Fixed batch sizing reserve; exact complete command and result sizes remain enforced independently.'});
  return {profileVersion:'world-source-transport-policy/v1',owner:'world-source',settings};
}

export function validatePairedTransportSettings(input) {
  if(!input || Object.keys(TRANSPORT_DEFAULTS).some(k=>!Object.hasOwn(input,k)))
    throw resourceFailure('SCHEMA_INVALID','configure','courier-settings','INVALID_CONFIG');
  return validateTransportSettings(input);
}
