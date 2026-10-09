import assert from 'node:assert/strict';
import test from 'node:test';

test('current entry exposes only the new local protocol and no permission provider', async () => {
  const m = await import('../src/index.mjs');
  const services = new Map(); const adapter = m.apply({ effect(run) { run(); },
    get() {}, provide: (n, v) => services.set(n, v), webServer: { register() {} } });
  try {
    assert.equal(services.has('hanaworldsWorldAdapterV6'), true);
    assert.equal(services.has('hanaworldsWorldAdapterV5'), false);
    assert.equal(services.has('hanaworldsSessionAuthorizationV1'), false);
    const C = await import('hanaworlds-contracts');
    assert.equal(services.get('hanaworldsWorldAdapterV6').contractHandshake.contracts, `hanaworlds-contracts@${C.version}`);
    C.checkContractsVersion(services.get('hanaworldsWorldAdapterV6').contractHandshake.contracts);
  } finally { await adapter.close(); }
});
