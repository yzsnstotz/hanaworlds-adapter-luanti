import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { discoverLocalWorlds, payloadDigest, provisionLocalPayload, restoreLocalPayload,
  rollbackLocalPayload } from '../src/local-worlds.mjs';
import { rename } from 'node:fs/promises';

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
  assert.equal(first.payloadVersion, '0.2.3');
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

// A complete older payload directory with that version's shipped file set.
async function installOldPayload(world, version, worldRef, transport) {
  const mod = join(world, 'worldmods', 'hanaworlds_adapter');
  await mkdir(mod, { recursive: true });
  const hash = createHash('sha256');
  const files = ['mod.conf', 'init.lua', 'engine.lua', 'transport.lua'];
  if (version === '0.2.0') files.push('region.lua');
  for (const name of files) {
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

test('verified stopped-world 0.2.0 upgrade keeps pairing and identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-upgrade-020-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const pairing = { worldRef: 'luanti:bbbbbbbb-2222-3333-4444-555555555555', port: 30113,
    token: 'd'.repeat(64) };
  const old = await installOldPayload(world, '0.2.0', pairing.worldRef, pairing);
  const upgraded = await provisionLocalPayload(world, { operatorAuthority });
  const mod = join(world, 'worldmods', 'hanaworlds_adapter');
  assert.equal(upgraded.worldRef, old.worldRef);
  assert.equal(upgraded.payloadVersion, '0.2.3');
  assert.deepEqual(JSON.parse(await readFile(join(mod, 'transport.json'), 'utf8')), pairing);
  assert.ok((await readdir(join(world, 'worldmods'))).includes(
    `.hanaworlds-adapter-backup-0.2.0-${old.payloadDigest}`));
  assert.ok((await readFile(join(mod, 'grant.lua'))).length > 0);
});

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
  assert.equal(upgraded.payloadVersion, '0.2.3');
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
  assert.equal(upgraded.payloadVersion, '0.2.3');
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
  assert.equal(again.payloadVersion, '0.2.3');
});


// QR-ADV4-02 reviewer case: a crash between the two renames of a swap leaves
// no current payload while the identity is still on disk. Provisioning must
// refuse (naming the saved directories) instead of minting a new worldRef.
test('crash between swap renames never mints a new identity; explicit restore or fresh identity only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-adapter-crash-'));
  const world = join(root, 'one');
  await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  const pairing = { worldRef: 'luanti:aaaaaaaa-2222-3333-4444-555555555555', port: 30111,
    token: 'c'.repeat(64) };
  const old = await installOldPayload(world, '0.1.1', pairing.worldRef, pairing);
  const mods = join(world, 'worldmods');
  const mod = join(mods, 'hanaworlds_adapter');
  const upgraded = await provisionLocalPayload(world, { operatorAuthority });
  // Rollback crashed after its first rename: current payload moved aside, backup not yet moved in.
  const retained = `.hanaworlds-adapter-retained-0.2.3-${upgraded.payloadDigest}-crash`;
  await rename(mod, join(mods, retained));
  const backup = `.hanaworlds-adapter-backup-0.1.1-${old.payloadDigest}`;
  await assert.rejects(() => rollbackLocalPayload(world, { operatorAuthority, toVersion: '0.1.1' }),
    /PAYLOAD_VERSION_MISMATCH/);
  const before = (await readdir(mods)).sort();
  await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority, transportPort: 30111 }),
    error => error.message === 'RECOVERY_PENDING' &&
      JSON.stringify(error.directories) === JSON.stringify([backup, retained].sort()) &&
      error.savedPayloads.every(entry => entry.worldRef === old.worldRef));
  assert.deepEqual((await readdir(mods)).sort(), before, 'refusal changes nothing on disk');
  // Explicit restore of a named saved directory brings back the same identity and bytes.
  await assert.rejects(() => restoreLocalPayload(world, { operatorAuthority, directory: '../escape' }),
    /PAYLOAD_VERSION_MISMATCH/);
  const restored = await restoreLocalPayload(world, { operatorAuthority, directory: backup });
  assert.equal(restored.worldRef, old.worldRef);
  assert.deepEqual(JSON.parse(await readFile(join(mod, 'payload.json'), 'utf8')), old);
  // A current payload now exists, so restore refuses a second swap-in.
  await assert.rejects(() => restoreLocalPayload(world, { operatorAuthority, directory: retained }),
    /PAYLOAD_VERSION_MISMATCH/);
  // Upgrade crashed after its first rename: same refusal; a fresh identity needs the explicit flag.
  await provisionLocalPayload(world, { operatorAuthority });
  await rm(join(mods, retained), { recursive: true });
  await rename(mod, join(mods, `.hanaworlds-adapter-retained-0.2.3-${upgraded.payloadDigest}-again`));
  await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority }), /RECOVERY_PENDING/);
  const fresh = await provisionLocalPayload(world, { operatorAuthority, freshIdentity: true });
  assert.notEqual(fresh.worldRef, old.worldRef);
});

// QRR-ADV4-01: a saved payload whose manifest is unreadable, corrupt or of an
// unknown version is listed as MANIFEST_UNREADABLE, never skipped silently.
test('unreadable saved payload manifests still stop provisioning and cannot be restored blindly', async () => {
  const operatorAuthority = { verify: async ({ worldPath, action }) =>
    ({ current: true, worldPath, action, worldStopped: true }) };
  for (const [label, manifest] of [['missing', null], ['corrupt', '{not json'],
    ['unknown-version', JSON.stringify({ worldRef: 'luanti:x', payloadVersion: '9.9.9',
      payloadDigest: 'a'.repeat(64) })]]) {
    const root = await mkdtemp(join(tmpdir(), `hw-adapter-unreadable-${label}-`));
    const world = join(root, 'one');
    const saved = `.hanaworlds-adapter-retained-0.2.3-${label}`;
    await mkdir(join(world, 'worldmods', saved), { recursive: true });
    await writeFile(join(world, 'world.mt'), 'gameid = minimal\n');
    if (manifest !== null) await writeFile(join(world, 'worldmods', saved, 'payload.json'), manifest);
    await assert.rejects(() => provisionLocalPayload(world, { operatorAuthority }), error =>
      error.message === 'RECOVERY_PENDING' && error.directories.includes(saved) &&
      error.savedPayloads.find(entry => entry.directory === saved).status === 'MANIFEST_UNREADABLE', label);
    assert.deepEqual(await readdir(join(world, 'worldmods')), [saved], `${label}: nothing written`);
    await assert.rejects(() => restoreLocalPayload(world, { operatorAuthority, directory: saved }),
      /PAYLOAD_VERSION_MISMATCH/, label);
    const fresh = await provisionLocalPayload(world, { operatorAuthority, freshIdentity: true });
    assert.match(fresh.worldRef, /^luanti:/);
  }
});
