// SOURCE/PACKAGE: normal tgz install with pnpm 11.28.5 default strict policy; no dev SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage } from '../scripts/package-boundary.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const npm = join(dirname(process.execPath), 'npm');
const run = (file, args, cwd, env = process.env) => execFileSync(file, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('contracts are a pinned development input and production imports resolve to compiled local structures', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  assert.equal(pkg.dependencies?.['hanaworlds-contracts'], undefined);
  assert.equal(pkg.devDependencies['hanaworlds-contracts'], 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.13.0');
  assert.equal(lock.packages['node_modules/hanaworlds-contracts'].dev, true);
  assert.deepEqual(pkg.imports['#contracts'], {development:'./dist/contracts.mjs',default:'./dist/runtime/contracts.mjs'});
  const upstream = await import('hanaworlds-contracts');
  const compiled = await import('#contracts');
  const runtime = await import('../dist/runtime/contracts.mjs');
  assert.deepEqual(runtime.contractHandshake, upstream.contractHandshake);
  assert.equal(runtime.canonicalJSON(runtime.schemaBundle), upstream.canonicalJSON(upstream.schemaBundle));
  assert.notEqual(runtime.ContractError, upstream.ContractError);
  assert.deepEqual(compiled.contractHandshake, upstream.contractHandshake);
  assert.equal(compiled.canonicalJSON(compiled.schemaBundle), upstream.canonicalJSON(upstream.schemaBundle));
  for (const name of ['wireVersions', 'operationContracts', 'digestProfile', 'placementInvariants'])
    assert.equal(compiled.canonicalJSON(compiled[name]), upstream.canonicalJSON(upstream[name]), name);
});

test('packed public runtime and declarations work with no contract package or builder installed', async t => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.equal(pkg.dependencies?.['hanaworlds-contracts'], undefined, 'production package must not fetch the contract repository');
  const dir = mkdtempSync(join(tmpdir(), 'hw-adapter-production-package-'));
  t.diagnostic(`package-owned ${JSON.stringify({ root: dir })}`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['pack', '--cache', join(homedir(), '.npm'), '--pack-destination', dir], root, {...process.env,HW_ADAPTER_BOUNDARY_PACK:'1'});
  const packed = {filename: `${pkg.name}-${pkg.version}.tgz`};
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(npm_config_|PNPM_|NODE_PATH$|NODE_OPTIONS$|HW_)/i.test(k)));
  env.HOME=join(dir,'home'); env.XDG_CONFIG_HOME=join(dir,'config');
  const pnpm=join(root,'node_modules/pnpm/bin/pnpm.cjs');
  assert.equal(run(process.execPath,[pnpm,'--version'],dir,env).trim(),'11.28.5');
  const install=run(process.execPath,[pnpm,'install','--prod','--store-dir',join(homedir(),'.cache/pnpm/store'),join(dir,packed.filename)],dir,env);
  writeFileSync(join(dir,'install.log'),install);
  assert.doesNotMatch(readFileSync(join(dir,'pnpm-lock.yaml'),'utf8'),/hanaworlds-contracts|esbuild|typescript/);
  writeFileSync(join(dir,'resolution-graph.json'),run(process.execPath,[pnpm,'list','--depth','Infinity','--json'],dir,env));
  assert.equal(existsSync(join(dir, 'node_modules/hanaworlds-contracts')), false);
  assert.equal(existsSync(join(dir, 'node_modules/esbuild')), false);
  const installed = JSON.parse(readFileSync(join(dir, 'node_modules/hanaworlds-adapter-luanti/package.json')));
  assert.deepEqual(Object.keys(installed.exports).sort(), ['.','./host','./inspection-context','./local-worlds-v2-mock','./source-locator','./world-source-facts-mock','./fixtures/local-world-source.json','./fixtures/world-source-facts.json'].sort());
  writeFileSync(join(dir,'package-graph.json'),JSON.stringify(verifyPackage(join(dir,'node_modules/hanaworlds-adapter-luanti')),null,2));
  assert.deepEqual(installed.imports['#contracts'], {development:'./dist/contracts.mjs',default:'./dist/runtime/contracts.mjs'});
  assert.equal(existsSync(join(dir,'node_modules/hanaworlds-adapter-luanti/dist/contracts.mjs')),false,'development value module must not be packed');
  writeFileSync(join(dir, 'deny-contract-import.mjs'), `import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, next) {
  if (specifier === 'hanaworlds-contracts' || specifier.startsWith('hanaworlds-contracts/')) throw Error('EXTERNAL_CONTRACT_IMPORT');
  return next(specifier, context);
}});\n`);
  writeFileSync(join(dir, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { apply, payloadDigest } from 'hanaworlds-adapter-luanti';
import { createNativeHost } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';
import { createLocalWorldsMock, createLocalConnectionReadbackMock } from 'hanaworlds-adapter-luanti/local-worlds-v2-mock';
import { createWorldSourceFactsMock } from 'hanaworlds-adapter-luanti/world-source-facts-mock';
import { SOURCE_LOCATOR_VERSION, SOURCE_STARTUP_VERSION } from 'hanaworlds-adapter-luanti/source-locator';
import facts from 'hanaworlds-adapter-luanti/fixtures/world-source-facts.json' with { type: 'json' };
import worlds from 'hanaworlds-adapter-luanti/fixtures/local-world-source.json' with { type: 'json' };
assert.match(await payloadDigest(), /^[0-9a-f]{64}$/);
assert.equal(typeof createNativeHost, 'function');
assert.equal(typeof createInspectionContext({}).read, 'function');
assert.equal(typeof SOURCE_LOCATOR_VERSION, 'string');
assert.equal(typeof SOURCE_STARTUP_VERSION, 'string');
const fs = await import('node:fs/promises');
const errors=[];
const peer = createWorldSourceFactsMock();
for (const e of facts.exchanges) assert.deepEqual(JSON.parse(JSON.stringify(await peer.call(e.operation, e.request))), e.response);
for(const e of facts.exchanges) { const code=e.operation==='ReadCatalogue'?'WORLD_NOT_BOUND':e.operation==='ReadMaterialSources'?'CAPABILITY_UNAVAILABLE':'ADAPTER_UNAVAILABLE';
 const response=await createWorldSourceFactsMock({[e.operation]:code}).call(e.operation,e.request);
 assert.equal(response.error.code,code);assert.equal(response.error.mutationState,'NONE');
 errors.push({wire:e.wire,operation:e.operation,request:e.request,response});
}
await fs.writeFile('protocol-errors.json',JSON.stringify(errors));
const owned=createNativeHost({C:{validateType:(_type,value)=>value},state:process.cwd(),profile:process.cwd(),worlds:process.cwd(),luanti:'unused',event(){}});
assert.equal(owned.game.running(),false);
await assert.rejects(owned.host.inspect({controlRef:'missing'}),/CURRENT_WORLD_MISMATCH/);
await assert.rejects(owned.game.enter({nativeProcessId:-1,worldPath:'absent'}),/CURRENT_WORLD_MISMATCH/);
await owned.shutdown();
const foreignCanvas={call:async(_name,q)=>({contractVersion:'canvas/v7',requestId:q.requestId,result:null,error:JSON.parse(JSON.stringify(errors[0].response.error))})};
await assert.rejects(createInspectionContext({resolveCanvas:()=>foreignCanvas}).ReadInspectionContext({contractVersion:'world-inspection/v1',requestId:'foreign',sessionRef:'S',worldRef:'W'}), /WORLD_NOT_BOUND/);
const local = createLocalWorldsMock();
const lifecycle=JSON.parse(await fs.readFile(new URL('./node_modules/hanaworlds-adapter-luanti/fixtures/local-worlds-v2.json',import.meta.url)));
for(const e of lifecycle.exchanges) {
 if(e.wire==='local-worlds/v2'&&e.response.result)assert.deepEqual(JSON.parse(JSON.stringify(await local[e.operation](e.request))),e.response);
 if(e.operation==='ReadLocalConnection'&&e.response.result) {
  const read=createLocalConnectionReadbackMock();assert.deepEqual(JSON.parse(JSON.stringify(await read(e.request))),e.response);
  for(const code of ['CONNECTION_NOT_FOUND','PAYLOAD_VERSION_MISMATCH'])assert.equal((await createLocalConnectionReadbackMock(code)(e.request)).error.code,code);
 }
}
for (const e of worlds.exchanges.filter(e => e.response.result)) assert.deepEqual(JSON.parse(JSON.stringify(await local.describeSourceWorld(e.request))), e.response);
const roots = await fs.realpath(process.cwd());
const worldRoot=roots+'/owned-worlds';
await fs.mkdir(worldRoot+'/world',{recursive:true});
await fs.writeFile(worldRoot+'/world/world.mt','gameid = package_probe\\n');
const services = new Map();
const adapter = apply({ get() {}, provide: (n, s) => services.set(n, s), effect() {}, webServer: { register: () => () => {} } },{localWorldRoots:[worldRoot]});
try {
 assert.equal(services.get('hanaworldsWorldAdapterV6').contractHandshake.contracts, 'hanaworlds-contracts@2.13.0');
 const port=services.get('hanaworldsLocalWorlds');
 const rows=await port.discover();assert.equal(rows.length,1);assert.equal(rows[0].gameId,'package_probe');
 const source=await port.describeSourceWorld({contractVersion:'local-worlds/v2',requestId:'source',worldRef:rows[0].connectionRef});
 assert.equal(source.error,null);assert.equal(source.result.sourceLocator.worldPath,worldRoot+'/world');
 assert.equal(source.result.sourceStartupFacts.availability,'UNAVAILABLE');
 const absent=await port.describeSourceWorld({contractVersion:'local-worlds/v2',requestId:'absent',worldRef:'absent'});
 assert.equal(absent.error.code,'WORLD_NOT_FOUND');
 await assert.rejects(services.get('hanaworldsLocalWorlds').setRoots({roots:['relative']}), /SCHEMA_INVALID/);
} finally { await adapter.close(); }
const noBundle = await import('node:fs/promises');
const bundle=new URL('./node_modules/hanaworlds-adapter-luanti/dist/runtime/contracts.mjs',import.meta.url);
await noBundle.rename(bundle,new URL('./contracts.saved.mjs',bundle));
const child=await import('node:child_process');
const missing=child.spawnSync(process.execPath,['--input-type=module','-e',"await import('hanaworlds-adapter-luanti')"],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
assert.notEqual(missing.status,0); assert.match(missing.stderr,/ERR_MODULE_NOT_FOUND/);
await noBundle.rename(new URL('./contracts.saved.mjs',bundle),bundle);
console.log('packed runtime without external contracts PASS');\n`);
  assert.match(run(process.execPath, ['consumer.mjs'], dir, env), /PASS/);
  assert.match(run(process.execPath, ['--input-type=module','-e',"import assert from 'node:assert/strict'; await assert.rejects(import('hanaworlds-contracts'), e=>e.code==='ERR_MODULE_NOT_FOUND'); console.log('NO_DEVELOPMENT_RESOLUTION');"], dir, env), /NO_DEVELOPMENT_RESOLUTION/);
  // Retain the former denial gate after ordinary default-condition execution succeeds.
  assert.match(run(process.execPath, ['--import', './deny-contract-import.mjs', 'consumer.mjs'], dir, env), /PASS/);
  writeFileSync(join(dir, 'consumer.ts'), `import { createNativeHost, type NativeHostOptions } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';
import { createLocalWorldsMock, createLocalConnectionReadbackMock } from 'hanaworlds-adapter-luanti/local-worlds-v2-mock';
import { createWorldSourceFactsMock } from 'hanaworlds-adapter-luanti/world-source-facts-mock';
import { SOURCE_LOCATOR_VERSION, type LuantiSourceLocator } from 'hanaworlds-adapter-luanti/source-locator';
type Host = ReturnType<typeof createNativeHost>;
type Inspection = ReturnType<typeof createInspectionContext>;
type Worlds = ReturnType<typeof createLocalWorldsMock>;
type Facts = ReturnType<typeof createWorldSourceFactsMock>;
const locatorVersion: LuantiSourceLocator['locatorVersion'] = SOURCE_LOCATOR_VERSION;
export type PublicTypes = [NativeHostOptions, Host, Inspection, Worlds, Facts, typeof locatorVersion];\n`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], dir, env);
  const upstream=await import('hanaworlds-contracts');
  for(const row of JSON.parse(readFileSync(join(dir,'protocol-errors.json')))) {
   assert.deepEqual(JSON.parse(JSON.stringify(upstream.validateBoundResponse(row.wire,row.operation,row.request,row.response).error)),row.response.error);
  }
  writeFileSync(join(dir,'artifact.json'),JSON.stringify({pnpm:'11.28.5',tarSHA256:createHash('sha256').update(readFileSync(join(dir,packed.filename))).digest('hex'),runtime:'PASS',declarations:'PASS',foreignSDKProtocolErrors:'PASS'},null,2));
  // The exact same target manager must reject exotic subdependencies and unreviewed
  // dependency builds, proving its policies were not disabled by machine configuration.
  for(const kind of ['exotic-subdependency','unreviewed-build']) {
   const negative=join(dir,kind);mkdirSync(negative);cpSync(join(dir,'node_modules/hanaworlds-adapter-luanti'),join(negative,'package'),{recursive:true,dereference:true});
   const manifest=join(negative,'package/package.json');const broken=JSON.parse(readFileSync(manifest));
   if(kind==='exotic-subdependency')broken.dependencies['hanaworlds-contracts']=broken.devDependencies['hanaworlds-contracts'];
   else broken.scripts={postinstall:"node -e \"throw Error('SHOULD_NOT_EXECUTE_UNREVIEWED_BUILD')\""};
   writeFileSync(manifest,JSON.stringify(broken));
   const badTar=join(negative,'negative.tgz');run('tar',['-czf',badTar,'-C',negative,'package'],dir);
   const consumer=join(negative,'consumer');mkdirSync(consumer);writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true}));
   const failure=spawnSync(process.execPath,[pnpm,'install','--prod','--store-dir',join(homedir(),'.cache/pnpm/store'),badTar],{cwd:consumer,env,encoding:'utf8'});
   const output=failure.stdout+failure.stderr;writeFileSync(join(negative,'install-failure.log'),output);
   assert.notEqual(failure.status,0,output);
   assert.match(output,kind==='exotic-subdependency'?/ERR_PNPM_EXOTIC_SUBDEP/:/ERR_PNPM_IGNORED_BUILDS/);
  }
  t.diagnostic(`package-closed ${JSON.stringify({ root: dir, packed: packed.filename, runtime: 'PASS', declarations: 'PASS', contractsInstalled: false })}`);
});
