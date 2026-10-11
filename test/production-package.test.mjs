// SOURCE/PACKAGE: install the actual tar without development dependencies or lifecycle scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const npm = join(dirname(process.execPath), 'npm');
const run = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('contracts are a pinned development input and production imports resolve to compiled local structures', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  assert.equal(pkg.dependencies?.['hanaworlds-contracts'], undefined);
  assert.equal(pkg.devDependencies['hanaworlds-contracts'], 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.13.0');
  assert.equal(lock.packages['node_modules/hanaworlds-contracts'].dev, true);
  assert.equal(pkg.imports['#contracts'], './dist/contracts.mjs');
  const upstream = await import('hanaworlds-contracts');
  const compiled = await import('#contracts');
  assert.deepEqual(compiled.contractHandshake, upstream.contractHandshake);
  assert.equal(compiled.canonicalJSON(compiled.schemaBundle), upstream.canonicalJSON(upstream.schemaBundle));
  for (const name of ['wireVersions', 'operationContracts', 'digestProfile', 'placementInvariants'])
    assert.equal(compiled.canonicalJSON(compiled[name]), upstream.canonicalJSON(upstream[name]), name);
});

test('packed public runtime and declarations work with no contract package or builder installed', t => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.equal(pkg.dependencies?.['hanaworlds-contracts'], undefined, 'production package must not fetch the contract repository');
  const dir = mkdtempSync(join(tmpdir(), 'hw-adapter-production-package-'));
  t.diagnostic(`package-owned ${JSON.stringify({ root: dir })}`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const [packed] = JSON.parse(run(npm, ['pack', '--cache', join(homedir(), '.npm'), '--ignore-scripts', '--json', '--pack-destination', dir], root));
  run(npm, ['install', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--cache', join(homedir(), '.npm'), join(dir, packed.filename)], dir);
  assert.equal(existsSync(join(dir, 'node_modules/hanaworlds-contracts')), false);
  assert.equal(existsSync(join(dir, 'node_modules/esbuild')), false);
  const installed = JSON.parse(readFileSync(join(dir, 'node_modules/hanaworlds-adapter-luanti/package.json')));
  assert.equal(installed.imports['#contracts'], './dist/contracts.mjs');
  writeFileSync(join(dir, 'deny-contract-import.mjs'), `import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'hanaworlds-contracts' || specifier.startsWith('hanaworlds-contracts/')) throw Error('EXTERNAL_CONTRACT_IMPORT');
  return next(specifier, context);
}});\n`);
  writeFileSync(join(dir, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { apply } from 'hanaworlds-adapter-luanti';
import { createNativeHost } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';
import { createLocalWorldsMock } from 'hanaworlds-adapter-luanti/local-worlds-v2-mock';
import { createWorldSourceFactsMock } from 'hanaworlds-adapter-luanti/world-source-facts-mock';
import { SOURCE_LOCATOR_VERSION } from 'hanaworlds-adapter-luanti/source-locator';
import facts from 'hanaworlds-adapter-luanti/fixtures/world-source-facts.json' with { type: 'json' };
import worlds from 'hanaworlds-adapter-luanti/fixtures/local-world-source.json' with { type: 'json' };
assert.equal(typeof createNativeHost, 'function');
assert.equal(typeof createInspectionContext({}).read, 'function');
assert.equal(typeof SOURCE_LOCATOR_VERSION, 'string');
const peer = createWorldSourceFactsMock();
for (const e of facts.exchanges) assert.deepEqual(JSON.parse(JSON.stringify(await peer.call(e.operation, e.request))), e.response);
const local = createLocalWorldsMock();
for (const e of worlds.exchanges.filter(e => e.response.result)) assert.deepEqual(JSON.parse(JSON.stringify(await local.describeSourceWorld(e.request))), e.response);
const services = new Map();
const adapter = apply({ get() {}, provide: (n, s) => services.set(n, s), effect() {}, webServer: { register: () => () => {} } });
try {
 assert.equal(services.get('hanaworldsWorldAdapterV6').contractHandshake.contracts, 'hanaworlds-contracts@2.13.0');
 assert.deepEqual(await services.get('hanaworldsLocalWorlds').discover(), []);
 await assert.rejects(services.get('hanaworldsLocalWorlds').setRoots({roots:['relative']}), /SCHEMA_INVALID/);
} finally { await adapter.close(); }
console.log('packed runtime without external contracts PASS');\n`);
  assert.match(run(process.execPath, ['--import', './deny-contract-import.mjs', 'consumer.mjs'], dir), /PASS/);
  writeFileSync(join(dir, 'consumer.ts'), `import { createNativeHost, type NativeHostOptions } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';
import { createLocalWorldsMock } from 'hanaworlds-adapter-luanti/local-worlds-v2-mock';
import { createWorldSourceFactsMock } from 'hanaworlds-adapter-luanti/world-source-facts-mock';
import { SOURCE_LOCATOR_VERSION, type LuantiSourceLocator } from 'hanaworlds-adapter-luanti/source-locator';
type Host = ReturnType<typeof createNativeHost>;
type Inspection = ReturnType<typeof createInspectionContext>;
type Worlds = ReturnType<typeof createLocalWorldsMock>;
type Facts = ReturnType<typeof createWorldSourceFactsMock>;
const locatorVersion: LuantiSourceLocator['locatorVersion'] = SOURCE_LOCATOR_VERSION;
export type PublicTypes = [NativeHostOptions, Host, Inspection, Worlds, Facts, typeof locatorVersion];\n`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], dir);
  t.diagnostic(`package-closed ${JSON.stringify({ root: dir, packed: packed.filename, runtime: 'PASS', declarations: 'PASS', contractsInstalled: false })}`);
});
