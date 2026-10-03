import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { LocalEngineTransport } from '../src/local-transport.mjs';
import { provisionLocalPayload } from '../src/local-worlds.mjs';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('local courier accepts only a current world, player and scope grant proof', async () => {
  const root = join(homedir(), '.cache', 'hanaworlds-runs', 'S1-AD-GRANT-01');
  await mkdir(root, { recursive: true });
  const base = await mkdtemp(join(root, 'local-grant-'));
  const world = join(base, 'world');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = devtest\n');
  const port = await freePort();
  const identity = await provisionLocalPayload(world, { transportPort: port,
    operatorAuthority: { verify: async ({ worldPath, action }) =>
      ({ current: true, worldPath, action, worldStopped: true }) } });
  const { token } = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter',
    'transport.json'), 'utf8'));
  const courier = await LocalEngineTransport.open(world, { serviceName: 'service',
    onAction: async () => ({}) });
  const url = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function answer(reply) {
    const pending = courier.verifyPrincipal('alice');
    pending.catch(() => {});
    const poll = await fetch(`${url}/poll`, { headers }).then(res => res.json());
    assert.equal(poll.command.operation, 'authorize');
    await fetch(`${url}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: poll.command.id, worldRef: identity.worldRef, result: reply }) });
    return pending;
  }
  try {
    await assert.rejects(answer({ current: false, engineActorName: 'alice',
      worldRef: identity.worldRef, worldeditAvailable: true }), /CONNECTION_UNAUTHORIZED/);
    await assert.rejects(answer({ current: true, engineActorName: 'alice',
      worldRef: identity.worldRef, worldeditAvailable: true }), /CONNECTION_UNAUTHORIZED/);
    const grant = await answer({ current: true, engineActorName: 'alice',
      worldRef: identity.worldRef, worldeditAvailable: true,
      scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION', grantRef: 'engine-grant:one' });
    assert.deepEqual(grant, { current: true, engineActorName: 'alice',
      worldRef: identity.worldRef, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION',
      grantRef: 'engine-grant:one' });
    const binding = { current: true, engineActorName: 'alice',
      nativeGrantRef: grant.grantRef };
    for (const [operation, issue] of [
      ['snapshot', () => courier.snapshot({ coveredPositions: [[0, 0, 0]] }, binding)],
      ['apply', () => courier.apply({ effects: [], operationDigest: 'digest' },
        { beforeImage: {}, operationDigest: 'digest' }, binding)],
      ['apply_state', () => courier.applyState({ operationDigest: 'digest' }, {}, {}, binding)],
    ]) {
      const pending = issue();
      pending.catch(() => {});
      const polled = await fetch(`${url}/poll`, { headers }).then(res => res.json());
      assert.equal(polled.command.operation, operation);
      assert.equal(polled.command.actorName, 'alice');
      assert.equal(polled.command.grantRef, grant.grantRef,
        `${operation} must carry the engine proof from this verification`);
      await fetch(`${url}/result`, { method: 'POST', headers, body: JSON.stringify({
        id: polled.command.id, worldRef: identity.worldRef, result: true }) });
      await pending;
    }
    const shown = courier.presentFrame('alice', { sessionRef: 'session', actions: [] });
    const authorize = await fetch(`${url}/poll`, { headers }).then(res => res.json());
    assert.equal(authorize.command.operation, 'authorize');
    await fetch(`${url}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: authorize.command.id, worldRef: identity.worldRef,
      result: { current: true, engineActorName: 'alice', worldRef: identity.worldRef,
        worldeditAvailable: true, scope: 'WORLD_BUILD_WITH_ENGINE_PROTECTION',
        grantRef: grant.grantRef } }) });
    const display = await fetch(`${url}/poll`, { headers }).then(res => res.json());
    assert.equal(display.command.operation, 'present_frame');
    assert.equal(display.command.grantRef, grant.grantRef);
    await fetch(`${url}/result`, { method: 'POST', headers, body: JSON.stringify({
      id: display.command.id, worldRef: identity.worldRef, result: true }) });
    assert.equal(await shown, true);
  } finally {
    await courier.close();
    await rm(base, { recursive: true, force: true });
  }
});
