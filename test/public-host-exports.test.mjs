// Only the new public packaging surface; no existing candidate gates are replayed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import * as C from 'hanaworlds-contracts';
const root=process.env.HW_PUBLIC_HOST_TEST_ROOT;
if(!root)throw Error('own test root required');
test('public native factory exposes the actual port without inventing child facts',async()=>{
 const {createNativeHost}=await import('hanaworlds-adapter-luanti/host');
 const state=join(root,'empty-native'),profile=join(state,'profile'),worlds=join(profile,'worlds');
 for(const p of [worlds,join(state,'logs'),join(state,'tmp')])await mkdir(p,{recursive:true,mode:0o700});
 const events=[];const owned=createNativeHost({C,state:await realpath(state),profile:await realpath(profile),worlds:await realpath(worlds),luanti:'/usr/bin/false',event:(kind,facts)=>events.push({kind,...facts})});
 assert.equal(typeof owned.host.acquire,'function');assert.equal(typeof owned.host.inspect,'function');assert.equal(typeof owned.host.withStoppedWorld,'function');
 await assert.rejects(owned.host.inspect({controlRef:'own:absent',worldPath:join(worlds,'never-created'),requesterRef:'own:assembly',operationRef:'own:unrun'}),/CURRENT_WORLD_MISMATCH/);
 assert.equal(owned.records.size,0);assert.deepEqual(events,[]);await owned.shutdown();
});
test('public inspection factory provides a lazy forwarding bridge without Canvas facts',async()=>{
 const {createInspectionContext}=await import('hanaworlds-adapter-luanti/inspection-context');
 let reads=0;const bridge=createInspectionContext({resolveCanvas(){reads++;},resolveOracle(){reads++;}});
 assert.equal(typeof bridge.read,'function');assert.equal(reads,0);
});
test('public declarations and runtime subpaths are packaged without development imports',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 for(const sub of ['host','inspection-context']){
  const row=pkg.exports['./'+sub];assert.equal(typeof row.types,'string');assert.equal(typeof row.import,'string');
  const source=await readFile(new URL('../'+row.import,import.meta.url),'utf8');assert.equal(/from\s+['"][^'"]*dev\//.test(source),false);
  assert.ok((await readFile(new URL('../'+row.types,import.meta.url),'utf8')).includes('hanaworlds-contracts'));
 }
});
