// Private world-source interpretation. No transport credential is read here.
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { canonicalJSON } from '#contracts';
import { payloadDigest } from './local-worlds.mjs';
import { PAYLOAD_FILES, PAYLOAD_VERSION } from './version.mjs';
export const SOURCE_STARTUP_VERSION = 'hanaworlds-luanti-source-startup/v1';
const unavailable = () => ({ profileVersion: SOURCE_STARTUP_VERSION, availability: 'UNAVAILABLE', reason: 'PAYLOAD_NOT_VERIFIED' });
/** Least native startup permissions for this exact world-bound installed payload.
 * A manifest alone is not proof: all source files must match this release's digest.
 * Read-time facts only; the paired runtime rechecks before native startup. */
export async function readSourceStartupFacts(row, directory) {
  if (row.payloadStatus !== 'INSTALLED_UNVERIFIED' || row.payloadVersion !== PAYLOAD_VERSION || row.payloadDigest !== await payloadDigest()) return unavailable();
  const dir = join(row.worldPath, 'worldmods', 'hanaworlds_adapter');
  for (const path of [join(row.worldPath, 'worldmods'), dir]) {
    const stat = await lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat?.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) return unavailable();
  }
  async function observe() {
    const hash = createHash('sha256'); let mod;
    for (const name of [...PAYLOAD_FILES, 'payload.json']) {
      const path = join(dir, name), stat = await lstat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (!stat?.isFile() || stat.isSymbolicLink()) return null;
      // O_NOFOLLOW closes the lstat->open final-component symlink window. No bytes
      // are read until the opened file and current canonical directories still match.
      let handle;
      try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if (['ELOOP','ENOENT','ENOTDIR'].includes(error.code)) return null; throw error; }
      let bytes;
      try {
        const held = await handle.stat({bigint:true}), current = await lstat(path,{bigint:true});
        if (!held.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) return null;
        if (await realpath(dir) !== dir || await realpath(row.worldPath) !== row.worldPath) return null;
        const world = await lstat(row.worldPath,{bigint:true});
        if (String(world.dev) !== directory.device || String(world.ino) !== directory.inode) throw Error('CURRENT_WORLD_MISMATCH');
        bytes = await handle.readFile();
        const after = await lstat(path,{bigint:true});
        if (after.isSymbolicLink() || held.dev !== after.dev || held.ino !== after.ino || held.size !== after.size || held.mtimeNs !== after.mtimeNs || held.ctimeNs !== after.ctimeNs) throw Error('CURRENT_WORLD_MISMATCH');
      } finally { await handle.close(); }
      if (name === 'payload.json') {
        let identity; try { identity = JSON.parse(bytes); } catch { return null; }
        if (identity.worldRef !== row.worldRef || identity.payloadVersion !== row.payloadVersion || identity.payloadDigest !== row.payloadDigest) return null;
      } else {
        hash.update(`${name}\n`); hash.update(bytes);
        if (name === 'mod.conf') mod = /^\s*name\s*=\s*([a-z0-9_]+)\s*$/m.exec(bytes.toString())?.[1];
      }
    }
    return hash.digest('hex') === row.payloadDigest && mod ? mod : null;
  }
  const first = await observe(), second = await observe();
  if (first !== second) throw Error('CURRENT_WORLD_MISMATCH');
  if (!second) return unavailable();
  const facts = { profileVersion: SOURCE_STARTUP_VERSION, availability: 'KNOWN',
    connection: { worldRef: row.worldRef, connectionRef: row.connectionRef, payloadVersion: row.payloadVersion, payloadDigest: row.payloadDigest, directory },
    runtimeSettings: { httpMods: [second], trustedMods: [] } };
  // Only JSON leaves this boundary; no file handles, credentials or engine API.
  return JSON.parse(canonicalJSON(facts));
}
