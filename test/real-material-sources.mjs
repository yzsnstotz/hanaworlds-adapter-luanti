// Affected material-source seam only: own source/package, Cordis 4.0.4 and actual
// Luanti 5.17. The game below is an explicit COMPONENT FIXTURE (hw_material_fixture),
// never the product game. Host lifecycle is a public peer fixture; no Canvas needed.
// Independent engine attestation: Luanti verbose log "Server: <sha1> is <file>"
// lines (Server::addMediaFile) show which bytes the engine itself loaded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, cp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { crc32, deflateSync } from 'node:zlib';
const root = await realpath(process.env.HW_LOCAL_E);
const installed = process.env.HW_LOCAL_PACKAGE;
assert.ok(installed && process.env.HW_CORDIS_MODULE && process.env.HW_WORLDEDIT, 'HW_LOCAL_PACKAGE, HW_CORDIS_MODULE and HW_WORLDEDIT are required');
const { apply, inject, payloadDigest } = await import(pathToFileURL(join(installed,'src/index.mjs')));
const C = await import(pathToFileURL(join(installed,'node_modules/hanaworlds-contracts/dist/local/index.mjs')));
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const sha256=b=>createHash('sha256').update(b).digest('hex'), sha1=b=>createHash('sha1').update(b).digest('hex');
// Distinct valid 1x1 RGB PNG files (different colours) so each source is attributable.
const chunk=(type,data)=>{const len=Buffer.alloc(4),crc=Buffer.alloc(4),td=Buffer.concat([Buffer.from(type),data]);
  len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);};
const png=hex=>{const ihdr=Buffer.from('0000000100000001080200000 0'.replace(/ /g,''),'hex');
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(Buffer.from('00'+hex,'hex'))),chunk('IEND',Buffer.alloc(0))]);};
const bytes={modPlain:png('c08040'),gameStone:png('606060'),modStoneShadowed:png('ff0000'),
  coreShared:png('0060c0'),lateShared:png('f0f0f0'),hidden:png('60f8ff')};
const profile=join(root,'profile'),world=join(profile,'worlds','current'),home=join(root,'home');
const game=join(profile,'games','hw_material_fixture'),core=join(game,'mods','hwm_core'),late=join(game,'mods','hwm_late');
for(const p of [world,home,join(game,'textures','_ignored'),join(core,'textures'),join(late,'textures'),join(root,'tmp')]) await mkdir(p,{recursive:true,mode:0o700});
await writeFile(join(game,'game.conf'),'title = HanaWorlds material-source COMPONENT FIXTURE (not a product game)\n');
await writeFile(join(game,'textures','hwm_game.png'),bytes.gameStone);
await writeFile(join(game,'textures','_ignored','hwm_hidden.png'),bytes.hidden);
await writeFile(join(core,'mod.conf'),'name = hwm_core\n');
await writeFile(join(core,'textures','hwm_plain.png'),bytes.modPlain);
await writeFile(join(core,'textures','hwm_game.png'),bytes.modStoneShadowed);
await writeFile(join(core,'textures','hwm_shared.png'),bytes.coreShared);
await writeFile(join(late,'mod.conf'),'name = hwm_late\ndepends = hwm_core\n');
await writeFile(join(late,'init.lua'),'-- media-only mod loaded after hwm_core\n');
await writeFile(join(late,'textures','hwm_shared.png'),bytes.lateShared);
const reg=(n,d)=>`core.register_node('hwm_core:${n}',${d})\n`;
await writeFile(join(core,'init.lua'),[
  reg('plain',"{tiles={'hwm_plain.png'}}"),
  reg('rotated',"{paramtype2='facedir',tiles={'hwm_plain.png'}}"),
  reg('game_stone',"{tiles={'hwm_game.png'}}"),
  reg('shared',"{tiles={'hwm_shared.png'}}"),
  reg('faces',"{tiles={'hwm_plain.png','hwm_game.png'}}"),
  reg('modified',"{tiles={'hwm_plain.png^[brighten'}}"),
  reg('wall',"{paramtype2='wallmounted',tiles={'hwm_plain.png'}}"),
  reg('missing',"{tiles={'hwm_absent.png'}}"),
  reg('hidden',"{tiles={'hwm_hidden.png'}}"),
].join(''));
await writeFile(join(world,'world.mt'),'gameid = hw_material_fixture\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
await mkdir(join(world,'worldmods'),{recursive:true});
await cp(process.env.HW_WORLDEDIT,join(world,'worldmods/worldedit'),{recursive:true});
const probe=join(world,'worldmods/hw_probe');await mkdir(probe);
await writeFile(join(probe,'mod.conf'),'name = hw_probe\ndepends = worldedit\noptional_depends = hanaworlds_adapter\n');
// Independent native source dump and write counters (WorldEdit + set_node/swap_node).
await writeFile(join(probe,'init.lua'),`
local writes=0
local function count(name)
  local old=assert(name=='set' and worldedit.set or minetest[name])
  local wrapped=function(...)
    writes=writes+1
    assert(minetest.safe_file_write(minetest.get_worldpath() .. '/probe-writes',tostring(writes)))
    return old(...)
  end
  if name=='set' then worldedit.set=wrapped else minetest[name]=wrapped end
end
minetest.after(0,function()
  assert(minetest.safe_file_write(minetest.get_worldpath() .. '/probe-writes','0'))
  for _,n in ipairs({'set','set_node','swap_node','bulk_set_node','add_node','remove_node'}) do count(n) end
  local nodes={}
  for name,d in pairs(minetest.registered_nodes) do
    if name:find('^hwm_core:') then nodes[name]={tiles=d.tiles,paramtype2=d.paramtype2,drawtype=d.drawtype} end
  end
  local info=minetest.get_game_info()
  local source={gameId=info.id,gamePath=info.path,userPath=minetest.get_user_path(),
    modsLoadOrder=minetest.get_modnames(true),nodes=nodes}
  assert(minetest.safe_file_write(minetest.get_worldpath() .. '/material-source.json',assert(minetest.write_json(source))))
  minetest.log('action','HW_LOCAL_READY=' .. tostring(rawget(_G,'hanaworlds_adapter')~=nil))
end)
`);
async function port(){const s=createServer();await new Promise(y=>s.listen(0,'127.0.0.1',y));const n=s.address().port;await new Promise(y=>s.close(y));return n;}
const serverPort=await port(),config=join(root,'luanti.conf');
await writeFile(config,`port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nmg_name = singlenode\nenable_damage = false\ndebug_log_level = verbose\n`);
const processes=[],protocol=[],events=[];let child,stage=0,hostInput,logPath;
async function waitReady(log,ready){const until=Date.now()+30000;while(Date.now()<until){
  const s=await readFile(log,'utf8').catch(()=> '');if(s.includes(ready))return;
  if(child.exitCode!==null||child.signalCode!==null)throw Error('LUANTI_EARLY_EXIT');
  await new Promise(y=>setTimeout(y,100));}throw Error(`LUANTI_READY_TIMEOUT waiting for ${ready} in ${log}`);}
async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const pending=once(child,'exit');child.kill('SIGINT');const [code,signal]=await pending;
 processes.at(-1).exitCode=code;processes.at(-1).signal=signal;assert.equal(code,0);}
const host={ // Public NativeControl peer fixture controlling the real own process.
 async acquire(input){C.validateType('NativeControlInput',input);assert.equal(input.worldPath,world);assert.equal(input.userPath,profile);
   const log=join(root,`luanti-${++stage}.log`),out=join(root,`luanti-${stage}-stdio.log`);let text='';logPath=log;
   const argv=['--server','--world',world,'--config',config,'--logfile',log];
   child=spawn('/Applications/luanti.app/Contents/MacOS/luanti',argv,
     {env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile,XDG_CACHE_HOME:join(profile,'cache'),TMPDIR:join(root,'tmp')},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});child.on('exit',(code,signal)=>{void writeFile(out,text);const item=processes.find(p=>p.pid===child.pid);if(item){item.exitCode=code;item.signal=signal;}});
   processes.push({pid:child.pid,worldPath:world,operationRef:input.operationRef,argv});
   await waitReady(log,`HW_LOCAL_READY=${stage>1}`);hostInput=input;return {controlRef:`real:${child.pid}`,worldPath:world};
 },
 async inspect(q){assert.equal(q.controlRef,`real:${child.pid}`);assert.equal(q.operationRef,hostInput.operationRef);assert.equal(q.worldPath,world);
   process.kill(child.pid,0);assert.equal(child.exitCode,null);events.push({event:'ACTUAL_CURRENT_FACTS',pid:child.pid,worldPath:world,operationRef:q.operationRef});return C.validateType('NativeControlEvidence',{state:'CURRENT',worldPath:world,processId:child.pid,operationRef:q.operationRef});},
 async withStoppedWorld(q,consume){await this.inspect(q);const pid=child.pid;await stop();events.push({event:'STOPPED_CALLBACK',pid,worldPath:world});
   return consume(C.validateType('NativeControlEvidence',{state:'STOPPED',worldPath:world,processId:pid,operationRef:q.operationRef}));}
};
const ctx=new Context();
ctx.provide('webServer',{register(){return ()=>{};}});
ctx.provide('dshHomePath',(...parts)=>join(home,...parts));
ctx.provide('hanaworldsNativeEngineControl',host);
const fiber=ctx.plugin({name:'hanaworlds-adapter-luanti',inject,apply(c){apply(c,{localWorldRoots:[join(profile,'worlds')]});}});
await fiber.await();
const local=ctx.get('hanaworldsLuantiLocalWorlds'),native=ctx.get('hanaworldsLuantiNativeFacts');
const checks=[];
try {
 const [found]=await local.discover();
 const acquire=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'PROVISION_PAYLOAD'});
 const query=x=>({connectionRef:found.connectionRef,requesterRef:'fixture-host',leaseRef:x.leaseRef});
 const provision=await local.provision(query(acquire));assert.equal(provision.payloadDigest,await payloadDigest());
 const opened=await local.acquire({connectionRef:found.connectionRef,requesterRef:'fixture-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 const paired=await local.pair(query(opened));
 const connection={worldRef:paired.worldRef,connectionRef:paired.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef};
 const source=JSON.parse(await readFile(join(world,'material-source.json'),'utf8'));
 // Engine-side attestation: sha1 per media file name actually loaded at startup.
 const engineMedia={};for(const m of (await readFile(logPath,'utf8')).matchAll(/Server: ([0-9a-f]{40}) is (\S+)/g)) engineMedia[m[2]]=m[1];

 const count=()=>events.filter(x=>x.event==='ACTUAL_CURRENT_FACTS').length;
 let before=count();
 const first=await native.readMaterialSources(paired.worldRef);
 assert.equal(count()-before,2,'actual native process/world checked before and after the read');
 const catalogue=await native.readCatalogue(paired.worldRef);
 const valid=C.validateMaterialSources(first,catalogue,connection);checks.push('public-supplier-validates-against-fresh-catalogue-and-connection');
 assert.equal(first.snapshot.gameId,'hw_material_fixture');assert.equal(first.snapshot.gameId,source.gameId);
 const rows=Object.fromEntries(valid.snapshot.materials.filter(r=>r.nodeName.startsWith('hwm_core:')).map(r=>[r.nodeName,r]));
 assert.deepEqual(Object.keys(rows).sort(),Object.keys(source.nodes).sort());
 const blob=d=>Buffer.from(valid.textures.find(t=>t.bytesDigest===d).bytes);
 const known=(name,kind,ref,file,expected)=>{const r=rows[name];assert.equal(r.availability,'KNOWN',name);
   assert.equal(r.texture.sourceKind,kind);assert.equal(r.texture.sourceRef,ref);assert.equal(r.texture.textureName,file);
   assert.equal(r.texture.bytesDigest,sha256(expected));assert.deepEqual(blob(r.texture.bytesDigest),expected);
   assert.equal(engineMedia[file],sha1(expected),`engine loaded the same bytes for ${file}`);};
 known('hwm_core:plain','MOD','mod:hwm_core/textures/hwm_plain.png','hwm_plain.png',bytes.modPlain);
 known('hwm_core:game_stone','GAME','game:hw_material_fixture/textures/hwm_game.png','hwm_game.png',bytes.gameStone);
 checks.push('game-textures-outrank-mod-textures-engine-attested');
 known('hwm_core:shared','MOD','mod:hwm_late/textures/hwm_shared.png','hwm_shared.png',bytes.lateShared);
 assert.deepEqual(source.modsLoadOrder.indexOf('hwm_late')>source.modsLoadOrder.indexOf('hwm_core'),true);
 checks.push('later-loaded-mod-outranks-earlier-engine-attested');
 known('hwm_core:rotated','MOD','mod:hwm_core/textures/hwm_plain.png','hwm_plain.png',bytes.modPlain);
 assert.deepEqual(catalogue.nodes['hwm_core:rotated'].allowedParam2,Array.from({length:24},(_,i)=>i));
 assert.deepEqual(catalogue.nodes['hwm_core:plain'].allowedParam2,[0]);
 assert.equal(rows['hwm_core:rotated'].param2,0);assert.equal(source.nodes['hwm_core:rotated'].paramtype2,'facedir');
 assert.equal(catalogue.nodes['hwm_core:wall'].allowedParam2,null);
 assert.equal(rows['hwm_core:wall'].reason,'UNKNOWN_PARAM2');assert.equal(rows['hwm_core:wall'].param2,null);
 checks.push('legal-param2-from-native-paramtype2');
 assert.equal(rows['hwm_core:faces'].reason,'UNSUPPORTED_APPEARANCE');assert.equal(rows['hwm_core:modified'].reason,'UNSUPPORTED_APPEARANCE');
 assert.equal(rows['hwm_core:missing'].reason,'MISSING_TEXTURE');
 assert.equal(rows['hwm_core:hidden'].reason,'MISSING_TEXTURE');assert.equal(engineMedia['hwm_hidden.png'],undefined,'engine ignores _-prefixed dirs');
 checks.push('unsupported-missing-ignored-explicit-unknown');
 for(const r of Object.values(rows)) if(r.availability==='UNKNOWN') assert.equal(r.texture,null);
 for(const n of Object.keys(rows)){assert.equal(catalogue.nodes[n].hasPersistentState,null);assert.equal(catalogue.nodes[n].collisionBoxes,null);}
 checks.push('static-unknowns-not-filled-by-known-texture');
 protocol.push({operation:'hanaworldsLuantiNativeFacts.readMaterialSources',connection,snapshot:first.snapshot,
   textures:first.textures.map(t=>({bytesDigest:t.bytesDigest,byteLength:t.bytes.length})),engineMedia,actualSource:source});

 // Fresh read after actual byte change: new sourceRevision, unchanged registry revision.
 await writeFile(join(core,'textures','hwm_plain.png'),png('a07020'));
 const second=await native.readMaterialSources(paired.worldRef);
 C.validateMaterialSources(second,await native.readCatalogue(paired.worldRef),connection);
 assert.notEqual(second.snapshot.sourceRevision,first.snapshot.sourceRevision);
 assert.equal(second.snapshot.gameRevision,first.snapshot.gameRevision);
 assert.equal(second.snapshot.materials.find(r=>r.nodeName==='hwm_core:plain').texture.bytesDigest,sha256(png('a07020')));
 await writeFile(join(core,'textures','hwm_plain.png'),bytes.modPlain);
 checks.push('fresh-byte-change-new-sourceRevision');
 protocol.push({operation:'readMaterialSources-after-byte-change',sourceRevision:second.snapshot.sourceRevision,gameRevision:second.snapshot.gameRevision});

 // A different incarnation is not the current connection for the pure validator.
 assert.throws(()=>C.validateMaterialSources(first,catalogue,{...connection,connectionIncarnationRef:'other-incarnation'}),/CURRENT_WORLD_MISMATCH/);
 before=count();
 await assert.rejects(()=>native.readMaterialSources('wrong-world'),/WORLD_NOT_BOUND/);
 await assert.rejects(()=>native.readMaterialSources(paired.connectionRef),/WORLD_NOT_BOUND/);
 assert.equal(count(),before,'wrong world never reaches the native courier');
 checks.push('wrong-world-no-dispatch','incarnation-bound');
 assert.equal(await readFile(join(world,'probe-writes'),'utf8'),'0');
 checks.push('read-only-zero-world-writes');
 await stop();
 await assert.rejects(()=>native.readMaterialSources(paired.worldRef),/CURRENT_WORLD_MISMATCH/);
 checks.push('stopped-process-reject');
 events.push({event:'PASS',checks,gameId:source.gameId,fixture:'COMPONENT_FIXTURE_GAME_NOT_PRODUCT',sourceRevision:first.snapshot.sourceRevision});
} finally {
 await fiber.dispose();await stop();
 await writeFile(join(root,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
 await writeFile(join(root,'processes.json'),JSON.stringify(processes,null,2)+'\n');
 await writeFile(join(root,'events.json'),JSON.stringify(events,null,2)+'\n');
}
console.log(`Material sources affected seam REAL_RUNTIME PASS (${checks.length} checks); component fixture game, public Host lifecycle fixture, no Canvas/transactions/old gate rerun`);
