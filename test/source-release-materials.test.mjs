// Q-250 proposed provider contract. SOURCE/FIXTURE only; candidate awaits joint review.
// Expected bytes are literal provider materials, never derived from an installed world,
// world manifest, src/version.mjs, payloadDigest() or a sibling implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Context, symbols } from '@deepseek-ai/cordis';
import { setup, ask, WIRE, plain, keys, envelope, denied, replace, files } from './support/source-release-fixture.mjs';

const candidate = JSON.parse(await fs.readFile(new URL('./fixtures/source-release-materials.json', import.meta.url), 'utf8'));
const NAMES = ['mod.conf', 'init.lua', 'engine.lua', 'transport.lua', 'transport-policy.lua',
  'region.lua', 'facts.lua', 'voxel.lua', 'canvas-facts.json'];
const bytes = file => Buffer.from(file.bytesBase64, 'base64');
const sha = value => createHash('sha256').update(value).digest('hex');
function aggregate(rows) {
  const hash = createHash('sha256');
  for (const row of rows) { hash.update(`${row.name}\n`); hash.update(bytes(row)); }
  return hash.digest('hex');
}
async function fixture(t) {
  const f = await setup(t), descriptor = await f.descriptor(), world = await f.create(descriptor.source);
  return { ...f, d: descriptor, world, q: f.request(descriptor.source, world.worldRef) };
}
async function read(f, q = f.q) {
  return f.audit(async () => envelope(q, await f.entry('readSourceReleaseMaterials')(q)));
}
async function rejected(f, code, reason, q = f.q) {
  return f.audit(async () => denied(q, await f.entry('readSourceReleaseMaterials')(q), code, reason));
}
async function identity(f, edit) {
  const path = join(f.world.payloadPath, 'payload.json');
  const value = JSON.parse(await fs.readFile(path, 'utf8')); edit(value);
  await fs.writeFile(path, `${JSON.stringify(value)}\n`);
}
async function selfRehash(f) {
  const hash = createHash('sha256');
  for (const name of NAMES) { hash.update(`${name}\n`); hash.update(await fs.readFile(join(f.world.payloadPath, name))); }
  await identity(f, value => { value.payloadDigest = hash.digest('hex'); });
}
function materialShape(value) {
  keys(value, ['source', 'worldRef', 'connectionRef', 'directory', 'release', 'origin', 'permissions']);
  keys(value.source, ['sourceRef', 'instanceRef']); keys(value.directory, ['device', 'inode']);
  for (const part of Object.values(value.directory)) assert.match(part, /^\d+$/);
  keys(value.release, ['format', 'releaseRef', 'adapterVersion', 'payloadVersion', 'payloadDigest', 'digestAlgorithm', 'files', 'layout']);
  keys(value.release.layout, ['payloadDirectory', 'identityFile', 'instanceFiles', 'extraFiles']);
  keys(value.origin, ['name', 'version', 'sourceUrl', 'license', 'noticePath']);
  keys(value.permissions, ['securityEnabled', 'httpMods', 'trustedMods']);
  for (const row of value.release.files) {
    keys(row, ['name', 'relativePath', 'byteLength', 'sha256', 'bytesBase64']);
    assert.equal(bytes(row).toString('base64'), row.bytesBase64);
    assert.equal(row.byteLength, bytes(row).length); assert.equal(sha(bytes(row)), row.sha256);
  }
}

test('literal candidate has nine ordered complete release files, independent hashes, origin and least permissions', () => {
  assert.equal(candidate.approvalStatus, 'CANDIDATE_AWAITING_JOINT_REVIEW');
  assert.equal(candidate.evidenceLevel, 'SOURCE_FIXTURE_ONLY');
  assert.deepEqual(candidate.release.files.map(row => row.name), NAMES);
  assert.equal(new Set(candidate.release.files.map(row => row.relativePath)).size, 9);
  for (const row of candidate.release.files) {
    assert.equal(row.relativePath, `worldmods/hanaworlds_adapter/${row.name}`);
    assert.equal(row.byteLength, bytes(row).length); assert.equal(row.sha256, sha(bytes(row)));
    assert.equal(row.bytesBase64, bytes(row).toString('base64'));
  }
  assert.equal(aggregate(candidate.release.files), '7b15f690092171622624703c91819630bee15366f101fb1cacf6a98453a65878');
  assert.equal(candidate.release.payloadDigest, aggregate(candidate.release.files));
  assert.deepEqual(candidate.permissions, { securityEnabled: true, httpMods: ['hanaworlds_adapter'], trustedMods: [] });
  const mod = bytes(candidate.release.files[0]).toString('utf8');
  assert.match(mod, /^name\s*=\s*hanaworlds_adapter\s*$/m);
  assert.equal(candidate.origin.license, 'MIT'); assert.equal(candidate.origin.version, candidate.release.adapterVersion);
});

test('scoped create really installs every literal provider-issued byte without deriving expected from its manifest', async t => {
  const f = await fixture(t);
  for (const row of candidate.release.files) {
    const actual = await fs.readFile(join(f.world.worldPath, row.relativePath));
    assert.deepEqual(actual, bytes(row), `created ${row.name} differs from independent candidate`);
    assert.equal(sha(actual), row.sha256);
  }
  const manifest = JSON.parse(await fs.readFile(join(f.world.payloadPath, 'payload.json'), 'utf8'));
  keys(manifest, ['worldRef', 'payloadVersion', 'payloadDigest']);
  assert.deepEqual(manifest, { worldRef: f.world.worldRef,
    payloadVersion: candidate.release.payloadVersion, payloadDigest: candidate.release.payloadDigest });
  assert.deepEqual(f.actions, []);
});

test('real provider read returns complete closed release bytes bound to this source world connection and directory', async t => {
  const f = await fixture(t), out = await read(f); assert.equal(out.error, null);
  materialShape(out.result);
  const st = await fs.lstat(f.world.worldPath, { bigint: true });
  const describe = await f.scoped(f.d.source, 'describeSourceWorld', { worldRef: f.world.worldRef });
  assert.deepEqual(out.result, { source: f.d.source, worldRef: f.world.worldRef,
    connectionRef: describe.sourceLocator.connectionRef, directory: { device: String(st.dev), inode: String(st.ino) },
    release: candidate.release, origin: candidate.origin, permissions: candidate.permissions });
  assert.deepEqual(out.result.release.files.map(row => row.name), NAMES);
  assert.equal(aggregate(out.result.release.files), candidate.release.payloadDigest);
  for (const row of out.result.release.files) assert.deepEqual(await fs.readFile(join(f.world.worldPath, row.relativePath)), bytes(row));
  assert.deepEqual((await f.descriptor()).source, f.d.source);
});

test('separate release entry does not extend existing descriptor locator startup KNOWN identity or five scoped operations', async t => {
  const f = await fixture(t); await read(f);
  const d = await f.descriptor(); keys(d, ['source', 'contractVersions', 'discoveryInput', 'templates']);
  const description = await f.audit(() => f.scoped(d.source, 'describeSourceWorld', { worldRef: f.world.worldRef }));
  keys(description, ['worldRef', 'sourceLocator', 'sourceStartupFacts']);
  keys(description.sourceLocator, ['locatorVersion', 'worldRef', 'connectionRef', 'worldPath', 'worldRoot', 'userPath', 'directory', 'gameId', 'payload']);
  keys(description.sourceLocator.payload, ['status', 'payloadVersion', 'payloadDigest']);
  keys(description.sourceStartupFacts, ['profileVersion', 'availability', 'connection', 'runtimeSettings']);
  keys(description.sourceStartupFacts.connection, ['worldRef', 'connectionRef', 'payloadVersion', 'payloadDigest', 'directory']);
  keys(description.sourceStartupFacts.runtimeSettings, ['httpMods', 'trustedMods']);
  assert.equal(description.sourceStartupFacts.availability, 'KNOWN');
  const q = ask({ source: d.source, operation: 'readSourceReleaseMaterials', payload: { worldRef: f.world.worldRef } });
  await f.audit(async () => denied(q, await f.entry('callScoped')(q), 'SCHEMA_INVALID', 'INVALID_SHAPE'));
});

test('child creation keeps source generation and immutable release identity while each world binding differs', async t => {
  const f = await fixture(t), first = await read(f); assert.equal(first.error, null);
  const second = await f.create(f.d.source, 'Second legal child');
  assert.deepEqual((await f.descriptor()).source, f.d.source);
  const other = await read(f, f.request(f.d.source, second.worldRef)); assert.equal(other.error, null);
  assert.deepEqual(other.result.release, first.result.release); assert.deepEqual(other.result.origin, first.result.origin);
  assert.notEqual(other.result.worldRef, first.result.worldRef); assert.notEqual(other.result.connectionRef, first.result.connectionRef);
  assert.notDeepEqual(other.result.directory, first.result.directory);
});

test('transport instance bytes and credentials are excluded from immutable release and response', async t => {
  const f = await fixture(t), secret = 'TEST_ONLY_NEVER_PUBLISH_TRANSPORT_SECRET';
  await fs.writeFile(join(f.world.payloadPath, 'transport.json'), JSON.stringify({ token: secret, port: 12345 }));
  const out = await read(f); assert.equal(out.error, null); assert.deepEqual(out.result.release, candidate.release);
  assert.equal(JSON.stringify(out).includes(secret), false);
  assert.equal(out.result.release.files.some(row => row.name === 'transport.json' || row.name === 'payload.json'), false);
});

test('unknown world returns correlated WORLD_NOT_FOUND without a substitute', async t => {
  const f = await fixture(t); await rejected(f, 'WORLD_NOT_FOUND', undefined, f.request(f.d.source, 'world:unknown'));
});

for (const mode of ['cross-source', 'expired-instance', 'extra-request', 'extra-source', 'extra-permissions',
  'extra-httpMods', 'extra-trustedMods', 'extra-release', 'extra-worldPath', 'bad-version', 'missing-source', 'missing-worldRef'])
  test(`release request rejects ${mode} with closed correlated NONE refusal`, async t => {
    const f = await fixture(t), q = plain(f.q); let code = 'CURRENT_WORLD_MISMATCH', reason;
    if (mode === 'cross-source') q.source.sourceRef += ':other';
    else if (mode === 'expired-instance') q.source.instanceRef += ':stale';
    else if (mode.startsWith('extra-')) {
      code = 'UNKNOWN_REQUIRED_FIELD'; reason = 'INVALID_SHAPE';
      if (mode === 'extra-source') q.source.unexpected = true;
      else q[mode.slice(6)] = mode === 'extra-permissions' ? { securityEnabled: false, httpMods: ['evil'], trustedMods: ['evil'] } : ['evil'];
    } else if (mode === 'bad-version') { q.contractVersion = 'local-worlds/v3'; code = 'PAYLOAD_VERSION_MISMATCH'; reason = 'VERSION_UNSUPPORTED'; }
    else { delete q[mode.slice(8)]; code = 'SCHEMA_INVALID'; reason = 'INVALID_SHAPE'; }
    await rejected(f, code, reason, q);
  });

test('uncorrelatable release request rejects instead of inventing a request id', async t => {
  const f = await fixture(t), q = plain(f.q); delete q.requestId;
  await f.audit(() => assert.rejects(f.entry('readSourceReleaseMaterials')(q), error => {
    assert.equal(error.publicError.code, 'SCHEMA_INVALID'); assert.equal(error.publicError.mutationState, 'NONE'); return true;
  }));
});

for (const mode of ['raw-port', 'detached-method', 'forged-receiver', 'foreign-root'])
  test(`release authority refuses ${mode} even with genuine current JSON source`, async t => {
    const f = await fixture(t), port = f.local(), method = port.readSourceReleaseMaterials;
    assert.equal(typeof method, 'function', 'Adapter must supply readSourceReleaseMaterials for independent startup byte verification');
    const raw = port[symbols.original] ?? port, foreign = new Context();
    try {
      if (mode === 'foreign-root') {
        foreign.provide('hanaworldsLocalWorlds', raw);
        await f.audit(async () => denied(f.q, await foreign.get('hanaworldsLocalWorlds').readSourceReleaseMaterials(f.q), 'CURRENT_WORLD_MISMATCH'));
      } else {
        const receiver = mode === 'raw-port' ? raw : mode === 'detached-method' ? undefined : { ctx: f.consumer };
        await f.audit(async () => denied(f.q, await method.call(receiver, f.q), 'CURRENT_WORLD_MISMATCH'));
      }
    } finally { await foreign.fiber.dispose(); }
  });

test('captured release method refuses same-name service replacement and never redispatches', async t => {
  const f = await fixture(t), call = f.entry('readSourceReleaseMaterials');
  replace(f.owner, 'hanaworldsLocalWorlds', { readSourceReleaseMaterials() { assert.fail('replacement must never inherit authority'); } });
  await f.audit(async () => denied(f.q, await call(f.q), 'CURRENT_WORLD_MISMATCH'));
});

test('captured release method refuses a closed Adapter as ADAPTER_UNAVAILABLE', async t => {
  const f = await fixture(t), call = f.entry('readSourceReleaseMaterials'); await f.service.close();
  await f.audit(async () => denied(f.q, await call(f.q), 'ADAPTER_UNAVAILABLE'));
});

for (const mode of ['setRoots', 'physical-root-replacement'])
  test(`release binding expires across ${mode} while path/namespace can remain the same`, async t => {
    const f = await fixture(t), call = f.entry('readSourceReleaseMaterials');
    if (mode === 'setRoots') await f.local().setRoots({ roots: [f.worlds] });
    else { await fs.rename(f.worlds, join(f.user, 'old-worlds')); await fs.mkdir(f.worlds); }
    await f.audit(async () => denied(f.q, await call(f.q), 'CURRENT_WORLD_MISMATCH'));
    const current = await f.descriptor(); assert.notEqual(current.source.instanceRef, f.d.source.instanceRef);
  });

const mutations = {
  'missing installed engine file': async f => fs.rm(join(f.world.payloadPath, 'engine.lua')),
  'installed byte altered without manifest update': async f => fs.appendFile(join(f.world.payloadPath, 'engine.lua'), '\n-- unauthorized\n'),
  'installed byte altered with self-rehashed world manifest': async f => {
    await fs.appendFile(join(f.world.payloadPath, 'engine.lua'), '\n-- world self-claim\n'); await selfRehash(f);
  },
  'payloadVersion only changed': async f => identity(f, value => { value.payloadVersion = '0.14.1'; }),
  'payloadDigest only changed': async f => identity(f, value => { value.payloadDigest = 'a'.repeat(64); }),
  'mod.conf identity changed and self-rehashed': async f => {
    const path = join(f.world.payloadPath, 'mod.conf');
    await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace(/^name\s*=.*$/m, 'name = unauthorized_mod')); await selfRehash(f);
  },
  'unlisted payload file': async f => fs.writeFile(join(f.world.payloadPath, 'unreviewed.lua'), '-- extra'),
  'unlisted payload directory': async f => fs.mkdir(join(f.world.payloadPath, 'unreviewed')),
  'payload file symbolic link to matching bytes': async f => {
    const path = join(f.world.payloadPath, 'engine.lua'), target = join(f.root, 'matching-engine.lua');
    await fs.rename(path, target); await fs.symlink(target, path);
  },
  'payload directory symbolic link to matching bytes': async f => {
    const target = join(f.root, 'matching-payload'); await fs.rename(f.world.payloadPath, target); await fs.symlink(target, f.world.payloadPath);
  },
  'identity extra release field': async f => identity(f, value => { value.release = candidate.release; }),
  'identity extra HTTP permission': async f => identity(f, value => { value.httpMods = ['hanaworlds_adapter', 'evil']; }),
  'identity extra trusted permission': async f => identity(f, value => { value.trustedMods = ['evil']; }),
};
for (const [name, mutate] of Object.entries(mutations))
  test(`release materials reject ${name} without installing repairing or native work`, async t => {
    const f = await fixture(t); await mutate(f);
    await rejected(f, name.startsWith('identity extra') ? 'UNKNOWN_REQUIRED_FIELD' : 'PAYLOAD_VERSION_MISMATCH',
      name.startsWith('identity extra') ? 'INVALID_SHAPE' : 'VERSION_UNSUPPORTED');
  });

// Every release member is independently indispensable; engine.lua also has the
// baseline and self-rehashed mutations above. Neither hashes nor manifest claims
// permit one file's bytes to stand in for another release member.
for (const name of NAMES.filter(name => name !== 'engine.lua')) {
  test(`release rejects missing ${name} against literal complete ordered release`, async t => {
    const f = await fixture(t); await fs.rm(join(f.world.payloadPath, name));
    await rejected(f, 'PAYLOAD_VERSION_MISMATCH', 'VERSION_UNSUPPORTED');
  });
  test(`release rejects changed ${name} even when world self-rehashes all installed members`, async t => {
    const f = await fixture(t); await fs.appendFile(join(f.world.payloadPath, name), '\nUNREVIEWED_BYTES\n');
    await selfRehash(f); await rejected(f, 'PAYLOAD_VERSION_MISMATCH', 'VERSION_UNSUPPORTED');
  });
}

for (const mode of ['registration', 'world-directory'])
  test(`release refuses ${mode} replacement while actual installed payload bytes await return`, async t => {
    const f = await fixture(t), call = f.entry('readSourceReleaseMaterials');
    let enter, release, intercepted = false;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const target = join(f.world.payloadPath, 'engine.lua');
    async function hold(path, run) {
      const result = await run();
      if (String(path) === target && !intercepted) { intercepted = true; enter(); await gate; }
      return result;
    }
    const readFile = fs.readFile, open = fs.open;
    const patchedRead = t.mock.method(fs, 'readFile', (path, ...args) => hold(path, () => readFile(path, ...args)));
    const handles = [];
    const patchedOpen = t.mock.method(fs, 'open', async (path, ...args) => {
      const handle = await open(path, ...args);
      if (String(path) === target) {
        const method = handle.readFile.bind(handle);
        handles.push(t.mock.method(handle, 'readFile', (...options) => hold(path, () => method(...options))));
      }
      return handle;
    }); syncBuiltinESMExports();
    let before;
    try {
      const pending = call(f.q);
      await Promise.race([entered, pending.then(() => assert.fail('release read must validate actual installed payload bytes'))]);
      if (mode === 'registration') replace(f.owner, 'hanaworldsLocalWorlds', {});
      else { await fs.rename(f.world.worldPath, join(f.root, 'replaced-after-bytes'));
        await fs.cp(join(f.root, 'replaced-after-bytes'), f.world.worldPath, { recursive: true }); }
      before = await files(f.root); release(); denied(f.q, await pending, 'CURRENT_WORLD_MISMATCH');
      assert.equal(intercepted, true);
    } finally {
      release(); for (const handle of handles) handle.mock.restore();
      patchedRead.mock.restore(); patchedOpen.mock.restore(); syncBuiltinESMExports();
    }
    assert.deepEqual(await files(f.root), before); assert.deepEqual(f.actions, []);
  });

for (const mode of ['registration', 'world-directory'])
  test(`release currency is rechecked after awaited filesystem observation: ${mode} change`, async t => {
    const f = await fixture(t), call = f.entry('readSourceReleaseMaterials');
    let enter, release, intercepted = false;
    const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const lstat = fs.lstat;
    const patched = t.mock.method(fs, 'lstat', async (path, ...args) => {
      if (path === (mode === 'registration' ? f.worlds : f.world.worldPath) && !intercepted) {
        const captured = await lstat(path, ...args); intercepted = true; enter(); await gate; return captured;
      }
      return lstat(path, ...args);
    }); syncBuiltinESMExports();
    let before;
    try {
      const pending = call(f.q);
      await Promise.race([entered, pending.then(() => assert.fail('release read must observe actual current root identity'))]);
      if (mode === 'registration') replace(f.owner, 'hanaworldsLocalWorlds', {});
      else { await fs.rename(f.world.worldPath, join(f.root, 'replaced-old-world'));
        await fs.cp(join(f.root, 'replaced-old-world'), f.world.worldPath, { recursive: true }); }
      before = await files(f.root); release(); denied(f.q, await pending, 'CURRENT_WORLD_MISMATCH');
      assert.equal(intercepted, true);
    } finally { release(); patched.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await files(f.root), before); assert.deepEqual(f.actions, []);
  });
