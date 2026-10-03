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
const prepareFor = (worldRef, requestId, position) => {
  const request = remotePrepare(requestId);
  const operations = { ...request.operations, worldRef, ...(position ? {
    effects: [{ ...request.operations.effects[0], position }] } : {}) };
  const operationDigest = digestValue('operations', operations).sha256;
  return { ...request, worldRef, operations, operationDigest,
    authorizationBinding: { ...request.authorizationBinding, worldRef, operationDigest } };
};
const abortFor = (request, requestId) => ({ ...abortRequest(request, requestId),
  worldRef: request.worldRef });
const localAuthority = (counter = {}) => ({ verify: async r => grant(r),
  verifyEngineBinding: async r => { counter.engine = (counter.engine ?? 0) + 1; return grant(r); },
  verifyService: async r => ({ ...serviceProof(r), worldRef: r?.worldRef }) });
async function localMatrix(services, { serviceCurrent = () => true, remoteProfiles, replyOverride } = {}) {
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
    const override = replyOverride?.(command, worldRef, digest);
    if (override) return override;
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
  return { service, worldRef, call, bind, discover, commands, journalFiles, serviceCurrent, worldPath, base,
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
async function mixedWorld(home, { park = async () => {}, replyOverride, stateRead } = {}) {
  const operator = { local: true, remote: true, localChecks: 0, remoteChecks: 0 };
  const tunnel = { commands: [], opens: 0 };
  const digest = await payloadDigest();
  let shared = null;
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  const all = providers(home, digest, {
    hanaworldsAuthority: localAuthority(),
    ...(stateRead ? { hanaworldsLuantiStateProfile: { read: stateRead } } : {}),
    hanaworldsOperatorAuthority: { verify: async input => {
      await park();
      if (input.action === 'BIND_RUNNING_WORLD') {
        operator.localChecks++;
        return { current: operator.local, ...input };
      }
      operator.remoteChecks++;
      return { current: operator.remote, ...input };
    } },
    hanaworldsRemoteTunnelFactory: { open: async () => { await park(); tunnel.opens++; return {
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
  const m = await localMatrix(services, { replyOverride, remoteProfiles: worldRef => {
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

// ADAPTER-D1-CONCURRENT-WORLDREF-OWNERSHIP-RACE (quality FAIL eae80665…) and the
// frozen recheck map ADAPTER_D1_CONCURRENT_BIND_MATRIX_2026-10-03 (C01–C06).
// Interleavings are forced by a barrier that parks calls at provider await
// points and releases them only when every live call is parked, so overlap
// does not depend on timing luck. A call waiting on another call's shared
// in-flight work (for example the same connection's transport open) can never
// park itself, so the barrier also releases once the parked set has stopped
// changing; otherwise the fixture itself would deadlock.
function barrier() {
  let live = 0;
  let stopped = false;
  const parked = [];
  let stable = 0;
  let lastParked = 0;
  const pump = (async () => {
    while (!stopped) {
      await new Promise(done => setTimeout(done, 2));
      stable = parked.length && parked.length === lastParked ? stable + 1 : 0;
      lastParked = parked.length;
      if (parked.length && (parked.length >= live || stable >= 25)) {
        parked.splice(0).forEach(release => release());
        stable = 0; lastParked = 0;
      }
    }
  })();
  return {
    park: () => new Promise(release => parked.push(release)),
    run: promise => { live++; return promise.finally(() => { live--; }); },
    async stop() { stopped = true; parked.splice(0).forEach(release => release()); await pump; },
  };
}
const SHARED = 'luanti:shared';
async function remotePair(home, { failOpen = new Set(), serviceCurrent = () => true, stateRead, grantFor,
  closeFailures = { remaining: 0 }, closeErrorText = 'CLOSE_REJECTED', logs } = {}) {
  const gate = barrier();
  const digest = await payloadDigest();
  const operator = { 'remote:a': true, 'remote:b': true };
  const tunnels = { 'remote:a': { opens: 0, closes: 0, closeAttempts: 0, commands: [] },
    'remote:b': { opens: 0, closes: 0, closeAttempts: 0, commands: [] } };
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  const profiles = Object.keys(tunnels).map(connectionRef => ({ ...remoteProfile, connectionRef,
    worldRef: SHARED, operatorRef: `operator:${connectionRef}` }));
  const all = providers(home, digest, {
    hanaworldsAuthority: { ...localAuthority(),
      ...(grantFor ? { verify: async r => grantFor(r) } : {}),
      verifyService: async r => ({ ...serviceProof(r), worldRef: r?.worldRef, current: serviceCurrent() }) },
    ...(stateRead ? { hanaworldsLuantiStateProfile: { read: stateRead } } : {}),
    hanaworldsOperatorAuthority: { verify: async input => {
      await gate.park();
      return { ...input, current: operator[input.connectionRef] === true };
    } },
    hanaworldsRemoteTunnelFactory: { open: async profile => {
      await gate.park();
      const t = tunnels[profile.connectionRef];
      if (failOpen.has(profile.connectionRef)) throw new Error('TUNNEL_OPEN_FAILED');
      t.opens++;
      return {
        async request(command) {
          t.commands.push(command.operation);
          const worldRef = SHARED;
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
        },
        async close() {
          t.closeAttempts++;
          // Injected failure: rejects before closing, the tunnel stays live.
          if (closeFailures.remaining > 0) { closeFailures.remaining--; throw new Error(closeErrorText); }
          t.closes++;
        } };
    } },
  });
  const services = { ...all.services };
  const ctx = context(services);
  if (logs) ctx.logger = () => ({ warn: m => logs.push(String(m)), error: m => logs.push(String(m)),
    info: m => logs.push(String(m)) });
  const service = apply(ctx, { remoteProfiles: profiles });
  const bindRequestFor = (connectionRef, requestId) => bindRequest(requestId, connectionRef, SHARED,
    remoteProfile.capabilityRevision);
  const bind = (connectionRef, requestId) =>
    service.worldAdapter.call('AuthorizeBinding', bindRequestFor(connectionRef, requestId));
  const liveTunnels = () => Object.values(tunnels).reduce((n, t) => n + t.opens - t.closes, 0);
  return { gate, service, services, operator, tunnels, bind, bindRequestFor, liveTunnels,
    call: (operation, request) => service.worldAdapter.call(operation, request),
    async close() { await gate.stop(); await service.close(); } };
}
async function raceRemote(r) {
  const [a, b] = await Promise.all([r.gate.run(r.bind('remote:a', 'race-a')),
    r.gate.run(r.bind('remote:b', 'race-b'))]);
  const results = { 'remote:a': a, 'remote:b': b };
  const winners = Object.keys(results).filter(c => results[c].error === null);
  return { results, winners };
}

test('Concurrency C01 remote/remote: one owner, one transport; the loser is refused before any effect', async () => {
  const home = await dshHome();
  const r = await remotePair(home);
  try {
    const { results, winners } = await raceRemote(r);
    assert.equal(winners.length, 1, `exactly one accepted binding: ${JSON.stringify(results)}`);
    const [winner] = winners;
    const loser = winner === 'remote:a' ? 'remote:b' : 'remote:a';
    assert.equal(results[loser].error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(results[loser].error));
    assert.equal(results[loser].error?.mutationState, 'NONE');
    assert.equal(r.tunnels[loser].opens, 0, 'loser opened no tunnel');
    assert.deepEqual(r.tunnels[loser].commands, [], 'loser sent no engine command');
    assert.equal(r.liveTunnels(), 1, 'exactly one live transport');
    const before = r.tunnels[winner].commands.length;
    const prepared = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'c01'));
    assert.equal(prepared.error, null, JSON.stringify(prepared.error));
    assert.ok(r.tunnels[winner].commands.slice(before).includes('snapshot'), 'served by the winner transport');
    assert.deepEqual(r.tunnels[loser].commands, []);
  } finally { await r.close(); }
});

for (const order of [['remote', 'local'], ['local', 'remote']]) {
  test(`Concurrency C02 ${order.join('/')}: one owner, the winner operator governs, no tunnel/courier cross-wire`, async () => {
    const home = await dshHome();
    const gate = barrier();
    const world = await mixedWorld(home, { park: () => gate.park() });
    try {
      await world.m.discover();
      const start = { remote: () => world.bindRemote('race-remote'), local: () => world.bindLocal('race-local') };
      const settled = await Promise.all(order.map(kind => gate.run(start[kind]())));
      const results = Object.fromEntries(order.map((kind, i) => [kind, settled[i]]));
      const winners = Object.keys(results).filter(kind => results[kind].error === null);
      assert.equal(winners.length, 1, `exactly one accepted binding: ${JSON.stringify(results)}`);
      const [winner] = winners;
      const loser = winner === 'remote' ? 'local' : 'remote';
      assert.equal(results[loser].error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(results[loser].error));
      if (winner === 'remote') assert.ok(!world.m.commands.includes('handshake'), 'no local courier handshake');
      else assert.equal(world.tunnel.opens, 0, 'no remote tunnel opened');
      // The winner's operator governs normal calls, not the loser's.
      world.operator[loser] = false;
      const prepared = await world.m.call('PrepareRecoverableTransaction', prepareFor(world.m.worldRef, 'c02'));
      assert.equal(prepared.error, null, JSON.stringify(prepared.error));
      if (winner === 'remote') assert.ok(world.tunnel.commands.includes('snapshot'));
      else assert.ok(world.m.commands.includes('snapshot'));
      world.operator[winner] = false;
      const denied = await world.m.call('PrepareRecoverableTransaction', prepareFor(world.m.worldRef, 'c02b'));
      assert.equal(denied.error?.code, 'AUTHORIZATION_REVOKED', JSON.stringify(denied.error));
    } finally { await gate.stop(); await world.m.close(); }
  });
}

async function localPair(home) {
  const gate = barrier();
  const digest = await payloadDigest();
  const root = await mkdtemp(join(tmpdir(), 'hw-c03-'));
  const worlds = [];
  for (const name of ['one', 'two']) {
    const worldPath = join(root, name);
    await mkdir(worldPath);
    await writeFile(join(worldPath, 'world.mt'), 'gameid = minimal\n');
    const port = await freePort();
    const manifest = await provisionLocalPayload(worldPath, { transportPort: port,
      operatorAuthority: { verify: async input => ({ current: true, ...input, worldStopped: true }) } });
    worlds.push({ worldPath, port, worldRef: manifest.worldRef, commands: [] });
  }
  // A copied world: both directories carry the same worldRef.
  const shared = worlds[0].worldRef;
  const dir = join(worlds[1].worldPath, 'worldmods', 'hanaworlds_adapter');
  for (const file of ['payload.json', 'transport.json']) {
    const value = JSON.parse(await readFile(join(dir, file), 'utf8'));
    await writeFile(join(dir, file), JSON.stringify({ ...value, worldRef: shared }));
  }
  const operator = new Map(worlds.map(w => [w.worldPath, true]));
  const all = providers(home, digest, { hanaworldsAuthority: localAuthority(),
    hanaworldsOperatorAuthority: { verify: async input => {
      await gate.park();
      return { ...input, current: operator.get(input.worldPath) === true };
    } } });
  const services = { ...all.services };
  const service = apply(context(services), { localWorldRoots: [root], serviceName: 'operator' });
  const air = position => ({ position, nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null });
  let running = true;
  const loops = worlds.map(async w => {
    const config = JSON.parse(await readFile(join(w.worldPath, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
    const headers = { Authorization: `Bearer ${config.token}` };
    while (running) {
      const polled = await (await fetch(`http://127.0.0.1:${w.port}/poll`, { headers }).catch(() => null))
        ?.json().catch(() => null);
      if (!polled?.command) { await new Promise(done => setTimeout(done, 10)); continue; }
      const c = polled.command;
      w.commands.push(c.operation);
      const result = c.operation === 'handshake' ? { payloadVersion: '0.2.0', worldRef: shared,
        loadedSourceDigest: digest, manifestDigest: digest, payloadMatches: true, worldeditAvailable: true } :
        c.operation === 'authorize' ? { current: true, engineActorName: c.actorName, worldRef: shared,
          worldeditAvailable: true } :
        c.operation === 'prepare_check' ? { checked: c.positions.length } :
        c.operation === 'snapshot' ? { worldRef: shared, coveredPositions: c.positions,
          records: c.positions.map(air) } : null;
      await fetch(`http://127.0.0.1:${w.port}/result`, { method: 'POST', headers, body: JSON.stringify({
        id: c.id, worldRef: shared, result, error: result ? null : 'UNEXPECTED' }) }).catch(() => null);
    }
  });
  const call = (operation, request) => service.worldAdapter.call(operation, request);
  const rows = async () => (await call('DiscoverConnections', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas', sessionRef: 'session:one', requestId: `discover-${Math.random()}`,
    authorizationRef: 'grant:one', adapterId: 'hanaworlds-adapter-luanti' })).result.connections;
  return { gate, worlds, shared, operator, call, rows,
    async close() { running = false; await Promise.all(loops); await gate.stop(); await service.close(); } };
}

test('Concurrency C03 local/local: one owner, one transport; the winner operator governs', async () => {
  const home = await dshHome();
  const p = await localPair(home);
  try {
    const rows = await p.rows();
    assert.equal(rows.length, 2, 'two local connections share one worldRef');
    const settled = await Promise.all(rows.map(row => p.gate.run(p.call('AuthorizeBinding',
      bindRequest(`race-${row.connectionRef.slice(6, 12)}`, row.connectionRef, p.shared, row.capabilityRevision)))));
    const winners = settled.map((r, i) => r.error === null ? i : -1).filter(i => i >= 0);
    assert.equal(winners.length, 1, `exactly one accepted binding: ${JSON.stringify(settled.map(r => r.error?.code ?? 'OK'))}`);
    const loserIndex = winners[0] === 0 ? 1 : 0;
    assert.equal(settled[loserIndex].error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(settled[loserIndex].error));
    // Map rows back to worlds through the commands each courier received.
    const served = p.worlds.filter(w => w.commands.includes('handshake'));
    assert.equal(served.length, 1, 'only the winner world received engine commands');
    const [winnerWorld] = served;
    const loserWorld = p.worlds.find(w => w !== winnerWorld);
    p.operator.set(loserWorld.worldPath, false);
    const prepared = await p.call('PrepareRecoverableTransaction', prepareFor(p.shared, 'c03'));
    assert.equal(prepared.error, null, JSON.stringify(prepared.error));
    assert.ok(winnerWorld.commands.includes('snapshot'));
    assert.deepEqual(loserWorld.commands, []);
    p.operator.set(winnerWorld.worldPath, false);
    const denied = await p.call('PrepareRecoverableTransaction', prepareFor(p.shared, 'c03b'));
    assert.equal(denied.error?.code, 'AUTHORIZATION_REVOKED', JSON.stringify(denied.error));
  } finally { await p.close(); }
});

test('Concurrency C04 remote: a failed first opener leaves no reservation or transport; the next connection binds', async () => {
  const home = await dshHome();
  const failOpen = new Set(['remote:a']);
  const r = await remotePair(home, { failOpen });
  try {
    const { results } = await raceRemote(r);
    assert.notEqual(results['remote:a'].error, null, 'injected opener failure');
    assert.equal(r.tunnels['remote:a'].opens, 0, 'the failed opener left no tunnel');
    // B either won the overlap or was refused while A held the reservation;
    // either way A's failed claim must not stay stuck.
    assert.equal(r.liveTunnels(), results['remote:b'].error === null ? 1 : 0, 'no orphan transport');
    const later = await r.bind('remote:b', 'later-b');
    assert.equal(later.error, null, JSON.stringify(later.error));
    assert.equal(later.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    assert.equal(r.liveTunnels(), 1, 'exactly one live transport');
  } finally { await r.close(); }
});

test('Concurrency C04 local: a failed local handshake leaves no reservation or open transport; a remote connection then binds', async () => {
  const home = await dshHome();
  const world = await mixedWorld(home, { replyOverride: command =>
    command.operation === 'handshake' ? { result: { payloadVersion: '0.2.0', payloadMatches: false } } : null });
  try {
    const failed = await world.bindLocal('local-fails');
    assert.notEqual(failed.error, null, 'injected handshake failure');
    const probe = await fetch(`${world.m.base}/poll`).then(() => 'listening', () => 'closed');
    assert.equal(probe, 'closed', 'failed local transport was closed, not orphaned');
    const later = await world.bindRemote('remote-after');
    assert.equal(later.error, null, JSON.stringify(later.error));
    assert.ok(world.tunnel.commands.includes('handshake'));
  } finally { await world.m.close(); }
});

test('Concurrency C05: winner operator withdrawn denies replay and Prepare although the loser operator stays valid', async () => {
  const home = await dshHome();
  const r = await remotePair(home);
  try {
    const { winners } = await raceRemote(r);
    assert.equal(winners.length, 1);
    const [winner] = winners;
    const loser = winner === 'remote:a' ? 'remote:b' : 'remote:a';
    const commands = () => r.tunnels['remote:a'].commands.length + r.tunnels['remote:b'].commands.length;
    const before = commands();
    r.operator[winner] = false;
    assert.equal(r.operator[loser], true);
    const replay = await r.bind(winner, winner === 'remote:a' ? 'race-a' : 'race-b');
    assert.equal(replay.result, null, 'no cached binding replayed');
    assert.equal(replay.error?.code, 'CONNECTION_UNAUTHORIZED', JSON.stringify(replay.error));
    const prepared = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'c05'));
    assert.deepEqual([prepared.error?.code, prepared.error?.reason], ['AUTHORIZATION_REVOKED', 'GRANT_REVOKED'],
      JSON.stringify(prepared.error));
    assert.equal(commands(), before, 'no engine command on either transport');
    assert.equal((await r.bind(loser, 'loser-retry')).error?.code, 'CONNECTION_UNAUTHORIZED',
      'loser still cannot take the world');
  } finally { await r.close(); }
});

test('Concurrency C06: the winner prepared/pending records stay recoverable by the service after operator withdrawal', async () => {
  const home = await dshHome();
  let serviceOk = true;
  const r = await remotePair(home, { serviceCurrent: () => serviceOk });
  try {
    const { winners } = await raceRemote(r);
    assert.equal(winners.length, 1, 'one owner');
    const [winner] = winners;
    const abortable = prepareFor(SHARED, 'c06a');
    const preparedAbortable = await r.call('PrepareRecoverableTransaction', abortable);
    assert.equal(preparedAbortable.error, null, JSON.stringify(preparedAbortable.error));
    const pending = prepareFor(SHARED, 'c06p', [5, 1, 3]);
    const pendingResponse = await r.call('PrepareRecoverableTransaction', pending);
    assert.equal(pendingResponse.error, null, JSON.stringify(pendingResponse.error));
    const preparedPending = pendingResponse.result;
    serviceOk = false;
    const applied = await r.call('ApplyCompiledTransaction', { contractVersion: 'world-adapter/v4',
      actorRef: 'canvas', sessionRef: 'session:one', requestId: 'apply-c06', authorizationRef: 'grant:one',
      worldRef: SHARED, transactionId: pending.transactionId, expectedWorldRevision: 'rev-1',
      preparedTransaction: projectPreparedTransaction(preparedPending), operations: pending.operations,
      operationDigest: pending.operationDigest, authorizationBinding: pending.authorizationBinding,
      guarantee: 'RECOVERABLE_VERIFIED' });
    assert.equal(applied.error?.code, 'RECOVERY_PENDING', JSON.stringify(applied.error));
    serviceOk = true;
    r.operator[winner] = false;
    const aborted = await r.call('AbortPreparedTransaction', abortFor(abortable, 'abort-c06'));
    assert.equal(aborted.error, null, JSON.stringify(aborted.error));
    assert.equal(aborted.result.status, 'ABORTED_PREPARED');
    const restored = await r.call('RestoreTransaction', { contractVersion: 'world-adapter/v4',
      actorRef: 'canvas', sessionRef: 'session:one', requestId: 'restore-c06', authorizationRef: 'grant:one',
      worldRef: SHARED, originTransactionId: pending.transactionId, operationDigest: pending.operationDigest,
      beforeImageDigest: preparedPending.beforeImageDigest, restoreAttemptIdentity: 'e'.repeat(64),
      guarantee: 'RECOVERABLE_VERIFIED' });
    assert.equal(restored.error, null, JSON.stringify(restored.error));
    assert.equal(restored.result.status, 'ROLLED_BACK');
    assert.ok(r.tunnels[winner].commands.includes('restore'), 'restore over the winner transport');
  } finally { await r.close(); }
});

test('Concurrency audit: same-connection concurrent binds share one transport (no duplicate or leaked tunnel)', async () => {
  const home = await dshHome();
  const r = await remotePair(home);
  try {
    const [a1, a2] = await Promise.all([r.gate.run(r.bind('remote:a', 'same-1')),
      r.gate.run(r.bind('remote:a', 'same-2'))]);
    assert.equal(a1.error, null, JSON.stringify(a1.error));
    assert.equal(a2.error, null, JSON.stringify(a2.error));
    assert.equal(r.tunnels['remote:a'].opens, 1, 'one tunnel opened');
    assert.equal(r.liveTunnels(), 1);
  } finally { await r.close(); }
});

// ADAPTER-D1-C04-LATE-BIND-FAILURE-STRANDS-EMPTY-BACKEND (spec FAIL 9cd38efd…):
// a bind that fails after its backend was built (late capability projection
// or response validation) must leave no owner, transport or backend unless a
// binding was accepted or the journal holds unsettled (recoverable) records.
const transactionRecords = async home => {
  const dir = join(home, 'data', 'hanaworlds-adapter-luanti', 'journal');
  let n = 0;
  for (const key of await readdir(dir).catch(() => []))
    n += (await readdir(join(dir, key))).filter(name => name.endsWith('.json')).length;
  return n;
};
const uncloneableProfile = () => ({ ...profile, uncloneable: () => {} });

test('C04 late failure (reviewer case): uncloneable state profile after backend build leaves nothing; the next connection binds', async () => {
  const home = await dshHome();
  let broken = true;
  const r = await remotePair(home, { stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    const first = await r.bind('remote:a', 'late-a');
    assert.equal(first.result, null);
    assert.notEqual(first.error, null, 'first bind fails');
    assert.equal(await transactionRecords(home), 0, 'no journal transaction record');
    assert.equal(r.tunnels['remote:a'].opens, 1);
    assert.equal(r.tunnels['remote:a'].closes, 1, 'its tunnel was closed');
    assert.equal(r.liveTunnels(), 0, 'no orphan transport');
    const prepared = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'late-p'));
    assert.notEqual(prepared.error, null, 'no backend left for normal use');
    broken = false;
    const second = await r.bind('remote:b', 'late-b');
    assert.equal(second.error, null, JSON.stringify(second.error));
    assert.equal(second.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    assert.equal(r.liveTunnels(), 1);
  } finally { await r.close(); }
});

test('C04 late failure: a binding response that fails contract validation after the backend is built leaves nothing', async () => {
  const home = await dshHome();
  let broken = true;
  // Unsorted allowedActions are rejected by the response contract (no silent sort).
  const r = await remotePair(home, { grantFor: request => broken
    ? { ...grant(request), allowedActions: ['READBACK', 'APPLY_RECOVERABLE'] } : grant(request) });
  try {
    const first = await r.bind('remote:a', 'schema-a');
    assert.equal(first.result, null);
    assert.notEqual(first.error, null);
    assert.equal(r.liveTunnels(), 0, 'no orphan transport');
    assert.equal(await transactionRecords(home), 0);
    broken = false;
    const second = await r.bind('remote:b', 'schema-b');
    assert.equal(second.error, null, JSON.stringify(second.error));
    // The failed request is not replayable as a success either.
    const replay = await r.bind('remote:a', 'schema-a');
    assert.equal(replay.result, null);
  } finally { await r.close(); }
});

test('C04 late failure local: a failed local bind closes its courier transport; a remote connection then binds', async () => {
  const home = await dshHome();
  let broken = true;
  const world = await mixedWorld(home, { stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    const failed = await world.bindLocal('local-late');
    assert.notEqual(failed.error, null);
    const probe = await fetch(`${world.m.base}/poll`).then(() => 'listening', () => 'closed');
    assert.equal(probe, 'closed', 'local transport closed, not stranded');
    broken = false;
    const later = await world.bindRemote('remote-after-late');
    assert.equal(later.error, null, JSON.stringify(later.error));
  } finally { await world.m.close(); }
});

test('C04 late failure, same connection: concurrent binds that both fail leave nothing; another connection then binds', async () => {
  const home = await dshHome();
  let broken = true;
  const r = await remotePair(home, { stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    const [x, y] = await Promise.all([r.gate.run(r.bind('remote:a', 'same-late-1')),
      r.gate.run(r.bind('remote:a', 'same-late-2'))]);
    assert.notEqual(x.error, null); assert.notEqual(y.error, null);
    assert.equal(r.tunnels['remote:a'].opens, 1, 'one shared tunnel');
    assert.equal(r.liveTunnels(), 0, 'closed after the last holder failed');
    broken = false;
    assert.equal((await r.bind('remote:b', 'same-late-b')).error, null);
  } finally { await r.close(); }
});

test('C04 late failure with unsettled journal records: the recovery handle is kept, normal use refused, trusted abort works', async () => {
  const home = await dshHome();
  // A previous process left a PREPARED record for this world.
  const before = await remotePair(home);
  const prepareRequest = prepareFor(SHARED, 'carried');
  try {
    assert.equal((await before.bind('remote:a', 'prev-bind')).error, null);
    assert.equal((await before.call('PrepareRecoverableTransaction', prepareRequest)).error, null);
  } finally { await before.close(); }
  assert.equal(await transactionRecords(home), 1);
  let broken = true;
  const r = await remotePair(home, { stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    const failed = await r.bind('remote:a', 'late-with-records');
    assert.notEqual(failed.error, null);
    assert.equal(r.liveTunnels(), 1, 'transport kept as the recovery handle');
    const prepared = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'not-bound', [7, 1, 3]));
    assert.notEqual(prepared.error, null, 'no normal use without an accepted binding');
    assert.equal(r.tunnels['remote:a'].commands.filter(c => c === 'snapshot').length, 0);
    assert.equal((await r.bind('remote:b', 'other-while-recovering')).error?.code, 'CONNECTION_UNAUTHORIZED',
      'world stays with the connection that holds the recovery handle');
    const aborted = await r.call('AbortPreparedTransaction', abortFor(prepareRequest, 'abort-carried'));
    assert.equal(aborted.error, null, JSON.stringify(aborted.error));
    assert.equal(aborted.result.status, 'ABORTED_PREPARED');
    broken = false;
    const rebound = await r.bind('remote:a', 'rebind-after-recovery');
    assert.equal(rebound.error, null, JSON.stringify(rebound.error));
  } finally { await r.close(); }
});

// ADAPTER-D1-C04 post-recovery (spec FAIL 6d51bf2b…): once trusted recovery
// settles the last unsettled record of a world whose binding was never
// accepted, that world's reservation, backend and retained transport are
// retired, so a different currently authorized connection can bind.
async function priorProcessRecords(home, { pending = false, extra = false } = {}) {
  let serviceOk = true;
  const before = await remotePair(home, { serviceCurrent: () => serviceOk });
  const prepared = prepareFor(SHARED, 'carried');
  const second = prepareFor(SHARED, 'carried-2', [9, 1, 3]);
  try {
    assert.equal((await before.bind('remote:a', 'prev-bind')).error, null);
    const response = await before.call('PrepareRecoverableTransaction', prepared);
    assert.equal(response.error, null, JSON.stringify(response.error));
    if (extra) assert.equal((await before.call('PrepareRecoverableTransaction', second)).error, null);
    if (pending) {
      serviceOk = false;
      const applied = await before.call('ApplyCompiledTransaction', { contractVersion: 'world-adapter/v4',
        actorRef: 'canvas', sessionRef: 'session:one', requestId: 'apply-carried', authorizationRef: 'grant:one',
        worldRef: SHARED, transactionId: prepared.transactionId, expectedWorldRevision: 'rev-1',
        preparedTransaction: projectPreparedTransaction(response.result), operations: prepared.operations,
        operationDigest: prepared.operationDigest, authorizationBinding: prepared.authorizationBinding,
        guarantee: 'RECOVERABLE_VERIFIED' });
      assert.equal(applied.error?.code, 'RECOVERY_PENDING', JSON.stringify(applied.error));
    }
    return { prepared, second, beforeImageDigest: response.result.beforeImageDigest };
  } finally { await before.close(); }
}
async function lateFailedOwner(home) {
  let broken = true;
  const r = await remotePair(home, { stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  const failed = await r.bind('remote:a', 'late-a');
  assert.notEqual(failed.error, null, 'late bind failure');
  assert.equal(r.liveTunnels(), 1, 'recovery handle retained while records are unsettled');
  const normal = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'refused', [11, 1, 3]));
  assert.notEqual(normal.error, null, 'normal use refused before acceptance');
  return { r, fix: () => { broken = false; } };
}
const restoreFor = (prepared, beforeImageDigest, requestId) => ({ contractVersion: 'world-adapter/v4',
  actorRef: 'canvas', sessionRef: 'session:one', requestId, authorizationRef: 'grant:one', worldRef: SHARED,
  originTransactionId: prepared.transactionId, operationDigest: prepared.operationDigest, beforeImageDigest,
  restoreAttemptIdentity: 'd'.repeat(64), guarantee: 'RECOVERABLE_VERIFIED' });

test('C04/C06 post-recovery: trusted Abort settles the last record; a different authorized connection then binds', async () => {
  const home = await dshHome();
  const { prepared } = await priorProcessRecords(home);
  const { r, fix } = await lateFailedOwner(home);
  try {
    fix(); // the host profile is valid again for any new binding
    const aborted = await r.call('AbortPreparedTransaction', abortFor(prepared, 'abort-post'));
    assert.equal(aborted.error, null, JSON.stringify(aborted.error));
    assert.equal(aborted.result.status, 'ABORTED_PREPARED');
    assert.equal(r.tunnels['remote:a'].closes, r.tunnels['remote:a'].opens, 'old tunnel retired');
    assert.equal(r.liveTunnels(), 0);
    const other = await r.bind('remote:b', 'other-after-recovery');
    assert.equal(other.error, null, JSON.stringify(other.error));
    assert.equal(other.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    assert.equal(r.liveTunnels(), 1, 'only the new connection transport');
    assert.equal(r.tunnels['remote:b'].opens, 1);
  } finally { await r.close(); }
});

test('C04/C06 post-recovery: trusted Restore of a pending record settles it; a different connection then binds', async () => {
  const home = await dshHome();
  const { prepared, beforeImageDigest } = await priorProcessRecords(home, { pending: true });
  const { r, fix } = await lateFailedOwner(home);
  try {
    fix();
    const restored = await r.call('RestoreTransaction', restoreFor(prepared, beforeImageDigest, 'restore-post'));
    assert.equal(restored.error, null, JSON.stringify(restored.error));
    assert.equal(restored.result.status, 'ROLLED_BACK');
    assert.equal(r.liveTunnels(), 0, 'retired after settlement');
    assert.equal((await r.bind('remote:b', 'other-after-restore')).error, null);
  } finally { await r.close(); }
});

test('C04/C06 post-recovery: the world stays held while any record is unsettled, then retires on the last one', async () => {
  const home = await dshHome();
  const { prepared, second } = await priorProcessRecords(home, { extra: true });
  const { r, fix } = await lateFailedOwner(home);
  try {
    fix();
    assert.equal((await r.call('AbortPreparedTransaction', abortFor(prepared, 'abort-1'))).error, null);
    assert.equal(r.liveTunnels(), 1, 'one record still unsettled: handle kept');
    assert.equal((await r.bind('remote:b', 'too-early')).error?.code, 'CONNECTION_UNAUTHORIZED');
    assert.notEqual((await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, 'still-refused', [12, 1, 3]))).error,
      null, 'still no normal use');
    assert.equal((await r.call('AbortPreparedTransaction', abortFor(second, 'abort-2'))).error, null);
    assert.equal(r.liveTunnels(), 0);
    assert.equal((await r.bind('remote:b', 'after-last')).error, null);
  } finally { await r.close(); }
});

test('C04/C06 post-recovery: a same-owner bind in flight during settlement keeps the world and is accepted', async () => {
  const home = await dshHome();
  const { prepared } = await priorProcessRecords(home);
  const { r, fix } = await lateFailedOwner(home);
  try {
    fix();
    // Hold the in-flight bind inside the handler (its reused-tunnel operator check).
    const real = r.services.hanaworldsOperatorAuthority;
    let calls = 0;
    let release;
    const held = new Promise(done => { release = done; });
    let entered;
    const inside = new Promise(done => { entered = done; });
    r.services.hanaworldsOperatorAuthority = { verify: async input => {
      calls++;
      if (calls === 2) { entered(); await held; }
      return real.verify(input);
    } };
    const pending = r.bind('remote:a', 'same-owner-during-settlement');
    await inside;
    const aborted = await r.call('AbortPreparedTransaction', abortFor(prepared, 'abort-during'));
    assert.equal(aborted.error, null, JSON.stringify(aborted.error));
    assert.equal(r.liveTunnels(), 1, 'not retired while the owner bind is in flight');
    release();
    const bound = await pending;
    assert.equal(bound.error, null, JSON.stringify(bound.error));
    assert.equal(bound.result.capabilities.recoveryGuarantee, 'RECOVERABLE_VERIFIED');
    r.services.hanaworldsOperatorAuthority = real;
    assert.equal((await r.bind('remote:b', 'other-after-accept')).error?.code, 'CONNECTION_UNAUTHORIZED');
  } finally { await r.close(); }
});

// ADAPTER-D1-C04 close failure (spec FAIL aafc5a8e…): a transport whose close
// is rejected stays owned and reachable; the world is released only after a
// later close succeeds, and no second tunnel is opened meanwhile.
async function assertCloseFailureLifecycle(r, closeFailures, label) {
  // The retirement/cleanup close was rejected: the old tunnel is live and owned.
  assert.equal(r.tunnels['remote:a'].closeAttempts, 1, `${label}: one close attempted`);
  assert.equal(r.liveTunnels(), 1, `${label}: rejected close keeps the tunnel managed, not orphaned`);
  const effectsBefore = r.tunnels['remote:a'].commands.length;
  // A competing connection is refused while cleanup keeps failing, without a new tunnel.
  closeFailures.remaining = 1;
  const refused = await r.bind('remote:b', `${label}-refused`);
  assert.equal(refused.result, null);
  assert.equal(refused.error?.code, 'ADAPTER_UNAVAILABLE', JSON.stringify(refused.error));
  assert.equal(r.tunnels['remote:b'].opens, 0, 'no second tunnel while the old one may live');
  assert.equal(r.tunnels['remote:a'].closeAttempts, 2, 'cleanup re-attempted on demand');
  const normal = await r.call('PrepareRecoverableTransaction', prepareFor(SHARED, `${label}-normal`, [13, 1, 3]));
  assert.notEqual(normal.error, null, 'no normal effect on a held, unaccepted world');
  assert.equal(r.tunnels['remote:a'].commands.length, effectsBefore, 'zero engine commands');
  // The next attempt's cleanup succeeds; then the other connection binds.
  const bound = await r.bind('remote:b', `${label}-bound`);
  assert.equal(bound.error, null, JSON.stringify(bound.error));
  assert.equal(r.tunnels['remote:a'].closes, r.tunnels['remote:a'].opens, 'old tunnel closed');
  assert.equal(r.tunnels['remote:b'].opens, 1);
  assert.equal(r.liveTunnels(), 1);
}

test('C04 close failure (A, post-recovery retirement): a rejected close keeps the world held until a later close succeeds', async () => {
  const home = await dshHome();
  const { prepared } = await priorProcessRecords(home);
  const closeFailures = { remaining: 0 };
  let broken = true;
  const r = await remotePair(home, { closeFailures,
    stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    assert.notEqual((await r.bind('remote:a', 'late-a')).error, null);
    broken = false;
    closeFailures.remaining = 1;
    const aborted = await r.call('AbortPreparedTransaction', abortFor(prepared, 'abort-close'));
    assert.equal(aborted.error, null, 'trusted recovery itself succeeded');
    assert.equal(aborted.result.status, 'ABORTED_PREPARED');
    await assertCloseFailureLifecycle(r, closeFailures, 'A');
  } finally { closeFailures.remaining = 0; await r.close(); }
  assert.equal(r.liveTunnels(), 0, 'no orphan after shutdown');
});

test('C04 close failure (B, immediate failed bind): a rejected close keeps the world held until a later close succeeds', async () => {
  const home = await dshHome();
  const closeFailures = { remaining: 1 };
  let broken = true;
  const r = await remotePair(home, { closeFailures,
    stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    const failed = await r.bind('remote:a', 'late-close');
    assert.notEqual(failed.error, null, 'the bind reports its own failure');
    broken = false;
    await assertCloseFailureLifecycle(r, closeFailures, 'B');
  } finally { closeFailures.remaining = 0; await r.close(); }
  assert.equal(r.liveTunnels(), 0, 'no orphan after shutdown');
});

test('C04 close failure: the owner itself rebinds only after its old tunnel is closed (fresh tunnel, no reuse)', async () => {
  const home = await dshHome();
  const closeFailures = { remaining: 1 };
  let broken = true;
  const r = await remotePair(home, { closeFailures,
    stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  try {
    assert.notEqual((await r.bind('remote:a', 'own-late')).error, null);
    broken = false;
    closeFailures.remaining = 1;
    assert.equal((await r.bind('remote:a', 'own-refused')).error?.code, 'ADAPTER_UNAVAILABLE');
    assert.equal(r.tunnels['remote:a'].opens, 1, 'no second tunnel');
    const again = await r.bind('remote:a', 'own-again');
    assert.equal(again.error, null, JSON.stringify(again.error));
    assert.equal(r.tunnels['remote:a'].opens, 2, 'a fresh tunnel after the old one closed');
    assert.equal(r.liveTunnels(), 1);
  } finally { closeFailures.remaining = 0; await r.close(); }
  assert.equal(r.liveTunnels(), 0);
});

test('C04 close failure at shutdown is reported and the transport stays managed until a later close succeeds', async () => {
  const home = await dshHome();
  const closeFailures = { remaining: 0 };
  const r = await remotePair(home, { closeFailures });
  try {
    assert.equal((await r.bind('remote:a', 'shutdown-bind')).error, null);
    closeFailures.remaining = 1;
    await assert.rejects(r.service.close(), /transport close failed/, 'shutdown reports the failure');
    assert.equal(r.liveTunnels(), 1, 'still managed, not dropped');
    await r.service.close();
    assert.equal(r.liveTunnels(), 0, 'closed on the next attempt; no orphan');
  } finally {
    closeFailures.remaining = 0;
    await r.gate.stop();
    await r.service.close().catch(() => {});
  }
});

// Provider close-exception privacy (quality FAIL f0f6bba3…): text thrown by an
// untrusted tunnel close() never reaches host logs, public errors or the
// shutdown error; the failure stays attributable by a fixed code.
test('C04 close failure never logs or returns provider exception text (bind cleanup and shutdown)', async () => {
  const home = await dshHome();
  const marker = `SYNTHETIC-CANARY-${Math.random().toString(36).slice(2)}`;
  const closeErrorText = `close failed at https://relay.invalid/?token=${marker} Authorization: Bearer ${marker}`;
  const logs = [];
  const consoleLines = [];
  const realConsoleError = console.error;
  console.error = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  const closeFailures = { remaining: 1 };
  let broken = true;
  const r = await remotePair(home, { closeFailures, closeErrorText, logs,
    stateRead: async () => broken ? uncloneableProfile() : structuredClone(profile) });
  const surfaces = [];
  try {
    // (B) bind cleanup: late failure, then the cleanup close is rejected.
    const failed = await r.bind('remote:a', 'privacy-late');
    surfaces.push(JSON.stringify(failed));
    assert.notEqual(failed.error, null);
    assert.equal(r.liveTunnels(), 1, 'handle still managed');
    broken = false;
    // A competing bind re-attempts the close, which is rejected again.
    closeFailures.remaining = 1;
    const refused = await r.bind('remote:b', 'privacy-refused');
    surfaces.push(JSON.stringify(refused));
    assert.equal(refused.error?.code, 'ADAPTER_UNAVAILABLE');
    assert.equal(r.tunnels['remote:b'].opens, 0, 'no second tunnel');
    // Later successful close; then the authorized connection binds.
    const bound = await r.bind('remote:b', 'privacy-bound');
    surfaces.push(JSON.stringify(bound));
    assert.equal(bound.error, null, JSON.stringify(bound.error));
    // Shutdown path: its close is rejected with the marker text too.
    closeFailures.remaining = 1;
    const shutdown = await r.service.close().then(() => null, error => error);
    assert.ok(shutdown instanceof Error, 'shutdown reports the failure');
    surfaces.push(String(shutdown.message), String(shutdown.stack), JSON.stringify(shutdown));
    var shutdownCoded = /TRANSPORT_CLOSE_FAILED/.test(shutdown.message);
    assert.equal(r.liveTunnels(), 1, 'still managed after a rejected shutdown close');
    await r.service.close();
    assert.equal(r.liveTunnels(), 0, 'closed on the next explicit attempt');
  } finally {
    console.error = realConsoleError;
    closeFailures.remaining = 0;
    await r.gate.stop();
    await r.service.close().catch(() => {});
  }
  // Boolean-only assertions: a failure must never echo provider text.
  const everything = [...logs, ...consoleLines, ...surfaces].join('\n');
  assert.equal(everything.includes(marker), false, 'no provider text in any log, public error or shutdown error');
  assert.equal(everything.includes('relay.invalid'), false, 'no provider URL anywhere');
  assert.equal(logs.length + consoleLines.length > 0, true, 'the close failure was reported');
  assert.equal([...logs, ...consoleLines].some(line => line.includes('TRANSPORT_CLOSE_FAILED')), true,
    'host log attributes the failure by a fixed code');
  assert.equal(shutdownCoded, true, 'shutdown error attributable by a fixed code');
});
