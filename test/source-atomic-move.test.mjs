// Q-250 design/RED only: this file proves OWN primitive behavior separately from
// world guards, and uses normally built/packed/installed production bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { verifyPackage } from '../scripts/package-boundary.mjs';
import { requireMover } from './support/source-atomic-probe.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const evidenceRoot = resolve(root, '../tmp/source-atomic-q250');
fs.mkdirSync(evidenceRoot, { recursive: true });
const helper = fileURLToPath(new URL('./support/source-atomic-probe.mjs', import.meta.url));
const sourceModule = join(root, 'src/source-atomic-move.mjs');
const loaderRelative = 'dist/runtime/source-atomic-native.mjs';
const manifestRelative = 'dist/native/source-atomic/release.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_config_|PNPM_|NODE_PATH$|NODE_OPTIONS$|NODE_TEST_|HW_)/i.test(k)));
const execute = (args, cwd, env = cleanEnv) => execFileSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function observe(label, file, args, cwd, env = cleanEnv) {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8' });
  fs.writeFileSync(join(evidenceRoot, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}\nEXIT=${result.status}\n`);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.error?.message || result.stdout}`);
  return result.stdout;
}
function childProbe(t, modulePath, scenario, label) {
  const caseRoot = fs.mkdtempSync(join(evidenceRoot, `${label}-`));
  const output = observe(label, process.execPath, [helper, '--probe', JSON.stringify({ modulePath, scenario, caseRoot })], caseRoot,
    { ...cleanEnv, PATH: dirname(process.execPath) });
  const receipt = JSON.parse(output.trim());
  assert.equal(receipt.proven, true);
  t.diagnostic(`actual OWN syscall/tree evidence ${join(caseRoot, 'receipt.json')}`);
  return receipt;
}

test('OWN atomic mover capability must be present rather than module-load setup failure', async () => {
  await requireMover(sourceModule);
});
for (const scenario of ['success', 'occupied-empty', 'occupied-nonempty', 'parent-replaced', 'parent-symlink',
  'source-replaced', 'post-source-replaced', 'post-target-replaced', 'native-error-after-move', 'identity-mismatch', 'invalid-name', 'closed',
  'commit-source-replaced', 'commit-parent-replaced', 'commit-source-replaced-occupied', 'commit-parent-replaced-occupied']) {
  test(`real primitive ${scenario} on actual current target volume`, t => {
    childProbe(t, sourceModule, scenario, `source-${scenario}`);
  });
}

// One fresh preparation shared by all artifact cases; failures stay normal test
// assertions and are never converted to skip or an always-refusing green result.
let prepared;
function preparePackage() {
  if (prepared) return prepared;
  const archiveRoot = fs.mkdtempSync(join(evidenceRoot, 'normal-package-'));
  const checkout = join(archiveRoot, 'checkout'), consumer = join(archiveRoot, 'consumer');
  fs.mkdirSync(checkout); fs.mkdirSync(consumer);
  const tar = join(archiveRoot, 'source.tar');
  execute(['git', 'archive', '--format=tar', `--output=${tar}`, 'HEAD'], root);
  execute(['tar', '-xf', tar, '-C', checkout], archiveRoot);
  // Overlay the current uncommitted candidate, never dependencies/build output.
  const changed = execute(['git', 'diff', '--name-only', 'HEAD', '--'], root).trim().split('\n').filter(Boolean);
  const added = execute(['git', 'ls-files', '--others', '--exclude-standard'], root).trim().split('\n').filter(Boolean);
  for (const name of new Set([...changed, ...added])) {
    const from = join(root, name), to = join(checkout, name);
    assert.ok(!name.startsWith('..') && !/^(?:node_modules|dist)\//.test(name));
    if (fs.existsSync(from)) { fs.mkdirSync(dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
    else fs.rmSync(to, { force: true });
  }
  const npm = join(dirname(process.execPath), 'npm');
  const env = { ...cleanEnv, HOME: join(archiveRoot, 'home'), XDG_CONFIG_HOME: join(archiveRoot, 'config'),
    TMPDIR: join(archiveRoot, 'tmp'), npm_config_cache: join(archiveRoot, 'npm-cache') };
  fs.mkdirSync(env.HOME); fs.mkdirSync(env.TMPDIR); fs.mkdirSync(env.XDG_CONFIG_HOME);
  observe('normal-frozen-npm-ci', npm, ['ci'], checkout, env);
  observe('normal-npm-pack', npm, ['pack', '--pack-destination', archiveRoot], checkout, env);
  const pkg = JSON.parse(fs.readFileSync(join(checkout, 'package.json')));
  const packed = join(archiveRoot, `${pkg.name}-${pkg.version}.tgz`);
  assert.ok(fs.existsSync(packed), 'normal pack must produce actual release tgz');
  fs.writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const pnpm = join(checkout, 'node_modules/pnpm/bin/pnpm.cjs');
  assert.equal(execute([process.execPath, pnpm, '--version'], consumer, env).trim(), '11.28.5');
  observe('normal-default-production-pnpm-install', process.execPath,
    [pnpm, 'install', '--prod', '--store-dir', join(archiveRoot, 'store'), packed, '@deepseek-ai/cordis@4.0.4'], consumer, env);
  const installed = fs.realpathSync(join(consumer, 'node_modules', pkg.name));
  assert.doesNotMatch(fs.readFileSync(join(consumer, 'pnpm-lock.yaml'), 'utf8'), /esbuild|typescript|node-gyp|hanaworlds-contracts/);
  for (const builder of ['esbuild', 'typescript', 'node-gyp', 'pnpm'])
    assert.equal(fs.existsSync(join(consumer, 'node_modules', builder)), false, `production install must not need ${builder}`);
  const installedPkg = JSON.parse(fs.readFileSync(join(installed, 'package.json')));
  assert.deepEqual(installedPkg.os, pkg.os, 'must not silently narrow package platform declarations');
  assert.deepEqual(installedPkg.cpu, pkg.cpu);
  // Test the real public exported surface before selecting an internal packed path.
  const publicProbe = join(consumer, 'public-surface.mjs');
  fs.writeFileSync(publicProbe, `import assert from 'node:assert/strict';\nimport {apply} from '${pkg.name}';\nassert.equal(typeof apply,'function');\n`);
  observe('installed-public-source-surface', process.execPath, [publicProbe], consumer, { ...env, PATH: dirname(process.execPath) });
  const extracted = join(archiveRoot, 'extracted'); fs.mkdirSync(extracted);
  execute(['tar', '-xzf', packed, '-C', extracted], archiveRoot);
  for (const name of ['test/source-release-materials.test.mjs', 'test/support/source-release-fixture.mjs',
    'test/fixtures/source-release-materials.json', 'test/support/source-atomic-release-package-probe.mjs',
    'test/local-source-deletion-race.test.mjs', 'test/support/commit-boundary-observer.mjs']) {
    const to = join(consumer, name); fs.mkdirSync(dirname(to), { recursive: true });
    fs.copyFileSync(join(root, name), to);
  }
  prepared = { archiveRoot, checkout, consumer, installed, extracted: join(extracted, 'package'), packed };
  fs.writeFileSync(join(archiveRoot, 'platform-matrix.json'), JSON.stringify({
    evidenceLevel: 'PACKAGE_PREPARATION_ONLY',
    current: { platform: process.platform, arch: process.arch, node: process.version, status: 'ATOMIC_CAPABILITY_UNPROVEN' },
    packageOSConstraint: installedPkg.os ?? null,
    candidatePrimitives: { darwin: 'renameatx_np(RENAME_EXCL)', linux: 'renameat2(RENAME_NOREPLACE)', win32: 'handle-bound FileRenameInfo ReplaceIfExists=false' },
    unprovenPlatforms: ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'].filter(v => v !== process.platform),
    unresolved: 'No package OS constraint. Additional platforms/architectures/libc profiles require explicit PM disposition and real native release tests; no platform shrink inferred.'
  }, null, 2));
  return prepared;
}
test('normal installed public Adapter passes full independent SOURCE RELEASE materials suite', () => {
  const p = preparePackage(), env = { ...cleanEnv, PATH: dirname(process.execPath),
    SOURCE_RELEASE_ADAPTER_URL: pathToFileURL(join(p.installed, 'dist/runtime/index.mjs')).href,
    SOURCE_RELEASE_RUN: resolve(root, '..') };
  const result = spawnSync(process.execPath, ['--test', 'test/source-release-materials.test.mjs'], {
    cwd: p.consumer, env, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(join(evidenceRoot, 'installed-source-release-materials.log'), `${output}\nEXIT=${result.status}\n`);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/,
    'installed public release test must resolve normal dependencies');
  assert.doesNotMatch(output, /recursively within a test file|skipping running files/);
  assert.match(output, /(?:ℹ tests|# tests) [1-9][0-9]*/, 'actual installed SOURCE suite must execute tests');
  assert.equal(result.status, 0,
    'INSTALLED_SOURCE_RELEASE_CAPABILITY_MISSING: actual installed Adapter must pass complete readSourceReleaseMaterials SOURCE suite; inspect installed-source-release-materials.log');
});
test('D-154 normal installed public delete and compensation run the same native final-check races', () => {
  const p = preparePackage();
  const result = spawnSync(process.execPath, ['--test', 'test/local-source-deletion-race.test.mjs'], {
    cwd: p.consumer, encoding: 'utf8', env: { ...cleanEnv, PATH: dirname(process.execPath),
      SOURCE_RACE_ADAPTER_ROOT: join(p.installed, 'dist/runtime'), SOURCE_RACE_RUN: resolve(root, '..') }
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(join(evidenceRoot, 'installed-public-deletion-D154.log'), `${output}\nEXIT=${result.status}\n`);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module|recursively within a test file/);
  assert.match(output, /(?:ℹ tests|# tests) [1-9][0-9]*/);
  assert.match(output, /D-154/, 'same new final-check public assertions must actually execute');
  assert.equal(result.status, 0, 'INSTALLED_DELETE_IDENTITY_CAPABILITY_MISSING: full real public deletion/compensation suite must pass');
});
function requireReleaseFixture(p) {
  const pkg = JSON.parse(fs.readFileSync(join(p.extracted, 'package.json')));
  const fixture = pkg.exports?.['./fixtures/source-release-materials.json'];
  assert.equal(fixture, './fixtures/source-release-materials.json',
    'SOURCE_RELEASE_ARTIFACT_MISSING: normal tgz must export immutable provider release fixture');
  const candidate = JSON.parse(fs.readFileSync(join(root, 'test/fixtures/source-release-materials.json')));
  const actual = JSON.parse(fs.readFileSync(join(p.extracted, fixture)));
  assert.deepEqual(actual, { release: candidate.release, origin: candidate.origin, permissions: candidate.permissions },
    'actual extracted public release fixture equals independent literal provider materials without test-only approval metadata');
  assert.deepEqual(actual.permissions, { securityEnabled: true, httpMods: ['hanaworlds_adapter'], trustedMods: [] });
  assert.equal(actual.origin.name, candidate.origin.name); assert.equal(actual.origin.license, 'MIT');
  return fixture;
}
test('normal tgz actual exported source release fixture has exact independent bytes/origin/least permissions', () => {
  requireReleaseFixture(preparePackage());
});
for (const mutation of ['missing', 'modified', 'rehashed', 'origin-modified', 'permissions-modified'])
  test(`actual Adapter rejects ${mutation} extracted public source release before world/native actions`, () => {
    const p = preparePackage(), fixture = requireReleaseFixture(p);
    const caseRoot = fs.mkdtempSync(join(evidenceRoot, `source-release-${mutation}-`));
    const candidate = join(caseRoot, 'package'); fs.cpSync(p.extracted, candidate, { recursive: true });
    // Copying the actual tar keeps runtime imports relative. Dependencies resolve
    // through the isolated consumer, not this worktree or a global Node path.
    fs.symlinkSync(join(p.consumer, 'node_modules'), join(caseRoot, 'node_modules'), 'dir');
    const artifact = join(candidate, fixture), value = JSON.parse(fs.readFileSync(artifact));
    if (mutation === 'missing') fs.rmSync(artifact);
    else {
      if (mutation === 'origin-modified') value.origin.sourceUrl = 'https://invalid.example/untrusted';
      else if (mutation === 'permissions-modified') value.permissions.trustedMods = ['untrusted'];
      else {
        const member = value.release.files.find(file => file.name === 'engine.lua');
        member.bytesBase64 = Buffer.concat([Buffer.from(member.bytesBase64, 'base64'), Buffer.from('\n-- unauthorized\n')]).toString('base64');
        if (mutation === 'rehashed') {
          const hash = createHash('sha256');
          for (const row of value.release.files) { const bytes = Buffer.from(row.bytesBase64, 'base64'); row.byteLength = bytes.length; row.sha256 = sha256(bytes); hash.update(row.name + '\n'); hash.update(bytes); }
          value.release.payloadDigest = hash.digest('hex');
        }
      }
      fs.writeFileSync(artifact, JSON.stringify(value));
      if (mutation === 'rehashed') {
        const buildPath = join(candidate, 'dist/runtime-build.json'), build = JSON.parse(fs.readFileSync(buildPath));
        build.sha256[fixture.replace(/^\.\//, '')] = sha256(fs.readFileSync(artifact));
        fs.writeFileSync(buildPath, JSON.stringify(build));
      }
    }
    observe(`source-release-artifact-${mutation}`, process.execPath,
      [join(p.consumer, 'test/support/source-atomic-release-package-probe.mjs'), JSON.stringify({ evidencePath: join(caseRoot, 'refusal.json') })],
      p.consumer, { ...cleanEnv, PATH: dirname(process.execPath), SOURCE_RELEASE_ADAPTER_URL: pathToFileURL(join(candidate, 'dist/runtime/index.mjs')).href,
        SOURCE_RELEASE_RUN: resolve(root, '..') });
  });
function requireRelease(p) {
  const manifestPath = join(p.extracted, manifestRelative);
  assert.ok(fs.existsSync(manifestPath), 'ATOMIC_NATIVE_RELEASE_MISSING: normal tgz lacks trusted OWN native release manifest');
  assert.ok(fs.existsSync(join(p.extracted, loaderRelative)), 'ATOMIC_NATIVE_LOADER_MISSING: normal tgz lacks finite OWN native loader');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(manifest.owner, 'adapter'); assert.equal(manifest.abi, 'napi-v8');
  assert.equal(typeof manifest.releaseId, 'string'); assert.ok(manifest.releaseId.length);
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length);
  for (const row of manifest.artifacts) {
    assert.equal(row.napi, 8); assert.equal(row.license, 'MIT');
    assert.match(row.sha256, /^[a-f0-9]{64}$/); assert.match(row.sourceSHA256, /^[a-f0-9]{64}$/);
    assert.equal(typeof row.runtimeProfile, 'string'); assert.ok(row.runtimeProfile.length,
      'NAPI ABI alone does not establish libc/minimum OS/CPU compatibility');
    assert.match(row.relativePath, /^dist\/native\/source-atomic\/[a-z0-9_-]+\.node$/);
    const file = join(p.extracted, row.relativePath);
    assert.ok(fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
    assert.equal(sha256(fs.readFileSync(file)), row.sha256, 'release hash is of actual extracted native bytes');
  }
  const selected = manifest.artifacts.filter(a => a.platform === process.platform && a.arch === process.arch);
  assert.equal(selected.length, 1, 'current normal-install platform must have one exact trusted native artifact');
  return { manifest, selected: selected[0] };
}
test('normal archive pack/default prod install supplies real successful OWN atomic move without compiler/tools', t => {
  const p = preparePackage(), { selected } = requireRelease(p);
  const receipt = childProbe(t, join(p.installed, 'dist/runtime/source-atomic-move.mjs'), 'success', 'installed-success');
  assert.ok(receipt.dlopenPaths.every(path => path.startsWith(join(p.installed, 'dist/native/source-atomic') + sep)));
  assert.equal(receipt.runtimeProfile, selected.runtimeProfile);
  assert.deepEqual(receipt.profileTuple, { platform: selected.platform, arch: selected.arch, napi: selected.napi, runtimeProfile: selected.runtimeProfile });
  fs.writeFileSync(join(p.archiveRoot, 'platform-matrix.json'), JSON.stringify({
    current: { ...receipt.profileTuple, filesystemDevice: receipt.targetVolumeDevice, status: 'ACTUAL_SYSCALL_PROVEN' },
    candidatePrimitives: { darwin: 'renameatx_np(RENAME_EXCL)', linux: 'renameat2(RENAME_NOREPLACE)', win32: 'handle-bound FileRenameInfo ReplaceIfExists=false' },
    unprovenPlatforms: ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'].filter(v => v !== process.platform),
    matrixAcceptance: 'All declared release artifacts must run success/occupancy/custody/trust on their actual OS/volume; unproven is not skip/pass; absent os restriction is not approval to narrow support.'
  }, null, 2));
});
for (const scenario of ['occupied-empty', 'occupied-nonempty', 'parent-replaced', 'parent-symlink', 'source-replaced',
  'post-source-replaced', 'post-target-replaced', 'native-error-after-move', 'commit-source-replaced', 'commit-parent-replaced',
  'commit-source-replaced-occupied', 'commit-parent-replaced-occupied'])
  test(`installed OWN primitive ${scenario} uses actual extracted native bytes`, t => {
    const p = preparePackage(); requireRelease(p);
    childProbe(t, join(p.installed, 'dist/runtime/source-atomic-move.mjs'), scenario, `installed-${scenario}`);
  });

function candidatePackage(name) {
  const p = preparePackage(), release = requireRelease(p);
  const caseRoot = fs.mkdtempSync(join(evidenceRoot, `trust-${name}-`)), candidate = join(caseRoot, 'package');
  fs.cpSync(p.extracted, candidate, { recursive: true });
  return { ...release, caseRoot, candidate };
}
function writeManifest(c) { fs.writeFileSync(join(c.candidate, manifestRelative), JSON.stringify(c.manifest, null, 2)); }
let hostileFixture;
function genuineReplacementFixture(p) {
  if (hostileFixture) return hostileFixture;
  // Test preparation only. Never a production compiler dependency or shipped
  // loader helper. A valid, self-authored executable attack image is required;
  // invalid bytes and a mocked dlopen are not non-execution evidence.
  const headers = join(dirname(dirname(process.execPath)), 'include/node');
  assert.ok(fs.existsSync(join(headers, 'node_api.h')), 'test SDK must match the actual Node distribution');
  const fixtureRoot = fs.mkdtempSync(join(evidenceRoot, 'D154-executable-fixture-'));
  const fixture = join(fixtureRoot, 'replacement.node');
  const source = join(root, 'test/fixtures/d154-replacement-native.c');
  const compiler = { darwin: '/usr/bin/clang', linux: '/usr/bin/cc' }[process.platform];
  assert.ok(compiler, 'D154_TEST_FIXTURE_TOOLCHAIN_UNPROVEN: provide legal normal native test toolchain; no platform skip/shrink');
  const args = ['-I', headers, '-DNAPI_VERSION=8', ...(process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']), source, '-o', fixture];
  observe('D154-compile-executable-test-fixture', compiler, args, fixtureRoot, cleanEnv);
  const loadProbe = join(root, 'test/support/source-atomic-load-race.mjs');
  observe('D154-real-replacement-dlopen-control', process.execPath, [loadProbe, JSON.stringify({
    mode: 'control', hostilePath: fixture, evidencePath: join(fixtureRoot, 'control.json')
  })], fixtureRoot, { ...cleanEnv, PATH: dirname(process.execPath) });
  hostileFixture = fixture;
  return fixture;
}
test('D-154 actual executable replacement fixture has a genuine dlopen initialization control', () => {
  const p = preparePackage(); requireRelease(p); genuineReplacementFixture(p);
});
for (const surface of ['source', 'normal-installed']) for (const mode of ['binary', 'parent'])
  test(`D-154 ${surface} verified bytes -> real dlopen ${mode} replacement never executes foreign code`, t => {
    const p = preparePackage(), c = candidatePackage(`D154-load-${surface}-${mode}`);
    if (surface === 'source') {
      // Exercise the normally prepared archive's real src loader, with its own
      // actual built artifacts; dependencies are not copied from this worktree.
      const sourceCandidate = join(c.caseRoot, 'source-checkout');
      fs.cpSync(p.checkout, sourceCandidate, { recursive: true, filter: path => !path.includes(`${sep}node_modules`) });
      fs.symlinkSync(join(p.checkout, 'node_modules'), join(sourceCandidate, 'node_modules'), 'dir');
      c.candidate = sourceCandidate;
    }
    const caller = join(c.caseRoot, 'worlds'); fs.mkdirSync(caller);
    for (const name of ['source', 'neighbour']) { fs.mkdirSync(join(caller, name)); fs.writeFileSync(join(caller, name, 'keep'), name); }
    const evidencePath = join(c.caseRoot, 'load-race.json');
    observe(`D154-load-${surface}-${mode}`, process.execPath, [join(root, 'test/support/source-atomic-load-race.mjs'), JSON.stringify({
      mode, modulePath: join(c.candidate, surface === 'source' ? 'src/source-atomic-move.mjs' : 'dist/runtime/source-atomic-move.mjs'),
      artifactPath: join(c.candidate, c.selected.relativePath), hostilePath: genuineReplacementFixture(p),
      parentPath: caller, evidencePath, expectedProfile: c.selected.runtimeProfile
    })], c.caseRoot, { ...cleanEnv, PATH: dirname(process.execPath) });
    t.diagnostic(`genuine loader and preserved worlds evidence ${evidencePath}`);
  });
const trustCases = {
  'missing-manifest': c => fs.rmSync(join(c.candidate, manifestRelative)),
  'missing-native': c => fs.rmSync(join(c.candidate, c.selected.relativePath)),
  'modified-native': c => fs.appendFileSync(join(c.candidate, c.selected.relativePath), Buffer.from([1, 17, 5])),
  'rehashed-self-manifest': c => {
    fs.appendFileSync(join(c.candidate, c.selected.relativePath), Buffer.from([1, 17, 5]));
    c.selected.sha256 = sha256(fs.readFileSync(join(c.candidate, c.selected.relativePath))); writeManifest(c);
    const metaPath = join(c.candidate, 'dist/runtime-build.json'), meta = JSON.parse(fs.readFileSync(metaPath));
    meta.sha256[c.selected.relativePath] = c.selected.sha256;
    meta.sha256[manifestRelative] = sha256(fs.readFileSync(join(c.candidate, manifestRelative)));
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  },
  'foreign-platform': c => { c.selected.platform = 'foreign-platform'; writeManifest(c); },
  'foreign-abi': c => { c.manifest.abi = 'napi-v999'; c.selected.napi = 999; writeManifest(c); },
  'foreign-runtime-profile': c => { c.selected.runtimeProfile = 'forged-libc-minos-cpu-profile'; writeManifest(c); },
  'untrusted-external-path': c => { const foreign = join(c.caseRoot, 'foreign.node'); fs.copyFileSync(join(c.candidate, c.selected.relativePath), foreign); c.selected.relativePath = foreign; writeManifest(c); },
  'path-traversal': c => { c.selected.relativePath = '../../foreign.node'; writeManifest(c); },
  'symlink-native': c => { const file = join(c.candidate, c.selected.relativePath), foreign = join(c.caseRoot, 'foreign.node'); fs.copyFileSync(file, foreign); fs.rmSync(file); fs.symlinkSync(foreign, file); },
  'symlink-native-directory': c => { const dir = join(c.candidate, 'dist/native/source-atomic'), foreign = join(c.caseRoot, 'foreign-directory'); fs.renameSync(dir, foreign); fs.symlinkSync(foreign, dir, 'dir'); },
};
for (const [name, mutate] of Object.entries(trustCases)) test(`actual artifact trust rejects ${name} before dlopen/action`, t => {
  const c = candidatePackage(name); mutate(c);
  const parentPath = join(c.caseRoot, 'caller-parent'); fs.mkdirSync(parentPath);
  fs.mkdirSync(join(parentPath, 'source')); fs.writeFileSync(join(parentPath, 'source', 'owned'), 'owned');
  observe(`trust-${name}`, process.execPath, [helper, '--trust', JSON.stringify({
    modulePath: join(c.candidate, 'dist/runtime/source-atomic-move.mjs'), parentPath, evidencePath: join(c.caseRoot, 'trust-receipt.json')
  })], c.caseRoot, { ...cleanEnv, PATH: dirname(process.execPath) });
  t.diagnostic(`trust receipt ${join(c.caseRoot, 'trust-receipt.json')}`);
});

test('loader AST uses one finite audited OWN dlopen seam; package boundary has no global exemption', () => {
  const p = preparePackage(); requireRelease(p);
  const loader = fs.readFileSync(join(p.extracted, loaderRelative), 'utf8');
  const ast = ts.createSourceFile(loaderRelative, loader, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(ast.parseDiagnostics, []);
  let dlopen = 0;
  function walk(n) {
    if (ts.isImportDeclaration(n)) assert.notEqual(n.moduleSpecifier.text, 'node:module');
    if (ts.isCallExpression(n)) {
      const text = n.expression.getText(ast);
      assert.ok(!/(?:createRequire|\brequire|\beval|Function)/.test(text), `unbounded loader ${text}`);
      if (text === 'process.dlopen') dlopen++;
    }
    ts.forEachChild(n, walk);
  }
  walk(ast); assert.equal(dlopen, 1, 'a single auditable native loading point');
  verifyPackage(p.extracted);
  for (const [name, code] of Object.entries({
    'foreign-dlopen': "process.dlopen({exports:{}}, '/tmp/foreign.node');",
    'env-dlopen': "process.dlopen({exports:{}}, process.env.HW_ATOMIC_NATIVE);",
    'dynamic-url-dlopen': "process.dlopen({exports:{}}, new URL(process.env.HW_ATOMIC_NATIVE, import.meta.url).pathname);",
    'aliased-dlopen': "const foreign=process.dlopen; foreign({exports:{}}, '/tmp/foreign.node');",
    'node-module-loader': "import {createRequire} from 'node:module'; createRequire(import.meta.url)('/tmp/foreign.node');",
  })) {
    const c = candidatePackage(`audit-${name}`), file = join(c.candidate, loaderRelative);
    fs.writeFileSync(file, loader + '\n' + code);
    const metaPath = join(c.candidate, 'dist/runtime-build.json'), meta = JSON.parse(fs.readFileSync(metaPath));
    meta.sha256[loaderRelative] = sha256(fs.readFileSync(file)); fs.writeFileSync(metaPath, JSON.stringify(meta));
    assert.throws(() => verifyPackage(c.candidate), /NATIVE_(?:LOAD|ARTIFACT|TRUST)|DYNAMIC_MODULE_LOADER|DYNAMIC_ARTIFACT_RESOURCE/,
      `${name}: self-rehashed build manifest cannot grant arbitrary native loading`);
  }
});
