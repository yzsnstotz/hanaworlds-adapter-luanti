import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteEngineTransport } from '../src/remote-transport.mjs';
import { payloadDigest } from '../src/local-worlds.mjs';
import { createLuantiOperations } from '../src/v2-operations.mjs';
import { WorldAdapterV2 } from '../src/v2-port.mjs';

const profile = { connectionRef: 'remote:one', worldRef: 'luanti:one', operatorRef: 'operator:one' };

test('remote descriptor is never a credential or an implicit network connection', async () => {
  let opened = 0;
  const tunnelFactory = { open() { opened++; throw new Error('must not open'); } };
  await assert.rejects(RemoteEngineTransport.open(profile, { tunnelFactory }),
    /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(RemoteEngineTransport.open(profile, { tunnelFactory,
    operatorAuthority: { verify: async () => ({ current: false }) } }),
    /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(RemoteEngineTransport.open(profile, {
    operatorAuthority: { verify: async () => ({ current: true, ...profile }) },
  }), /ADAPTER_UNAVAILABLE/);
  assert.equal(opened, 0);
});

test('authorized fixture tunnel checks installed bytes and current principal', async () => {
  const digest = await payloadDigest();
  const commands = [];
  let closed = 0;
  const tunnelFactory = { async open() { return {
    async request(command) {
      commands.push(command);
      if (command.operation === 'handshake') return { worldRef: profile.worldRef,
        payloadVersion: '0.2.1', loadedSourceDigest: digest, manifestDigest: digest,
        payloadMatches: true, worldeditAvailable: true };
      return { worldRef: profile.worldRef, current: true,
        engineActorName: command.actorName, worldeditAvailable: true,
        scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'native:one' };
    },
    async close() { closed++; },
  }; } };
  const operatorAuthority = { async verify() { return { current: true, ...profile }; } };
  const transport = await RemoteEngineTransport.open(profile, { operatorAuthority, tunnelFactory });
  assert.equal((await transport.verifyPrincipal('alice')).engineActorName, 'alice');
  assert.deepEqual(commands.map(command => command.operation), ['handshake', 'authorize']);
  await transport.close();
  assert.equal(closed, 1);
});

test('remote fixture tunnel carries the complete guarded engine transaction command set', async () => {
  const digest = await payloadDigest();
  const commands = [];
  const transport = await RemoteEngineTransport.open({ ...profile, serviceName: 'operator' }, {
    operatorAuthority: { verify: async () => ({ current: true, ...profile }) },
    tunnelFactory: { open: async () => ({
      async request(command) {
        commands.push(command);
        if (command.operation === 'handshake') return { worldRef: profile.worldRef,
          payloadVersion: '0.2.1', loadedSourceDigest: digest, manifestDigest: digest,
          payloadMatches: true, worldeditAvailable: true };
        return { worldRef: profile.worldRef, result: { status: 'OK' } };
      }, async close() {},
    }) },
  });
  const binding = { current: true, worldRef: profile.worldRef, engineActorName: 'alice',
    nativeGrantRef: 'native:one' };
  await transport.inspect([[0, 0, 0]], binding);
  await transport.snapshot({ coveredPositions: [[0, 0, 0]] }, binding);
  await transport.apply({ effects: [], operationDigest: 'a' },
    { beforeImage: {}, operationDigest: 'a' }, binding);
  await transport.readback({ coveredPositions: [[0, 0, 0]] }, binding);
  await transport.restore({ status: 'RESTORING' }, {});
  assert.deepEqual(commands.map(command => command.operation),
    ['handshake', 'inspect', 'snapshot', 'apply', 'readback', 'restore']);
  assert.ok(commands.every(command => command.worldRef === profile.worldRef));
  assert.ok(commands.filter(command => ['inspect', 'snapshot', 'apply', 'readback']
    .includes(command.operation)).every(command => command.actorName === 'alice' &&
      command.grantRef === 'native:one'));
  await transport.close();
});

test('v2 remote binding uses operator tunnel and live principal fixture, without dialing an address', async () => {
  const digest = await payloadDigest();
  let opened = 0;
  const descriptor = { ...profile, displayName: 'Remote fixture',
    capabilityRevision: 'remote-revision:one', payloadVersion: '0.2.1' };
  const runtime = createLuantiOperations({ remoteProfiles: [descriptor],
    operatorAuthority: { verify: async () => ({ current: true, ...profile }) },
    remoteTunnelFactory: { async open() {
      opened++;
      return { async request(command) {
        return command.operation === 'handshake'
          ? { worldRef: profile.worldRef, payloadVersion: '0.2.1',
            loadedSourceDigest: digest, manifestDigest: digest,
            payloadMatches: true, worldeditAvailable: true }
          : { worldRef: profile.worldRef, current: true,
            engineActorName: command.actorName, worldeditAvailable: true,
            scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'native:one' };
      }, async close() {} };
    } },
  });
  const port = new WorldAdapterV2({ authority: { verify: async request => ({
    current: true, actorRef: request.actorRef, sessionRef: request.sessionRef,
    authorizationRef: request.authorizationRef, engineActorName: 'alice',
    authorizerRef: 'operator:one', bindingRef: 'binding:one', grantEpoch: 'epoch:one',
    allowedActions: ['APPLY_RECOVERABLE', 'READBACK'] }) },
  operations: runtime.operations });
  const result = await port.call('AuthorizeBinding', {
    contractVersion: 'world-adapter/v2', actorRef: 'actor:alice',
    sessionRef: 'session:one', requestId: 'bind:one', authorizationRef: 'grant:one',
    worldRef: profile.worldRef, connectionRef: profile.connectionRef,
    expectedCapabilityRevision: descriptor.capabilityRevision });
  assert.equal(result.error, null);
  assert.equal(result.result.binding.worldRef, profile.worldRef);
  assert.equal(result.result.payloadDigest, digest);
  assert.equal(opened, 1);
  await runtime.close();
});
