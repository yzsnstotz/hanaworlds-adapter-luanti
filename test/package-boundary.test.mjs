import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from '../scripts/package-boundary.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'hw-adapter-package-boundary-'));
const pkg=JSON.parse(readFileSync(join(root,'package.json')));
execFileSync(join(dirname(process.execPath),'npm'),['pack','--cache',join(homedir(),'.npm'),'--pack-destination',dir],{cwd:root,env:{...process.env,HW_ADAPTER_BOUNDARY_PACK:'1'},stdio:'pipe'});
const tar=join(dir,`${pkg.name}-${pkg.version}.tgz`);
execFileSync('tar',['-xzf',tar,'-C',dir]);
const source=join(dir,'package');
test('all real npm tar public runtime/resources close with no SDK runtime loads',t=>{
 const graph=verifyPackage(source);
 assert.ok(graph.modules.length>20);assert.deepEqual(graph.external,['canonicalize','pngjs']);
 writeFileSync(join(dir,'artifact-graph.json'),JSON.stringify(graph,null,2));
 t.diagnostic(`boundary-owned ${JSON.stringify({root:dir,tar,modules:graph.modules.length,resources:graph.resources.length})}`);
});
const edit=(base,path,change)=>{const p=join(base,path);const x=JSON.parse(readFileSync(p));change(x);writeFileSync(p,JSON.stringify(x));};
for(const [name,mutate,expected] of [
 ['production SDK dependency',b=>edit(b,'package.json',p=>p.dependencies['hanaworlds-contracts']=p.devDependencies['hanaworlds-contracts']),/PRODUCTION_CONTRACT_DEPENDENCY/],
 ['bare SDK value load',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import * as SDK from 'hanaworlds-contracts'; export { SDK };"),/CONTRACT_RUNTIME_LOAD/],
 ['private SDK alias load',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"export * from '#contracts';"),/CONTRACT_RUNTIME_LOAD/],
 ['computed dynamic SDK import',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"const name='hanaworlds-contracts'; await import(name);"),/DYNAMIC_MODULE_LOAD/],
 ['dynamic external resource read',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import {readFile} from 'node:fs/promises'; await readFile(import.meta.resolve('hanaworlds-contracts/package.json'));"),/EXTERNAL_RESOURCE_READ|CONTRACT_RUNTIME_LOAD/],
 ['aliased external resource read',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import {readFile} from 'node:fs/promises'; const source='node_modules/hanaworlds-contracts/package.json'; await readFile(source);"),/EXTERNAL_RESOURCE_READ/],
 ['declaration value load',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import '../contracts-types/index.d.ts';"),/DECLARATION_VALUE_LOAD/],
 ['dynamic require constructor',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import {createRequire} from 'node:module'; const load=createRequire(import.meta.url); load('hanaworlds-contracts');"),/DYNAMIC_MODULE_LOADER/],
 ['unpacked JSON resource',b=>writeFileSync(join(b,'dist/runtime/index.mjs'),"import data from './lost.json' with {type:'json'}; export {data};"),/UNPACKED_LOCAL_DEPENDENCY/],
 ['omitted bundle',b=>rmSync(join(b,'dist/runtime/contracts.mjs')),/UNPACKED_LOCAL_DEPENDENCY/],
 ['wrong source SHA',b=>edit(b,'dist/runtime-build.json',p=>p.sourceResolved='git+https://github.com/other/contracts.git#0000'),/BUILD_SOURCE_MISMATCH/],
 ['changed generated value',b=>writeFileSync(join(b,'dist/runtime/contracts.mjs'),readFileSync(join(b,'dist/runtime/contracts.mjs'),'utf8')+'\nexport const fault=true;'),/ARTIFACT_DIGEST_MISMATCH/],
 ['package import outside tar',b=>edit(b,'package.json',p=>p.imports['#other']='../source/secret.mjs'),/UNPACKED_LOCAL_DEPENDENCY/],
]) test(`actual corrupted tgz refuses ${name}`,t=>{
 const candidate=join(dir,name.replaceAll(' ','-'));mkdirSync(candidate);cpSync(source,join(candidate,'package'),{recursive:true});mutate(join(candidate,'package'));
 const tgz=join(candidate,'negative.tgz');execFileSync('tar',['-czf',tgz,'-C',candidate,'package']);
 const unpack=join(candidate,'unpacked');mkdirSync(unpack);execFileSync('tar',['-xzf',tgz,'-C',unpack]);
 assert.throws(()=>verifyPackage(join(unpack,'package')),expected);
 t.diagnostic(`negative ${name}: ${tgz}`);
});
