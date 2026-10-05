import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverLocalWorlds, payloadDigest, provisionLocalPayload } from '../src/local-worlds.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

const stopped = { verify: async input => ({ current: true, ...input, worldStopped: true }) };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-fresh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  return { root, world };
}
test('local discovery reports an uninstalled world without fabricating identity', async t => {
  const { root } = await fixture(t);
  const [world] = await discoverLocalWorlds([root]);
  assert.equal(world.worldRef, null);
  assert.equal(world.gameId, 'minimal');
  assert.equal(world.payloadStatus, 'MISSING');
  assert.equal(world.connectionRef.includes(root), false);
});
test('fresh installation creates current identity and repeated provisioning cannot reuse it', async t => {
  const { root, world } = await fixture(t);
  const first = await provisionLocalPayload(world, { operatorAuthority: stopped, transportPort: 32123 });
  assert.match(first.worldRef, /^luanti:/);
  assert.equal(first.payloadVersion, PAYLOAD_VERSION);
  assert.equal(first.payloadDigest, await payloadDigest());
  const directory = join(world, 'worldmods', 'hanaworlds_adapter');
  const before = await Promise.all((await readdir(directory)).sort().map(async name =>
    [name, await readFile(join(directory, name))]));
  await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority: stopped, transportPort: 32123 }),
    /PAYLOAD_VERSION_MISMATCH/);
  const after = await Promise.all((await readdir(directory)).sort().map(async name =>
    [name, await readFile(join(directory, name))]));
  assert.deepEqual(after, before);
  const [discovered] = await discoverLocalWorlds([root]);
  assert.equal(discovered.worldRef, first.worldRef);
  assert.equal(discovered.payloadDigest, first.payloadDigest);
});
test('unapproved, running or symlinked worlds reject before payload mutation', async t => {
  const { root, world } = await fixture(t);
  await assert.rejects(() => provisionLocalPayload(world), /CONNECTION_UNAUTHORIZED/);
  await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority: {
    verify: async input => ({ current: true, ...input, worldStopped: false }) } }), /CONNECTION_UNAUTHORIZED/);
  assert.equal((await readdir(world)).includes('worldmods'), false);
  await assert.rejects(() => provisionLocalPayload(join(root, 'missing'), { operatorAuthority: stopped }), /WORLD_NOT_FOUND/);
  await mkdir(join(root, 'linked'));
  await symlink(join(world, 'world.mt'), join(root, 'linked', 'world.mt'));
  await assert.rejects(() => provisionLocalPayload(join(root, 'linked'), { operatorAuthority: stopped }), /WORLD_NOT_FOUND/);
});
