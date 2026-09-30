import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverLocalWorlds, provisionLocalPayload } from '../src/local-worlds.mjs';

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
    ({ current: true, worldPath, action }) };
  const first = await provisionLocalPayload(world, { operatorAuthority });
  const second = await provisionLocalPayload(world, { operatorAuthority });
  assert.equal(first.worldRef, second.worldRef);
  assert.match(first.payloadDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.payloadVersion, '0.1.0');
  const saved = JSON.parse(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'payload.json'), 'utf8'));
  assert.equal(saved.worldRef, first.worldRef);
  assert.match(await readFile(join(world, 'worldmods', 'hanaworlds_adapter', 'engine.lua'), 'utf8'), /verifyPrepared/);
});

test('unapproved or symlinked worlds are rejected before filesystem mutation', async () => {
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action }) };
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
