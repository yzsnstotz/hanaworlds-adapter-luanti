import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD_FILES, PAYLOAD_VERSION } from './version.mjs';

const payloadDir = fileURLToPath(new URL('../payload/hanaworlds_adapter/', import.meta.url));
const payloadFiles = PAYLOAD_FILES;
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
  if (value?.payloadVersion !== PAYLOAD_VERSION ||
      typeof value.worldRef !== 'string' || !/^luanti:[0-9a-f-]+$/.test(value.worldRef) ||
      !/^[0-9a-f]{64}$/.test(value.payloadDigest ?? '')) return null;
  return value;
}

export async function discoverLocalWorlds(configuredRoots) {
  const worlds = [];
  for (const root of configuredRoots) {
    await realDirectory(root, 'CONNECTION_NOT_FOUND');
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const world = join(root, entry.name);
      const worldMt = join(world, 'world.mt');
      const info = await lstat(worldMt).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) continue;
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

export async function provisionLocalPayload(world, { stoppedWorld, transportPort = null } = {}) {
  if (typeof stoppedWorld !== 'function') throw fault('CURRENT_WORLD_MISMATCH');
  const stopped = await stoppedWorld();
  if (stopped?.state !== 'STOPPED' || stopped.worldPath !== resolve(world) ||
      !Number.isSafeInteger(stopped.processId) || stopped.processId <= 0 ||
      typeof stopped.operationRef !== 'string' || !stopped.operationRef)
    throw fault('CURRENT_WORLD_MISMATCH');
  if (transportPort !== null && (!Number.isSafeInteger(transportPort) || transportPort < 1 || transportPort > 65535))
    throw fault('SCHEMA_INVALID');
  await realDirectory(world, 'WORLD_NOT_FOUND');
  const worldMt = await lstat(join(world, 'world.mt')).catch(() => null);
  if (!worldMt?.isFile() || worldMt.isSymbolicLink()) throw fault('WORLD_NOT_FOUND');
  const mods = join(world, 'worldmods');
  const modsStat = await lstat(mods).catch(() => null);
  if (modsStat) await realDirectory(mods, 'CURRENT_WORLD_MISMATCH');
  else { await mkdir(mods, { mode: 0o700 }); await syncDirectory(world); }
  const target = join(mods, 'hanaworlds_adapter');
  const targetStat = await lstat(target).catch(() => null);
  // Installation is only for an empty current payload location. No identity,
  // pairing or bytes are adopted from an existing installation.
  if (targetStat) throw fault('PAYLOAD_VERSION_MISMATCH');
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

export async function payloadDigest() {
  const hash = createHash('sha256');
  for (const name of payloadFiles) {
    hash.update(`${name}\n`);
    hash.update(await readFile(join(payloadDir, name)));
  }
  return hash.digest('hex');
}
