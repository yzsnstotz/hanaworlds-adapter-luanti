// REAL Luanti regression for game mutation between region precheck and restore.
// Host/Canvas caller/hw_probe are test fixtures. The game's registered grass ABM is real.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openRealWorld} from '../dev/stage1-supply/real-world.mjs';
import {LocalCourier} from '../src/local-courier.mjs';
const E=process.env.HW_REAL_E;
assert.ok(E && process.env.HW_GAME && process.env.HW_WORLDEDIT);
const w=await openRealWorld({runRoot:E,game:process.env.HW_GAME,worldedit:process.env.HW_WORLDEDIT,log:console.log});
const C=w.C,box={min:[-16,0,-16],max:[15,15,15]},records={layers:{real:'Luanti/VoxeLibre/WorldEdit/Adapter via official Cordis',fixture:'Host, Canvas caller, hw_probe; controlled invocation of real registered grass-death ABM'},steps:[]};
let seq=0;
const call=(name,input)=>w.region().call(name,{contractVersion:'world-adapter-region/v2',sessionRef:'real-session',requestId:name+'-'+(++seq),worldRef:w.worldRef,localContext:w.localContext,...input});
const read=async()=>{const r=await call('ReadRegion',{box,purpose:'BEFORE_IMAGE'});assert.equal(r.error,null);C.requireKnownRegion(r.result);return r.result;};
function operations(snapshot,effects){return snapshot.chunks.map(c=>{const size=c.box.max.map((v,i)=>v-c.box.min[i]+1),indices=new Int32Array(size.reduce((a,b)=>a*b)).fill(-1),palette=[];
 for(const e of effects){const pos=e.position;if(!pos.every((v,i)=>v>=c.box.min[i]&&v<=c.box.max[i]))continue;
 let k=palette.findIndex(p=>p.nodeName===e.nodeName);if(k<0){k=palette.length;palette.push({nodeName:e.nodeName,param2:0});}indices[(pos[0]-c.box.min[0])+(pos[1]-c.box.min[1])*size[0]+(pos[2]-c.box.min[2])*size[0]*size[1]]=k;}
 return palette.length?{chunkPos:c.chunkPos,expectedCurrentDigest:c.stateDigest,ops:C.encodeRegionBlock({origin:c.box.min,size,palette,indices}),state:null}:null;}).filter(Boolean);}
const restore=(now,target)=>target.chunks.map((c,i)=>({chunkPos:c.chunkPos,expectedCurrentDigest:now.chunks[i].stateDigest,ops:null,state:c.state}));
const digests=r=>r.chunks.map(c=>c.stateDigest);
function differences(a,b){const out=[];for(let c=0;c<a.chunks.length;c++){const x=C.expandRegionBlock(a.chunks[c].state.block),y=C.expandRegionBlock(b.chunks[c].state.block),o=a.chunks[c].state.block.origin,[sx,sy]=x.size;
 for(let i=0;i<x.indices.length;i++){const before=x.palette[x.indices[i]],after=y.palette[y.indices[i]];if(before.nodeName!==after.nodeName||before.param2!==after.param2)out.push({position:[o[0]+i%sx,o[1]+Math.floor(i/sx)%sy,o[2]+Math.floor(i/(sx*sy))],before,after});}}return out;}
const originalRegionWrite=LocalCourier.prototype.regionWrite;let armed=false;
try{
 const probePath=join(w.worldPath,'worldmods/hw_probe/init.lua');const probe=await readFile(probePath,'utf8');
 await writeFile(probePath,probe.replace('if q.protect then',`if q.invokeGrassDeath then
 local p=q.invokeGrassDeath;local pos={x=p[1],y=p[2],z=p[3]};out.before=minetest.get_node(pos)
 for _,abm in pairs(minetest.registered_abms) do if abm.label=='Grass block / mycelium in darkness' then abm.action(pos,out.before);out.invoked=abm.label end end
 out.after=minetest.get_node(pos)
 end
 if q.protect then`));
 await w.connect();const initial=await read();
 const ring=[];for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)if(x||z)for(let y=9;y<=11;y++)ring.push({position:[x,y,z],nodeName:'mcl_core:stone'});
 const sealed=await call('WriteRegion',{transactionId:'seal',purpose:'APPLY',writes:operations(initial,ring)});assert.equal(sealed.error,null);assert.ok(sealed.result.chunks.every(c=>c.status==='WRITTEN'));
 const target=await read();const opened=await call('WriteRegion',{transactionId:'open-door',purpose:'APPLY',writes:operations(target,[9,10,11].map(y=>({position:[1,y,0],nodeName:'air'})))});assert.equal(opened.error,null);assert.ok(opened.result.chunks.every(c=>c.status==='WRITTEN'));
 const doorOpen=await read();armed=true;
 LocalCourier.prototype.regionWrite=async function(args){if(armed&&!args.checkOnly){armed=false;const invoked=await w.probe({invokeGrassDeath:[1,8,-1]});records.steps.push({name:'REAL_REGISTERED_GRASS_ABM',invoked});assert.equal(invoked.invoked,'Grass block / mycelium in darkness');assert.equal(invoked.before.name,'mcl_core:dirt_with_grass');assert.equal(invoked.after.name,'mcl_core:dirt');}return originalRegionWrite.call(this,args);};
 const response=await call('WriteRegion',{transactionId:'controlled-restore-conflict',purpose:'RESTORE',writes:restore(doorOpen,target)}),facts=w.region().lastFacts(),actual=await read();
 const delta=differences(target,actual);records.steps.push({name:'REAL_RESTORE_CONFLICT_ZERO_WRITE',target,doorOpen,response,facts,actual,delta});
 await writeFile(join(E,'conflict-debug.json'),JSON.stringify(records,null,2));
 assert.equal(response.error,null,'null envelope error is not restoration success');assert.ok(response.result.chunks.every(c=>c.status==='NOT_WRITTEN'));
 assert.equal(facts.failure.code,'TRANSACTION_CONFLICT');
 assert.deepEqual(delta.map(c=>({position:c.position,before:c.before.nodeName,after:c.after.nodeName})),[
 {position:[1,8,-1],before:'mcl_core:dirt_with_grass',after:'mcl_core:dirt'},
 {position:[1,9,0],before:'mcl_core:stone',after:'air'},
 {position:[1,10,0],before:'mcl_core:stone',after:'air'},
 {position:[1,11,0],before:'mcl_core:stone',after:'air'}]);
 const rejected=()=>assert.ok(response.result.chunks.every(c=>c.status==='WRITTEN'),'restore must report every chunk WRITTEN');assert.throws(rejected,/restore must report every chunk WRITTEN/);records.steps.push({name:'RESTORE_SUCCESS_ASSERTION_REJECTS_NULL_ERROR_NOT_WRITTEN'});
 // A separate restore after explicit new current facts, with no further injected edits.
 const current=await read(),restored=await call('WriteRegion',{transactionId:'new-facts-restore',purpose:'RESTORE',writes:restore(current,target)}),after=await read();records.steps.push({name:'REAL_RESTORE_WITH_NEW_FACTS',response:restored,after});
 assert.equal(restored.error,null);assert.ok(restored.result.chunks.every(c=>c.status==='WRITTEN'));assert.deepEqual(digests(after),digests(target));
 records.pass=true;console.log('REAL grass mutation / restore conflict regression PASS');
}catch(e){records.pass=false;records.failure={message:e.message,stack:e.stack};throw e;}finally{LocalCourier.prototype.regionWrite=originalRegionWrite;await w.close();records.processes=w.processes;await writeFile(join(E,'results.json'),JSON.stringify(records,null,2)+'\n');}
