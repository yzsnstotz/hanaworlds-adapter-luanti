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
const SAVED_PREFIXES = ['.hanaworlds-adapter-backup-', '.hanaworlds-adapter-retained-'];

// Saved Adapter payload directories that still carry a world identity.
async function savedPayloads(mods) {
  const found = [];
  for (const name of (await readdir(mods).catch(() => [])).sort()) {
    if (!SAVED_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    const stat = await lstat(join(mods, name)).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    let manifest = null;
    try { manifest = JSON.parse(await readFile(join(mods, name, 'payload.json'), 'utf8')); }
    catch { manifest = null; }
    if (typeof manifest?.worldRef === 'string' && knownVersions.includes(manifest.payloadVersion))
      found.push({ directory: name, worldRef: manifest.worldRef,
        payloadVersion: manifest.payloadVersion, payloadDigest: manifest.payloadDigest });
  }
  return found;
}
function recoveryPending(saved) {
  const error = fault('RECOVERY_PENDING');
  error.directories = saved.map(entry => entry.directory);
  error.savedPayloads = saved;
  error.choices = ['RESTORE_SAVED_PAYLOAD (restoreLocalPayload with one named directory)',
    'FRESH_IDENTITY (provisionLocalPayload with freshIdentity: true)'];
  return error;
}
/**
 * Replace `target` with `incoming`, keeping the old directory at `keep`.
 * The undo rename runs only if the second rename itself failed; a failed
 * directory sync after both renames is surfaced unchanged.
 */
async function swapDirectory(mods, target, incoming, keep) {
  await rename(target, keep);
  try { await rename(incoming, target); }
  catch (error) { await rename(keep, target); throw error; }
  await syncDirectory(mods);
}
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

export async function provisionLocalPayload(world, { operatorAuthority, transportPort = null,
  freshIdentity = false } = {}) {
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
        await swapDirectory(mods, target, staging, backup);
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
  // No current payload. A saved (backup/retained) payload means an earlier
  // identity still exists, e.g. after a crash between the two renames of an
  // upgrade or rollback. Never mint a new identity over it silently.
  const saved = await savedPayloads(mods);
  if (saved.length && freshIdentity !== true) throw recoveryPending(saved);
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
  await swapDirectory(mods, target, backup, join(mods, retainedName));
  return { worldRef: old.worldRef, payloadVersion: old.payloadVersion,
    payloadDigest: old.payloadDigest, retainedPayload: retainedName };
}

/**
 * Explicit operator restore of one named saved payload directory when no
 * current payload exists (the RECOVERY_PENDING choice). Its bytes are
 * verified against its own manifest before it becomes the payload again.
 */
export async function restoreLocalPayload(world, { operatorAuthority, directory } = {}) {
  if (typeof operatorAuthority?.verify !== 'function') throw fault('CONNECTION_UNAUTHORIZED');
  const operator = await operatorAuthority.verify({ worldPath: resolve(world),
    action: 'RESTORE_PAYLOAD' });
  if (!operator?.current || operator.worldPath !== resolve(world) ||
      operator.action !== 'RESTORE_PAYLOAD' || operator.worldStopped !== true)
    throw fault('CONNECTION_UNAUTHORIZED');
  const mods = join(world, 'worldmods');
  await realDirectory(mods, 'WORLD_NOT_FOUND');
  const target = join(mods, 'hanaworlds_adapter');
  if (await lstat(target).catch(() => null)) throw fault('PAYLOAD_VERSION_MISMATCH');
  const entry = (await savedPayloads(mods)).find(item => item.directory === directory);
  if (!entry) throw fault('PAYLOAD_VERSION_MISMATCH');
  const source = join(mods, entry.directory);
  const files = entry.payloadVersion === PAYLOAD_VERSION ? payloadFiles :
    UPGRADABLE_PAYLOADS[entry.payloadVersion];
  if (entry.payloadDigest !== await installedPayloadDigest(source, files))
    throw fault('PAYLOAD_VERSION_MISMATCH');
  await rename(source, target);
  await syncDirectory(mods);
  return { worldRef: entry.worldRef, payloadVersion: entry.payloadVersion,
    payloadDigest: entry.payloadDigest, restoredFrom: entry.directory };
}

export async function payloadDigest() {
  const hash = createHash('sha256');
  for (const name of payloadFiles) {
    hash.update(`${name}\n`);
    hash.update(await readFile(join(payloadDir, name)));
  }
  return hash.digest('hex');
}
