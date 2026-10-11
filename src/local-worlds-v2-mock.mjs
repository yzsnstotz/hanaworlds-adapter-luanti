import { createLocalWorldSourceMock, createWorldLifecycleMock, validateBoundRequest, validateBoundResponse } from '#contracts';
import examples from '../fixtures/local-worlds-v2.json' with { type: 'json' };
import sourceExamples from '../fixtures/local-world-source.json' with { type: 'json' };

/** Stateless SOURCE/FIXTURE peer for every local-worlds/v2 operation, including the read-only
 * describeSourceWorld (Luanti-shaped locators, selected by exact worldRef, never by name).
 * Uses the published SDK; it never creates, discovers, describes or deletes actual worlds.
 * Refusals are keyed by local-worlds/v2:<operation> and must be declared codes.
 */
export function createLocalWorldsMock(refusals = {}) {
  const { 'local-worlds/v2:describeSourceWorld': sourceRefusal = null, ...lifecycleRefusals } = refusals;
  const call = createWorldLifecycleMock(examples, lifecycleRefusals);
  const describe = createLocalWorldSourceMock(sourceExamples, sourceRefusal);
  return Object.freeze({ ...Object.fromEntries(['discover', 'createWorld', 'pair', 'deleteWorld']
    .map(operation => [operation, async request => call('local-worlds/v2', operation, request)])),
    describeSourceWorld: async request => describe(request) });
}

/** Fixture-only world-adapter readback operation; never proves native freshness. */
export function createLocalConnectionReadbackMock(refusal) {
  if (refusal !== undefined && !['CONNECTION_NOT_FOUND', 'PAYLOAD_VERSION_MISMATCH'].includes(refusal))
    throw new TypeError('Undeclared readback fixture error');
  const exchanges = examples.exchanges.filter(x => x.operation === 'ReadLocalConnection');
  const success = exchanges.find(x => x.response.result);
  return async input => {
    const request = validateBoundRequest('world-adapter/v8', 'ReadLocalConnection', input);
    const code = refusal ?? (request.connectionRef === success.request.connectionRef ? null : 'CONNECTION_NOT_FOUND');
    const example = code ? exchanges.find(x => x.response.error?.code === code) : success;
    return validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', request,
      { ...example.response, requestId: request.requestId });
  };
}
