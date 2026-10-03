import test from 'node:test';
import assert from 'node:assert/strict';
import { createLuantiOperations } from '../src/v2-operations.mjs';

test('late trusted InspectWorld context is resolved at call time and missing context fails before engine read', async () => {
  let context = null;
  let reads = 0;
  const runtime = createLuantiOperations({ inspectContext: () => context });
  runtime.open.set('world', { verifyPrincipal: async () => true,
    inspect: async () => { reads++; return { occupiedCells: [],
      knownEmptyCells: [[0, 0, 0]], unknownCells: [] }; } });
  const request = { worldRef: 'world', expectedWorldRevision: 'revision',
    sampledBounds: { min: [0, 0, 0], max: [0, 0, 0] } };
  const proof = { engineActorName: 'author' };
  await assert.rejects(() => runtime.operations.InspectWorld(request, proof), /CAPABILITY_UNAVAILABLE/);
  assert.equal(reads, 0);
  context = { read: async () => ({ current: true, worldRef: 'world',
    worldRevision: 'revision', objectRef: 'object', objectRevision: 'object-rev',
    catalogueDigest: 'a'.repeat(64), frameDigest: 'b'.repeat(64), portals: [],
    capacity: { check: async () => ({ allowed: true }) } }) };
  const result = await runtime.operations.InspectWorld(request, proof);
  assert.equal(result.objectRef, 'object');
  assert.equal(reads, 1);
});
