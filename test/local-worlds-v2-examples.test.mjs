import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateBoundResponse } from '#contracts';
import { apply } from '../src/index.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/local-worlds-v2.json', import.meta.url)));
import { createLocalWorldsMock } from '../src/local-worlds-v2-mock.mjs';
test('provider examples include valid receipts and every declared refusal for this card', () => {
  for (const x of fixture.exchanges) validateBoundResponse(x.wire, x.operation, x.request, x.response);
  assert.equal(fixture.exchanges.length, 8);
});
test('minimal async local-worlds mock returns examples unchanged and binds new request IDs', async () => {
  const mock = createLocalWorldsMock();
  for (const x of fixture.exchanges.filter(x => x.response.result)) {
    const q = { ...x.request, requestId: 'new:' + x.operation };
    const pending = mock[x.operation](q);
    assert.equal(typeof pending.then, 'function');
    const r = validateBoundResponse(x.wire, x.operation, q, await pending);
    assert.equal(r.error, null); assert.equal(r.requestId, q.requestId);
  }
  const q = fixture.exchanges.find(x => x.operation === 'deleteWorld').request;
  assert.equal((await mock.deleteWorld({ ...q, confirmationName: 'Wrong name' })).error.code, 'TRANSACTION_CONFLICT');
  const unavailable = createLocalWorldsMock({ 'local-worlds/v2:createWorld': 'ADAPTER_UNAVAILABLE' });
  assert.equal((await unavailable.createWorld(fixture.exchanges.find(x => x.operation === 'createWorld').request)).error.code, 'ADAPTER_UNAVAILABLE');
});
test('public registration exposes createWorld and returns a declared missing-profile refusal', async () => {
  const providers = new Map();
  const service = apply({ get() {}, effect(run) { run(); }, provide: (name, port) => providers.set(name, port), webServer: { register() { return () => {}; } } });
  try {
    assert.equal(providers.get('hanaworldsLuantiLocalWorlds'), service.localWorlds);
    const q = { contractVersion: 'local-worlds/v2', requestId: 'public:create', templateId: 'flat', displayName: 'Example world' };
    const r = validateBoundResponse('local-worlds/v2', 'createWorld', q, await service.localWorlds.createWorld(q));
    assert.equal(r.error.code, 'ADAPTER_UNAVAILABLE');
  } finally { await service.close(); }
});
