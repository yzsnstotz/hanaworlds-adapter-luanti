// Normal own archive/install/package preparation, shared by Q-265 Node tests.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const evidenceRoot = resolve(sourceRoot, '../tmp/source-node-q265');
fs.mkdirSync(evidenceRoot, { recursive: true });
export const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(npm_config_|PNPM_|NODE_PATH$|NODE_OPTIONS$|NODE_TEST_|HW_|SOURCE_(?:FILE|RACE|RELEASE)_)/i.test(key)));
const execute = (args, cwd, env = cleanEnv) => execFileSync(args[0], args.slice(1),
  { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export function observe(label, file, args, cwd, env = cleanEnv) {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8' });
  fs.writeFileSync(join(evidenceRoot, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}\nEXIT=${result.status}\n`);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.error?.message || result.stdout}`);
  return result.stdout;
}
let prepared;
export function prepareSourcePackage() {
  if (prepared) return prepared;
  const archiveRoot = fs.mkdtempSync(join(evidenceRoot, 'normal-package-'));
  const checkout = join(archiveRoot, 'checkout'), consumer = join(archiveRoot, 'consumer');
  fs.mkdirSync(checkout); fs.mkdirSync(consumer);
  const tar = join(archiveRoot, 'source.tar');
  execute(['git', 'archive', '--format=tar', `--output=${tar}`, 'HEAD'], sourceRoot);
  execute(['tar', '-xf', tar, '-C', checkout], archiveRoot);
  const changed = execute(['git', 'diff', '--name-only', 'HEAD', '--'], sourceRoot).trim().split('\n').filter(Boolean);
  const added = execute(['git', 'ls-files', '--others', '--exclude-standard'], sourceRoot).trim().split('\n').filter(Boolean);
  for (const name of new Set([...changed, ...added])) {
    assert.ok(!name.startsWith('..') && !/^(?:node_modules|dist)\//.test(name));
    const from = join(sourceRoot, name), to = join(checkout, name);
    if (fs.existsSync(from)) { fs.mkdirSync(dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
    else fs.rmSync(to, { force: true }); // withdrawn test file in this NEW archive only
  }
  const env = { ...cleanEnv, HOME: join(archiveRoot, 'home'), XDG_CONFIG_HOME: join(archiveRoot, 'config'),
    TMPDIR: join(archiveRoot, 'tmp'), npm_config_cache: join(archiveRoot, 'npm-cache') };
  for (const path of [env.HOME, env.TMPDIR, env.XDG_CONFIG_HOME]) fs.mkdirSync(path);
  const npm = join(dirname(process.execPath), 'npm');
  observe('normal-frozen-npm-ci', npm, ['ci'], checkout, env);
  observe('normal-npm-pack', npm, ['pack', '--pack-destination', archiveRoot], checkout, env);
  const pkg = JSON.parse(fs.readFileSync(join(checkout, 'package.json')));
  const packed = join(archiveRoot, `${pkg.name}-${pkg.version}.tgz`);
  assert.ok(fs.existsSync(packed));
  fs.writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const pnpm = join(checkout, 'node_modules/pnpm/bin/pnpm.cjs');
  assert.equal(execute([process.execPath, pnpm, '--version'], consumer, env).trim(), '11.28.5');
  observe('normal-default-production-pnpm-install', process.execPath,
    [pnpm, 'install', '--prod', '--store-dir', join(archiveRoot, 'store'), packed, '@deepseek-ai/cordis@4.0.4'], consumer, env);
  const installed = fs.realpathSync(join(consumer, 'node_modules', pkg.name));
  assert.doesNotMatch(fs.readFileSync(join(consumer, 'pnpm-lock.yaml'), 'utf8'), /esbuild|typescript|node-gyp|hanaworlds-contracts/);
  for (const builder of ['esbuild', 'typescript', 'node-gyp', 'pnpm'])
    assert.equal(fs.existsSync(join(consumer, 'node_modules', builder)), false);
  const installedPkg = JSON.parse(fs.readFileSync(join(installed, 'package.json')));
  assert.deepEqual(installedPkg.os, pkg.os); assert.deepEqual(installedPkg.cpu, pkg.cpu);
  assert.equal(pkg.os, undefined, 'owner kept platform range; do not add OS filters');
  assert.equal(pkg.cpu, undefined, 'owner kept CPU range; do not add CPU filters');
  const publicProbe = join(consumer, 'public-surface.mjs');
  fs.writeFileSync(publicProbe, `import assert from 'node:assert/strict';\nimport {apply} from '${pkg.name}';\nassert.equal(typeof apply,'function');\n`);
  observe('installed-public-source-surface', process.execPath, [publicProbe], consumer, { ...env, PATH: dirname(process.execPath) });
  const extracted = join(archiveRoot, 'extracted'); fs.mkdirSync(extracted);
  execute(['tar', '-xzf', packed, '-C', extracted], archiveRoot);
  for (const name of ['test/source-release-materials.test.mjs', 'test/support/source-release-fixture.mjs',
    'test/fixtures/source-release-materials.json', 'test/support/source-release-package-probe.mjs',
    'test/local-source-deletion-race.test.mjs', 'test/support/local-source-node-observer.mjs',
    'test/local-source-file-operations.test.mjs', 'test/support/local-source-file-probe.mjs']) {
    const to = join(consumer, name); fs.mkdirSync(dirname(to), { recursive: true });
    fs.copyFileSync(join(sourceRoot, name), to);
  }
  fs.writeFileSync(join(archiveRoot, 'platform-evidence.json'), JSON.stringify({
    scope: 'NODE_BUILTIN_OPERATIONS_NORMAL_DESKTOP_TRUST', platform: process.platform, arch: process.arch, node: process.version,
    packageOSConstraint: pkg.os ?? null, packageCPUConstraint: pkg.cpu ?? null,
    actualCrossPlatformRuns: [process.platform], otherPlatforms: 'NOT_RUN; no inferred narrowing or native profile requirement',
    maliciousSameAccountLastWindowProtection: 'NOT_PROMISED_BY_D159; withdrawn specifications retained separately'
  }, null, 2));
  prepared = { archiveRoot, checkout, consumer, installed, extracted: join(extracted, 'package'), packed };
  return prepared;
}
