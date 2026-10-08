import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const OWNER = 'hanaworlds-adapter-luanti';
// Not *.json: DurableJournal reads every *.json entry as a transaction record.
const MARKER = 'world-binding';
const MARKER_FORMAT = 'hanaworlds-adapter-journal-world/1';

function unavailable(reason) {
  const error = new Error('ADAPTER_STORAGE_UNAVAILABLE');
  error.reason = reason;
  return error;
}
// Same as @deepseek-ai/dsh-home-paths expandHomePath (os.homedir()).
function expandHomePath(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * The Adapter's durable journal directory for one world, from the host's
 * native DSH seam `ctx.get('dshHomePath')` (dsh-app-boot provides
 * `dshHomePath(...segments) = join(resolveDshHome(), ...segments)`):
 *
 *   <DSH_HOME>/data/hanaworlds-adapter-luanti/journal/<sha256(worldRef)>
 *
 * The DSH home must already exist and be a real directory; when DSH_HOME is
 * configured it must be that path. Every existing component below it must be
 * a real (non-symlink) directory whose canonical path stays inside the
 * canonical home. Missing components are created one level at a time inside
 * that home only. A marker binds the directory to its worldRef; a missing or
 * unreadable marker beside existing records fails closed instead of adopting
 * the records or starting a fresh identity.
 */
export async function nativeJournalDirectory(homePath, worldRef, env = process.env) {
  if (typeof homePath !== 'function') throw unavailable('dshHomePath not provided');
  if (typeof worldRef !== 'string' || !worldRef) throw unavailable('worldRef missing');
  const root = homePath();
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root)
    throw unavailable('DSH home is not an absolute normalized path');
  // Same rule as @deepseek-ai/dsh-home-paths resolveDshHome: a non-blank
  // DSH_HOME (used untrimmed) with a leading ~, ~/ or ~\ expanded to the
  // user home, then resolved.
  const configured = env.DSH_HOME;
  if (configured !== undefined && configured.trim().length > 0 &&
      root !== resolve(expandHomePath(configured)))
    throw unavailable('dshHomePath does not resolve to the configured DSH_HOME');
  const key = createHash('sha256').update(worldRef).digest('hex');
  const segments = ['data', OWNER, 'journal', key];
  const directory = join(root, ...segments);
  if (homePath(...segments) !== directory)
    throw unavailable('dshHomePath does not join segments under the DSH home');
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw unavailable('DSH home is missing, not a directory, or a symlink');
  const canonicalRoot = await realpath(root);
  let path = root;
  let canonical = canonicalRoot;
  for (const segment of segments) {
    path = join(path, segment);
    canonical = join(canonical, segment);
    let stat = await lstat(path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw unavailable(`cannot inspect ${segment}: ${error.code ?? error.message}`);
    });
    if (!stat) {
      await mkdir(path, { mode: 0o700 });
      await syncDirectory(join(path, '..'));
      stat = await lstat(path);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw unavailable(`${segment} is not a real directory`);
    if (await realpath(path) !== canonical)
      throw unavailable(`${segment} resolves outside the DSH home`);
  }
  await bindWorld(directory, worldRef);
  return directory;
}

async function bindWorld(directory, worldRef) {
  const markerPath = join(directory, MARKER);
  const raw = await readFile(markerPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw unavailable(`journal world marker unreadable: ${error.code ?? error.message}`);
  });
  if (raw !== null) {
    let marker;
    try { marker = JSON.parse(raw); } catch { marker = null; }
    if (marker?.format !== MARKER_FORMAT || marker.worldRef !== worldRef)
      throw unavailable('journal world marker is corrupt or names another world');
    return;
  }
  const entries = (await readdir(directory)).filter(name => !name.startsWith('.pending-'));
  if (entries.length) throw unavailable('journal records exist without a world marker');
  const temporary = join(directory, `.pending-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ format: MARKER_FORMAT, worldRef })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, markerPath);
  await syncDirectory(directory);
}

// Transaction outcomes after which no world mutation is still in flight.
const SETTLED = new Set(['VERIFIED', 'ROLLED_BACK', 'ABORTED_PREPARED']);
/**
 * Read-only view of one world's journal, without creating any directory:
 * `{state:'NONE'}` when no journal was ever written, `{state:'PRESENT', unsettled:[...]}`
 * listing transactions that are not settled, or `{state:'UNKNOWN', reason}` when it
 * cannot be read exactly (fail closed for callers that need "no in-flight operation").
 */
export async function readJournalActivity(homePath, worldRef) {
  try {
    if (typeof homePath !== 'function') return { state: 'UNKNOWN', reason: 'dshHomePath not provided' };
    const root = homePath();
    if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root) return { state: 'UNKNOWN', reason: 'DSH home is not an absolute normalized path' };
    const key = createHash('sha256').update(worldRef).digest('hex');
    const directory = join(root, 'data', OWNER, 'journal', key);
    const dir = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!dir) return { state: 'NONE' };
    if (!dir.isDirectory() || dir.isSymbolicLink()) return { state: 'UNKNOWN', reason: 'journal is not a real directory' };
    const file = join(directory, 'local-world-state');
    const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return { state: 'NONE' };
    if (!info.isFile() || info.isSymbolicLink()) return { state: 'UNKNOWN', reason: 'journal state is not a regular file' };
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data?.worldRef !== worldRef || typeof data.transactions !== 'object' || data.transactions === null)
      return { state: 'UNKNOWN', reason: 'journal names another world or is malformed' };
    const unsettled = Object.values(data.transactions).filter(t => !SETTLED.has(t?.status))
      .map(t => ({ transactionId: t?.transactionId ?? null, status: t?.status ?? null }));
    return { state: 'PRESENT', unsettled };
  } catch (error) { return { state: 'UNKNOWN', reason: `journal unreadable: ${error.code ?? error.message}` }; }
}
