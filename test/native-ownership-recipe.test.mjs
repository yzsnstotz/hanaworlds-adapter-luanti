// Actual owned Node child and exit callback; synthetic engine stdout, not REAL_LUANTI.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,realpath,writeFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import * as C from '#contracts';
import {createNativeHost} from '../dev/world-manage/host.mjs';
const base=process.env.HW_BIND_TEST_ROOT;
if(!base) throw Error('own test root required');
test('public native Host recipe retains actual owned PID and exit association across finite callbacks',async()=>{
 await mkdir(base,{recursive:true});const state=await realpath(await mkdtemp(join(base,'native-owner-'))),profile=join(state,'profile'),worlds=join(profile,'worlds'),world=join(worlds,'A');
 for(const d of [world,join(state,'logs'),join(state,'tmp')]) await mkdir(d,{recursive:true});
 const executable=join(state,'synthetic-engine');
 await writeFile(executable,`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';const logfile=process.argv[process.argv.indexOf('--logfile')+1];writeFileSync(logfile,' listening on synthetic engine\\n');process.stdout.write(' listening on synthetic engine\\n');process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000);\n`);await chmod(executable,0o700);
 const events=[],owned=createNativeHost({C,state,profile,worlds,luanti:executable,event:(kind,facts)=>events.push({kind,...facts})});
 try {
  const input={requesterRef:'fixture:host',operationRef:'BIND_RUNNING_WORLD:fixture',worldPath:world,userPath:profile};
  const lease=await owned.host.acquire(input),query={controlRef:lease.controlRef,requesterRef:input.requesterRef,operationRef:input.operationRef,worldPath:world};
  const current=await owned.host.inspect(query);process.kill(current.processId,0);
  await assert.rejects(owned.host.inspect({...query,operationRef:'other-operation'}),/CURRENT_WORLD_MISMATCH/);
  let callbacks=0;
  const consume=async facts=>{callbacks++;assert.equal(facts.state,'STOPPED');assert.equal(facts.processId,current.processId);assert.equal(facts.operationRef,input.operationRef);assert.throws(()=>process.kill(facts.processId,0),{code:'ESRCH'});return 'consumed';};
  assert.equal(await owned.host.withStoppedWorld(query,consume),'consumed');
  assert.equal(await owned.host.withStoppedWorld(query,consume),'consumed');assert.equal(callbacks,2);
  await assert.rejects(owned.host.inspect(query),/CURRENT_WORLD_MISMATCH/);
  const exited=events.find(e=>e.kind==='NATIVE_EXIT');assert.equal(exited.pid,current.processId);assert.equal(exited.code,0);assert.equal(exited.signal,null);
 } finally {await owned.shutdown();await rm(state,{recursive:true});}
});
