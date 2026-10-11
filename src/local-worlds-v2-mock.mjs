import { createWorldLifecycleMock } from '#contracts';
import examples from '../fixtures/local-worlds-v2.json' with { type: 'json' };

/** Stateless SOURCE/FIXTURE peer for the three adapter-03 operations.
 * Uses the published SDK; it never creates, discovers or deletes actual worlds.
 * Refusals are keyed by local-worlds/v2:<operation> and must be declared codes.
 */
export function createLocalWorldsMock(refusals = {}) {
  const call = createWorldLifecycleMock(examples, refusals);
  return Object.freeze(Object.fromEntries(['discover', 'createWorld', 'deleteWorld']
    .map(operation => [operation, async request => call('local-worlds/v2', operation, request)])));
}
