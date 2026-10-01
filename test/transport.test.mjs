import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { provisionLocalPayload } from '../src/local-worlds.mjs';
import { LocalEngineTransport } from '../src/local-transport.mjs';

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('per-world courier refuses unpaired calls and delivers only queued in-process work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-loopback-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const manifest = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  assert.equal(config.worldRef, manifest.worldRef);
  assert.match(config.token, /^[0-9a-f]{64}$/);
  const courier = await LocalEngineTransport.open(world, { serviceName: 'operator' });
  try {
    const base = `http://127.0.0.1:${port}`;
    const denied = await fetch(`${base}/poll`);
    assert.equal(denied.status, 403);
    assert.throws(() => courier.snapshot({ coveredPositions: [[0, 0, 0]] }, { current: true }),
      /CONNECTION_UNAUTHORIZED/);
    const pending = courier.snapshot({ coveredPositions: [[0, 0, 0]] },
      { current: true, engineActorName: 'operator' });
    const auth = { Authorization: `Bearer ${config.token}` };
    const polled = await fetch(`${base}/poll`, { headers: auth });
    assert.equal(polled.status, 200);
    const payload = await polled.json();
    assert.equal(payload.worldRef, manifest.worldRef);
    assert.equal(payload.command.operation, 'snapshot');
    assert.equal(payload.command.actorName, 'operator');
    const reply = await fetch(`${base}/result`, { method: 'POST', headers: auth,
      body: JSON.stringify({ id: payload.command.id, worldRef: manifest.worldRef,
        result: { coveredPositions: [[0, 0, 0]], records: [] }, error: null }) });
    assert.equal(reply.status, 200);
    assert.deepEqual((await pending).coveredPositions, [[0, 0, 0]]);
    const replay = await fetch(`${base}/result`, { method: 'POST', headers: auth,
      body: JSON.stringify({ id: payload.command.id, worldRef: manifest.worldRef, result: {} }) });
    assert.equal(replay.status, 409);
  } finally { await courier.close(); }
});

test('paired frame action reaches only the trusted owner callback once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-action-'));
  const world = join(root, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const port = await freePort();
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const manifest = await provisionLocalPayload(world, { operatorAuthority, transportPort: port });
  const config = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'transport.json')));
  const actions = [];
  const courier = await LocalEngineTransport.open(world, { serviceName: 'operator',
    onAction: async (request, principal) => {
      actions.push({ request, principal });
      return { invocationId: request.invocationId, resultRevision: 'revision:two',
        ownerRef: 'workshop', domainReceiptDigest: null, accepted: true };
    } });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  const frame = { actorRef: 'actor:alice', authorizationRef: 'grant:one',
    sessionRef: 'session:one', turnRevision: 'turn:one', frameRef: 'frame:one',
    frameRevision: 'frame-revision:one', content: 'Continue', actions: [
      { actionId: 'continue', surfaceActionDigest: 'a'.repeat(64), inputKinds: ['TEXT'],
        surfaceAction: { contractVersion: 'interaction-surface/v2', sessionRef: 'session:one',
          turnRevision: 'turn:one', frameRef: 'frame:one', frameRevision: 'frame-revision:one',
          actionId: 'continue', orderedTargetRefs: [], intentDigest: 'b'.repeat(64),
          operationDigest: null, analysisDigest: null, decisionRevision: null } },
    ] };
  try {
    const pending = courier.presentFrame('alice', frame);
    const polled = await (await fetch(`${base}/poll`, { headers })).json();
    assert.equal(polled.command.operation, 'present_frame');
    await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: polled.command.id, worldRef: manifest.worldRef, result: true, error: null }) });
    assert.equal(await pending, true);
    const request = { contractVersion: 'interaction-surface/v2', actorRef: frame.actorRef,
      sessionRef: frame.sessionRef, requestId: 'invoke:one', authorizationRef: frame.authorizationRef,
      turnRevision: frame.turnRevision, frameRevision: frame.frameRevision,
      frameRef: frame.frameRef, actionId: 'continue', invocationId: 'invoke:one',
      surfaceAction: frame.actions[0].surfaceAction,
      surfaceActionDigest: frame.actions[0].surfaceActionDigest,
      input: { kind: 'TEXT', text: 'Hello' } };
    const first = await fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice', request }) });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).result.ownerRef, 'workshop');
    const replay = await fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice', request }) });
    assert.equal(replay.status, 409);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].principal.engineActorName, 'alice');
    const selectable = structuredClone(frame);
    selectable.frameRef = 'frame:select';
    selectable.actions[0].actionId = 'select';
    selectable.actions[0].inputKinds = ['SELECT_OBJECTS'];
    selectable.actions[0].surfaceAction.frameRef = selectable.frameRef;
    selectable.actions[0].surfaceAction.actionId = 'select';
    selectable.actions[0].surfaceAction.orderedTargetRefs = ['object:a', 'object:b'];
    const delivered = courier.presentFrame('alice', selectable);
    const next = await (await fetch(`${base}/poll`, { headers })).json();
    await fetch(`${base}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: next.command.id, worldRef: manifest.worldRef, result: true, error: null }) });
    await delivered;
    const selectRequest = { ...request, requestId: 'invoke:select',
      invocationId: 'invoke:select', frameRef: selectable.frameRef,
      actionId: 'select', surfaceAction: selectable.actions[0].surfaceAction,
      input: { kind: 'SELECT_OBJECTS', orderedObjectRefs: ['object:b'] } };
    const invented = await fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice',
        request: { ...selectRequest, input: { kind: 'SELECT_OBJECTS',
          orderedObjectRefs: ['object:invented'] } } }) });
    assert.equal(invented.status, 409);
    assert.equal(actions.length, 1);
    const selected = await fetch(`${base}/action`, { method: 'POST', headers,
      body: JSON.stringify({ worldRef: manifest.worldRef, engineActorName: 'alice',
        request: selectRequest }) });
    assert.equal(selected.status, 200);
    assert.deepEqual(actions[1].request.input.orderedObjectRefs, ['object:b']);
  } finally { await courier.close(); }
});
