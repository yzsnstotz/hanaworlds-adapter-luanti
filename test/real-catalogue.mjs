// Affected Catalogue seam only: own source/package, fixed Cordis and actual Luanti. Host lifecycle is a public peer fixture; no Canvas needed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, cp, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
const root = await realpath(process.env.HW_LOCAL_E);
const installed = process.env.HW_LOCAL_PACKAGE;
assert.ok(installed, 'extract the actual npm package first');
const { apply, inject, payloadDigest } = await import(pathToFileURL(join(installed,'src/index.mjs')));
const C = await import(pathToFileURL(join(installed,'vendor/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(join(process.env.HW_CORDIS_APP,
  'Contents/Resources/hanaworlds-dsh/node_modules/@deepseek-ai/cordis/lib/index.js')));
const profile=join(root,'profile'),world=join(profile,'worlds','current'),home=join(root,'home');
for(const p of [world,home,join(profile,'games','hw_local','mods','base'),join(root,'tmp')]) await mkdir(p,{recursive:true,mode:0o700});
await writeFile(join(profile,'games/hw_local/game.conf'),'title = HanaWorlds local component runtime\n');
await writeFile(join(profile,'games/hw_local/mods/base/mod.conf'),'name = base\n');
await writeFile(join(profile,'games/hw_local/mods/base/init.lua'),"minetest.register_node('base:stone',{description='Static stone',tiles={'unknown_node.png'},paramtype='none',walkable=true})\nminetest.register_node('base:unused_fixture',{description='Unplaced registry material',tiles={'unknown_node.png'},walkable=false,damage_per_second=7,light_source=3})\n");
await writeFile(join(world,'world.mt'),'gameid = hw_local\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
await mkdir(join(world,'worldmods'),{recursive:true});
await cp(process.env.HW_WORLDEDIT,join(world,'worldmods/worldedit'),{recursive:true});
const probe=join(world,'worldmods/hw_probe');await mkdir(probe);
await writeFile(join(probe,'mod.conf'),'name = hw_probe\ndepends = worldedit\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe,'init.lua'),`
local writes=0
local old_set=worldedit.set
worldedit.set=function(...)
  writes=writes+1
  assert(minetest.safe_file_write(minetest.get_worldpath() .. '/probe-writes',tostring(writes)))
  return old_set(...)
end
minetest.after(0,function()
  minetest.load_area({x=0,y=0,z=0},{x=0,y=0,z=0})
  minetest.set_node({x=0,y=0,z=0},{name='air'})
  assert(minetest.safe_file_write(minetest.get_worldpath() .. '/probe-writes','0'))
  local names={}
  for n in pairs(minetest.registered_nodes) do names[#names+1]=n end
  table.sort(names)
  local d=minetest.registered_nodes['base:unused_fixture']
  local source={gameId=minetest.get_game_info().id,mods=minetest.get_modnames(),nodeNames=names,
    unusedNode={walkable=d.walkable,damagePerSecond=d.damage_per_second,lightSource=d.light_source},
    placedNode=minetest.get_node({x=0,y=0,z=0}).name}
  assert(minetest.safe_file_write(minetest.get_worldpath() .. '/catalogue-source.json',assert(minetest.write_json(source))))
  minetest.log('action','HW_LOCAL_READY=' .. tostring(rawget(_G,'hanaworlds_adapter')~=nil))
end)
`);
async function port(){const s=createServer();await new Promise(y=>s.listen(0,'127.0.0.1',y));const n=s.address().port;await new Promise(y=>s.close(y));return n;}
const serverPort=await port(),config=join(root,'luanti.conf');
await writeFile(config,`port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nmg_name = singlenode\nenable_damage = false\n`);
const processes=[],protocol=[],events=[];let child,stage=0,hostInput;
async function waitReady(log,ready){const until=Date.now()+20000;while(Date.now()<until){
  const s=await readFile(log,'utf8').catch(()=> '');if(s.includes(ready))return;
  if(child.exitCode!==null||child.signalCode!==null)throw Error('LUANTI_EARLY_EXIT');
  await new Promise(y=>setTimeout(y,100));}throw Error('LUANTI_READY_TIMEOUT');}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const pending=once(child,'exit');child.kill('SIGINT');const [code,signal]=await pending;
 processes.at(-1).exitCode=code;processes.at(-1).signal=signal;assert.equal(code,0);}
const host={ // Public NativeControl peer fixture controlling the real own process.
 async acquire(input){C.validateType('NativeControlInput',input);assert.equal(input.worldPath,world);assert.equal(input.userPath,profile);
   const log=join(root,`luanti-${++stage}.log`),out=join(root,`luanti-${stage}-stdio.log`);let text='';
   child=spawn('/Applications/luanti.app/Contents/MacOS/luanti',['--server','--world',world,'--config',config,'--logfile',log],
     {env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile,XDG_CACHE_HOME:join(profile,'cache'),TMPDIR:join(root,'tmp')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});child.on('exit',(code,signal)=>{void writeFile(out,text);const item=processes.find(p=>p.pid===child.pid);if(item){item.exitCode=code;item.signal=signal;}});
   processes.push({pid:child.pid,worldPath:world,operationRef:input.operationRef,argv:['--server','--world',world,'--config',config,'--logfile',log]});
   await waitReady(log,`HW_LOCAL_READY=${stage>1}`);hostInput=input;return {controlRef:`real:${child.pid}`,worldPath:world};
 },
 async inspect(q){assert.equal(q.controlRef,`real:${child.pid}`);assert.equal(q.operationRef,hostInput.operationRef);assert.equal(q.worldPath,world);
   process.kill(child.pid,0);assert.equal(child.exitCode,null);events.push({event:'ACTUAL_CURRENT_FACTS',pid:child.pid,worldPath:world,operationRef:q.operationRef});return C.validateType('NativeControlEvidence',{state:'CURRENT',worldPath:world,processId:child.pid,operationRef:q.operationRef});},
 async withStoppedWorld(q,consume){await this.inspect(q);const pid=child.pid;await stop();events.push({event:'STOPPED_CALLBACK',pid,worldPath:world});
   return consume(C.validateType('NativeControlEvidence',{state:'STOPPED',worldPath:world,processId:pid,operationRef:q.operationRef}));}
};
const ctx=new Context();let service;
ctx.provide('webServer',{register(){return ()=>{};}});
ctx.provide('dshHomePath',(...parts)=>join(home,...parts));
ctx.provide('hanaworldsNativeEngineControl',host);
const fiber=ctx.plugin({name:'hanaworlds-adapter-luanti',inject,apply(c){service=apply(c,{localWorldRoots:[join(profile,'worlds')]});}});
await fiber.await();
const local=ctx.get('hanaworldsLuantiLocalWorlds'),native=ctx.get('hanaworldsLuantiNativeFacts');
try {
 const [found]=await local.discover();
 const acquire=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'PROVISION_PAYLOAD'});
 const query=x=>({connectionRef:found.connectionRef,requesterRef:'fixture-host',leaseRef:x.leaseRef});
 const provision=await local.provision(query(acquire));assert.equal(provision.payloadDigest,await payloadDigest());
 const opened=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair(query(opened));
 const count=events.filter(x=>x.event==='ACTUAL_CURRENT_FACTS').length;
 const catalogue=await native.readCatalogue(paired.worldRef);
 C.validateType('Catalogue',catalogue);
 assert.equal(events.filter(x=>x.event==='ACTUAL_CURRENT_FACTS').length-count,2,'native process/world checked before and after read');
 const source=JSON.parse(await readFile(join(world,'catalogue-source.json'),'utf8'));
 assert.equal(catalogue.gameId,source.gameId);
 assert.deepEqual(Object.keys(catalogue.nodes).sort(),source.nodeNames);
 assert.deepEqual(Object.keys(catalogue.modRevisions).sort(),source.mods.sort());
 const unused=catalogue.nodes['base:unused_fixture'];assert.ok(unused);
 assert.equal(source.placedNode,'air');
 for(const k of ['walkable','damagePerSecond','lightSource'])assert.equal(unused[k],source.unusedNode[k]);
 assert.equal(unused.hasPersistentState,null);assert.ok(unused.unknownFields.includes('hasPersistentState'));
 const digest=C.digestValue('catalogue',catalogue).sha256;
 protocol.push({operation:'hanaworldsLuantiNativeFacts.readCatalogue',worldRef:paired.worldRef,connectionRef:paired.connectionRef,
   connectionIncarnationRef:paired.connectionIncarnationRef,result:catalogue,digest,actualSource:source});
 await assert.rejects(()=>native.readCatalogue('wrong-world'),/WORLD_NOT_BOUND/);
 await assert.rejects(()=>native.readCatalogue(paired.connectionRef),/WORLD_NOT_BOUND/);
 assert.equal(events.filter(x=>x.event==='ACTUAL_CURRENT_FACTS').length-count,2,'wrong world never reaches courier');
 assert.equal(await readFile(join(world,'probe-writes'),'utf8'),'0');
 await stop();
 await assert.rejects(()=>native.readCatalogue(paired.worldRef),/CURRENT_WORLD_MISMATCH/);
 events.push({event:'PASS',checks:['root-public-catalogue','actual-full-registry-and-mods','unplaced-material-actual-properties',
   'actual-world-before-after','wrong-world-no-dispatch','stopped-process-reject','read-only-no-write','unknown-facts-preserved'],nodeCount:source.nodeNames.length,digest});
} finally {
 await fiber.dispose();await stop();
 await writeFile(join(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
 await writeFile(join(root,'processes.json'),JSON.stringify(processes,null,2)+'\n');
 await writeFile(join(root,'events.json'),JSON.stringify(events,null,2)+'\n');
}
console.log('Catalogue affected seam REAL_RUNTIME PASS; actual own runtime, public Host lifecycle fixture, no Canvas/transactions/old gate rerun');
