// REAL_ENGINE + real loopback courier. Fresh test-only world; no product Host/UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { writePayload } from '../src/local-worlds.mjs';
import { LocalCourier } from '../src/local-courier.mjs';
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('real Luanti courier enforces configured result boundary for snapshot, readback and region read without retries',async t=>{
 const base=process.env.HW_ADAPTER_TEST_ROOT??join(tmpdir(),'hanaworlds-adapter-policy');await mkdir(base,{recursive:true});
 const root=await mkdtemp(join(base,'real-courier-')),profile=join(root,'profile'),world=join(profile,'worlds','fixture');
 const mod=join(profile,'games/policy_fixture/mods/base');await mkdir(mod,{recursive:true});
 await mkdir(join(world,'worldmods/hanaworlds_adapter'),{recursive:true});
 await writeFile(join(profile,'games/policy_fixture/game.conf'),'title = Courier policy fixture\n');
 await writeFile(join(mod,'mod.conf'),'name = base\n');
 const bytes=131072;
 await writeFile(join(mod,'init.lua'),`
minetest.register_node('base:stone',{description='Fixture',tiles={'unknown_node.png'}})
minetest.after(0,function()
 minetest.emerge_area({x=0,y=0,z=0},{x=15,y=15,z=15},function(_,_,remaining)
  if remaining~=0 then return end
  minetest.set_node({x=0,y=0,z=0},{name='base:stone'})
  minetest.get_meta({x=0,y=0,z=0}):set_string('blob',string.rep('x',${bytes}))
  minetest.log('action','HW_POLICY_READY')
 end)
end)
`);
 await writeFile(join(world,'world.mt'),'gameid = policy_fixture\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
 const settings={courierBodyBytes:bytes,courierResultWaitMs:30000};
 const identity=await writePayload(join(world,'worldmods/hanaworlds_adapter'),{transportPort:await port(),transportSettings:settings});
 const courier=await LocalCourier.open({...identity,worldPath:world},settings);
 const conf=join(root,'luanti.conf'),log=join(root,'luanti.log');
 await writeFile(conf,`port = ${await port()}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nmg_name = singlenode\n`);
 let stdio='';const child=spawn(process.env.HW_LUANTI_BINARY??'/Applications/luanti.app/Contents/MacOS/luanti',
 ['--server','--world',world,'--config',conf,'--logfile',log],{env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdio+=b);child.stderr.on('data',b=>stdio+=b);
 const exit=once(child,'exit');let summary={evidence:'REAL_ENGINE/COURIER; Host/UI peer not exercised',pid:child.pid,worldPath:world,settings,operations:[]};
 try {
  const until=Date.now()+20000;
  while(!(await readFile(log,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).includes('HW_POLICY_READY')) {
   if(child.exitCode!==null||child.signalCode!==null)throw Error('LUANTI_EARLY_EXIT: '+stdio);
   if(Date.now()>until)throw Error('LUANTI_READY_TIMEOUT');await new Promise(r=>setTimeout(r,100));
  }
  await courier.handshake();assert.equal((await courier.regionLimits()).maxBodyBytes,bytes);
  for(const [operation,input] of [['snapshot',{positions:[[0,0,0]]}],['readback',{positions:[[0,0,0]]}],
   ['region_read',{geometryProfile:'voxel-grid/v1',partition:{edge:[16,16,16]},min:[0,0,0],max:[0,0,0],boxes:[{min:[0,0,0],max:[0,0,0]}]}]]) {
   await assert.rejects(()=>courier.dispatch(operation,input),e=>e.message==='LIMIT_EXCEEDED'&&e.source?.resource==='courier-result-body');
   summary.operations.push({operation,error:'LIMIT_EXCEEDED',source:'courier-result-body'});
  }
  assert.equal(courier.queue.length,0);assert.equal(courier.pending.size,0);
  const text=await readFile(log,'utf8');assert.match(text,/courier-result-body LIMIT/);summary.status='PASS';
 } finally {
  await courier.close();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGINT');
  const [code,signal]=await exit;summary.exitCode=code;summary.signal=signal;
  await writeFile(join(root,'stdio.log'),stdio);await writeFile(join(root,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
  assert.equal(code,0);
 }
});
