import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { discoverLocalWorlds, payloadDigest, provisionLocalPayload, rollbackLocalPayload } from '../src/local-worlds.mjs';

test('local discovery reports only configured worlds and does not fabricate a stable identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-worlds-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const worlds = await discoverLocalWorlds([root]);
  assert.equal(worlds.length, 1);
  assert.equal(worlds[0].worldRef, null);
  assert.equal(worlds[0].gameId, 'minimal');
  assert.equal(worlds[0].payloadStatus, 'MISSING');
  assert.equal(worlds[0].connectionRef.includes(root), false);
});

test('payload provisioning writes a stable world identity and a versioned digest receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-provision-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const first = await provisionLocalPayload(world, { operatorAuthority });
  const second = await provisionLocalPayload(world, { operatorAuthority });
  assert.equal(first.worldRef, second.worldRef);
  assert.match(first.payloadDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.payloadVersion, '0.2.0');
  const saved = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'payload.json'), 'utf8'));
  assert.equal(saved.worldRef, first.worldRef);
  assert.match(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'engine.lua'), 'utf8'), /verifyPrepared/);
});

test('unapproved or symlinked worlds are rejected before filesystem mutation', async () => {
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-reject-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  await assert.rejects(() => provisionLocalPayload(world, {}), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(() => provisionLocalPayload(join(root, 'missing'), { operatorAuthority }), /WORLD_NOT_FOUND/);
  await mkdir(join(root, 'linked'));
  await symlink(join(world, 'world.mt'), join(root, 'linked', 'world.mt'));
  await assert.rejects(() => provisionLocalPayload(join(root, 'linked'), { operatorAuthority }), /WORLD_NOT_FOUND/);
});

// A genuine older payload directory: the four files those versions shipped.
async function installOldPayload(world, version, worldRef, transport) {
  const mod = join(world, 'worldmods', 'hanaworlds_adapter');
  await mkdir(mod, { recursive: true });
  const hash = createHash('sha256');
  for (const name of ['mod.conf', 'init.lua', 'engine.lua', 'transport.lua']) {
    const content = `-- ${version} ${name}\n`;
    await writeFile(join(mod, name), content);
    hash.update(`${name}\n`); hash.update(content);
  }
  const identity = { worldRef, payloadVersion: version, payloadDigest: hash.digest('hex') };
  await writeFile(join(mod, 'payload.json'), JSON.stringify(identity) + '\n');
  if (transport) await writeFile(join(mod, 'transport.json'), JSON.stringify(transport) + '\n',
    { mode: 0o600 });
  return identity;
}

test('provisioning refuses a running world and preserves the stable world identity on a verified 0.1.0 upgrade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-upgrade-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  let worldStopped = false;
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped }) };
  await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority }),
    /CONNECTION_UNAUTHORIZED/);
  assert.equal((await readdir(world)).includes('worldmods'), false);
  worldStopped = true;
  const old = await installOldPayload(world, '0.1.0', 'luanti:11111111-2222-3333-4444-555555555555');
  const upgraded = await provisionLocalPayload(world, { operatorAuthority,
    transportPort: 32123 });
  assert.equal(upgraded.worldRef, old.worldRef);
  assert.equal(upgraded.payloadVersion, '0.2.0');
  assert.ok((await readdir(join(world, 'worldmods'))).includes(
    `.hanaworlds-adapter-backup-0.1.0-${old.payloadDigest}`));
});

test('0.1.1 upgrade keeps identity and pairing, then stopped-world rollback restores exact 0.1.1 bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-rollback-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  let worldStopped = true;
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped }) };
  const pairing = { worldRef: 'luanti:aaaaaaaa-2222-3333-4444-555555555555', port: 30111,
    token: 'c'.repeat(64) };
  const old = await installOldPayload(world, '0.1.1', pairing.worldRef, pairing);
  const mod = join(world, 'worldmods', 'hanaworlds_adapter');
  const oldInit = await readFile(join(mod, 'init.lua'));
  const upgraded = await provisionLocalPayload(world, { operatorAuthority });
  assert.equal(upgraded.payloadVersion, '0.2.0');
  assert.equal(upgraded.payloadDigest, await payloadDigest());
  assert.deepEqual(JSON.parse(await readFile(join(mod, 'transport.json'), 'utf8')), pairing);
  worldStopped = false;
  await assert.rejects(() => rollbackLocalPayload(world, { operatorAuthority, toVersion: '0.1.1' }),
    /CONNECTION_UNAUTHORIZED/);
  worldStopped = true;
  await assert.rejects(() => rollbackLocalPayload(world, { operatorAuthority, toVersion: '0.0.9' }),
    /PAYLOAD_VERSION_MISMATCH/);
  const rolled = await rollbackLocalPayload(world, { operatorAuthority, toVersion: '0.1.1' });
  assert.deepEqual({ ...rolled, retainedPayload: undefined },
    { ...old, retainedPayload: undefined });
  assert.ok((await readFile(join(mod, 'init.lua'))).equals(oldInit));
  assert.deepEqual(JSON.parse(await readFile(join(mod, 'payload.json'), 'utf8')), old);
  assert.ok((await readdir(join(world, 'worldmods'))).includes(rolled.retainedPayload));
  // Re-upgrade after rollback is the same verified path, with the same identity.
  const again = await provisionLocalPayload(world, { operatorAuthority });
  assert.equal(again.worldRef, old.worldRef);
  assert.equal(again.payloadVersion, '0.2.0');
});

