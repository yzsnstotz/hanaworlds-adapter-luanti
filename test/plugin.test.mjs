import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, DurableJournal, EngineBridge, inject, name } from '../src/index.mjs';
import { payloadDigest } from '../src/local-worlds.mjs';

function response() {
  const reply = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v; } };
  return reply;
}

test('DSH host registers loopback status and a fail-closed v4 provider', async () => {
  let route;
  let provided;
  const ctx = { webServer: { register(value) { route = value; } },
    provide(name, value) { provided = { name, value }; } };
  const service = apply(ctx, {});
  assert.equal(name, 'hanaworlds-adapter-luanti');
  assert.equal(typeof DurableJournal.open, 'function');
  assert.equal(typeof EngineBridge, 'function');
  assert.deepEqual(inject, ['webServer']);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/api-hanaworlds-luanti');
  assert.equal(provided.name, 'hanaworldsWorldAdapterV4');
  assert.equal(provided.value, service.worldAdapter);
  assert.equal(service.status().recoverableTransport, 'GATED_BY_AUTHORITY_AND_STATE_PROFILE');
  const noAuthority = await service.worldAdapter.call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'actor', sessionRef: 'session',
    requestId: 'request', authorizationRef: 'authorization', adapterId: name });
  assert.equal(noAuthority.error.code, 'PERMISSION_DENIED');

  const remote = new EventEmitter();
  remote.method = 'GET';
  remote.url = '/api-hanaworlds-luanti/status';
  remote.socket = { remoteAddress: '192.0.2.1' };
  const denied = response();
  await route.handler(remote, denied);
  assert.equal(denied.statusCode, 403);

  const local = new EventEmitter();
  local.method = 'GET';
  local.url = '/api-hanaworlds-luanti/status';
  local.socket = { remoteAddress: '127.0.0.1' };
  const allowed = response();
  await route.handler(local, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(JSON.parse(allowed.body).recoverableTransport, 'GATED_BY_AUTHORITY_AND_STATE_PROFILE');
  assert.equal(allowed.body.includes('/Users/'), false);
});

test('DSH context can load without unprovided optional HanaWorlds services', () => {
  const context = new Proxy({
    webServer: { register() {} },
    get: () => undefined,
    provide() {},
    on() {},
  }, {
    get(target, property) {
      if (property in target) return target[property];
      throw new Error(`cannot get property "${String(property)}" without inject`);
    },
  });
  const service = apply(context, {});
  assert.equal(service.status().productReadiness, 'UNPROVEN');
});

test('DSH source seam assembles its own journal backend after remote loaded-byte binding and gates frame delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hw-adapter-owned-'));
  const profile = { connectionRef: 'remote:one', worldRef: 'luanti:one',
    operatorRef: 'operator:one', serviceName: 'operator', displayName: 'Fixture',
    capabilityRevision: 'capability:one' };
  const digest = await payloadDigest();
  let storageCalls = 0;
  let shown = 0;
  const ctx = { webServer: { register() {} }, provide() {},
    hanaworldsOperatorAuthority: { verify: async () => ({ current: true, ...profile }) },
    hanaworldsRemoteTunnelFactory: { open: async () => ({
      async request(command) {
        if (command.operation === 'handshake') return { worldRef: profile.worldRef,
          payloadVersion: '0.2.0', loadedSourceDigest: digest, manifestDigest: digest,
          payloadMatches: true, worldeditAvailable: true };
        if (command.operation === 'authorize') return { worldRef: profile.worldRef,
          current: true, engineActorName: command.actorName, worldeditAvailable: true };
        if (command.operation === 'present_frame') { shown++; return {
          worldRef: profile.worldRef, result: true }; }
        throw new Error('UNEXPECTED_ENGINE_COMMAND');
      }, async close() {},
    }) },
    hanaworldsAuthority: {
      verify: async request => ({ current: true, actorRef: request.actorRef,
        sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
        worldRef: request.worldRef,
        engineActorName: 'alice', authorizerRef: 'operator:one',
        bindingRef: 'binding:one', grantEpoch: 'epoch:one', allowedActions: [] }),
      verifyEngineBinding: async () => null,
      verifyService: async () => ({ current: false }),
    },
    hanaworldsProfileStorage: { adapterJournalDirectory: async () => {
      storageCalls++; return join(dir, 'journal'); } },
    hanaworldsWorldRevisionOracle: { read: async () => 'world:one',
      readObjects: async () => ({}) },
    hanaworldsLuantiCapacity: { check: async () => ({ allowed: true }) },
    hanaworldsLuantiStateProfile: { read: async () => ({ profileVersion: 'state-profile/v2',
      nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
      inventoryMode: 'exact', timerMode: 'exact',
      derivedLightMode: 'recompute-with-readback' }) },
    hanaworldsWorkshop: { verifyFrameDelivery: async () => ({ current: true,
      worldRef: profile.worldRef, engineActorName: 'alice',
      sessionRef: 'session:one', authorizationRef: 'grant:one',
      actorRef: 'actor:alice' }), invokeAction: async () => null },
  };
  const service = apply(ctx, { remoteProfiles: [profile] });
  const bound = await service.worldAdapter.call('AuthorizeBinding', {
    contractVersion: 'world-adapter/v4', actorRef: 'actor:alice',
    sessionRef: 'session:one', requestId: 'bind:one', authorizationRef: 'grant:one',
    worldRef: profile.worldRef, connectionRef: profile.connectionRef,
    expectedCapabilityRevision: profile.capabilityRevision });
  assert.equal(bound.error, null);
  assert.equal(storageCalls, 1);
  assert.equal(typeof service.presentFrame, 'function');
  await service.presentFrame({ worldRef: profile.worldRef, engineActorName: 'alice',
    authorizationRef: 'grant:one', frame: { sessionRef: 'session:one', actions: [] } });
  assert.equal(shown, 1);
  await service.close();
});
