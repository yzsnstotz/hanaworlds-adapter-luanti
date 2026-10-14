import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD_FILES, PAYLOAD_VERSION } from './version.mjs';

import { validateTransportSettings } from './transport-policy.mjs';
import { absentOnly, ioKind, resourceFailure } from './resource-errors.mjs';
import { sourceRead, sourceWrite } from './source-scope.mjs';

const payloadDir = fileURLToPath(new URL('../payload/hanaworlds_adapter/', import.meta.url));
const payloadFiles = PAYLOAD_FILES;
const manifestName = 'payload.json';

function fault(code) { return new Error(code); }
async function realDirectory(path, code) {
  const stat = await sourceRead(() => absentOnly(()=>lstat(path), code, 'discover', 'world-directory'));
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw fault(code);
}
export async function syncFile(path, content) {
  let handle;
  try {
    await sourceWrite(async () => { handle = await open(path, 'wx', 0o600); });
    await sourceWrite(() => handle.writeFile(content));
    await sourceWrite(() => handle.sync());
  } finally {
    // Release the captured descriptor even when the source loses authority.
    if (handle) await handle.close();
  }
}
export async function syncDirectory(path) {
  let handle;
  try {
    await sourceRead(async () => { handle = await open(path, 'r'); });
    await sourceWrite(() => handle.sync());
  } finally {
    // Release the captured descriptor even when the source loses authority.
    if (handle) await handle.close();
  }
}
export function worldSettings(raw) {
  const match = /^\s*gameid\s*=\s*([^\r\n#]+)\s*$/m.exec(raw);
  return match?.[1]?.trim() || null;
}
async function readIdentity(world) {
  const path = join(world, 'worldmods', 'hanaworlds_adapter', manifestName);
  const info = await sourceRead(() => absentOnly(()=>lstat(path),'ADAPTER_UNAVAILABLE','discover','payload-identity'));
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw resourceFailure('ADAPTER_UNAVAILABLE','discover','payload-identity','UNSAFE_PATH');
  const raw = await sourceRead(() => absentOnly(()=>readFile(path,'utf8'),'ADAPTER_UNAVAILABLE','discover','payload-identity'));
  if (raw === null) throw resourceFailure('ADAPTER_UNAVAILABLE','discover','payload-identity','NOT_FOUND');
  let value;
  try { value = JSON.parse(raw); } catch(error) { throw resourceFailure('PAYLOAD_VERSION_MISMATCH','discover','payload-identity','CORRUPT',error); }
  if (!value || typeof value!=='object' || Array.isArray(value)) throw resourceFailure('PAYLOAD_VERSION_MISMATCH','discover','payload-identity','CORRUPT');
  if (Object.keys(value).some(key => !['worldRef', 'payloadVersion', 'payloadDigest'].includes(key)))
    throw resourceFailure('UNKNOWN_REQUIRED_FIELD','discover','payload-identity','CORRUPT');
  if (value.payloadVersion !== PAYLOAD_VERSION) throw resourceFailure('PAYLOAD_VERSION_MISMATCH','discover','payload-identity','VERSION');
  if (typeof value.worldRef !== 'string' || !/^luanti:[0-9a-f-]+$/.test(value.worldRef) ||
      !/^[0-9a-f]{64}$/.test(value.payloadDigest ?? '')) throw resourceFailure('PAYLOAD_VERSION_MISMATCH','discover','payload-identity','CORRUPT');
  return value;
}

export async function discoverLocalWorlds(configuredRoots) {
  const worlds = [];
  for (const root of configuredRoots) {
    await realDirectory(root, 'CONNECTION_NOT_FOUND');
    for (const entry of await sourceRead(() => readdir(root, { withFileTypes: true }))) {
      // Adapter staging (new world / deletion in progress) is never a world.
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.hanaworlds-')) continue;
      const world = join(root, entry.name);
      const worldMt = join(world, 'world.mt');
      const info = await sourceRead(() => absentOnly(()=>lstat(worldMt),'ADAPTER_UNAVAILABLE','discover','world-settings'));
      if (!info?.isFile() || info.isSymbolicLink()) continue;
      const raw = await sourceRead(async () => {
        try { return await readFile(worldMt,'utf8'); }
        catch(error) { throw resourceFailure('ADAPTER_UNAVAILABLE','discover','world-settings',ioKind(error),error); }
      });
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

export async function provisionLocalPayload(world, { stoppedWorld, transportPort = null, transportSettings = {} } = {}) {
  if (typeof stoppedWorld !== 'function') throw fault('CURRENT_WORLD_MISMATCH');
  const stopped = await sourceRead(() => stoppedWorld());
  if (stopped?.state !== 'STOPPED' || stopped.worldPath !== resolve(world) ||
      !Number.isSafeInteger(stopped.processId) || stopped.processId <= 0 ||
      typeof stopped.operationRef !== 'string' || !stopped.operationRef)
    throw fault('CURRENT_WORLD_MISMATCH');
  if (transportPort !== null && (!Number.isSafeInteger(transportPort) || transportPort < 1 || transportPort > 65535))
    throw fault('SCHEMA_INVALID');
  await realDirectory(world, 'WORLD_NOT_FOUND');
  const worldMt = await sourceRead(() => absentOnly(()=>lstat(join(world,'world.mt')),'ADAPTER_UNAVAILABLE','provision','world-settings'));
  if (!worldMt?.isFile() || worldMt.isSymbolicLink()) throw fault('WORLD_NOT_FOUND');
  const mods = join(world, 'worldmods');
  const modsStat = await sourceRead(() => absentOnly(()=>lstat(mods),'ADAPTER_UNAVAILABLE','provision','worldmods'));
  if (modsStat) await realDirectory(mods, 'CURRENT_WORLD_MISMATCH');
  else { await sourceWrite(() => mkdir(mods, { mode: 0o700 })); await syncDirectory(world); }
  const target = join(mods, 'hanaworlds_adapter');
  const targetStat = await sourceRead(() => absentOnly(()=>lstat(target),'ADAPTER_UNAVAILABLE','provision','payload-directory'));
  // Installation is only for an empty current payload location. No identity,
  // pairing or bytes are adopted from an existing installation.
  if (targetStat) throw fault('PAYLOAD_VERSION_MISMATCH');
  const staging = join(mods, `.hanaworlds-adapter-${randomUUID()}`);
  await sourceWrite(() => mkdir(staging, { mode: 0o700 }));
  let committed = false;
  try {
    const identity = await writePayload(staging, { transportPort, transportSettings });
    await sourceWrite(async () => { await rename(staging, target); committed = true; });
    await syncDirectory(mods);
    return identity;
  } catch (error) {
    if (committed && !error.mutationState)
      Object.defineProperty(error, 'mutationState', { value: 'UNKNOWN', configurable: true });
    if (!committed && error.message !== 'CURRENT_WORLD_MISMATCH')
      await sourceWrite(() => rm(staging, { recursive: true, force: true }));
    throw error;
  }
}

/** Writes a fresh payload identity into an empty, caller-owned directory and fsyncs it.
 * Used for an existing stopped world (above) and for a world this Adapter creates. */
export async function writePayload(directory, { transportPort = null, transportSettings = {} } = {}) {
  const settings = validateTransportSettings(transportSettings);
  const worldRef = `luanti:${randomUUID()}`;
  const identity = { worldRef, payloadVersion: PAYLOAD_VERSION, payloadDigest: await payloadDigest() };
  for (const name of payloadFiles) await syncFile(join(directory, name), await sourceRead(() => readFile(join(payloadDir, name))));
  await syncFile(join(directory, manifestName), `${JSON.stringify(identity)}\n`);
  if (transportPort !== null) {
    await syncFile(join(directory, 'transport.json'), `${JSON.stringify({
      worldRef, settings, port: transportPort, token: randomBytes(32).toString('hex') })}\n`);
  }
  await syncDirectory(directory);
  return identity;
}

export async function payloadDigest() {
  const hash = createHash('sha256');
  for (const name of payloadFiles) {
    hash.update(`${name}\n`);
    hash.update(await sourceRead(() => readFile(join(payloadDir, name))));
  }
  return hash.digest('hex');
}
