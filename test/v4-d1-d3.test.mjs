// CP-S1-02 same-origin repair D1 + D3 (freeze c9087425…).
// D3 ADAPTER-D3-RECOVERY-CAPABILITY-NULL: AuthorizeBinding advertises
//   RECOVERABLE_VERIFIED and the backend's exact StateProfile only when a
//   recoverable backend exists for the bound world.
// D1 ADAPTER-D1-STARTUP-CAPTURED-AUTHORITY: host authority, operator authority
//   and remote tunnel factory are resolved at call time.
// Host providers here are FIXTURE stand-ins; they prove no product readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestValue, projectPreparedTransaction, validateType } from 'hanaworlds-contracts/v4';
import { apply } from '../src/index.mjs';
import { payloadDigest, provisionLocalPayload } from '../src/local-worlds.mjs';

const profile = Object.freeze({ profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact', inventoryMode: 'exact',
  timerMode: 'exact', derivedLightMode: 'recompute-with-readback' });
const remoteProfile = { connectionRef: 'remote:one', worldRef: 'luanti:one',
  operatorRef: 'operator:one', serviceName: 'operator', displayName: 'Fixture',
  capabilityRevision: 'capability:one' };
const grant = request => ({ current: true, sessionRef: request.sessionRef,
  authorizationRef: request.authorizationRef, worldRef: request.worldRef, actorRef: 'actor:alice',
  authorRef: 'actor:alice', engineActorName: 'alice', authorizerRef: 'operator:one',
  bindingRef: 'binding:one', grantEpoch: 'epoch:one', domainOwner: 'hanaworlds-canvas',
  allowedActions: ['APPLY_RECOVERABLE', 'HISTORY', 'INSPECT', 'READBACK'] });

async function dshHome() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'hw-d1d3-home-')));
  process.env.DSH_HOME = home;
  return home;
}
function providers(home, digest, overrides = {}) {
  let provider = 0;
  let closes = 0;
  const services = {
    hanaworldsAuthority: { verify: async r => grant(r), verifyEngineBinding: async r => grant(r),
      verifyService: async request => ({ current: true, worldRef: remoteProfile.worldRef,
        sessionRef: request?.sessionRef, authorizationRef: request?.authorizationRef,
        domainOwner: 'hanaworlds-canvas' }) },
    hanaworldsOperatorAuthority: { verify: async input => ({ current: true, ...remoteProfile, ...input,
      worldStopped: true }) },
    hanaworldsRemoteTunnelFactory: { open: async () => ({
      async request(command) {
        provider++;
        if (command.operation === 'handshake') return { worldRef: remoteProfile.worldRef,
          payloadVersion: '0.2.0', loadedSourceDigest: digest, manifestDigest: digest,
          payloadMatches: true, worldeditAvailable: true };
        if (command.operation === 'authorize') return { worldRef: remoteProfile.worldRef,
          current: true, engineActorName: command.actorName, worldeditAvailable: true };
        throw new Error('UNEXPECTED_ENGINE_COMMAND');
      }, async close() { closes++; } }) },
    hanaworldsWorldRevisionOracle: { read: async () => 'rev-1', readObjects: async () => ({}) },
    hanaworldsLuantiCapacity: { check: async () => ({ allowed: true }) },
    hanaworldsLuantiStateProfile: { read: async () => structuredClone(profile) },
    dshHomePath: (...segments) => join(home, ...segments),
    ...overrides,
  };
  return { services, providerCalls: () => provider, tunnelCloses: () => closes };
}
const context = services => ({ webServer: { register() {} }, provide() {},
  get: name => services[name], logger: () => ({ warn() {}, error() {} }) });
const bindRequest = (requestId, connectionRef, worldRef, capabilityRevision) => ({
  contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one', requestId,
  authorizationRef: 'grant:one', worldRef, connectionRef, expectedCapabilityRevision: capabilityRevision });
const journals = async home =>
  readdir(join(home, 'data', 'hanaworlds-adapter-luanti', 'journal')).catch(() => []);

test('D3 remote: a built recoverable backend is advertised with its exact state profile', async () => {
  const home = await dshHome();
  const { services } = providers(home, await payloadDigest());
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  const bound = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-1',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.equal(bound.error, null, JSON.stringify(bound.error));
  assert.equal((await journals(home)).length, 1, 'recoverable backend built');
  assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
  assert.deepEqual(bound.result.capabilities.stateProfile, profile);
  validateType('PublicCapabilities', bound.result.capabilities);
  assert.equal(bound.result.capabilities.engineBounds, null, 'no attributed source yet');
  assert.deepEqual(bound.result.capabilities.limits, []);
  // A repeated binding for the same world reports the same backend's profile.
  const again = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-2',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.deepEqual(again.result.capabilities.stateProfile, profile);
  await service.close();
});

for (const [label, override] of [
  ['state profile provider missing', { hanaworldsLuantiStateProfile: undefined }],
  ['state profile not state-profile/v2', { hanaworldsLuantiStateProfile: { read: async () => ({ ...profile, profileVersion: 'state-profile/v1' }) } }],
  ['revision oracle missing', { hanaworldsWorldRevisionOracle: undefined }],
  ['capacity missing', { hanaworldsLuantiCapacity: undefined }],
  ['engine binding verifier missing', { hanaworldsAuthority: { verify: async r => grant(r) } }],
  ['journal storage unavailable', { dshHomePath: undefined }],
]) {
  test(`D3 negative (${label}): no backend, no guarantee, no profile, nothing written`, async () => {
    const home = await dshHome();
    const { services } = providers(home, await payloadDigest(), override);
    const service = apply(context(services), { remoteProfiles: [remoteProfile] });
    const bound = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-neg',
      remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
    assert.equal(bound.error, null, JSON.stringify(bound.error));
    assert.equal(bound.result.capabilities.recoveryGuarantee, null);
    assert.equal(bound.result.capabilities.stateProfile, null);
    assert.deepEqual(await readdir(home), [], 'no journal or other write under DSH_HOME');
    await service.close();
  });
}

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function localBind(services, home) {
  const root = await mkdtemp(join(tmpdir(), 'hw-d1d3-local-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const manifest = await provisionLocalPayload(world, { transportPort: port,
    operatorAuthority: { verify: async input => ({ current: true, ...input, worldStopped: true }) } });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  const service = apply(context(services), { localWorldRoots: [root], serviceName: 'operator' });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  const serve = async reply => {
    for (let i = 0; i < 300; i++) {
      const polled = await (await fetch(`${base}/poll`, { headers }).catch(() => null))?.json().catch(() => null);
      if (polled?.command) {
        await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
          id: polled.command.id, worldRef: manifest.worldRef, result: reply(polled.command), error: null }) });
        return polled.command.operation;
      }
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error('no courier command within 3s');
  };
  const inventory = await service.worldAdapter.call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: 'discover', authorizationRef: 'grant:one', adapterId: 'hanaworlds-adapter-luanti' });
  const row = inventory.result.connections[0];
  const pending = service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-local',
    row.connectionRef, manifest.worldRef, row.capabilityRevision));
  const digest = await payloadDigest();
  return { service, pending, serve, manifest, digest };
}

test('D3 local: a built recoverable backend is advertised with its exact state profile', async () => {
  const home = await dshHome();
  const { services } = providers(home, await payloadDigest());
  const { service, pending, serve, manifest, digest } = await localBind(services, home);
  try {
    await serve(() => ({ payloadVersion: '0.2.0', worldRef: manifest.worldRef, loadedSourceDigest: digest,
      manifestDigest: digest, payloadMatches: true, worldeditAvailable: true }));
    await serve(c => ({ current: true, engineActorName: c.actorName, worldRef: manifest.worldRef,
      worldeditAvailable: true }));
    const bound = await pending;
    assert.equal(bound.error, null, JSON.stringify(bound.error));
    assert.equal((await journals(home)).length, 1);
    assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    assert.deepEqual(bound.result.capabilities.stateProfile, profile);
  } finally { await service.close(); }
});

test('D3 local negative: without a state profile provider nothing is advertised or written', async () => {
  const home = await dshHome();
  const { services } = providers(home, await payloadDigest(), { hanaworldsLuantiStateProfile: undefined });
  const { service, pending, serve, manifest, digest } = await localBind(services, home);
  try {
    await serve(() => ({ payloadVersion: '0.2.0', worldRef: manifest.worldRef, loadedSourceDigest: digest,
      manifestDigest: digest, payloadMatches: true, worldeditAvailable: true }));
    await serve(c => ({ current: true, engineActorName: c.actorName, worldRef: manifest.worldRef,
      worldeditAvailable: true }));
    const bound = await pending;
    assert.equal(bound.result.capabilities.recoveryGuarantee, null);
    assert.equal(bound.result.capabilities.stateProfile, null);
    assert.deepEqual(await readdir(home), []);
  } finally { await service.close(); }
});

test('D1: host authority provided after Adapter start is used; withdrawn denies before replay and provider work', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest());
  const services = {};
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  const discover = requestId => service.worldAdapter.call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one', requestId,
    authorizationRef: 'grant:one', adapterId: 'hanaworlds-adapter-luanti' });
  assert.equal((await discover('before')).error.reason, 'IDENTITY_UNVERIFIED', 'absent at start: denied');
  Object.assign(services, all.services); // registered after the Adapter
  const late = await discover('late');
  assert.equal(late.error, null, JSON.stringify(late.error));
  const bound = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-late',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.equal(bound.error, null, 'late operator authority and tunnel factory are used');
  assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
  const callsBefore = all.providerCalls();
  delete services.hanaworldsAuthority; // withdrawn
  const replay = await discover('late'); // same requestId and payload as the accepted call
  assert.equal(replay.error?.code, 'PERMISSION_DENIED', 'no cached grant or replay reuse');
  assert.equal(replay.error?.reason, 'IDENTITY_UNVERIFIED');
  const rebind = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind-after-withdraw',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.equal(rebind.error?.code, 'PERMISSION_DENIED');
  assert.equal(all.providerCalls(), callsBefore, 'no engine/provider work after withdrawal');
  await service.close();
});

test('D1: operator authority and remote tunnel factory resolve at use; absent ones fail closed', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest());
  const services = { ...all.services };
  delete services.hanaworldsOperatorAuthority;
  delete services.hanaworldsRemoteTunnelFactory;
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  const bind = id => service.worldAdapter.call('AuthorizeBinding', bindRequest(id,
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.equal((await bind('no-operator')).error?.code, 'CONNECTION_UNAUTHORIZED');
  services.hanaworldsOperatorAuthority = all.services.hanaworldsOperatorAuthority;
  const noTunnel = await bind('no-tunnel');
  assert.notEqual(noTunnel.error, null, 'absent tunnel factory fails closed');
  assert.deepEqual(await readdir(home), [], 'nothing written while refused');
  services.hanaworldsRemoteTunnelFactory = all.services.hanaworldsRemoteTunnelFactory;
  const bound = await bind('late-both');
  assert.equal(bound.error, null, JSON.stringify(bound.error));
  await service.close();
});

// ADAPTER-D1-REMOTE-CACHED-TRANSPORT-WITHDRAWAL (spec FAIL ceccb6de…): a cached
// remote transport must not carry a new binding after the operator authority
// or the tunnel factory is withdrawn.
for (const [label, withdrawn, expectedCode] of [
  ['operator authority', 'hanaworldsOperatorAuthority', 'CONNECTION_UNAUTHORIZED'],
  ['remote tunnel factory', 'hanaworldsRemoteTunnelFactory', 'ADAPTER_UNAVAILABLE'],
]) {
  test(`D1 cached remote transport: ${label} withdrawn after first bind denies a new binding`, async () => {
    const home = await dshHome();
    const all = providers(home, await payloadDigest());
    const services = { ...all.services };
    const service = apply(context(services), { remoteProfiles: [remoteProfile] });
    const bind = id => service.worldAdapter.call('AuthorizeBinding', bindRequest(id,
      remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
    const first = await bind('first');
    assert.equal(first.error, null, JSON.stringify(first.error));
    assert.equal(first.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    const callsBefore = all.providerCalls();
    delete services[withdrawn];
    const after = await bind('after-withdrawal');
    assert.equal(after.result, null, 'no binding through the cached transport');
    assert.equal(after.error?.code, expectedCode, JSON.stringify(after.error));
    assert.equal(after.error?.mutationState, 'NONE');
    assert.equal(all.providerCalls(), callsBefore, 'no engine command sent over the stale tunnel');
    // The tunnel is retained only as the trusted recovery handle; every
    // non-recovery call is refused before reaching it.
    assert.equal(all.tunnelCloses(), 0, 'tunnel kept for trusted recovery');
    // ADAPTER-D1-REMOTE-REPLAY-AFTER-OPERATOR-WITHDRAWAL: revocation precedes
    // replay, so the original accepted request is not replayed either.
    const replay = await bind('first');
    assert.equal(replay.result, null, 'no cached binding replayed after withdrawal');
    assert.equal(replay.error?.code, expectedCode, JSON.stringify(replay.error));
    assert.equal((await bind('after-withdrawal-2')).error?.code, expectedCode);
    assert.equal(all.providerCalls(), callsBefore, 'still no engine command');
    // Restoring the provider makes binding available again over a verified tunnel.
    services[withdrawn] = all.services[withdrawn];
    const restored = await bind('restored');
    assert.equal(restored.error, null, JSON.stringify(restored.error));
    assert.equal(restored.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    assert.ok(all.providerCalls() > callsBefore, 'engine principal re-verified for the new binding');
    await service.close();
  });
}

// Already-bound remote world: a withdrawn operator authority (or tunnel
// factory) stops non-recovery operations before any remote engine command;
// the trusted service recovery path stays available (CONTRACT_RULES §5).
function remotePrepare(requestId) {
  const worldRef = remoteProfile.worldRef;
  const operations = { contractVersion: 'operations/v2', buildDigest: 'a'.repeat(64),
    compilerRevision: 'c', compilationConfigDigest: 'b'.repeat(64), worldRef,
    frameDigest: 'c'.repeat(64), catalogueDigest: 'd'.repeat(64), targetFactsDigest: 'e'.repeat(64),
    effects: [{ position: [0, 1, 3], nodeName: 'fixture:stone', param2: 0 }] };
  const operationDigest = digestValue('operations', operations).sha256;
  return { contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId, authorizationRef: 'grant:one', worldRef, transactionId: `tx-${requestId}`,
    operationDigest, operations,
    authorizationBinding: { contractVersion: 'world-adapter/v2', authorizerRef: 'operator:one',
      actorRef: 'actor:alice', grantEpoch: 'epoch:one', bindingRef: 'binding:one', worldRef,
      sessionRef: 'session:one', turnRevision: 't', intentDigest: 'f'.repeat(64),
      surfaceActionDigest: '1'.repeat(64), allowedAction: 'APPLY_RECOVERABLE',
      transactionId: `tx-${requestId}`, operationDigest, worldRevision: 'rev-1',
      selectionRevision: 's', analysisDigest: null, decisionRevision: null },
    expectedWorldRevision: 'rev-1', expectedObjectRevisions: {}, guarantee: 'RECOVERABLE_VERIFIED' };
}
for (const [label, withdrawn, expected] of [
  ['operator authority', 'hanaworldsOperatorAuthority', ['AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED']],
  ['remote tunnel factory', 'hanaworldsRemoteTunnelFactory', ['CAPABILITY_UNAVAILABLE', 'validate', 'POLICY_UNAVAILABLE']],
]) {
  test(`D1 already-bound remote world: ${label} withdrawn stops a transaction before any remote effect`, async () => {
    const home = await dshHome();
    const all = providers(home, await payloadDigest());
    const services = { ...all.services };
    const service = apply(context(services), { remoteProfiles: [remoteProfile] });
    const bound = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind',
      remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
    assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    const callsBefore = all.providerCalls();
    delete services[withdrawn];
    const prepared = await service.worldAdapter.call('PrepareRecoverableTransaction', remotePrepare('p1'));
    assert.deepEqual([prepared.error?.code, prepared.error?.phase, prepared.error?.reason], expected,
      JSON.stringify(prepared.error));
    assert.equal(prepared.error?.mutationState, 'NONE');
    assert.equal(all.providerCalls(), callsBefore, 'no remote engine command after withdrawal');
    const journalDir = join(home, 'data', 'hanaworlds-adapter-luanti', 'journal');
    for (const world of await readdir(journalDir).catch(() => []))
      assert.deepEqual(await readdir(join(journalDir, world)), ['world-binding'], 'no journal record');
    // Trusted service recovery is not blocked by the operator gate.
    const restore = await service.worldAdapter.call('RestoreTransaction', {
      contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
      requestId: 'restore-1', authorizationRef: 'grant:one', worldRef: remoteProfile.worldRef,
      originTransactionId: 'tx-unknown', operationDigest: 'a'.repeat(64),
      beforeImageDigest: 'b'.repeat(64), restoreAttemptIdentity: 'c'.repeat(64),
      guarantee: 'RECOVERABLE_VERIFIED' });
    assert.notEqual(restore.error?.code, 'AUTHORIZATION_REVOKED', 'recovery path not gated by operator');
    await service.close();
  });
}

// ADAPTER-D1-REVOCATION-DROPS-TRUSTED-RECOVERY-BACKEND (spec FAIL cb518a95…):
// after operator withdrawal, normal effects stay denied but trusted service
// recovery (CONTRACT_RULES §5:65) still reaches the retained backend, journal
// and tunnel for an already prepared or post-write pending transaction.
function recoveryWorld(home, digest) {
  const engine = { commands: [], serviceCurrent: true };
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  const all = providers(home, digest, {
    hanaworldsAuthority: { verify: async r => grant(r), verifyEngineBinding: async r => grant(r),
      verifyService: async request => ({ current: engine.serviceCurrent, worldRef: remoteProfile.worldRef,
        sessionRef: request?.sessionRef, authorizationRef: request?.authorizationRef,
        domainOwner: 'hanaworlds-canvas' }) },
    hanaworldsRemoteTunnelFactory: { open: async () => ({
      async request(command) {
        engine.commands.push(command.operation);
        const worldRef = remoteProfile.worldRef;
        if (command.operation === 'handshake') return { worldRef, payloadVersion: '0.2.0',
          loadedSourceDigest: digest, manifestDigest: digest, payloadMatches: true, worldeditAvailable: true };
        if (command.operation === 'authorize') return { worldRef, current: true,
          engineActorName: command.actorName, worldeditAvailable: true };
        if (command.operation === 'prepare_check') return { worldRef, result: { checked: command.positions.length } };
        if (command.operation === 'snapshot') return { worldRef, result: { worldRef,
          coveredPositions: command.positions, records: command.positions.map(air) } };
        if (command.operation === 'apply') return { worldRef, error: 'APPLY_FAILED' };
        if (command.operation === 'restore') return { worldRef, result: { status: 'ROLLED_BACK' } };
        throw new Error(`UNEXPECTED_ENGINE_COMMAND ${command.operation}`);
      }, async close() {} }) },
  });
  return { ...all, engine };
}
async function boundWithPrepared(home, requestId) {
  const world = recoveryWorld(home, await payloadDigest());
  const services = { ...world.services };
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  const bound = await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision));
  assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
  const request = remotePrepare(requestId);
  const prepared = await service.worldAdapter.call('PrepareRecoverableTransaction', request);
  assert.equal(prepared.error, null, JSON.stringify(prepared.error));
  return { world, services, service, request, prepared: prepared.result };
}

test('D1 trusted recovery: a prepared transaction can still be aborted by the service after operator withdrawal', async () => {
  const home = await dshHome();
  const { world, services, service, request, prepared } = await boundWithPrepared(home, 'pa');
  delete services.hanaworldsOperatorAuthority;
  // Normal effects and binding replay stay denied.
  assert.equal((await service.worldAdapter.call('PrepareRecoverableTransaction', remotePrepare('pb'))).error?.code,
    'AUTHORIZATION_REVOKED');
  assert.equal((await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision))).error?.code,
  'CONNECTION_UNAUTHORIZED');
  const aborted = await service.worldAdapter.call('AbortPreparedTransaction', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: 'abort-pa', authorizationRef: 'grant:one', worldRef: remoteProfile.worldRef,
    transactionId: request.transactionId, operationDigest: request.operationDigest,
    authorizationBindingDigest: digestValue('authorization-binding', request.authorizationBinding).sha256,
    serviceRecoveryRef: 'service:recovery' });
  assert.equal(aborted.error, null, JSON.stringify(aborted.error));
  assert.equal(aborted.result.status, 'ABORTED_PREPARED');
  assert.equal(aborted.result.mutationState, 'NONE');
  assert.equal(prepared.payload.transactionId, request.transactionId);
  await service.close();
});

test('D1 trusted recovery: a post-write pending transaction can still be restored by the service after operator withdrawal', async () => {
  const home = await dshHome();
  const { world, services, service, request, prepared } = await boundWithPrepared(home, 'pr');
  // Apply crosses the write barrier; the engine fails and no service proof is
  // available at that moment, so the transaction stays RECOVERY_PENDING.
  world.engine.serviceCurrent = false;
  const applied = await service.worldAdapter.call('ApplyCompiledTransaction', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: 'apply-pr', authorizationRef: 'grant:one', worldRef: remoteProfile.worldRef,
    transactionId: request.transactionId, expectedWorldRevision: 'rev-1',
    preparedTransaction: projectPreparedTransaction(prepared), operations: request.operations,
    operationDigest: request.operationDigest, authorizationBinding: request.authorizationBinding,
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(applied.error?.code, 'RECOVERY_PENDING', JSON.stringify(applied.error));
  assert.equal(applied.error?.mutationState, 'UNKNOWN');
  world.engine.serviceCurrent = true;
  delete services.hanaworldsOperatorAuthority;
  const commandsBefore = world.engine.commands.length;
  assert.equal((await service.worldAdapter.call('Readback', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas', sessionRef: 'session:one', requestId: 'readback-pr', authorizationRef: 'grant:one',
    worldRef: remoteProfile.worldRef, transactionId: request.transactionId,
    coveredPositions: prepared.protectedPositions, stateProfile: prepared.stateProfile })).error?.code,
  'AUTHORIZATION_REVOKED', 'normal readback stays denied');
  assert.equal(world.engine.commands.length, commandsBefore, 'denied call sent nothing');
  const restored = await service.worldAdapter.call('RestoreTransaction', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: 'restore-pr', authorizationRef: 'grant:one', worldRef: remoteProfile.worldRef,
    originTransactionId: request.transactionId, operationDigest: request.operationDigest,
    beforeImageDigest: prepared.beforeImageDigest, restoreAttemptIdentity: 'f'.repeat(64),
    guarantee: 'RECOVERABLE_VERIFIED' });
  assert.equal(restored.error, null, JSON.stringify(restored.error));
  assert.equal(restored.result.status, 'ROLLED_BACK');
  assert.ok(world.engine.commands.slice(commandsBefore).includes('restore'),
    'restore ran over the retained tunnel');
  await service.close();
});

// ADAPTER-D1-BACKEND-CAPTURED-AUTHORITY-FACADE (spec FAIL 6d2df63d…): the
// backend's engine-binding and service-recovery checks must consult the
// current named hanaworldsAuthority at each call, not the facade captured
// when the backend was built.
const abortRequest = (request, requestId) => ({
  contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
  requestId, authorizationRef: 'grant:one', worldRef: remoteProfile.worldRef,
  transactionId: request.transactionId, operationDigest: request.operationDigest,
  authorizationBindingDigest: digestValue('authorization-binding', request.authorizationBinding).sha256,
  serviceRecoveryRef: 'service:recovery' });
const serviceProof = request => ({ current: true, worldRef: remoteProfile.worldRef,
  sessionRef: request?.sessionRef, authorizationRef: request?.authorizationRef,
  domainOwner: 'hanaworlds-canvas' });

test('D1 backend authority: a replacement whose engine binding is not current stops Prepare before any engine effect', async () => {
  const home = await dshHome();
  const world = recoveryWorld(home, await payloadDigest());
  const services = { ...world.services };
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  assert.equal((await service.worldAdapter.call('AuthorizeBinding', bindRequest('bind',
    remoteProfile.connectionRef, remoteProfile.worldRef, remoteProfile.capabilityRevision)))
    .result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
  let oldEngineChecks = 0, newEngineChecks = 0;
  services.hanaworldsAuthority.verifyEngineBinding = async r => { oldEngineChecks++; return grant(r); };
  services.hanaworldsAuthority = { verify: async r => grant(r),
    verifyEngineBinding: async r => { newEngineChecks++; return { ...grant(r), current: false }; },
    verifyService: async r => serviceProof(r) };
  const commandsBefore = world.engine.commands.length;
  const request = remotePrepare('rb');
  const prepared = await service.worldAdapter.call('PrepareRecoverableTransaction', request);
  assert.equal(prepared.result, null);
  assert.ok(prepared.error, 'denied');
  assert.equal(prepared.error.mutationState, 'NONE');
  assert.equal(newEngineChecks, 1, 'current facade consulted');
  assert.equal(oldEngineChecks, 0, 'captured facade not used');
  assert.deepEqual(world.engine.commands.slice(commandsBefore), [], 'no prepare_check/snapshot');
  const [key] = await journals(home);
  const records = await readdir(join(home, 'data', 'hanaworlds-adapter-luanti', 'journal', key));
  assert.deepEqual(records, ['world-binding'], 'no PREPARED record');
  await service.close();
});

test('D1 backend authority: a late legitimate service authority can abort a transaction the old one would deny', async () => {
  const home = await dshHome();
  const { services, service, request } = await boundWithPrepared(home, 'ra');
  let oldServiceCalls = 0;
  services.hanaworldsAuthority.verifyService = async () => { oldServiceCalls++; return { current: false }; };
  services.hanaworldsAuthority = { verify: async r => grant(r),
    verifyEngineBinding: async r => grant(r), verifyService: async r => serviceProof(r) };
  const aborted = await service.worldAdapter.call('AbortPreparedTransaction', abortRequest(request, 'abort-ra'));
  assert.equal(aborted.error, null, JSON.stringify(aborted.error));
  assert.equal(aborted.result.status, 'ABORTED_PREPARED');
  assert.equal(oldServiceCalls, 0, 'captured facade not used');
  await service.close();
});

test('D1 backend authority: a replacement that denies service recovery is honoured over the old allowing facade', async () => {
  const home = await dshHome();
  const { world, services, service, request } = await boundWithPrepared(home, 'rd');
  let calls = 0;
  services.hanaworldsAuthority = { verify: async r => grant(r),
    verifyEngineBinding: async r => grant(r),
    // The port's own check (first call) passes; the backend's (second) denies.
    verifyService: async r => (++calls === 1 ? serviceProof(r) : { current: false }) };
  const commandsBefore = world.engine.commands.length;
  const aborted = await service.worldAdapter.call('AbortPreparedTransaction', abortRequest(request, 'abort-rd'));
  assert.equal(aborted.error?.code, 'PERMISSION_DENIED', JSON.stringify(aborted.error));
  assert.equal(calls, 2, 'backend consulted the current facade');
  assert.deepEqual(world.engine.commands.slice(commandsBefore), []);
  await service.close();
});

test('D1 backend authority: an absent or incomplete current authority fails closed in the backend', async () => {
  const home = await dshHome();
  const { world, services, service, request } = await boundWithPrepared(home, 'rx');
  // Outer verify present, backend methods absent.
  services.hanaworldsAuthority = { verify: async r => grant(r),
    verifyService: async r => serviceProof(r) };
  const commandsBefore = world.engine.commands.length;
  const prepared = await service.worldAdapter.call('PrepareRecoverableTransaction', remotePrepare('rx2'));
  assert.equal(prepared.result, null);
  assert.equal(prepared.error?.mutationState, 'NONE');
  services.hanaworldsAuthority = { verify: async r => grant(r),
    verifyEngineBinding: async r => grant(r) };
  const aborted = await service.worldAdapter.call('AbortPreparedTransaction', abortRequest(request, 'abort-rx'));
  assert.equal(aborted.error?.code, 'PERMISSION_DENIED', 'no verifyService: port denies');
  delete services.hanaworldsAuthority;
  const abortedAgain = await service.worldAdapter.call('AbortPreparedTransaction', abortRequest(request, 'abort-rx3'));
  assert.equal(abortedAgain.error?.code, 'PERMISSION_DENIED');
  assert.deepEqual(world.engine.commands.slice(commandsBefore), []);
  await service.close();
});

// D1/D3 call-path matrix (ADAPTER_D1_D3_CALL_PATH_MATRIX_2026-10-03, cede86c1…):
// probes for rows no earlier test proves, mainly the local path. Same frozen
// D1/D3 criteria; FIXTURE providers and a courier double, not product proof.
const prepareFor = (worldRef, requestId) => {
  const request = remotePrepare(requestId);
  const operations = { ...request.operations, worldRef };
  const operationDigest = digestValue('operations', operations).sha256;
  return { ...request, worldRef, operations, operationDigest,
    authorizationBinding: { ...request.authorizationBinding, worldRef, operationDigest } };
};
const abortFor = (request, requestId) => ({ ...abortRequest(request, requestId),
  worldRef: request.worldRef });
const localAuthority = (counter = {}) => ({ verify: async r => grant(r),
  verifyEngineBinding: async r => { counter.engine = (counter.engine ?? 0) + 1; return grant(r); },
  verifyService: async r => ({ ...serviceProof(r), worldRef: r?.worldRef }) });
async function localMatrix(services, { serviceCurrent = () => true, remoteProfiles } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hw-matrix-local-'));
  const worldPath = join(root, 'world');
  await mkdir(worldPath);
  await writeFile(join(worldPath, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const manifest = await provisionLocalPayload(worldPath, { transportPort: port,
    operatorAuthority: { verify: async input => ({ current: true, ...input, worldStopped: true }) } });
  const config = JSON.parse(await readFile(join(worldPath, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  const service = apply(context(services), { localWorldRoots: [root], serviceName: 'operator',
    remoteProfiles: remoteProfiles?.(manifest.worldRef) ?? [] });
  const worldRef = manifest.worldRef;
  const digest = await payloadDigest();
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  const commands = [];
  let running = true;
  const reply = command => {
    switch (command.operation) {
      case 'handshake': return { result: { payloadVersion: '0.2.0', worldRef, loadedSourceDigest: digest,
        manifestDigest: digest, payloadMatches: true, worldeditAvailable: true } };
      case 'authorize': return { result: { current: true, engineActorName: command.actorName, worldRef,
        worldeditAvailable: true } };
      case 'prepare_check': return { result: { checked: command.positions.length } };
      case 'snapshot': return { result: { worldRef, coveredPositions: command.positions,
        records: command.positions.map(air) } };
      case 'apply': return { error: 'APPLY_FAILED' };
      case 'restore': return { result: { status: 'ROLLED_BACK' } };
      default: return { error: `UNEXPECTED_ENGINE_COMMAND ${command.operation}` };
    }
  };
  const loop = (async () => {
    while (running) {
      const polled = await (await fetch(`${base}/poll`, { headers }).catch(() => null))?.json().catch(() => null);
      if (polled?.command) {
        commands.push(polled.command.operation);
        const { result = null, error = null } = reply(polled.command);
        await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
          id: polled.command.id, worldRef, result, error }) }).catch(() => null);
      } else await new Promise(done => setTimeout(done, 10));
    }
  })();
  const call = (operation, request) => service.worldAdapter.call(operation, request);
  const discover = async () => (await call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: `discover-${Math.random()}`, authorizationRef: 'grant:one',
    adapterId: 'hanaworlds-adapter-luanti' })).result?.connections?.[0];
  const bind = async requestId => {
    const row = await discover() ?? { connectionRef: 'unknown', capabilityRevision: 'unknown' };
    return call('AuthorizeBinding', bindRequest(requestId, row.connectionRef, worldRef,
      row.capabilityRevision));
  };
  const journalFiles = async () => {
    const dir = join(process.env.DSH_HOME, 'data', 'hanaworlds-adapter-luanti', 'journal');
    const out = [];
    for (const key of await readdir(dir).catch(() => [])) out.push(...await readdir(join(dir, key)));
    return out.sort();
  };
  return { service, worldRef, call, bind, discover, commands, journalFiles, serviceCurrent, worldPath,
    async close() { running = false; await loop; await service.close(); } };
}

test('Matrix L01 local new bind: authority and operator provided after Adapter start are used', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority() });
  const services = {};
  const m = await localMatrix(services);
  try {
    const before = await m.call('AuthorizeBinding', bindRequest('l01-before', 'unknown', m.worldRef, 'x'));
    assert.equal(before.error?.code, 'PERMISSION_DENIED', 'absent at start: denied');
    assert.deepEqual(m.commands, []);
    Object.assign(services, all.services);
    const bound = await m.bind('l01');
    assert.equal(bound.error, null, JSON.stringify(bound.error));
    assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
  } finally { await m.close(); }
});

for (const [row, withdrawn, expected] of [
  ['L02', 'hanaworldsAuthority', 'PERMISSION_DENIED'],
  ['L03', 'hanaworldsOperatorAuthority', 'CONNECTION_UNAUTHORIZED'],
]) {
  test(`Matrix ${row} local same-requestId bind replay: ${withdrawn} withdrawn denies before the cached response`, async () => {
    const home = await dshHome();
    const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority() });
    const services = { ...all.services };
    const m = await localMatrix(services);
    try {
      const row1 = await m.discover();
      const request = bindRequest('first', row1.connectionRef, m.worldRef, row1.capabilityRevision);
      const first = await m.call('AuthorizeBinding', request);
      assert.equal(first.error, null, JSON.stringify(first.error));
      const commandsBefore = m.commands.length;
      const journalBefore = await m.journalFiles();
      delete services[withdrawn];
      const replay = await m.call('AuthorizeBinding', request);
      assert.equal(replay.result, null, 'no cached binding replayed');
      assert.equal(replay.error?.code, expected, JSON.stringify(replay.error));
      assert.equal(m.commands.length, commandsBefore, 'no engine command');
      assert.deepEqual(await m.journalFiles(), journalBefore, 'no journal effect');
    } finally { await m.close(); }
  });
}

test('Matrix L04 local new-requestId bind: operator withdrawn denies with no binding or effect', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority() });
  const services = { ...all.services };
  const m = await localMatrix(services);
  try {
    assert.equal((await m.bind('first')).error, null);
    const commandsBefore = m.commands.length;
    const journalBefore = await m.journalFiles();
    delete services.hanaworldsOperatorAuthority;
    const after = await m.bind('second');
    assert.equal(after.result, null);
    assert.equal(after.error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(after.error));
    assert.equal(m.commands.length, commandsBefore);
    assert.deepEqual(await m.journalFiles(), journalBefore);
  } finally { await m.close(); }
});

test('Matrix L05 local Prepare: operator withdrawn after binding denies before engine command or PREPARED journal', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority() });
  const services = { ...all.services };
  const m = await localMatrix(services);
  try {
    assert.equal((await m.bind('bind')).error, null);
    const commandsBefore = m.commands.length;
    delete services.hanaworldsOperatorAuthority;
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'l05'));
    assert.deepEqual([prepared.error?.code, prepared.error?.phase, prepared.error?.reason],
      ['AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED'], JSON.stringify(prepared.error));
    assert.equal(prepared.error?.mutationState, 'NONE');
    assert.equal(m.commands.length, commandsBefore, 'no engine command');
    assert.deepEqual(await m.journalFiles(), ['world-binding'], 'no PREPARED record');
  } finally { await m.close(); }
});

test('Matrix L06 local Prepare: replacement authority B with revoked engine binding denies; old A not called', async () => {
  const home = await dshHome();
  const oldA = {};
  const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority(oldA) });
  const services = { ...all.services };
  const m = await localMatrix(services);
  try {
    assert.equal((await m.bind('bind')).error, null);
    const oldBefore = oldA.engine ?? 0;
    let newChecks = 0;
    services.hanaworldsAuthority = { ...localAuthority(),
      verifyEngineBinding: async r => { newChecks++; return { ...grant(r), current: false }; } };
    const commandsBefore = m.commands.length;
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'l06'));
    assert.equal(prepared.result, null);
    assert.equal(prepared.error?.mutationState, 'NONE', JSON.stringify(prepared.error));
    assert.equal(newChecks, 1, 'B consulted');
    assert.equal((oldA.engine ?? 0) - oldBefore, 0, 'old A not called');
    assert.equal(m.commands.length, commandsBefore);
    assert.deepEqual(await m.journalFiles(), ['world-binding']);
  } finally { await m.close(); }
});

test('Matrix R02 remote same-requestId bind replay: authority withdrawn denies before the cached response', async () => {
  const home = await dshHome();
  const all = providers(home, await payloadDigest());
  const services = { ...all.services };
  const service = apply(context(services), { remoteProfiles: [remoteProfile] });
  const request = bindRequest('first', remoteProfile.connectionRef, remoteProfile.worldRef,
    remoteProfile.capabilityRevision);
  assert.equal((await service.worldAdapter.call('AuthorizeBinding', request)).error, null);
  const callsBefore = all.providerCalls();
  const journalBefore = await readdir(join(home, 'data', 'hanaworlds-adapter-luanti', 'journal',
    (await journals(home))[0]));
  delete services.hanaworldsAuthority;
  const replay = await service.worldAdapter.call('AuthorizeBinding', request);
  assert.equal(replay.result, null);
  assert.equal(replay.error?.code, 'PERMISSION_DENIED', JSON.stringify(replay.error));
  assert.equal(all.providerCalls(), callsBefore);
  assert.deepEqual(await readdir(join(home, 'data', 'hanaworlds-adapter-luanti', 'journal',
    (await journals(home))[0])), journalBefore);
  await service.close();
});

async function localPrepared(home, requestId, authority = localAuthority()) {
  const all = providers(home, await payloadDigest(), { hanaworldsAuthority: authority });
  const services = { ...all.services };
  const m = await localMatrix(services);
  assert.equal((await m.bind('bind')).error, null);
  const request = prepareFor(m.worldRef, requestId);
  const prepared = await m.call('PrepareRecoverableTransaction', request);
  assert.equal(prepared.error, null, JSON.stringify(prepared.error));
  return { m, services, request, prepared: prepared.result };
}

test('Matrix S01 local trusted abort: prepared record aborted by the service after operator withdrawal', async () => {
  const home = await dshHome();
  const { m, services, request } = await localPrepared(home, 's01');
  try {
    delete services.hanaworldsOperatorAuthority;
    const aborted = await m.call('AbortPreparedTransaction', abortFor(request, 'abort-s01'));
    assert.equal(aborted.error, null, JSON.stringify(aborted.error));
    assert.equal(aborted.result.status, 'ABORTED_PREPARED');
    assert.equal(aborted.result.mutationState, 'NONE');
  } finally { await m.close(); }
});

test('Matrix S02 local trusted restore: post-write pending record restored by the service after operator withdrawal', async () => {
  const home = await dshHome();
  let serviceCurrent = true;
  const authority = { ...localAuthority(),
    verifyService: async r => ({ ...serviceProof(r), worldRef: r?.worldRef, current: serviceCurrent }) };
  const { m, services, request, prepared } = await localPrepared(home, 's02', authority);
  try {
    serviceCurrent = false;
    const applied = await m.call('ApplyCompiledTransaction', {
      contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
      requestId: 'apply-s02', authorizationRef: 'grant:one', worldRef: m.worldRef,
      transactionId: request.transactionId, expectedWorldRevision: 'rev-1',
      preparedTransaction: projectPreparedTransaction(prepared), operations: request.operations,
      operationDigest: request.operationDigest, authorizationBinding: request.authorizationBinding,
      guarantee: 'RECOVERABLE_VERIFIED' });
    assert.equal(applied.error?.code, 'RECOVERY_PENDING', JSON.stringify(applied.error));
    assert.equal(applied.error?.mutationState, 'UNKNOWN');
    serviceCurrent = true;
    delete services.hanaworldsOperatorAuthority;
    const commandsBefore = m.commands.length;
    const restored = await m.call('RestoreTransaction', {
      contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
      requestId: 'restore-s02', authorizationRef: 'grant:one', worldRef: m.worldRef,
      originTransactionId: request.transactionId, operationDigest: request.operationDigest,
      beforeImageDigest: prepared.beforeImageDigest, restoreAttemptIdentity: 'f'.repeat(64),
      guarantee: 'RECOVERABLE_VERIFIED' });
    assert.equal(restored.error, null, JSON.stringify(restored.error));
    assert.equal(restored.result.status, 'ROLLED_BACK');
    assert.ok(m.commands.slice(commandsBefore).includes('restore'), 'restore reached the retained transport');
  } finally { await m.close(); }
});

for (const [direction, oldAllows, newAllows] of [['A deny / B allow', false, true],
  ['A allow / B deny', true, false]]) {
  test(`Matrix S03 local trusted abort: ${direction} — backend uses the current B decision`, async () => {
    const home = await dshHome();
    let oldCalls = 0;
    const oldA = { ...localAuthority(), verifyService: async r => { oldCalls++;
      return { ...serviceProof(r), worldRef: r?.worldRef, current: oldAllows }; } };
    const { m, services, request } = await localPrepared(home, `s03-${oldAllows}`, oldA);
    try {
      let newCalls = 0;
      services.hanaworldsAuthority = { ...localAuthority(), verifyService: async r => {
        newCalls++;
        // The port's own check (first call) passes; the backend's follows B.
        return { ...serviceProof(r), worldRef: r?.worldRef, current: newCalls === 1 || newAllows }; } };
      const commandsBefore = m.commands.length;
      const aborted = await m.call('AbortPreparedTransaction', abortFor(request, `abort-s03-${oldAllows}`));
      if (newAllows) {
        assert.equal(aborted.error, null, JSON.stringify(aborted.error));
        assert.equal(aborted.result.status, 'ABORTED_PREPARED');
      } else {
        assert.equal(aborted.error?.code, 'PERMISSION_DENIED', JSON.stringify(aborted.error));
        assert.equal(m.commands.length, commandsBefore);
      }
      assert.equal(newCalls, 2, 'port and backend both consulted B');
      assert.equal(oldCalls, 0, 'stale A never consulted');
    } finally { await m.close(); }
  });
}

for (const [label, override] of [
  ['state profile not state-profile/v2', { hanaworldsLuantiStateProfile: { read: async () => ({ ...profile, profileVersion: 'state-profile/v1' }) } }],
  ['journal storage unavailable', { dshHomePath: undefined }],
]) {
  test(`Matrix D302 local negative (${label}): null guarantee and profile, nothing written`, async () => {
    const home = await dshHome();
    const all = providers(home, await payloadDigest(), { hanaworldsAuthority: localAuthority(), ...override });
    const m = await localMatrix({ ...all.services });
    try {
      const bound = await m.bind('d302');
      assert.equal(bound.error, null, JSON.stringify(bound.error));
      assert.equal(bound.result.capabilities.recoveryGuarantee, null);
      assert.equal(bound.result.capabilities.stateProfile, null);
      assert.deepEqual(await readdir(home), [], 'nothing written under DSH_HOME');
    } finally { await m.close(); }
  });
}

// ADAPTER-D1-MIXED-LOCAL-REMOTE-WORLDREF-AUTHORITY-BYPASS (quality FAIL 1fd490e1…):
// inventory uniqueness is (connectionRef, worldRef), so a local and a remote
// connection may share a worldRef. Normal v4 requests carry only worldRef;
// the connection whose transport serves that world is the exact identity and
// its operator must still stand. A different connection may not bind the same
// worldRef onto that transport, and an unbound collision fails closed.
async function mixedWorld(home) {
  const operator = { local: true, remote: true, localChecks: 0, remoteChecks: 0 };
  const tunnel = { commands: [], opens: 0 };
  const digest = await payloadDigest();
  let shared = null;
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  const all = providers(home, digest, {
    hanaworldsAuthority: localAuthority(),
    hanaworldsOperatorAuthority: { verify: async input => {
      if (input.action === 'BIND_RUNNING_WORLD') {
        operator.localChecks++;
        return { current: operator.local, ...input };
      }
      operator.remoteChecks++;
      return { current: operator.remote, ...input };
    } },
    hanaworldsRemoteTunnelFactory: { open: async () => { tunnel.opens++; return {
      async request(command) {
        tunnel.commands.push(command.operation);
        const worldRef = shared;
        if (command.operation === 'handshake') return { worldRef, payloadVersion: '0.2.0',
          loadedSourceDigest: digest, manifestDigest: digest, payloadMatches: true, worldeditAvailable: true };
        if (command.operation === 'authorize') return { worldRef, current: true,
          engineActorName: command.actorName, worldeditAvailable: true };
        if (command.operation === 'prepare_check') return { worldRef, result: { checked: command.positions.length } };
        if (command.operation === 'snapshot') return { worldRef, result: { worldRef,
          coveredPositions: command.positions, records: command.positions.map(air) } };
        throw new Error(`UNEXPECTED_ENGINE_COMMAND ${command.operation}`);
      }, async close() {} }; } },
  });
  const services = { ...all.services };
  const m = await localMatrix(services, { remoteProfiles: worldRef => {
    shared = worldRef;
    return [{ ...remoteProfile, connectionRef: 'remote:mixed', worldRef }];
  } });
  const remoteRow = async () => (await m.call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: `discover-${Math.random()}`, authorizationRef: 'grant:one',
    adapterId: 'hanaworlds-adapter-luanti' })).result.connections
    .find(row => row.connectionRef === 'remote:mixed');
  const bindRemote = async requestId => {
    const row = await remoteRow();
    return m.call('AuthorizeBinding', bindRequest(requestId, row.connectionRef, m.worldRef,
      row.capabilityRevision));
  };
  const bindLocal = async requestId => {
    const rows = (await m.call('DiscoverConnections', {
      contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
      requestId: `discover-${Math.random()}`, authorizationRef: 'grant:one',
      adapterId: 'hanaworlds-adapter-luanti' })).result.connections;
    const row = rows.find(entry => entry.connectionRef.startsWith('local:'));
    return m.call('AuthorizeBinding', bindRequest(requestId, row.connectionRef, m.worldRef,
      row.capabilityRevision));
  };
  return { m, services, operator, tunnel, bindRemote, bindLocal, remoteRow };
}

test('Mixed worldRef: remote binding with revoked remote operator and valid local operator denies replay and Prepare before any effect', async () => {
  const home = await dshHome();
  const { m, operator, tunnel, bindRemote, remoteRow } = await mixedWorld(home);
  try {
    const row = await remoteRow();
    const request = bindRequest('remote-first', row.connectionRef, m.worldRef, row.capabilityRevision);
    const first = await m.call('AuthorizeBinding', request);
    assert.equal(first.error, null, JSON.stringify(first.error));
    assert.equal(first.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    const tunnelBefore = tunnel.commands.length;
    const courierBefore = m.commands.length;
    operator.remote = false; // local operator stays valid
    const replay = await m.call('AuthorizeBinding', request);
    assert.equal(replay.result, null, 'no cached remote binding replayed');
    assert.equal(replay.error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(replay.error));
    const remoteChecks = operator.remoteChecks;
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'mx1'));
    assert.deepEqual([prepared.error?.code, prepared.error?.phase, prepared.error?.reason],
      ['AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED'], JSON.stringify(prepared.error));
    assert.equal(prepared.error?.mutationState, 'NONE');
    assert.ok(operator.remoteChecks > remoteChecks, 'the bound remote operator was checked');
    assert.equal(tunnel.commands.length, tunnelBefore, 'no remote engine command');
    assert.equal(m.commands.length, courierBefore, 'no local engine command');
    assert.deepEqual(await m.journalFiles(), ['world-binding'], 'no journal record');
    assert.equal((await bindRemote('remote-second')).error?.code, 'CONNECTION_UNAUTHORIZED');
  } finally { await m.close(); }
});

test('Mixed worldRef positive remote: the bound remote connection prepares while the local operator is revoked', async () => {
  const home = await dshHome();
  const { m, operator, tunnel, bindRemote } = await mixedWorld(home);
  try {
    assert.equal((await bindRemote('remote-bind')).error, null);
    operator.local = false;
    const courierBefore = m.commands.length;
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'mx2'));
    assert.equal(prepared.error, null, JSON.stringify(prepared.error));
    assert.ok(tunnel.commands.includes('snapshot'), 'served by the remote transport');
    assert.equal(m.commands.length, courierBefore, 'local courier untouched');
  } finally { await m.close(); }
});

test('Mixed worldRef positive local: the bound local connection prepares while the remote operator is revoked', async () => {
  const home = await dshHome();
  const { m, operator, tunnel, bindLocal } = await mixedWorld(home);
  try {
    assert.equal((await bindLocal('local-bind')).error, null);
    operator.remote = false;
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'mx3'));
    assert.equal(prepared.error, null, JSON.stringify(prepared.error));
    assert.ok(m.commands.includes('snapshot'), 'served by the local transport');
    assert.equal(tunnel.opens, 0, 'no remote tunnel opened');
    // Local withdrawal still denies the bound local connection.
    operator.local = false;
    const denied = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'mx3b'));
    assert.equal(denied.error?.code, 'AUTHORIZATION_REVOKED', JSON.stringify(denied.error));
  } finally { await m.close(); }
});

for (const [first, second] of [['local', 'remote'], ['remote', 'local']]) {
  test(`Mixed worldRef: a ${second} binding may not take over the ${first} connection's transport`, async () => {
    const home = await dshHome();
    const world = await mixedWorld(home);
    const bindFirst = first === 'local' ? world.bindLocal : world.bindRemote;
    const bindSecond = second === 'local' ? world.bindLocal : world.bindRemote;
    try {
      assert.equal((await bindFirst('first')).error, null);
      const tunnelBefore = world.tunnel.commands.length;
      const opensBefore = world.tunnel.opens;
      const courierBefore = world.m.commands.length;
      const taken = await bindSecond('second');
      assert.equal(taken.result, null, 'no cross-wired binding');
      assert.equal(taken.error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(taken.error));
      assert.equal(world.tunnel.commands.length, tunnelBefore);
      assert.equal(world.tunnel.opens, opensBefore);
      assert.equal(world.m.commands.length, courierBefore);
      // The first binding keeps working.
      assert.equal((await bindFirst('first-again')).error, null);
    } finally { await world.m.close(); }
  });
}

test('Mixed worldRef: with no bound connection an ambiguous worldRef fails closed before any effect', async () => {
  const home = await dshHome();
  const { m, tunnel } = await mixedWorld(home);
  try {
    await m.discover();
    const prepared = await m.call('PrepareRecoverableTransaction', prepareFor(m.worldRef, 'mx5'));
    assert.equal(prepared.result, null);
    assert.equal(prepared.error?.mutationState, 'NONE', JSON.stringify(prepared.error));
    assert.equal(tunnel.opens, 0);
    assert.deepEqual(m.commands, []);
  } finally { await m.close(); }
});
