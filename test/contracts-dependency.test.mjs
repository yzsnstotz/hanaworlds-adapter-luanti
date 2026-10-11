// Preserve supply-chain refusals under the Q-99 provider-owned document mechanism.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function verify(mutate){const dir=mkdtempSync(join(tmpdir(),'hw-contracts-range-test-'));
 try{
  for(const n of ['scripts','src','docs','fixtures','test/fixtures','package.json','package-lock.json'])cpSync(join(root,n),join(dir,n),{recursive:true});
  mkdirSync(join(dir,'node_modules'),{recursive:true});cpSync(join(root,'node_modules/canonicalize'),join(dir,'node_modules/canonicalize'),{recursive:true});
  mutate?.(dir);const r=spawnSync(process.execPath,['scripts/verify-contracts-range.mjs'],{cwd:dir,encoding:'utf8'});return {exit:r.status,...JSON.parse(r.stdout)};
 }finally{rmSync(dir,{recursive:true,force:true});}}
const edit=(file,change)=>dir=>{const p=join(dir,file),v=JSON.parse(readFileSync(p));change(v);writeFileSync(p,JSON.stringify(v));};
const dependency=spec=>edit('package.json',v=>{v.devDependencies['hanaworlds-contracts']=spec;});
test('documents, actual provider inputs and fixtures conform without external SDK resolution',()=>{const r=verify();assert.equal(r.exit,0,JSON.stringify(r));assert.equal(r.mechanism,'Q-98/Q-99 document protocol');});
for(const [name,mutate] of [
 ['exact tag tarball',dependency('https://codeload.github.com/yzsnstotz/hanaworlds-contracts/tar.gz/refs/tags/v2.0.0')],
 ['commit pin',dependency('git+https://github.com/yzsnstotz/hanaworlds-contracts.git#3377ea81513d9a9446dccd4b626b4bfc183dc711')],
 ['workspace link',dependency('file:../hanaworlds-contracts')],
 ['vendor copy',dir=>mkdirSync(join(dir,'vendor/hanaworlds-contracts'),{recursive:true})],
 ['semver range',dependency('git+https://github.com/yzsnstotz/hanaworlds-contracts.git#semver:^2.0.0')],
 ['github shorthand',dependency('github:yzsnstotz/hanaworlds-contracts#v2.0.0')],
 ['later release tag',dependency('git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.13.1')],
 ['old major tag',dependency('git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v1.0.0')],
 ['prerelease tag',dependency('git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.13.0-rc.3')],
 ['production SDK dependency',edit('package.json',v=>v.dependencies['hanaworlds-contracts']='2.13.0')],
 ['residual lock repository SHA',edit('package-lock.json',v=>v.packages['node_modules/hanaworlds-contracts']={resolved:'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#'+'0'.repeat(40)})],
 ['altered owned schema',dir=>{const p=join(dir,'src/protocol/schema.json');writeFileSync(p,readFileSync(p,'utf8')+'\n');}],
 ['changed input alias',edit('package.json',v=>v.imports['#contracts'].development='./node_modules/hanaworlds-contracts/index.mjs')],
 ['altered documented provider port',dir=>{const p=join(dir,'docs/protocol-scoped-state.md');writeFileSync(p,readFileSync(p,'utf8').replaceAll('readScopedState','invented'));}],
 ['undeclared generated source',dir=>writeFileSync(join(dir,'src/protocol/unverified.mjs'),'export const invented=1;')],
])test(`document/input verification refuses ${name}`,()=>{const r=verify(mutate);assert.equal(r.exit,1);assert.equal(r.ok,false);});
