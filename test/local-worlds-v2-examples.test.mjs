import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateBoundResponse } from '#contracts';
import { apply } from '../src/index.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/local-worlds-v2.json', import.meta.url)));
import { createLocalWorldsMock } from '../src/local-worlds-v2-mock.mjs';
import * as mocks from '../src/local-worlds-v2-mock.mjs';
test('provider examples include valid receipts and every declared refusal for this card', () => {
  for (const x of fixture.exchanges) validateBoundResponse(x.wire, x.operation, x.request, x.response);
  assert.equal(fixture.exchanges.length, 14);
});
test('minimal async local-worlds mock returns examples unchanged and binds new request IDs', async () => {
  const mock = createLocalWorldsMock();
  for (const x of fixture.exchanges.filter(x => x.wire === 'local-worlds/v2' && x.response.result)) {
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
test('pair and ReadLocalConnection mocks share complete readback and declared refusals', async () => {
  assert.equal(typeof mocks.createLocalConnectionReadbackMock, 'function');
  const pair = fixture.exchanges.find(x => x.operation === 'pair' && x.response.result);
  const read = fixture.exchanges.find(x => x.operation === 'ReadLocalConnection' && x.response.result);
  const paired = await createLocalWorldsMock().pair({ ...pair.request, requestId: 'consumer:pair' });
  const readback = mocks.createLocalConnectionReadbackMock();
  const request = { ...read.request, requestId: 'consumer:readback' };
  const result = validateBoundResponse(read.wire, read.operation, request, await readback(request));
  assert.deepEqual(paired.result, result.result);
  assert.equal((await readback({ ...request, connectionRef: 'missing' })).error.code, 'CONNECTION_NOT_FOUND');
  assert.equal((await createLocalWorldsMock().pair({ ...pair.request, worldRef: 'missing' })).error.code, 'CONNECTION_NOT_FOUND');
  for (const code of ['CONNECTION_NOT_FOUND', 'PAYLOAD_VERSION_MISMATCH']) {
    assert.equal((await mocks.createLocalConnectionReadbackMock(code)(request)).error.code, code);
    assert.equal((await createLocalWorldsMock({ 'local-worlds/v2:pair': code }).pair(pair.request)).error.code, code);
  }
  assert.throws(() => mocks.createLocalConnectionReadbackMock('ADAPTER_UNAVAILABLE'), /Undeclared/);
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
test('source examples: same-name worlds by exact ref, every declared refusal, async mock with new request IDs', async () => {
  const source = JSON.parse(await readFile(new URL('../fixtures/local-world-source.json', import.meta.url)));
  for (const x of source.exchanges) validateBoundResponse(x.wire, x.operation, x.request, x.response);
  assert.deepEqual(source.exchanges.filter(x => x.response.error).map(x => x.response.error.code).sort(),
    ['ADAPTER_UNAVAILABLE', 'CURRENT_WORLD_MISMATCH', 'WORLD_NOT_FOUND']);
  const mock = createLocalWorldsMock();
  const read = async ref => { const q = { contractVersion: 'local-worlds/v2', requestId: `new:${ref}`, worldRef: ref };
    const pending = mock.describeSourceWorld(q); assert.equal(typeof pending.then, 'function');
    return validateBoundResponse('local-worlds/v2', 'describeSourceWorld', q, await pending); };
  const [a, b] = source.worlds; assert.equal(a.displayName, b.displayName);
  const ra = await read(a.worldRef), rb = await read(b.worldRef);
  assert.equal(ra.result.sourceLocator.locatorVersion, 'hanaworlds-luanti-source-locator/v1');
  assert.notEqual(ra.result.sourceLocator.worldPath, rb.result.sourceLocator.worldPath);
  assert.equal((await read('luanti:fixture-missing')).error.code, 'WORLD_NOT_FOUND');
  assert.equal((await read(a.displayName)).error.code, 'WORLD_NOT_FOUND');
  for (const code of ['ADAPTER_UNAVAILABLE', 'CURRENT_WORLD_MISMATCH']) {
    const q = { contractVersion: 'local-worlds/v2', requestId: 'forced', worldRef: a.worldRef };
    assert.equal((await createLocalWorldsMock({ 'local-worlds/v2:describeSourceWorld': code }).describeSourceWorld(q)).error.code, code);
  }
  assert.throws(() => createLocalWorldsMock({ 'local-worlds/v2:describeSourceWorld': 'INVALID_NAME' }), /Undeclared/);
});
test('public registration exposes describeSourceWorld; an unconfigured source answers a declared refusal', async () => {
  const providers = new Map();
  const service = apply({ get() {}, effect(run) { run(); }, provide: (name, port) => providers.set(name, port), webServer: { register() { return () => {}; } } });
  try {
    const port = providers.get('hanaworldsLuantiLocalWorlds');
    assert.equal(typeof port.describeSourceWorld, 'function');
    const q = { contractVersion: 'local-worlds/v2', requestId: 'public:source', worldRef: 'luanti:absent' };
    const r = validateBoundResponse('local-worlds/v2', 'describeSourceWorld', q, await port.describeSourceWorld(q));
    assert.equal(r.error.code, 'WORLD_NOT_FOUND'); assert.equal(r.error.mutationState, 'NONE');
  } finally { await service.close(); }
});
