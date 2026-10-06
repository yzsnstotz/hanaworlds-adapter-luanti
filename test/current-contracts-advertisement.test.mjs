// SOURCE/FIXTURE: actual Adapter providers, no game or product authorization.
import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';
import { checkScopedWorldHandshake, checkSessionAuthorizationHandshake } from '#contracts/v4';

test('Adapter current providers advertise the exact admitted contracts 0.3.9', async () => {
  const provided = new Map();
  const adapter = apply({ effect(run) { run(); }, webServer: { register() {} },
    provide: (name, service) => provided.set(name, service), get() {},
  }, { localWorldRoots: [] });
  try {
    for (const name of ['hanaworldsWorldAdapterV4', 'hanaworldsWorldAdapterV5',
      'hanaworldsSessionAuthorizationV1']) {
      assert.equal(provided.get(name).contractHandshake.contracts, 'hanaworlds-contracts@0.3.9', name);
    }
    const scoped = provided.get('hanaworldsWorldAdapterV5');
    const original = provided.get('hanaworldsSessionAuthorizationV1');
    assert.equal(checkScopedWorldHandshake(scoped.contractHandshake).result, 'HANDSHAKE_OPERATION_MATCH');
    assert.equal(checkSessionAuthorizationHandshake(original.contractHandshake).result, 'HANDSHAKE_OPERATION_MATCH');
    assert.equal(original.contractVersion, 'session-authorization/v1');
    // No older advertisement may masquerade as this current package capability.
    for (const contracts of ['0.3.6', '0.3.8', '0.4.0']) {
      for (const [provider, check] of [[scoped, checkScopedWorldHandshake],
        [original, checkSessionAuthorizationHandshake]]) {
        assert.throws(() => check({ ...provider.contractHandshake, contracts: `hanaworlds-contracts@${contracts}` }),
          error => error.code === 'UNSUPPORTED_VERSION');
      }
    }
  } finally { await adapter.close(); }
});
