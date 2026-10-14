import { createHash } from 'node:crypto';
import { constants, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, ContractError } from '#contracts';
import { ADAPTER_VERSION, PAYLOAD_VERSION, PAYLOAD_FILES } from './version.mjs';
import { discoverLocalWorlds } from './local-worlds.mjs';
import { closedObject, LOCAL_SOURCE_VERSION } from './local-source-protocol.mjs';
import { addSourceCheck, bindSourceWorld, checkSourceScope, sourceRead } from './source-scope.mjs';

// Issued from this Adapter's own nine payload files, version, MIT license and
// NOTICE. These installed-JS anchors do not trust a mutable build manifest or
// the world's self-reported digest. No test candidate is an authority here.
const MATERIALS_SHA256 = 'a2149a31b38b8f82308dc453eddbdf6b20094a758be0b94a5a89a7ef58131141';
const NOTICE_SHA256 = '595efecb1c06fc9cbaf3e1d847767818557633191dd3e43c1dbbc5d03fae7a3f';
const LICENSE_SHA256 = '921940ddfcb1c9915b4d55942203a52ca8abf2e71354df85a8464f589d17c548';
const materialsPath = fileURLToPath(new URL('../fixtures/source-release-materials.json', import.meta.url));
const payloadPath = fileURLToPath(new URL('../payload/hanaworlds_adapter/', import.meta.url));
const noticePath = fileURLToPath(new URL('../NOTICE', import.meta.url));
const licensePath = fileURLToPath(new URL('../LICENSE', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const ordinary = st => st.isFile() && !st.isSymbolicLink();

export function releaseRequest(input) {
  const q = JSON.parse(canonicalJSON(input));
  closedObject(q, ['contractVersion', 'requestId', 'source', 'worldRef']);
  const ref = value => typeof value === 'string' && value.length > 0;
  if (![q.requestId, q.worldRef].every(ref)) throw new ContractError('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
  if (q.contractVersion !== LOCAL_SOURCE_VERSION) throw new ContractError('PAYLOAD_VERSION_MISMATCH', 'validate', 'VERSION_UNSUPPORTED');
  closedObject(q.source, ['sourceRef', 'instanceRef']);
  if (!Object.values(q.source).every(ref)) throw new ContractError('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
  return q;
}

// Existing source scope checks the official registration/root generation around
// every await. Synchronous extra observations also recheck captured directory
// and file identities after those checks yield, without retaining success caches.
function watchDirectory(path, stat, code) {
  const check = () => {
    try {
      const current = lstatSync(path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(stat, current) || realpathSync(path) !== path) fail(code);
    } catch (error) { if (error.message === code) throw error; throw new Error(code, { cause: error }); }
  };
  check(); addSourceCheck(check);
}
function watchFile(path, stat, code) {
  const check = () => {
    try {
      const current = lstatSync(path, { bigint: true });
      if (!ordinary(current) || !sameFile(stat, current) || realpathSync(path) !== path) fail(code);
    } catch (error) { if (error.message === code) throw error; throw new Error(code, { cause: error }); }
  };
  check(); addSourceCheck(check);
}
async function directory(path, code) {
  const stat = await sourceRead(() => lstat(path, { bigint: true }));
  if (!stat.isDirectory() || stat.isSymbolicLink() || await sourceRead(() => realpath(path)) !== path) fail(code);
  watchDirectory(path, stat, code);
  return stat;
}
async function fileIdentity(path, code) {
  const stat = await sourceRead(() => lstat(path, { bigint: true }));
  if (!ordinary(stat) || await sourceRead(() => realpath(path)) !== path) fail(code);
  watchFile(path, stat, code);
  return stat;
}
async function layout(path, names, code) {
  const expected = canonicalJSON([...names].sort());
  if (canonicalJSON((await sourceRead(() => readdir(path))).sort()) !== expected) fail(code);
  const check = () => {
    try { if (canonicalJSON(readdirSync(path).sort()) !== expected) fail(code); }
    catch (error) { if (error.message === code) throw error; throw new Error(code, { cause: error }); }
  };
  check(); addSourceCheck(check);
}
async function readOrdinary(path, code) {
  const stat = await fileIdentity(path, code);
  let handle;
  try {
    await sourceRead(async () => { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); });
    const held = await sourceRead(() => handle.stat({ bigint: true }));
    if (!ordinary(held) || !sameFile(stat, held)) fail(code);
    const bytes = await sourceRead(() => handle.readFile());
    const after = await sourceRead(() => handle.stat({ bigint: true }));
    if (!sameFile(stat, after)) fail(code);
    return bytes;
  } finally {
    // Release an already captured descriptor even when its source expires.
    if (handle) { await handle.close(); await checkSourceScope(); }
  }
}
function preserveCurrency(error, otherwise) {
  const code = error.publicError?.code ?? error.code ?? error.message;
  if (['CURRENT_WORLD_MISMATCH', 'ADAPTER_UNAVAILABLE', 'UNKNOWN_REQUIRED_FIELD'].includes(code)) throw error;
  throw new Error(otherwise, { cause: error });
}

async function ownMaterials() {
  try {
    const data = JSON.parse(await readOrdinary(materialsPath, 'ADAPTER_UNAVAILABLE'));
    if (sha(canonicalJSON(data)) !== MATERIALS_SHA256 || data.release.adapterVersion !== ADAPTER_VERSION ||
      data.release.payloadVersion !== PAYLOAD_VERSION || canonicalJSON(data.release.files.map(row => row.name)) !== canonicalJSON(PAYLOAD_FILES)) fail('ADAPTER_UNAVAILABLE');
    if (sha(await readOrdinary(noticePath, 'ADAPTER_UNAVAILABLE')) !== NOTICE_SHA256 ||
      sha(await readOrdinary(licensePath, 'ADAPTER_UNAVAILABLE')) !== LICENSE_SHA256) fail('ADAPTER_UNAVAILABLE');
    const ownDirectory = payloadPath.replace(/\/$/, '');
    await directory(ownDirectory, 'ADAPTER_UNAVAILABLE');
    await layout(ownDirectory, PAYLOAD_FILES, 'ADAPTER_UNAVAILABLE');
    const hash = createHash('sha256');
    for (const row of data.release.files) {
      const bytes = await readOrdinary(join(ownDirectory, row.name), 'ADAPTER_UNAVAILABLE');
      if (bytes.length !== row.byteLength || sha(bytes) !== row.sha256 || bytes.toString('base64') !== row.bytesBase64) fail('ADAPTER_UNAVAILABLE');
      hash.update(`${row.name}\n`); hash.update(bytes);
    }
    if (hash.digest('hex') !== data.release.payloadDigest) fail('ADAPTER_UNAVAILABLE');
    return data;
  } catch (error) { preserveCurrency(error, 'ADAPTER_UNAVAILABLE'); }
}

/** Private, read-only interpretation of this source's fixed issued materials. */
export async function readSourceReleaseMaterials({ source, worldRef, roots }) {
  const data = await ownMaterials(); // Provider trust precedes unknown-world lookup.
  let rows;
  try { rows = await discoverLocalWorlds(roots); }
  catch (error) {
    const code = error.publicError?.code ?? error.code ?? error.message;
    if (code === 'UNKNOWN_REQUIRED_FIELD' || code === 'CURRENT_WORLD_MISMATCH' ||
      (code === 'ADAPTER_UNAVAILABLE' && !error.source)) throw error;
    // Discovery's identity-file errors are release mismatches for this entry.
    throw new Error('PAYLOAD_VERSION_MISMATCH', { cause: error });
  }
  const matches = rows.filter(row => (row.worldRef ?? row.connectionRef) === worldRef);
  if (!matches.length) fail('WORLD_NOT_FOUND');
  if (matches.length !== 1) fail('CURRENT_WORLD_MISMATCH');
  const row = matches[0];
  try {
    const stat = await directory(row.worldPath, 'CURRENT_WORLD_MISMATCH');
    bindSourceWorld({ ...row, device: stat.dev, inode: stat.ino });
    const directoryIdentity = { device: String(stat.dev), inode: String(stat.ino) };
    await directory(join(row.worldPath, 'worldmods'), 'PAYLOAD_VERSION_MISMATCH');
    const installed = join(row.worldPath, data.release.layout.payloadDirectory);
    await directory(installed, 'PAYLOAD_VERSION_MISMATCH');
    const names = [...PAYLOAD_FILES, data.release.layout.identityFile, ...data.release.layout.instanceFiles];
    await layout(installed, names, 'PAYLOAD_VERSION_MISMATCH');
    const identity = JSON.parse(await readOrdinary(join(installed, 'payload.json'), 'PAYLOAD_VERSION_MISMATCH'));
    closedObject(identity, ['worldRef', 'payloadVersion', 'payloadDigest']);
    if (identity.worldRef !== worldRef || row.worldRef !== worldRef || identity.payloadVersion !== data.release.payloadVersion ||
      identity.payloadDigest !== data.release.payloadDigest || row.payloadVersion !== identity.payloadVersion || row.payloadDigest !== identity.payloadDigest) fail('PAYLOAD_VERSION_MISMATCH');
    // Instance channel bytes/credentials never participate in a release read.
    await fileIdentity(join(installed, 'transport.json'), 'PAYLOAD_VERSION_MISMATCH');
    const hash = createHash('sha256');
    for (const file of data.release.files) {
      const bytes = await readOrdinary(join(installed, file.name), 'PAYLOAD_VERSION_MISMATCH');
      if (bytes.length !== file.byteLength || sha(bytes) !== file.sha256 || bytes.toString('base64') !== file.bytesBase64) fail('PAYLOAD_VERSION_MISMATCH');
      hash.update(`${file.name}\n`); hash.update(bytes);
    }
    if (hash.digest('hex') !== data.release.payloadDigest) fail('PAYLOAD_VERSION_MISMATCH');
    await checkSourceScope();
    // Return only fresh JSON. Neither descriptors nor issued bytes confer a lease.
    return JSON.parse(canonicalJSON({ source, worldRef, connectionRef: row.connectionRef, directory: directoryIdentity, ...data }));
  } catch (error) { preserveCurrency(error, 'PAYLOAD_VERSION_MISMATCH'); }
}
