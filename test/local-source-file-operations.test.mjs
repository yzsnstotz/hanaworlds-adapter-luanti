// Q-265 / D-159: Node-only ordinary desktop file safety. No hostile same-account
// last-syscall-window guarantee, native helper, compiler, or loader is assumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import builtinFS from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { observeNodeRenames } from './support/local-source-node-observer.mjs';
import { filesFixture, tree, identity, recordError } from './support/local-source-file-probe.mjs';
const ADAPTER_ROOT = process.env.SOURCE_FILE_ADAPTER_ROOT ?? fileURLToPath(new URL('../src/', import.meta.url));
const { removeWorldDirectory } = await import(pathToFileURL(join(ADAPTER_ROOT, 'local-world-deletion.mjs')).href);
const { withSourceScope, bindSourceWorld } = await import(pathToFileURL(join(ADAPTER_ROOT, 'source-scope.mjs')).href);
const remove = (f, check = f.checkRoot, world = f.target) => withSourceScope(check, async () => {
  bindSourceWorld(world); await removeWorldDirectory(world);
});
function watch(t, f, after = () => {}) {
  return observeNodeRenames(t, event => { f.moves.push(event); return after(event); });
}
async function absent(path) { await assert.rejects(fs.lstat(path), e => e.code === 'ENOENT'); }
async function noStages(f) { assert.deepEqual((await fs.readdir(f.worlds)).filter(n => n.startsWith('.hanaworlds-deleting-')), []); }
function assertOriginal(error, original) {
  assert.equal(error, original, 'a failed operation preserves the exact original error object');
  assert.equal(error.cause, original.cause, 'the original cause remains intact');
  assert.equal(error.mutationState, 'UNKNOWN', 'a real move cannot be described as NONE');
}

test('Node helper normally removes the exact target with genuine Node file movement', async t => {
  const f = await filesFixture(t), restore = watch(t, f);
  try { await remove(f); } finally { restore(); }
  assert.ok(f.moves.some(e => e.from === f.target.worldPath && dirname(e.to) === f.worlds), 'normal deletion actually executes a Node rename');
  await absent(f.target.worldPath); await f.checkNeighbour(); await noStages(f);
});

for (const field of ['device', 'inode']) test(`Node helper refuses a forged ${field} before any move`, async t => {
  const f = await filesFixture(t), restore = watch(t, f);
  let failure;
  try { await remove(f, f.checkRoot, { ...f.target, [field]: -1 }); } catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.equal(failure?.message, 'CURRENT_WORLD_MISMATCH');
  assert.ok(!failure.mutationState || failure.mutationState === 'NONE');
  assert.deepEqual(f.moves, []); assert.deepEqual(await tree(f.target.worldPath), f.before);
  await f.checkNeighbour(); await noStages(f);
});

test('Node helper refuses an observed replaced source root with both roots preserved', async t => {
  const f = await filesFixture(t), saved = join(f.parent, 'Saved-worlds');
  await fs.rename(f.worlds, saved); await fs.mkdir(f.worlds); await fs.writeFile(join(f.worlds, 'replacement.txt'), 'replacement root');
  const held = await tree(saved), replacement = await tree(f.worlds), restore = watch(t, f);
  let failure; try { await remove(f); } catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.equal(failure?.message, 'CURRENT_WORLD_MISMATCH');
  assert.deepEqual(f.moves, []); assert.deepEqual(await tree(saved), held); assert.deepEqual(await tree(f.worlds), replacement);
});

test('Node helper refuses a world directory symlink without following or removing its target', async t => {
  const f = await filesFixture(t), saved = join(f.worlds, 'Saved-target');
  await fs.rename(f.target.worldPath, saved); await fs.symlink(saved, f.target.worldPath, 'dir');
  const link = await tree(f.target.worldPath), restore = watch(t, f);
  let failure; try { await remove(f); } catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.equal(failure?.message, 'CURRENT_WORLD_MISMATCH');
  assert.deepEqual(f.moves, []); assert.deepEqual(await tree(saved), f.before); assert.deepEqual(await tree(f.target.worldPath), link);
  await f.checkNeighbour(); await noStages(f);
});

for (const nonempty of [false, true]) test(`Node helper refuses a staging destination observed ${nonempty ? 'nonempty' : 'empty'} at its await check`, async t => {
  const f = await filesFixture(t), actual = fs.lstat; let occupied, destination, observed = false;
  const hook = t.mock.method(fs, 'lstat', async function(path, options) {
    if (!observed && dirname(String(path)) === f.worlds && String(path).includes('.hanaworlds-deleting-')) {
      observed = true; destination = String(path); await fs.mkdir(destination);
      if (nonempty) await fs.writeFile(join(destination, 'occupied.txt'), 'other owner');
      occupied = await tree(destination);
    }
    return actual.call(this, path, options);
  }); syncBuiltinESMExports();
  const restore = watch(t, f); let failure;
  try { await remove(f); } catch (e) { failure = e; } finally { restore(); hook.mock.restore(); syncBuiltinESMExports(); }
  recordError(f, failure);
  assert.equal(observed, true, 'Adapter checks staging destination before moving the world');
  assert.ok(failure, 'observed occupied destination refuses deletion');
  assert.ok(!failure.mutationState || failure.mutationState === 'NONE');
  assert.deepEqual(f.moves, []); assert.deepEqual(await tree(f.target.worldPath), f.before);
  assert.deepEqual(await tree(destination), occupied); await f.checkNeighbour();
});

test('Node helper recovers actual completed rename and preserves an EIO object and its cause', async t => {
  const f = await filesFixture(t), cause = new Error('original IO cause'), original = Object.assign(new Error('EIO after actual move', { cause }), { code: 'EIO' });
  const restore = watch(t, f, event => { if (event.from === f.target.worldPath) throw original; });
  let failure; try { await remove(f); } catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.ok(f.moves.some(e => e.from === f.target.worldPath)); assertOriginal(failure, original);
  assert.deepEqual(await tree(f.target.worldPath), f.before); await f.checkNeighbour(); await noStages(f);
});

test('Node helper recovers exact directory after a real move loses its source authority', async t => {
  const f = await filesFixture(t), original = new Error('CURRENT_WORLD_MISMATCH', { cause: new Error('registration revoked') }); let revoked = false;
  const restore = watch(t, f, event => { if (event.from === f.target.worldPath) revoked = true; });
  let failure; try { await remove(f, async () => { if (revoked) throw original; await f.checkRoot(); }); }
  catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.ok(revoked); assertOriginal(failure, original);
  assert.deepEqual(await tree(f.target.worldPath), f.before); await f.checkNeighbour(); await noStages(f);
});

for (const nonempty of [false, true]) test(`Node compensation preserves a new ${nonempty ? 'nonempty' : 'empty'} target and reports actual named residue`, async t => {
  const f = await filesFixture(t), original = new Error('CURRENT_WORLD_MISMATCH', { cause: new Error('source registration lost') });
  let revoked = false, occupant;
  const restore = watch(t, f, event => {
    if (event.from === f.target.worldPath) {
      builtinFS.mkdirSync(f.target.worldPath);
      if (nonempty) builtinFS.writeFileSync(join(f.target.worldPath, 'new-owner.txt'), 'new owner bytes');
      occupant = identity(builtinFS.lstatSync(f.target.worldPath, { bigint: true })); revoked = true;
    }
  });
  let failure; try { await remove(f, async () => { if (revoked) throw original; await f.checkRoot(); }); }
  catch (e) { failure = e; } finally { restore(); }
  recordError(f, failure); assert.ok(revoked); assertOriginal(failure, original);
  assert.deepEqual(identity(await fs.lstat(f.target.worldPath, { bigint: true })), occupant);
  if (nonempty) assert.equal(await fs.readFile(join(f.target.worldPath, 'new-owner.txt'), 'utf8'), 'new owner bytes');
  assert.equal(failure.details?.recoveryReason, 'TARGET_OCCUPIED');
  const residue = failure.details?.residuePath; assert.equal(typeof residue, 'string'); assert.equal(dirname(residue), f.worlds);
  assert.deepEqual(await tree(residue), f.before); await f.checkNeighbour();
  assert.equal(f.moves.filter(e => e.to === f.target.worldPath).length, 0, 'recovery cannot move over an observed new target');
});

test('Node removal failure after a genuine unlink reports PARTIAL or UNKNOWN and the actual residue with the original cause', async t => {
  const f = await filesFixture(t), actualRm = fs.rm, original = Object.assign(new Error('EIO after actual partial rm', { cause: new Error('underlying IO failure') }), { code: 'EIO' });
  let changed = false;
  const hook = t.mock.method(fs, 'rm', async function(path, options) {
    if (dirname(String(path)) === f.worlds && String(path).includes('.hanaworlds-deleting-')) {
      await fs.unlink(join(String(path), 'original.txt')); changed = true; throw original;
    }
    return actualRm.call(this, path, options);
  }); syncBuiltinESMExports(); const restore = watch(t, f); let failure;
  try { await remove(f); } catch (e) { failure = e; } finally { restore(); hook.mock.restore(); syncBuiltinESMExports(); }
  recordError(f, failure); assert.equal(changed, true, 'an actual file was removed before the IO error');
  assert.ok(failure === original || failure?.cause === original, 'the full original IO error and its own cause must be retained');
  assert.ok(['PARTIAL', 'UNKNOWN'].includes(failure?.mutationState));
  const residue = failure.details?.residuePath; assert.equal(typeof residue, 'string'); assert.equal(dirname(residue), f.worlds);
  await absent(join(residue, 'original.txt')); assert.equal(await fs.readFile(join(residue, 'world.mt'), 'utf8'), 'gameid = fixture\n');
  await f.checkNeighbour();
});

test('competing real helper deletions move one target at most once and preserve its neighbour', async t => {
  const f = await filesFixture(t), restore = watch(t, f);
  let results; try { results = await Promise.allSettled([remove(f), remove(f)]); } finally { restore(); }
  f.results = results.map(r => ({ status: r.status, reason: r.reason?.message }));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(f.moves.filter(e => e.from === f.target.worldPath).length, 1);
  await absent(f.target.worldPath); await f.checkNeighbour(); await noStages(f);
});

// Source invocation alone prepares the real own artifact. Installed child runs
// execute the SAME business assertions above, without recursive preparation.
if (!process.env.SOURCE_FILE_ADAPTER_ROOT) {
  const packageTools = await import('./support/local-source-package-preparation.mjs');
  const { prepareSourcePackage, observe, sourceRoot, evidenceRoot, cleanEnv } = packageTools;
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { verifyPackage } = await import('../scripts/package-boundary.mjs');
  const { default: ts } = await import('typescript');
  const { resolve } = await import('node:path');
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  function childSuite(name, variables) {
    const p = prepareSourcePackage();
    const out = spawnSync(process.execPath, ['--test', `test/${name}.test.mjs`], {
      cwd: p.consumer, encoding: 'utf8', env: { ...cleanEnv, PATH: dirname(process.execPath), ...variables(p) }
    });
    const output = `${out.stdout ?? ''}${out.stderr ?? ''}`;
    builtinFS.writeFileSync(join(evidenceRoot, `installed-${name}.log`), `${output}\nEXIT=${out.status}\n`);
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module|recursively within a test file|skipping running files/);
    assert.match(output, /(?:ℹ tests|# tests) [1-9][0-9]*/, 'normally installed own suite actually executes');
    assert.equal(out.status, 0, `INSTALLED_${name.toUpperCase().replaceAll('-', '_')}_BUSINESS_FAILURE: inspect actual child log`);
  }
  test('normal installed public source passes the full independent release materials suite', () => {
    childSuite('source-release-materials', p => ({ SOURCE_RELEASE_ADAPTER_URL: pathToFileURL(join(p.installed, 'dist/runtime/index.mjs')).href,
      SOURCE_RELEASE_RUN: resolve(sourceRoot, '..') }));
  });
  test('normal installed public Node deletion preserves all ordinary timing/compensation assertions', () => {
    childSuite('local-source-deletion-race', p => ({ SOURCE_RACE_ADAPTER_ROOT: join(p.installed, 'dist/runtime'),
      SOURCE_RACE_RUN: resolve(sourceRoot, '..') }));
  });
  test('normal installed own Node file helpers preserve full success/failure/identity/occupancy assertions', () => {
    childSuite('local-source-file-operations', p => ({ SOURCE_FILE_ADAPTER_ROOT: join(p.installed, 'dist/runtime'),
      SOURCE_FILE_RUN: resolve(sourceRoot, '..') }));
  });
  function releaseFixture(p) {
    const pkg = JSON.parse(builtinFS.readFileSync(join(p.extracted, 'package.json')));
    const exportPath = pkg.exports?.['./fixtures/source-release-materials.json'];
    assert.equal(exportPath, './fixtures/source-release-materials.json', 'SOURCE_RELEASE_ARTIFACT_MISSING: normal tgz must export fixed independent release bytes');
    const expected = JSON.parse(builtinFS.readFileSync(join(sourceRoot, 'test/fixtures/source-release-materials.json')));
    const actual = JSON.parse(builtinFS.readFileSync(join(p.extracted, exportPath)));
    assert.deepEqual(actual, { release: expected.release, origin: expected.origin, permissions: expected.permissions });
    assert.deepEqual(actual.permissions, { securityEnabled: true, httpMods: ['hanaworlds_adapter'], trustedMods: [] });
    assert.equal(actual.origin.license, 'MIT');
    return exportPath;
  }
  test('normal actual tgz public release fixture has all literal bytes, origin, licence and least permissions', () => {
    releaseFixture(prepareSourcePackage());
  });
  for (const mutation of ['missing', 'modified', 'rehashed', 'origin-modified', 'permissions-modified'])
    test(`actual packed source rejects ${mutation} release materials without any world/runtime actions`, () => {
      const p = prepareSourcePackage(), exportPath = releaseFixture(p);
      // Each candidate gets a complete normal production installation. An
      // extracted copy plus the consumer's top-level node_modules loses pnpm's
      // package dependency context before the Adapter can inspect its materials.
      const caseRoot = builtinFS.mkdtempSync(join(evidenceRoot, `release-${mutation}-`));
      const env = { ...cleanEnv, HOME: join(caseRoot, 'home'), XDG_CONFIG_HOME: join(caseRoot, 'config'),
        TMPDIR: join(caseRoot, 'tmp'), npm_config_cache: join(caseRoot, 'npm-cache') };
      for (const directory of [env.HOME, env.XDG_CONFIG_HOME, env.TMPDIR]) builtinFS.mkdirSync(directory);
      builtinFS.writeFileSync(join(caseRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      observe(`source-release-install-${mutation}`, process.execPath,
        [join(p.checkout, 'node_modules/pnpm/bin/pnpm.cjs'), 'install', '--prod', '--store-dir', join(caseRoot, 'store'),
          p.packed, '@deepseek-ai/cordis@4.0.4'], caseRoot, env);
      const pkg = JSON.parse(builtinFS.readFileSync(join(p.extracted, 'package.json')));
      const candidate = builtinFS.realpathSync(join(caseRoot, 'node_modules', pkg.name));
      verifyPackage(candidate);
      assert.deepEqual(JSON.parse(builtinFS.readFileSync(join(candidate, exportPath))),
        JSON.parse(builtinFS.readFileSync(join(p.extracted, exportPath))));
      const publicControl = join(caseRoot, 'public-source-control.mjs');
      builtinFS.writeFileSync(publicControl, `import assert from 'node:assert/strict';
import {apply} from '${pkg.name}';
import materials from '${pkg.name}/fixtures/source-release-materials.json' with {type:'json'};
assert.equal(typeof apply,'function');
assert.deepEqual(Object.keys(materials).sort(),['origin','permissions','release']);
console.log(JSON.stringify({adapterURL:import.meta.resolve('${pkg.name}')}));\n`);
      const { adapterURL } = JSON.parse(observe(`source-release-public-control-${mutation}`, process.execPath,
        [publicControl], caseRoot, { ...env, PATH: dirname(process.execPath) }));
      assert.equal(adapterURL, pathToFileURL(join(candidate, pkg.exports['.'].import)).href);
      const file = join(candidate, exportPath), value = JSON.parse(builtinFS.readFileSync(file));
      if (mutation === 'missing') builtinFS.rmSync(file);
      else {
        if (mutation === 'origin-modified') value.origin.sourceUrl = 'https://invalid.example/untrusted';
        else if (mutation === 'permissions-modified') value.permissions.trustedMods = ['untrusted'];
        else {
          const member = value.release.files.find(row => row.name === 'engine.lua');
          member.bytesBase64 = Buffer.concat([Buffer.from(member.bytesBase64, 'base64'), Buffer.from('\n-- unauthorized\n')]).toString('base64');
          if (mutation === 'rehashed') {
            const digest = createHash('sha256');
            for (const row of value.release.files) {
              const bytes = Buffer.from(row.bytesBase64, 'base64'); row.byteLength = bytes.length; row.sha256 = sha256(bytes);
              digest.update(row.name + '\n'); digest.update(bytes);
            }
            value.release.payloadDigest = digest.digest('hex');
          }
        }
        builtinFS.writeFileSync(file, JSON.stringify(value));
        if (mutation === 'rehashed') {
          const metaPath = join(candidate, 'dist/runtime-build.json'), meta = JSON.parse(builtinFS.readFileSync(metaPath));
          meta.sha256[exportPath.replace(/^\.\//, '')] = sha256(builtinFS.readFileSync(file));
          builtinFS.writeFileSync(metaPath, JSON.stringify(meta));
        }
      }
      observe(`source-release-artifact-${mutation}`, process.execPath,
        [join(p.consumer, 'test/support/source-release-package-probe.mjs'), JSON.stringify({ evidencePath: join(caseRoot, 'refusal.json') })],
        p.consumer, { ...env, PATH: dirname(process.execPath),
          SOURCE_RELEASE_ADAPTER_URL: adapterURL,
          SOURCE_RELEASE_RUN: resolve(sourceRoot, '..') });
    });
  function nodePolicy(root) {
    function walk(path) {
      for (const entry of builtinFS.readdirSync(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) walk(file);
        else {
          assert.ok(!/\.node$/.test(file) && !/source-atomic-(?:native|move)|d154-replacement-native/.test(file), 'WITHDRAWN_NATIVE_ARTIFACT: only existing Node file operations');
          if (!/\.(?:mjs|cjs|js)$/.test(file)) continue;
          const ast = ts.createSourceFile(file, builtinFS.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
          assert.deepEqual(ast.parseDiagnostics, []);
          function inspect(n) {
            if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, 'dlopen', 'NODE_ROUTE_NATIVE_LOADER_FORBIDDEN');
            ts.forEachChild(n, inspect);
          }
          inspect(ast);
        }
      }
    }
    walk(root);
  }
  test('normal installed Node route keeps original finite package audit and introduces no native artifact/loader or OS/CPU filter', () => {
    const p = prepareSourcePackage(); verifyPackage(p.extracted); nodePolicy(p.extracted);
  });
  test('packed Node policy rejects a self-rehashed native loader injection while the original SDK audit stays closed', () => {
    const p = prepareSourcePackage(), caseRoot = builtinFS.mkdtempSync(join(evidenceRoot, 'node-policy-'));
    const candidate = join(caseRoot, 'package'); builtinFS.cpSync(p.extracted, candidate, { recursive: true });
    const path = 'dist/runtime/local-world-deletion.mjs', file = join(candidate, path);
    builtinFS.appendFileSync(file, "\nprocess.dlopen({exports:{}}, '/tmp/foreign.node');\n");
    const metaPath = join(candidate, 'dist/runtime-build.json'), meta = JSON.parse(builtinFS.readFileSync(metaPath));
    meta.sha256[path] = sha256(builtinFS.readFileSync(file)); builtinFS.writeFileSync(metaPath, JSON.stringify(meta));
    assert.throws(() => nodePolicy(candidate), /NODE_ROUTE_NATIVE_LOADER_FORBIDDEN/);
    const sdk = join(candidate, 'dist/runtime/sdk-probe.mjs');
    builtinFS.writeFileSync(sdk, "import 'hanaworlds-contracts';\n");
    assert.throws(() => verifyPackage(candidate), /CONTRACT_RUNTIME_LOAD/);
  });
}
