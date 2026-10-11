// CP-S1-02 repair: the Workshop facade is resolved when an in-world action or
// frame arrives, not when the Adapter starts (Adapter installs before Workshop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, workshopRelay } from '../src/index.mjs';
import { provisionLocalPayload } from '../src/local-worlds.mjs';
import { LocalEngineTransport } from '../src/local-transport.mjs';

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
// A facade shaped like Workshop's: a class whose methods need `this`.
class Facade {
  #calls = [];
  #revoked = false;
  revoke() { this.#revoked = true; }
  get calls() { return this.#calls; }
  async invokeAction(request, principal) {
    if (this.#revoked) { const e = new Error('AUTHORIZATION_REVOKED'); e.code = 'AUTHORIZATION_REVOKED'; throw e; }
    this.#calls.push({ request, principal });
    return { invocationId: request.invocationId, resultRevision: 'revision:two',
      ownerRef: 'workshop', domainReceiptDigest: null, accepted: true };
  }
}

test('relay resolves the facade per invocation: missing refuses, late provider accepted, withdrawn refuses', async () => {
  let current;
  const logs = [];
  const relay = workshopRelay(() => current, (level, message) => logs.push({ level, message }));
  const request = { invocationId: 'inv-1' };
  const principal = { worldRef: 'luanti:w', engineActorName: 'alice' };
  await assert.rejects(() => relay(request, principal), /RENDERER_CAPABILITY_UNAVAILABLE/);
  assert.ok(logs.some(l => l.message.includes('not provided')));
  current = new Facade(); // provided after the Adapter started
  const receipt = await relay(request, principal);
  assert.equal(receipt.accepted, true);
  assert.deepEqual(current.calls, [{ request, principal }], 'exact request and principal, method this kept');
  const kept = current;
  current = undefined; // provider withdrawn
  await assert.rejects(() => relay({ invocationId: 'inv-2' }, principal), /RENDERER_CAPABILITY_UNAVAILABLE/);
  assert.equal(kept.calls.length, 1);
  current = { invokeAction: 'not a function' };
  await assert.rejects(() => relay({ invocationId: 'inv-3' }, principal), /RENDERER_CAPABILITY_UNAVAILABLE/);
});

test('loopback in-world action: late provider relayed once; missing, withdrawn and revoked are refused with no receipt and no engine work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-relay-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const manifest = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  let current;
  const courier = await LocalEngineTransport.open(world, { serviceName: 'operator',
    onAction: workshopRelay(() => current, () => {}) });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  const frameFor = n => ({ actorRef: 'actor:alice', authorizationRef: 'grant:one',
    sessionRef: 'session:one', turnRevision: 'turn:one', frameRef: `frame:${n}`,
    frameRevision: 'frame-revision:one', content: 'Continue', actions: [
      { actionId: 'continue', surfaceActionDigest: 'a'.repeat(64), inputKinds: ['TEXT'],
        surfaceAction: { contractVersion: 'interaction-surface/v2', sessionRef: 'session:one',
          turnRevision: 'turn:one', frameRef: `frame:${n}`, frameRevision: 'frame-revision:one',
          actionId: 'continue', orderedTargetRefs: [], intentDigest: 'b'.repeat(64),
          operationDigest: null, analysisDigest: null, decisionRevision: null } }] });
  const present = async frame => {
    const pending = courier.presentFrame('alice', frame);
    const authorize = await (await fetch(`${base}/poll`, { headers })).json();
    assert.equal(authorize.command.operation, 'authorize');
    await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: authorize.command.id, worldRef: manifest.worldRef,
      result: { current: true, worldRef: manifest.worldRef, engineActorName: 'alice',
        worldeditAvailable: true, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION',
        grantRef: 'native:one' }, error: null }) });
    const polled = await (await fetch(`${base}/poll`, { headers })).json();
    assert.equal(polled.command.operation, 'present_frame');
    await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: polled.command.id, worldRef: manifest.worldRef, result: true, error: null }) });
    assert.equal(await pending, true);
  };
  const act = async (frame, id, expectAuthorize = true) => {
    const request = { contractVersion: 'interaction-surface/v3', actorRef: frame.actorRef,
      sessionRef: frame.sessionRef, requestId: id, authorizationRef: frame.authorizationRef,
      turnRevision: frame.turnRevision, frameRevision: frame.frameRevision, frameRef: frame.frameRef,
      actionId: 'continue', invocationId: id, surfaceAction: frame.actions[0].surfaceAction,
      surfaceActionDigest: frame.actions[0].surfaceActionDigest, input: { kind: 'TEXT', text: 'Hi' } };
    const pending = fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice', request }) });
    if (expectAuthorize) {
      let authorize;
      for (let i = 0; i < 100; i++) {
        authorize = await (await fetch(`${base}/poll`, { headers })).json();
        if (authorize.command) break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(authorize?.command?.operation, 'authorize');
      await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
        id: authorize.command.id, worldRef: manifest.worldRef,
        result: { current: true, worldRef: manifest.worldRef, engineActorName: 'alice',
          worldeditAvailable: true, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION',
          grantRef: 'native:one' }, error: null }) });
    }
    const response = await pending;
    return { status: response.status, body: await response.json() };
  };
  const noEngineWork = async () => assert.equal(
    (await (await fetch(`${base}/poll`, { headers })).json()).command, null, 'no engine command queued');
  try {
    // 1. Workshop not provided yet (Adapter started first): refused, nothing relayed.
    await present(frameFor(1));
    const missing = await act(frameFor(1), 'invoke:missing');
    assert.deepEqual(missing, { status: 503, body: { error: 'RENDERER_CAPABILITY_UNAVAILABLE' } });
    await noEngineWork();
    // 2. Workshop provided later: the next invocation reaches it once with the verified principal.
    const facade = new Facade();
    current = facade;
    await present(frameFor(2));
    const late = await act(frameFor(2), 'invoke:late');
    assert.equal(late.status, 200);
    assert.equal(late.body.result.accepted, true);
    assert.equal(late.body.result.invocationId, 'invoke:late');
    assert.equal(facade.calls.length, 1);
    assert.deepEqual(facade.calls[0].principal, { engineActorName: 'alice', worldRef: manifest.worldRef });
    assert.equal(facade.calls[0].request.authorizationRef, 'grant:one');
    assert.equal(facade.calls[0].request.sessionRef, 'session:one');
    // Replaying the consumed frame is still refused.
    assert.equal((await act(frameFor(2), 'invoke:late', false)).status, 409);
    // 3. Provider withdrawn: refused.
    current = undefined;
    await present(frameFor(3));
    assert.equal((await act(frameFor(3), 'invoke:withdrawn')).status, 503);
    // 4. Provider present but the grant is revoked: refused, no receipt.
    current = facade;
    facade.revoke();
    await present(frameFor(4));
    const revoked = await act(frameFor(4), 'invoke:revoked');
    assert.equal(revoked.status, 503);
    assert.equal(revoked.body.result, undefined);
    assert.equal(facade.calls.length, 1, 'only the accepted invocation reached Workshop');
    await noEngineWork();
  } finally { await courier.close(); }
});

test('frame delivery resolves verifyFrameDelivery at delivery time and calls it on the facade', async () => {
  const ctx = { effect(run) { run(); }, webServer: { register() {} }, provide() {} };
  const service = apply(ctx, {});
  const args = { worldRef: 'luanti:w', engineActorName: 'alice', authorizationRef: 'grant:one',
    frame: { sessionRef: 'session:one', actions: [] } };
  await assert.rejects(() => service.presentFrame(args), /RENDERER_CAPABILITY_UNAVAILABLE/);
  class FrameFacade {
    #current = true;
    revoke() { this.#current = false; }
    async verifyFrameDelivery({ worldRef, engineActorName, frame, authorizationRef }) {
      return { current: this.#current, worldRef, engineActorName, sessionRef: frame.sessionRef,
        authorizationRef, actorRef: 'actor:alice' };
    }
  }
  const facade = new FrameFacade();
  ctx.hanaworldsWorkshop = facade; // provided after the Adapter started
  // Verified by the facade; the world is not bound in this test, so delivery stops there.
  await assert.rejects(() => service.presentFrame(args), /WORLD_NOT_BOUND/);
  // A proof bound to another player, world or grant is refused by the Adapter.
  for (const patch of [{ engineActorName: 'mallory' }, { worldRef: 'luanti:other' },
    { authorizationRef: 'grant:other' }, { sessionRef: 'session:other' }]) {
    ctx.hanaworldsWorkshop = { verifyFrameDelivery: async input =>
      ({ ...(await facade.verifyFrameDelivery(input)), ...patch }) };
    await assert.rejects(() => service.presentFrame(args), /ACTION_NOT_AUTHORIZED/, JSON.stringify(patch));
  }
  ctx.hanaworldsWorkshop = facade;
  facade.revoke();
  await assert.rejects(() => service.presentFrame(args), /ACTION_NOT_AUTHORIZED/);
  delete ctx.hanaworldsWorkshop; // withdrawn
  await assert.rejects(() => service.presentFrame(args), /RENDERER_CAPABILITY_UNAVAILABLE/);
  await service.close();
});

test('plugin wiring: Workshop provided after Adapter start relays through the bound world courier', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-relay-plugin-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const operatorAuthority = { verify: async input => ({ current: true, ...input, worldStopped: true }) };
  const manifest = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  const ctx = { effect(run) { run(); }, webServer: { register() {} }, provide() {},
    hanaworldsOperatorAuthority: operatorAuthority,
    hanaworldsAuthority: { verify: async request => ({ current: true, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef, worldRef: request.worldRef, actorRef: 'actor:alice',
      engineActorName: 'alice', authorizerRef: 'operator', bindingRef: 'binding:one',
      grantEpoch: 'epoch:one', allowedActions: ['INSPECT'] }) } };
  const service = apply(ctx, { localWorldRoots: [root], serviceName: 'operator' });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  // Answer courier commands the way the in-game payload does.
  const serve = async reply => {
    for (let i = 0; i < 200; i++) {
      const polled = await (await fetch(`${base}/poll`, { headers }).catch(() => null))?.json().catch(() => null);
      if (polled?.command) {
        await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
          id: polled.command.id, worldRef: manifest.worldRef, result: reply(polled.command), error: null }) });
        return polled.command.operation;
      }
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error('no courier command within 2s');
  };
  const { payloadDigest } = await import('../src/local-worlds.mjs');
  const digest = await payloadDigest();
  const inventory = await service.worldAdapter.call('DiscoverConnections', {
    contractVersion: 'world-adapter/v4', actorRef: 'canvas', sessionRef: 'session:one',
    requestId: 'discover', authorizationRef: 'grant:one', adapterId: 'hanaworlds-adapter-luanti' });
  const row = inventory.result.connections[0];
  const binding = service.worldAdapter.call('AuthorizeBinding', { contractVersion: 'world-adapter/v4',
    actorRef: 'canvas', sessionRef: 'session:one', requestId: 'bind', authorizationRef: 'grant:one',
    worldRef: manifest.worldRef, connectionRef: row.connectionRef,
    expectedCapabilityRevision: row.capabilityRevision });
  assert.equal(await serve(() => ({ payloadVersion: '0.2.7', worldRef: manifest.worldRef,
    loadedSourceDigest: digest, manifestDigest: digest, payloadMatches: true,
    worldeditAvailable: true })), 'handshake');
  const principal = c => ({ current: true, engineActorName: c.actorName, worldRef: manifest.worldRef,
    worldeditAvailable: true, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION',
    grantRef: 'grant:engine' });
  assert.equal(await serve(principal), 'authorize');
  assert.equal((await binding).error, null);
  try {
    const frame = { sessionRef: 'session:one', turnRevision: 'turn:one', frameRef: 'frame:one',
      frameRevision: 'frame-revision:one', content: 'Continue', actions: [
        { actionId: 'continue', surfaceActionDigest: 'a'.repeat(64), inputKinds: ['TEXT'],
          surfaceAction: { contractVersion: 'interaction-surface/v2', sessionRef: 'session:one',
            turnRevision: 'turn:one', frameRef: 'frame:one', frameRevision: 'frame-revision:one',
            actionId: 'continue', orderedTargetRefs: [], intentDigest: 'b'.repeat(64),
            operationDigest: null, analysisDigest: null, decisionRevision: null } }] };
    const facade = new Facade();
    // Workshop arrives only now, after the Adapter's apply.
    ctx.hanaworldsWorkshop = Object.assign(facade, {
      verifyFrameDelivery: async ({ worldRef, engineActorName, authorizationRef }) => ({ current: true,
        worldRef, engineActorName, sessionRef: 'session:one', authorizationRef, actorRef: 'actor:alice' }) });
    const shown = service.presentFrame({ worldRef: manifest.worldRef, engineActorName: 'alice',
      authorizationRef: 'grant:one', frame });
    assert.equal(await serve(principal), 'authorize');
    assert.equal(await serve(principal), 'authorize');
    assert.equal(await serve(() => true), 'present_frame');
    assert.equal(await shown, true);
    const request = { contractVersion: 'interaction-surface/v3', actorRef: 'actor:alice',
      sessionRef: 'session:one', requestId: 'invoke:plugin', authorizationRef: 'grant:one',
      turnRevision: 'turn:one', frameRevision: 'frame-revision:one', frameRef: 'frame:one',
      actionId: 'continue', invocationId: 'invoke:plugin', surfaceAction: frame.actions[0].surfaceAction,
      surfaceActionDigest: 'a'.repeat(64), input: { kind: 'TEXT', text: 'Hi' } };
    const relayedPending = fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice', request }) });
    assert.equal(await serve(principal), 'authorize');
    const relayed = await relayedPending;
    assert.equal(relayed.status, 200);
    assert.equal(facade.calls.length, 1);
    assert.deepEqual(facade.calls[0].principal, { engineActorName: 'alice', worldRef: manifest.worldRef });
  } finally { await service.close(); }
});
