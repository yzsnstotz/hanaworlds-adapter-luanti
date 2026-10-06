// Real fixed Cordis owns provider cleanup; the webServer route table is a labelled fixture.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { apply, inject } from '../../src/index.mjs';

const app = process.env.HANAWORLDS_TEST_HOST_APP;
assert.ok(app, 'set HANAWORLDS_TEST_HOST_APP to the fixed isolated Host input');
const { Context } = await import(pathToFileURL(join(app,
  'Contents/Resources/hanaworlds-dsh/node_modules/@deepseek-ai/cordis/lib/index.js')));
const names = ['hanaworldsWorldAdapterV4', 'hanaworldsWorldAdapterV5', 'hanaworldsLuantiLocalWorlds',
  'hanaworldsLuantiGrantEvidence', 'hanaworldsSessionAuthorizationV1', 'hanaworldsLuantiNativeFacts'];
const path = '/api-hanaworlds-luanti';

function fixture() {
  const routes = new Map(), ctx = new Context();
  let unregisterCalls = 0;
  // Exact fixed Host semantics: duplicate rejects, returned handle deletes its key.
  ctx.provide('webServer', { register(route) {
    if (routes.has(route.path)) throw new Error(`webserver: duplicate prefix route "${route.path}"`);
    routes.set(route.path, route);
    return () => { unregisterCalls++; routes.delete(route.path); };
  } });
  const load = () => {
    let service;
    const fiber = ctx.plugin({ inject, apply(context) { service = apply(context); } });
    return { fiber, get service() { return service; } };
  };
  return { ctx, routes, load, get unregisterCalls() { return unregisterCalls; } };
}

test('dispose clears its route/services; repeated old close cannot delete the next instance', async () => {
  const f = fixture(), first = f.load();
  await first.fiber.await();
  assert.equal(f.ctx.get(names[0]), first.service.worldAdapter);
  assert.equal(f.routes.size, 1);
  await first.fiber.dispose();
  assert.equal(f.routes.size, 0);
  for (const name of names) assert.equal(f.ctx.get(name), undefined);
  assert.equal(f.unregisterCalls, 1);
  const next = f.load();
  try {
    await next.fiber.await();
    const current = f.routes.get(path), currentService = f.ctx.get(names[0]);
    await Promise.all([first.service.close(), first.service.close()]);
    await first.fiber.dispose();
    assert.equal(f.routes.get(path), current);
    assert.equal(f.ctx.get(names[0]), currentService);
    assert.equal(f.unregisterCalls, 1);
    await Promise.all([next.service.close(), next.service.close()]);
    assert.equal(f.routes.size, 0);
    assert.equal(f.unregisterCalls, 2);
  } finally { await next.fiber.dispose(); }
  for (const name of names) assert.equal(f.ctx.get(name), undefined);
  assert.equal(f.unregisterCalls, 2);
});

test('failed duplicate route enable rolls back services and preserves the foreign route', async () => {
  const f = fixture(), foreign = { kind: 'prefix', path, handler() {} };
  f.routes.set(path, foreign);
  const failed = f.load();
  await assert.rejects(failed.fiber.await(), /duplicate prefix route/);
  await failed.fiber.dispose();
  assert.equal(f.routes.get(path), foreign);
  assert.equal(f.unregisterCalls, 0);
  for (const name of names) assert.equal(f.ctx.get(name), undefined);
  f.routes.delete(path);
  const next = f.load();
  try { await next.fiber.await(); assert.equal(f.routes.size, 1); }
  finally { await next.fiber.dispose(); }
  assert.equal(f.routes.size, 0);
});

test('failed service publication leaves another fiber service intact', async () => {
  const f = fixture(), foreign = {};
  f.ctx.provide(names[1], foreign);
  const failed = f.load();
  await assert.rejects(failed.fiber.await(), /has been registered/);
  await failed.fiber.dispose();
  assert.equal(f.ctx.get(names[1]), foreign);
  for (const name of names.filter(name => name !== names[1])) assert.equal(f.ctx.get(name), undefined);
  assert.equal(f.routes.size, 0);
  assert.equal(f.unregisterCalls, 0);
});
