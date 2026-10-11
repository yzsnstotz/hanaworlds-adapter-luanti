// FIXTURE: temporary world roots and a stand-in Luanti user path. describeSourceWorld reads the
// same discovery the Adapter uses; no engine, Host or runtime is started here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeSourceWorld, validateBoundResponse } from '#contracts';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { SOURCE_LOCATOR_VERSION } from '../src/source-locator.mjs';
import { payloadDigest } from '../src/local-worlds.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';

const WIRE = 'local-worlds/v2', OP = 'describeSourceWorld';
let n = 0;
const ask = worldRef => ({ contractVersion: WIRE, requestId: `source:${++n}`, worldRef });

async function world(root, name, worldRef) {
  const path = join(root, name);
  await mkdir(join(path, 'worldmods/hanaworlds_adapter'), { recursive: true });
  await writeFile(join(path, 'world.mt'), 'gameid = flatgame\n');
  if (worldRef) await writeFile(join(path, 'worldmods/hanaworlds_adapter/payload.json'),
    JSON.stringify({ worldRef, payloadVersion: PAYLOAD_VERSION, payloadDigest: await payloadDigest() }));
  return path;
}
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'hw-source-')));
  const user = join(base, 'user'), a = join(user, 'worlds'), b = join(base, 'more-worlds');
  await mkdir(a, { recursive: true }); await mkdir(b);
  await mkdir(join(user, 'games/flatgame'), { recursive: true });
  await writeFile(join(user, 'games/flatgame/game.conf'), 'title = Flat fixture\n');
  // Same display name, different references, in two configured roots.
  await world(a, 'Same', 'luanti:00000000-0000-4000-8000-00000000000a');
  await world(b, 'Same', 'luanti:00000000-0000-4000-8000-00000000000b');
  // An existing, never-started world without this Adapter's payload: its reference is its connection.
  await world(a, 'Plain');
  const calls = [], logs = [];
  const counted = name => new Proxy({}, { get: (_, key) => key === 'then' ? undefined
    : (...args) => { calls.push(`${name}.${String(key)}`); throw new Error('UNEXPECTED_CALL'); } });
  const runtime = counted('runtime'); runtime.port = counted('runtime.port');
  const local = createLocalWorldPort({ roots: [a, b], userPath: user, creationRoot: a, runtime,
    resolveControl: () => { calls.push('resolveControl'); return counted('host'); },
    resolveCanvas: () => { calls.push('resolveCanvas'); return counted('canvas'); },
    log: (...x) => logs.push(x.join(' ')) });
  return { base, user, a, b, local, port: local.port, calls, logs };
}
async function tree(path) {
  const out = [];
  for (const entry of await readdir(path, { withFileTypes: true, recursive: true })) {
    const p = join(entry.parentPath, entry.name), s = await lstat(p);
    out.push([p, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs,
      entry.isFile() ? createHash('sha256').update(await readFile(p)).digest('hex') : null].join('|'));
  }
  return out.sort();
}
// The SDK returns null-prototype frozen JSON; compare as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const call = async (port, request) => plain(validateBoundResponse(WIRE, OP, request, await port.describeSourceWorld(request)));
const refs = async (port, root) => (await port.discover({ contractVersion: WIRE, requestId: `d:${++n}`, worldRoot: root })).result.worlds;
const same = async (port, root) => (await refs(port, root)).filter(w => w.displayName === 'Same');

test('same display name, different references: each locator names its own canonical world', async () => {
  const f = await fixture();
  const [left] = await same(f.port, f.a), [right] = await same(f.port, f.b);
  assert.equal(left.displayName, 'Same'); assert.equal(right.displayName, 'Same');
  const l = (await call(f.port, ask(left.worldRef))).result, r = (await call(f.port, ask(right.worldRef))).result;
  assert.equal(l.worldRef, left.worldRef); assert.equal(r.worldRef, right.worldRef);
  assert.equal(l.sourceLocator.worldPath, join(f.a, 'Same')); assert.equal(r.sourceLocator.worldPath, join(f.b, 'Same'));
  assert.equal(l.sourceLocator.worldRoot, f.a); assert.equal(r.sourceLocator.worldRoot, f.b);
  assert.notDeepEqual(l.sourceLocator.directory, r.sourceLocator.directory);
  const info = await lstat(join(f.a, 'Same'), { bigint: true });
  assert.deepEqual(l.sourceLocator, { locatorVersion: SOURCE_LOCATOR_VERSION, worldRef: left.worldRef,
    connectionRef: left.worldId, worldPath: join(f.a, 'Same'), worldRoot: f.a, userPath: f.user,
    directory: { device: String(info.dev), inode: String(info.ino) }, gameId: 'flatgame',
    payload: { status: 'INSTALLED_UNVERIFIED', payloadVersion: PAYLOAD_VERSION, payloadDigest: await payloadDigest() } });
  // The display name is never a key.
  assert.equal((await call(f.port, ask('Same'))).error.code, 'WORLD_NOT_FOUND');
});

test('an existing, never-started world is described without starting, pairing or writing anything', async () => {
  const f = await fixture();
  const unstarted = (await refs(f.port, f.a)).find(w => w.displayName === 'Plain');
  const before = await tree(f.base);
  const r = await call(f.port, ask(unstarted.worldRef));
  // Through the published consumer helper too, preserving the provider's this.
  const viaHelper = await describeSourceWorld(f.port, ask(unstarted.worldRef));
  assert.deepEqual(plain(viaHelper.result), r.result);
  assert.equal(r.error, null);
  assert.equal(r.result.sourceLocator.connectionRef, unstarted.worldRef);
  assert.deepEqual(r.result.sourceLocator.payload, { status: 'MISSING', payloadVersion: null, payloadDigest: null });
  for (const w of [...await refs(f.port, f.a), ...await refs(f.port, f.b)]) await call(f.port, ask(w.worldRef));
  await call(f.port, ask('luanti:missing'));
  assert.deepEqual(await tree(f.base), before, 'zero file writes');
  assert.deepEqual(f.calls, [], 'no Host, runtime or canvas call: no process, provision, pairing or session');
  await assert.rejects(f.local.inspectConnection(unstarted.worldRef), /WORLD_NOT_BOUND/);
  assert.equal(f.local.manages(join(f.a, 'Plain')), false);
});

test('a world just created through createWorld is described by the reference createWorld returned', async () => {
  const f = await fixture();
  const q = { contractVersion: WIRE, requestId: 'source:create', templateId: 'flat', displayName: 'Fresh' };
  const created = validateBoundResponse(WIRE, 'createWorld', q, await f.port.createWorld(q));
  assert.equal(created.error, null, JSON.stringify(created.error) + f.logs.join('\n'));
  const made = created.result;
  const r = (await call(f.port, ask(made.worldRef))).result;
  assert.equal(r.worldRef, made.worldRef);
  assert.equal(r.sourceLocator.worldPath, made.creationFacts.worldPath);
  assert.equal(r.sourceLocator.connectionRef, made.creationFacts.connectionRef);
  assert.equal(r.sourceLocator.payload.status, 'INSTALLED_UNVERIFIED');
});

test('a vanished world refuses WORLD_NOT_FOUND; a replaced directory gets a new identity', async () => {
  const f = await fixture();
  const [left] = await same(f.port, f.a), path = join(f.a, 'Same');
  const first = (await call(f.port, ask(left.worldRef))).result.sourceLocator;
  // Replaced by a copy carrying the same payload: the locator reports the new directory, never the old.
  await cp(path, join(f.base, 'copy'), { recursive: true });
  await rm(path, { recursive: true }); await rename(join(f.base, 'copy'), path);
  const second = (await call(f.port, ask(left.worldRef))).result.sourceLocator;
  assert.notEqual(second.directory.inode, first.directory.inode);
  assert.deepEqual({ ...second, directory: null }, { ...first, directory: null });
  // Replaced by a different world under the same name: the old reference is gone.
  await rm(path, { recursive: true }); await world(f.a, 'Same', 'luanti:00000000-0000-4000-8000-0000000000cc');
  const gone = await call(f.port, ask(left.worldRef));
  assert.equal(gone.error.code, 'WORLD_NOT_FOUND'); assert.equal(gone.error.mutationState, 'NONE');
  await rm(path, { recursive: true });
  assert.equal((await call(f.port, ask('luanti:00000000-0000-4000-8000-0000000000cc'))).error.code, 'WORLD_NOT_FOUND');
});

test('a reference held by two directories is an identity mismatch, not a choice', async () => {
  const f = await fixture();
  const [left] = await same(f.port, f.a);
  await cp(join(f.a, 'Same'), join(f.a, 'Same copy'), { recursive: true });
  const r = await call(f.port, ask(left.worldRef));
  assert.equal(r.error.code, 'CURRENT_WORLD_MISMATCH'); assert.equal(r.result, null);
  assert.ok(f.logs.some(x => /LOCAL_SOURCE_DESCRIBE_REJECTED WORLD_REF_NOT_UNIQUE/.test(x)));
});

test('missing roots or user path and a closed service refuse ADAPTER_UNAVAILABLE; bad input is not admitted', async () => {
  const f = await fixture();
  const [left] = await same(f.port, f.a);
  await rm(f.b, { recursive: true });
  assert.equal((await call(f.port, ask(left.worldRef))).error.code, 'ADAPTER_UNAVAILABLE');
  const g = await fixture();
  const [other] = await same(g.port, g.a);
  const noUser = createLocalWorldPort({ roots: [g.a], userPath: join(g.base, 'absent'), runtime: {}, resolveControl: () => null });
  assert.equal((await call(noUser.port, ask(other.worldRef))).error.code, 'ADAPTER_UNAVAILABLE');
  const unconfigured = createLocalWorldPort({ roots: [g.a], runtime: {}, resolveControl: () => null });
  assert.equal((await call(unconfigured.port, ask(other.worldRef))).result.sourceLocator.userPath, null);
  await g.local.close();
  assert.equal((await call(g.port, ask(other.worldRef))).error.code, 'ADAPTER_UNAVAILABLE');
  await assert.rejects(g.port.describeSourceWorld({ contractVersion: WIRE, requestId: 'x', worldRef: other.worldRef, displayName: 'Same' }));
  await assert.rejects(g.port.describeSourceWorld({ contractVersion: WIRE, requestId: 'x' }));
});
