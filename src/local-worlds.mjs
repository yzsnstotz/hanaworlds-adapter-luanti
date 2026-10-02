import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD_FILES, PAYLOAD_VERSION, UPGRADABLE_PAYLOADS } from './version.mjs';

const payloadDir = fileURLToPath(new URL('../payload/hanaworlds_adapter/', import.meta.url));
const payloadFiles = PAYLOAD_FILES;
const knownVersions = [...Object.keys(UPGRADABLE_PAYLOADS), PAYLOAD_VERSION];
const manifestName = 'payload.json';

function fault(code) { return new Error(code); }
async function realDirectory(path, code) {
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw fault(code);
}
async function syncFile(path, content) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); }
  finally { await handle.close(); }
}
function worldSettings(raw) {
  const match = /^\s*gameid\s*=\s*([^\r\n#]+)\s*$/m.exec(raw);
  return match?.[1]?.trim() || null;
}
async function readIdentity(world) {
  const path = join(world, 'worldmods', 'hanaworlds_adapter', manifestName);
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (!raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!knownVersions.includes(value?.payloadVersion) ||
      typeof value.worldRef !== 'string' || !/^luanti:[0-9a-f-]+$/.test(value.worldRef) ||
      !/^[0-9a-f]{64}$/.test(value.payloadDigest ?? '')) return null;
  return value;
}

async function installedPayloadDigest(directory, files = payloadFiles) {
  const hash = createHash('sha256');
  for (const name of files) {
    const path = join(directory, name);
    const stat = await lstat(path).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw fault('PAYLOAD_VERSION_MISMATCH');
    hash.update(`${name}\n`);
    hash.update(await readFile(path));
  }
  return hash.digest('hex');
}

export async function discoverLocalWorlds(configuredRoots) {
  const worlds = [];
  for (const root of configuredRoots) {
    await realDirectory(root, 'CONNECTION_NOT_FOUND');
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const world = join(root, entry.name);
      const worldMt = join(world, 'world.mt');
      if (!(await lstat(worldMt).catch(() => null))?.isFile()) continue;
      const raw = await readFile(worldMt, 'utf8').catch(() => null);
      if (raw === null) continue;
      const identity = await readIdentity(world);
      worlds.push({
        connectionRef: `local:${createHash('sha256').update(resolve(world)).digest('hex')}`,
        worldPath: world,
        worldRef: identity?.worldRef ?? null,
        gameId: worldSettings(raw),
        payloadStatus: identity ? 'INSTALLED_UNVERIFIED' : 'MISSING',
        payloadVersion: identity?.payloadVersion ?? null,
        payloadDigest: identity?.payloadDigest ?? null,
      });
    }
  }
  return worlds.sort((a, b) => a.connectionRef < b.connectionRef ? -1 : a.connectionRef > b.connectionRef ? 1 : 0);
}

export async function provisionLocalPayload(world, { operatorAuthority, transportPort = null } = {}) {
  if (typeof operatorAuthority?.verify !== 'function') throw fault('CONNECTION_UNAUTHORIZED');
  const operator = await operatorAuthority.verify({ worldPath: resolve(world),
    action: 'PROVISION_PAYLOAD' });
  if (!operator?.current || operator.worldPath !== resolve(world) ||
      operator.action !== 'PROVISION_PAYLOAD' || operator.worldStopped !== true)
    throw fault('CONNECTION_UNAUTHORIZED');
  if (transportPort !== null && (!Number.isSafeInteger(transportPort) || transportPort < 1 || transportPort > 65535))
    throw fault('SCHEMA_INVALID');
  await realDirectory(world, 'WORLD_NOT_FOUND');
  const worldMt = await lstat(join(world, 'world.mt')).catch(() => null);
  if (!worldMt?.isFile() || worldMt.isSymbolicLink()) throw fault('WORLD_NOT_FOUND');
  const mods = join(world, 'worldmods');
  const modsStat = await lstat(mods).catch(() => null);
  if (modsStat) await realDirectory(mods, 'CONNECTION_UNAUTHORIZED');
  else { await mkdir(mods, { mode: 0o700 }); await syncDirectory(world); }
  const target = join(mods, 'hanaworlds_adapter');
  const targetStat = await lstat(target).catch(() => null);
  if (targetStat) {
    await realDirectory(target, 'PAYLOAD_VERSION_MISMATCH');
    const identity = await readIdentity(world);
    if (!identity) throw fault('PAYLOAD_VERSION_MISMATCH');
    const digest = await payloadDigest();
    const previousFiles = UPGRADABLE_PAYLOADS[identity.payloadVersion];
    if (previousFiles) {
      // Verified upgrade from an older payload: the complete old directory
      // (identity, transport pairing) is kept as a versioned backup so a
      // stopped-world rollback can restore exactly those bytes.
      if (identity.payloadDigest !== await installedPayloadDigest(target, previousFiles))
        throw fault('PAYLOAD_VERSION_MISMATCH');
      const backup = join(mods, backupName(identity));
      if (await lstat(backup).catch(() => null)) throw fault('PAYLOAD_VERSION_MISMATCH');
      const oldTransport = await readFile(join(target, 'transport.json'), 'utf8').catch(() => null);
      const staging = join(mods, `.hanaworlds-adapter-${randomUUID()}`);
      await mkdir(staging, { mode: 0o700 });
      try {
        for (const name of payloadFiles)
          await syncFile(join(staging, name), await readFile(join(payloadDir, name)));
        const upgraded = { worldRef: identity.worldRef,
          payloadVersion: PAYLOAD_VERSION, payloadDigest: digest };
        await syncFile(join(staging, manifestName), `${JSON.stringify(upgraded)}\n`);
        if (transportPort !== null) await syncFile(join(staging, 'transport.json'),
          `${JSON.stringify({ worldRef: identity.worldRef, port: transportPort,
            token: randomBytes(32).toString('hex') })}\n`);
        else if (oldTransport !== null) await syncFile(join(staging, 'transport.json'), oldTransport);
        await syncDirectory(staging);
        await rename(target, backup);
        try { await rename(staging, target); await syncDirectory(mods); }
        catch (error) { await rename(backup, target); throw error; }
        return upgraded;
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
    if (identity.payloadVersion !== PAYLOAD_VERSION) throw fault('PAYLOAD_VERSION_MISMATCH');
    if (identity.payloadDigest !== digest) throw fault('PAYLOAD_VERSION_MISMATCH');
    for (const name of payloadFiles) {
      const actual = await readFile(join(target, name)).catch(() => null);
      const expected = await readFile(join(payloadDir, name));
      if (!actual?.equals(expected)) throw fault('PAYLOAD_VERSION_MISMATCH');
    }
    if (transportPort !== null) {
      const transport = JSON.parse(await readFile(join(target, 'transport.json'), 'utf8').catch(() => '{}'));
      if (transport.port !== transportPort || transport.worldRef !== identity.worldRef ||
          !/^[0-9a-f]{64}$/.test(transport.token ?? '')) throw fault('PAYLOAD_VERSION_MISMATCH');
    }
    return identity;
  }
  const worldRef = `luanti:${randomUUID()}`;
  const payloadVersion = PAYLOAD_VERSION;
  const digest = await payloadDigest();
  const staging = join(mods, `.hanaworlds-adapter-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const name of payloadFiles) await syncFile(join(staging, name), await readFile(join(payloadDir, name)));
    const identity = { worldRef, payloadVersion, payloadDigest: digest };
    await syncFile(join(staging, manifestName), `${JSON.stringify(identity)}\n`);
    if (transportPort !== null) {
      await syncFile(join(staging, 'transport.json'), `${JSON.stringify({
        worldRef, port: transportPort, token: randomBytes(32).toString('hex') })}\n`);
    }
    await syncDirectory(staging);
    await rename(staging, target);
    await syncDirectory(mods);
    return identity;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function backupName(identity) {
  return `.hanaworlds-adapter-backup-${identity.payloadVersion}-${identity.payloadDigest}`;
}

/**
 * Stopped-world rollback to the exact payload this build upgraded from. The
 * current payload directory is kept beside it (never deleted), the world
 * identity and the Adapter engine-state file stay untouched, and the restored
 * bytes are verified against the backup's own recorded digest first.
 */
export async function rollbackLocalPayload(world, { operatorAuthority, toVersion } = {}) {
  if (typeof operatorAuthority?.verify !== 'function') throw fault('CONNECTION_UNAUTHORIZED');
  const operator = await operatorAuthority.verify({ worldPath: resolve(world),
    action: 'ROLLBACK_PAYLOAD' });
  if (!operator?.current || operator.worldPath !== resolve(world) ||
      operator.action !== 'ROLLBACK_PAYLOAD' || operator.worldStopped !== true)
    throw fault('CONNECTION_UNAUTHORIZED');
  const previousFiles = UPGRADABLE_PAYLOADS[toVersion];
  if (!previousFiles) throw fault('PAYLOAD_VERSION_MISMATCH');
  const mods = join(world, 'worldmods');
  await realDirectory(mods, 'WORLD_NOT_FOUND');
  const target = join(mods, 'hanaworlds_adapter');
  await realDirectory(target, 'PAYLOAD_VERSION_MISMATCH');
  const current = await readIdentity(world);
  if (current?.payloadVersion !== PAYLOAD_VERSION ||
      current.payloadDigest !== await installedPayloadDigest(target))
    throw fault('PAYLOAD_VERSION_MISMATCH');
  const prefix = `.hanaworlds-adapter-backup-${toVersion}-`;
  const candidates = (await readdir(mods)).filter(name => name.startsWith(prefix));
  if (candidates.length !== 1) throw fault('PAYLOAD_VERSION_MISMATCH');
  const backup = join(mods, candidates[0]);
  await realDirectory(backup, 'PAYLOAD_VERSION_MISMATCH');
  const old = JSON.parse(await readFile(join(backup, manifestName), 'utf8').catch(() => 'null'));
  if (old?.payloadVersion !== toVersion || old.worldRef !== current.worldRef ||
      `${prefix}${old.payloadDigest}` !== candidates[0] ||
      old.payloadDigest !== await installedPayloadDigest(backup, previousFiles))
    throw fault('PAYLOAD_VERSION_MISMATCH');
  const retainedName = `.hanaworlds-adapter-retained-${current.payloadVersion}-` +
    `${current.payloadDigest}-${randomUUID()}`;
  const retained = join(mods, retainedName);
  await rename(target, retained);
  try { await rename(backup, target); await syncDirectory(mods); }
  catch (error) { await rename(retained, target); throw error; }
  return { worldRef: old.worldRef, payloadVersion: old.payloadVersion,
    payloadDigest: old.payloadDigest, retainedPayload: retainedName };
}

export async function payloadDigest() {
  const hash = createHash('sha256');
  for (const name of payloadFiles) {
    hash.update(`${name}\n`);
    hash.update(await readFile(join(payloadDir, name)));
  }
  return hash.digest('hex');
}
