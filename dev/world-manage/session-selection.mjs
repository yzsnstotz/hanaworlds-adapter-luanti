import { randomUUID } from 'node:crypto';
import { canonicalJSON, validateBoundRequest, validateBoundResponse, validateType } from '#contracts';

const fail = code => { throw Error(code); };
const original = value => value?.[Symbol.for('cordis.original')] ?? value;
// Development-page consumer of existing Canvas authority. No Session→World table or revision generator.
// ensureConnection owns only Adapter lifecycle/readback; expectedRevision comes from the caller's
// authoritative owning-origin read, never display text or a manufactured selection revision.
export function createSessionSelectionConsumer({ resolveCanvas, ensureConnection }) {
  let chain = Promise.resolve();
  const serial = run => { const result = chain.then(run); chain = result.catch(() => {}); return result; };
  async function call(name, input) {
    const provider = resolveCanvas();
    if (typeof provider?.call !== 'function') fail('CAPABILITY_UNAVAILABLE');
    const request = validateBoundRequest('canvas/v7', name, input);
    const response = validateBoundResponse('canvas/v7', name, request, await provider.call(name, request));
    if (original(resolveCanvas()) !== original(provider)) fail('CURRENT_WORLD_MISMATCH');
    if (response.error) fail(response.error.code);
    if (!response.result) fail('REQUIRED_FACT_UNKNOWN');
    return response.result;
  }
  function read({ sessionRef, worldRef }) {
    return call('ReadWorldSelectionContext', {contractVersion:'canvas/v7',requestId:randomUUID(),sessionRef,worldRef});
  }
  return {
    read: input => serial(() => read(input)),
    unselect: input => serial(async () => {
      const {sessionRef,worldRef,expectedRevision}=input;
      const before=await read({sessionRef,worldRef});
      if(before.selection.status!=='BOUND'||before.selection.context.activeWorldRef!==worldRef)fail('CURRENT_WORLD_MISMATCH');
      const context=await call('UnselectWorldConnection',{contractVersion:'canvas/v7',requestId:randomUUID(),sessionRef,worldRef,expectedRevision,expectedContext:before.selection.context.localContext});
      if(context.activeWorldRef!==null||context.localContext!==null)fail('CURRENT_WORLD_MISMATCH');
      const after=await read({sessionRef,worldRef});if(after.selection.status!=='UNBOUND')fail('CURRENT_WORLD_MISMATCH');
      return context;
    }),
    select: input => serial(async () => {
      const {sessionRef,worldRef,connectionRef,expectedRevision} = input;
      validateType('Revision', expectedRevision);
      const before = await read({sessionRef,worldRef});
      const connection = validateType('LocalConnectionReadback', await ensureConnection(sessionRef, connectionRef));
      if (connection.worldRef !== worldRef || connection.connectionRef !== connectionRef) fail('CURRENT_WORLD_MISMATCH');
      const previous = before.selection.status === 'BOUND' ? before.selection.context : null;
      const expectedContext = previous?.localContext ?? null;
      const base = {contractVersion:'canvas/v7',requestId:randomUUID(),sessionRef,expectedRevision,expectedContext};
      const switched = previous && previous.activeWorldRef !== worldRef;
      if (previous && !previous.activeWorldRef) fail('CURRENT_WORLD_MISMATCH');
      const context = switched
        ? await call('SwitchWorldConnection', {...base,worldRef:previous.activeWorldRef,fromWorldRef:previous.activeWorldRef,toWorldRef:worldRef,toConnectionRef:connectionRef})
        : await call('SelectWorldConnection', {...base,worldRef,connectionRef,connectionIncarnationRef:connection.connectionIncarnationRef});
      if (context.currentSession !== sessionRef || context.activeWorldRef !== worldRef ||
        context.localContext?.connectionRef !== connectionRef ||
        context.localContext.connectionIncarnationRef !== connection.connectionIncarnationRef) fail('CURRENT_WORLD_MISMATCH');
      const after = await read({sessionRef,worldRef});
      if (after.selection.status !== 'BOUND' || canonicalJSON(after.selection.context) !== canonicalJSON(context)) fail('CURRENT_WORLD_MISMATCH');
      return context;
    }),
  };
}
