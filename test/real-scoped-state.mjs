// REAL_ADAPTER_NATIVE_READ: own Luanti/VoxeLibre world; official singleton Cordis.
// Assembly uses only public Adapter/Host ports. An observation-only HTTP tap
// records this world's actual payload commands/results, without altering bytes.
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import * as C from 'hanaworlds-contracts';
const root=await realpath(process.env.HW_SCOPED_STATE_ROOT),artifact=await realpath(process.env.HW_SCOPED_STATE_PACKAGE);
const {apply,inject}=await import(pathToFileURL(join(artifact,'dist/runtime/index.mjs')));
const {createNativeHost}=await import(pathToFileURL(join(artifact,'dist/runtime/host.mjs')));
const profile=join(root,'profile'),worlds=join(profile,'worlds'),home=join(root,'home');
for(const p of [worlds,home,join(profile,'games'),join(root,'logs'),join(root,'tmp')])await mkdir(p,{recursive:true});
await symlink(await realpath(process.env.HW_GAME),join(profile,'games','mineclone2'));
const events=[],commands=[],payloads=[];let transportPort;
const end=ServerResponse.prototype.end,emit=Server.prototype.emit;
ServerResponse.prototype.end=function(data,...rest){
 if(this.socket?.localPort===transportPort&&data){
  const response=JSON.parse(String(data));if(response.command)commands.push(response.command);
 }return end.call(this,data,...rest);
};
Server.prototype.emit=function(event,...args){
 if(event==='request'){
  const req=args[0];if(req.socket.localPort===transportPort&&req.url==='/result'){
   let raw='';req.on('data',chunk=>{raw+=chunk;});req.on('end',()=>payloads.push(JSON.parse(raw)));
  }
 }return emit.call(this,event,...args);
};
const owned=createNativeHost({C,state:root,profile,worlds,luanti:process.env.HW_LUANTI??'/Applications/luanti.app/Contents/MacOS/luanti',event:(kind,facts)=>events.push({kind,...facts})});
const ctx=new Context();let adapter,canvas,created,paired,receipt,failure;
ctx.provide('webServer',{register:()=>()=>{}});ctx.provide('dshHomePath',(...p)=>join(home,...p));ctx.provide('hanaworldsNativeEngineControl',owned.host);
const adapterFiber=ctx.plugin({name:'actual-packed-adapter',inject,apply(c){adapter=apply(c,{localUserPath:profile,localWorldRoots:[worlds]});}});await adapterFiber.await();
const canvasFiber=ctx.plugin({name:'legitimate-renamed-canvas',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(){throw Error('READ_MUST_NOT_SELECT_OR_WRITE');}});}});await canvasFiber.await();
const refused=code=>e=>e.publicError?.code===code&&e.publicError.mutationState==='NONE';
const journalTree=async path=>Promise.all((await readdir(path,{recursive:true,withFileTypes:true})).filter(r=>r.isFile()).map(async r=>({
 path:join(r.parentPath,r.name),sha256:createHash('sha256').update(await readFile(join(r.parentPath,r.name))).digest('hex')})));
try{
 const local=ctx.get('hanaworldsLocalWorlds');
 created=await local.createFlatWorld({requesterRef:'owned-host',userPath:profile,worldName:'scoped-read'});
 transportPort=JSON.parse(await readFile(join(created.worldPath,'worldmods/hanaworlds_adapter/transport.json'),'utf8')).port;
 // Preparation only: emerge a known test region using the real game. No nodes,
 // metadata, inventories or timers are hand-filled to fake a successful read.
 const observer=join(created.worldPath,'worldmods/hw_scoped_observer');await mkdir(observer);
 await writeFile(join(observer,'mod.conf'),'name = hw_scoped_observer\noptional_depends = hanaworlds_adapter\n');
 await writeFile(join(observer,'init.lua'),`minetest.after(0,function()
 minetest.emerge_area({x=-2,y=7,z=-2},{x=2,y=10,z=2},function(_,_,remaining)
 if remaining==0 then minetest.safe_file_write(minetest.get_worldpath()..'/scoped-region-ready','ready') end
 end)
end)\n`);
 const lease=await local.acquire({connectionRef:created.connectionRef,requesterRef:'owned-host',userPath:profile,action:'BIND_RUNNING_WORLD'});
 paired=await local.pair({connectionRef:created.connectionRef,requesterRef:'owned-host',leaseRef:lease.leaseRef});
 while(!(await readFile(join(created.worldPath,'scoped-region-ready'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}))){
  await local.inspect({connectionRef:created.connectionRef,requesterRef:'owned-host',leaseRef:lease.leaseRef});
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const positions=[[-1,9,0],[0,9,0],[1,9,0]],facts=canvas.get('hanaworldsWorldFacts');
 const journal=join(home,'data','hanaworlds-adapter-luanti');
 const historyBefore=await journalTree(journal);
 const begin=commands.length,actual=await facts.readScopedState(paired.connectionRef,positions);
 const snapshot=commands.slice(begin).find(q=>q.operation==='snapshot');assert.ok(snapshot);
 const raw=payloads.find(p=>p.id===snapshot.id);assert.ok(raw?.result,JSON.stringify(raw));
 assert.deepEqual(snapshot.positions,positions);assert.deepEqual(raw.result.coveredPositions,positions);
 assert.deepEqual(actual.cells.map(c=>JSON.parse(JSON.stringify(c.position))),positions);
 const legacy=await ctx.get('hanaworldsLuantiNativeFacts').readScopedState(paired.connectionRef,positions);
 assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(legacy)));
 const readback=await canvas.get('hanaworldsWorldAdapterV6').call('ReadLocalConnection',{contractVersion:'world-adapter/v8',requestId:'scoped-current',sessionRef:'own-read',connectionRef:paired.connectionRef});
 assert.equal(readback.error,null);assert.deepEqual(actual.stateProfile,readback.result.capabilities.stateProfile);
 for(const c of actual.cells)assert.match(c.stateDigest,/^[0-9a-f]{64}$/);
 const failedBegin=commands.length;
 await assert.rejects(facts.readScopedState(paired.connectionRef,[[1000,30000,1000]]),refused('TARGET_FACTS_INCOMPLETE'));
 const failedSnapshot=commands.slice(failedBegin).find(q=>q.operation==='snapshot');
 assert.equal(payloads.find(p=>p.id===failedSnapshot.id)?.error,'TARGET_FACTS_INCOMPLETE');
 for(const [positions,code] of [[[], 'SCHEMA_INVALID'],[[[0,9,0],[0,9,0]],'SCHEMA_INVALID']])
  await assert.rejects(facts.readScopedState(paired.connectionRef,positions),refused(code));
 await assert.rejects(ctx.get('hanaworldsWorldFacts').readScopedState(paired.connectionRef,positions),refused('CAPABILITY_UNAVAILABLE'));
 assert.deepEqual(await journalTree(journal),historyBefore);
 assert.equal(commands.some(q=>['apply','apply_state','restore','region_write','prepare_check'].includes(q.operation)),false);
 const read=facts.readScopedState;canvas.set('hanaworldsCanvasV5',{call(){}});
 await assert.rejects(read(paired.connectionRef,positions),refused('CAPABILITY_UNAVAILABLE'));
 receipt={scope:'REAL_ADAPTER_NATIVE_READ + production artifact in official Cordis; Host peer owns actual process; Canvas peer is public fixture',
  artifact,created:{worldRef:created.worldRef,connectionRef:created.connectionRef,worldPath:created.worldPath,payloadDigest:created.payloadDigest},paired,
  runtime:'@deepseek-ai/cordis@4.0.4',provider:'hanaworldsCanvasV5',fiberName:'legitimate-renamed-canvas',positions,actual,
  actualNativeSnapshot:raw.result,actualNativeFailure:'TARGET_FACTS_INCOMPLETE',sameLegacyOpaqueHashes:true,StateProfileMatchesConnection:true,
  adapterWorldWrites:0,transactionPreparation:0,historyChanges:0,readBindingChanges:0,synchronousGuard:'NOT_ESTABLISHED',UI:'NOT_RUN',owner:'NOT_ACCEPTED'};
}catch(error){failure=error;}finally{
 await adapter.close();await owned.shutdown();await canvasFiber.dispose();await adapterFiber.dispose();await ctx.fiber.dispose();
 ServerResponse.prototype.end=end;Server.prototype.emit=emit;
 await writeFile(join(root,'native-protocol.json'),JSON.stringify({commands,payloads},null,2)+'\n');
 await writeFile(join(root,'processes.json'),JSON.stringify(events,null,2)+'\n');
 await writeFile(join(root,'receipt.json'),JSON.stringify(receipt??{status:'FAILED',error:failure?.message},null,2)+'\n');
}if(failure)throw failure;console.log(JSON.stringify(receipt));
