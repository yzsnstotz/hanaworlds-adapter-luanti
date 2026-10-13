// Actual Adapter + official Cordis + real Luanti child. No replacement of
// LocalCourier, facts.lua, sourceDeclaration, readCanvasFacts or response bytes.
// Observer: native coordinates, write counters, passive HTTP recording. Faults
// edit only the normal declaration in this test's already-created world.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, realpath, symlink, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Server, ServerResponse } from 'node:http';
const cfg=JSON.parse(process.argv[2]),{root,artifact,mode,scenario}=cfg;
const plain=x=>JSON.parse(JSON.stringify(x)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile(join(artifact,'package.json'),'utf8'));
const {Context}=mode==='source'?await import('@deepseek-ai/cordis'):
 await import(pathToFileURL(cfg.cordis));
const {apply,inject}=await import(pathToFileURL(join(artifact,mode==='source'?'src/index.mjs':manifest.exports['.'].import)));
const {createNativeHost}=await import(pathToFileURL(join(artifact,mode==='source'?'src/host.mjs':manifest.exports['./host'].import)));
const profile=join(root,'profile'),worlds=join(profile,'worlds'),home=join(root,'home');
for(const p of [worlds,home,join(root,'logs'),join(root,'tmp'),join(profile,'games')])await mkdir(p,{recursive:true});
if(cfg.game)await symlink(await realpath(cfg.game),join(profile,'games','mineclone2'));
else {
 const game=join(profile,'games','canvas_native'),mod=join(game,'mods','base');await mkdir(mod,{recursive:true});
 await writeFile(join(game,'game.conf'),'title = Native Canvas test environment\nallowed_mapgens = flat\n');
 await writeFile(join(mod,'mod.conf'),'name = base\n');
 await writeFile(join(mod,'init.lua'),`core.register_node('base:stone',{description='Native marker',tiles={'unknown_node.png'}})
core.register_alias('mapgen_stone','base:stone')
core.register_alias('mapgen_water_source','air')
core.register_alias('mapgen_river_water_source','air')\n`);
}
const points=[[-11,4,-2],[-2,-11,4],[13,-7,22],[22,13,-7]];
const commands=[],results=[],events=[],checks=[];let transportPort,externalFault=null,created,adapter,canvas,adapterFiber,canvasFiber;
// Observation of actual bytes, without replacing, delaying or rewriting a response.
const originalEnd=ServerResponse.prototype.end,originalEmit=Server.prototype.emit;
ServerResponse.prototype.end=function(data,...rest){
 if(this.socket?.localPort===transportPort&&data){const out=JSON.parse(String(data));if(out.command)commands.push(plain(out.command));}
 return originalEnd.call(this,data,...rest);
};
Server.prototype.emit=function(event,...args){
 if(event==='request'){
  const req=args[0];if(req.socket.localPort===transportPort&&req.url==='/result'){
   let raw='';req.on('data',chunk=>{raw+=chunk;});req.on('end',()=>{
    const out=JSON.parse(raw);results.push(out);
    const command=commands.find(q=>q.id===out.id);
    if(externalFault&&command?.operation==='fact_world_source'&&out.result?.canvasFacts){
     const fault=externalFault;externalFault=null;
     // Controlled external file edit, AFTER real native result serialization and
     // BEFORE its receipt releases the caller to the second genuine native read.
     writeFileSync(fault.path,fault.bytes,{mode:0o600});fault.fired=true;
    }
   });
  }
 }
 return originalEmit.call(this,event,...args);
};
const host=createNativeHost({state:root,profile,worlds,luanti:cfg.luanti,event:(kind,value)=>events.push({kind,...value})});
const ctx=new Context();ctx.provide('webServer',{register:()=>()=>{}});ctx.provide('dshHomePath',(...p)=>join(home,...p));ctx.provide('hanaworldsNativeEngineControl',host.host);
for(const name of ['hanaworldsCanvasHistoryFacts','hanaworldsCanvasFootprintRegistry'])ctx.provide(name,{call(){throw Error('FACT_READ_MUST_NOT_MUTATE_PEER');}});
const traceResult=operation=>{
 const command=[...commands].reverse().find(q=>q.operation===operation);assert.ok(command,`actual ${operation} command missing`);
 const response=results.find(r=>r.id===command.id);assert.ok(response,`actual ${operation} result missing`);return {command,response};
};
const waitFor=async(path)=>{
 const until=Date.now()+30000;
 while(true){
  const value=await readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(value!==null)return value;
  for(const r of host.records.values())assert.equal(r.exit,null,`native exited early: ${r.logfile}`);
  assert.ok(Date.now()<until,`test setup observation missing: ${path}`);await new Promise(r=>setTimeout(r,50));
 }
};
const journal=async()=>{
 const all={};async function walk(path){for(const e of await readdir(path,{withFileTypes:true})){const p=join(path,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())all[p]=hash(await readFile(p));}}
 await walk(home);return all;
};
const refused=code=>e=>{
 assert.ok(e.publicError,`public refusal missing: ${e.message}`);assert.equal(e.publicError.mutationState,'NONE');
 assert.equal(e.publicError.transactionRef,null);return e.publicError.code===code;
};
let local,paired,scope,port;
async function observe(){
 const id=`observe-${Date.now()}-${Math.random()}`;
 await writeFile(join(created.worldPath,'canvas-probe-query.json'),JSON.stringify({id,points}));
 const out=JSON.parse(await waitFor(join(created.worldPath,`${id}.json`)));
 assert.equal(out.id,id);return out;
}
async function audit(read){
 const before=await observe(),files=await journal(),begin=commands.length,life=events.length;
 const binding=plain(await local.inspect({connectionRef:created.connectionRef,requesterRef:'native-test',leaseRef:paired.leaseRef}));
 try{return await read();}finally{
  const after=await observe();assert.deepEqual(after.nodes,before.nodes,'world cell state changed');
  assert.deepEqual(after.writes,before.writes,'native writes/emerge/lighting during a fact read');
  assert.deepEqual(await journal(),files,'history/transaction/binding files changed');
  assert.equal(events.length,life,'runtime binding/lifecycle changed');
  assert.deepEqual(plain(await local.inspect({connectionRef:created.connectionRef,requesterRef:'native-test',leaseRef:paired.leaseRef})),binding);
  const writes=new Set(['apply','apply_state','restore','region_write','prepare_check','region_emerge']);
  assert.equal(commands.slice(begin).some(q=>writes.has(q.operation)),false,'fact supplier dispatched a native write or preparation');
 }
}
const declarationName='canvas-facts.json';
const declarationPath=()=>join(created.worldPath,'worldmods/hanaworlds_adapter',declarationName);
let originalDeclaration,decl;
async function loadNormalDeclaration(){
 const packedPath=join(artifact,'payload/hanaworlds_adapter',declarationName);
 assert.ok(await access(packedPath).then(()=>true,()=>false),'normal production payload must contain canvas-facts.json');
 originalDeclaration=await readFile(packedPath);assert.deepEqual(await readFile(declarationPath()),originalDeclaration,'normal installer did not load the shipped declaration');
 decl=JSON.parse(originalDeclaration);assert.equal(decl.profileVersion,'canvas-declaration/v1');
 assert.deepEqual(Object.keys(decl).sort(),['frame','profileVersion','tools','unit']);
 assert.ok(Array.isArray(decl.tools)&&decl.tools.length>0,'normal declaration must contain the complete nonempty tool list');
 const refs=decl.tools.map(t=>t.toolRef);assert.deepEqual(refs,[...new Set(refs)].sort());
 for(const tool of decl.tools){assert.equal(typeof tool.purpose,'string');assert.ok(tool.purpose.length);assert.equal(tool.typicalScale.size.length,3);assert.ok(tool.typicalScale.size.every(x=>Number.isSafeInteger(x)&&x>0));assert.equal(tool.typicalScale.unit,decl.unit.name);}
 assert.equal(decl.frame.profileVersion,'frame/v2');assert.deepEqual(decl.frame.gridUnit,decl.unit);
 assert.deepEqual(Object.keys(decl.unit).sort(),['metersPerGridUnit','name']);
 assert.deepEqual(Object.keys(decl.frame).sort(),['axes','frameId','gridUnit','handedness','origin','profileVersion','transformRevision']);
 return decl;
}
function assertSource(value,kind,revision){
 assert.deepEqual(Object.keys(value).sort(),['source','value']);
 assert.deepEqual(Object.keys(value.source).sort(),['factRef','kind','revision']);
 assert.equal(value.source.kind,kind);assert.equal(typeof value.source.factRef,'string');assert.ok(value.source.factRef.length);
 assert.equal(typeof value.source.revision,'string');assert.ok(value.source.revision.length);if(revision)assert.equal(value.source.revision,revision);
}
function nativeCanvas(){const r=traceResult('fact_world_source');assert.equal(r.response.error,null);assert.ok(r.response.result?.canvasFacts,'actual payload source declaration must contain canvasFacts');return r.response.result.canvasFacts;}
function checkNativeFacts(raw,body=decl,revision=hash(originalDeclaration)){
 assert.deepEqual(raw.tools.map(t=>t.toolRef),body.tools.map(t=>t.toolRef));
 for(let i=0;i<body.tools.length;i++){
  assert.deepEqual(raw.tools[i].purpose.value,body.tools[i].purpose);assert.deepEqual(raw.tools[i].typicalScale.value,body.tools[i].typicalScale);
  assertSource(raw.tools[i].purpose,'LOADED_WORLD_DECLARATION',revision);assertSource(raw.tools[i].typicalScale,'LOADED_WORLD_DECLARATION',revision);
 }
 for(const field of ['unit','frame']){assert.deepEqual(raw[field].value,body[field]);assertSource(raw[field],'LOADED_WORLD_DECLARATION',revision);}
 assertSource(raw.partition,'NATIVE_OBSERVATION');return raw;
}
async function readComplete(declarationBody=decl,bytes=originalDeclaration){
 assert.equal(typeof port.readCanvasFacts,'function','normal neutral readCanvasFacts capability missing');
 const nativeBegin=commands.length;
 const result=await audit(()=>port.readCanvasFacts(scope));
 const sourceReads=commands.slice(nativeBegin).filter(q=>q.operation==='fact_world_source');
 assert.ok(sourceReads.length>=2,'each public fact read needs fresh before/after actual payload source observations');
 for(const command of sourceReads)assert.equal(command.worldRef,scope.worldRef);
 assert.deepEqual(plain(result.connection),scope);assert.equal(result.profileVersion,'canvas-source-facts/v1');
 const raw=checkNativeFacts(nativeCanvas(),declarationBody,hash(bytes));
 for(const field of ['tools','unit','frame','partition'])assert.deepEqual(plain(result[field]),raw[field],`public ${field} differs from real payload source`);
 const observation=await observe();assert.deepEqual(result.partition.value.edge,[observation.edge,observation.edge,observation.edge]);
 const limits=traceResult('region_limits');assert.equal(limits.response.result.mapblockSize,observation.edge);
 assert.equal(typeof result.provider.providerRef,'string');assert.ok(result.provider.providerRef);assert.ok(result.provider.providerRevision);
 const {sourceRevision,...body}=plain(result);const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;
 assert.equal(sourceRevision,hash(JSON.stringify(canonical(body))));
 checks.push({case:'complete',sourceRevision,connection:scope,provider:result.provider,actual:result,declarationSHA256:hash(bytes)});
 return result;
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const negate=a=>a.map(v=>-v);
const determinant=([a,b,c])=>a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
const closeVector=(a,b)=>{for(let i=0;i<3;i++)assert.ok(Math.abs(a[i]-b[i])<1e-10,`native direction mismatch: ${a} vs ${b}`);};
function independentHandedness(observation,records){
 // External engine reference, NOT Adapter's Frame, defaults or declaration:
 // https://api.luanti.org/coordinate-system/ defines physical right/up/forward.
 // https://api.luanti.org/nodes/ defines facedir quarter-turns and wallmounted 0 up.
 // Runtime yaw and facedir rotations must agree on actual forward/right; use
 // physical (right, up, BACKWARD) as the right-handed reference by definition.
 // No expected handedness string or production transform literal is copied.
 const {yaw0,yawMinusQuarter,yawPlusQuarter,turns,up,engineVersion}=observation.orientation;
 const forward=yaw0,right=yawMinusQuarter;
 closeVector(turns[0],forward);closeVector(turns[1],right);
 closeVector(turns[2],negate(forward));closeVector(turns[3],negate(right));
 closeVector(yawPlusQuarter,negate(right));
 for(const a of [right,up,forward])assert.ok(Math.abs(dot(a,a)-1)<1e-10,'native reference is not unit length');
 for(const [a,b] of [[right,up],[right,forward],[up,forward]])assert.ok(Math.abs(dot(a,b))<1e-10,'native reference is not orthogonal');
 const project=v=>[dot(v,right),dot(v,up),-dot(v,forward)];
 // Four distinct signed samples form a nondegenerate tetrahedron. Its signed
 // volume ratio measures the ACTUAL neutral -> native -> physical transform,
 // including permutations/reflections, independently of Frame.axes/origin.
 const neutralVolume=determinant(points.slice(1).map(p=>subtract(p,points[0])));
 const native=records.map(r=>r.position);
 const referenceVolume=determinant(native.slice(1).map(p=>project(subtract(p,native[0]))));
 assert.notEqual(neutralVolume,0);assert.notEqual(referenceVolume,0);
 const ratio=referenceVolume/neutralVolume;assert.ok(Math.abs(Math.abs(ratio)-1)<1e-10,'actual coordinate transform changed volume');
 const measuredHandedness=ratio>0?'right':'left';
 const calibration={engineVersion,reference:'physical right/up/backward',orientation:observation.orientation,neutralVolume,referenceVolume,ratio,measuredHandedness};
 checks.push({case:'independent-native-handedness',...calibration});return calibration;
}
async function coordinates(frame){
 // Native probe is independent of Adapter's Record encoder and reads x/y/z and
 // registered markers at four signed, nonzero, distinct-axis positions.
 const observation=await observe();const facts=await audit(()=>port.readScopedState(scope.connectionRef,points));
 const {command,response}=traceResult('snapshot');assert.equal(response.error,null);
 assert.deepEqual(command.positions,points);assert.deepEqual(response.result.coveredPositions,points);
 assert.deepEqual(response.result.records.map(r=>r.position),points);assert.deepEqual(facts.cells.map(r=>plain(r.position)),points);
 assert.deepEqual(response.result.records.map(r=>r.nodeName),observation.nodes.map(n=>n.node.name));
 assert.deepEqual(observation.nodes.map(n=>n.position),points);
 for(let i=0;i<points.length;i++)assert.equal(response.result.records[i].metadata['axis-marker'],points[i].join(','));
 const calibration=independentHandedness(observation,response.result.records);
 if(frame){
  const axes={X:0,Y:1,Z:2};assert.equal(new Set(frame.axes.map(a=>a.slice(1))).size,3);
  const forward=p=>{const n=[...frame.origin];for(let i=0;i<3;i++)n[axes[frame.axes[i].slice(1)]]+=(frame.axes[i][0]==='-'?-1:1)*p[i];return n;};
  const inverse=n=>frame.axes.map((a,i)=>(a[0]==='-'?-1:1)*(n[axes[a.slice(1)]]-frame.origin[axes[a.slice(1)]]));
  for(let i=0;i<points.length;i++){
   // The normal source's Frame describes the coordinate convention actually
   // implemented by its courier/Record path, rather than a forged test frame.
   assert.deepEqual(forward(points[i]),response.result.records[i].position,'declared Frame does not match native axis ordering/origin');
   assert.deepEqual(inverse(response.result.records[i].position),points[i]);
  }
  assert.equal(typeof frame.transformRevision,'string');assert.ok(frame.transformRevision);
  assert.equal(frame.handedness,calibration.measuredHandedness,'declared Frame handedness disagrees with independent native calibration');
 }
 checks.push({case:'coordinate-calibration',points,frame:frame??null,native:response.result.records});
 return calibration;
}
let failure;
try{
 adapterFiber=ctx.plugin({name:'real-source-under-test',inject,apply(c){adapter=apply(c,{localUserPath:profile,localWorldRoots:[worlds]});}});await adapterFiber.await();
 canvasFiber=ctx.plugin({name:'renamed-real-canvas-caller',apply(c){canvas=c;c.provide('hanaworldsCanvasV5',{call(){throw Error('FACT_READ_MUST_NOT_CALL_CANVAS');}});}});await canvasFiber.await();
 local=ctx.get('hanaworldsLocalWorlds');created=await local.createFlatWorld({requesterRef:'native-test',userPath:profile,worldName:'facts'});
 transportPort=JSON.parse(await readFile(join(created.worldPath,'worldmods/hanaworlds_adapter/transport.json'),'utf8')).port;
 const observer=join(created.worldPath,'worldmods/hw_canvas_probe');await mkdir(observer);
 await writeFile(join(observer,'mod.conf'),'name = hw_canvas_probe\noptional_depends = hanaworlds_adapter\n');
 await writeFile(join(observer,'init.lua'),`
local root=core.get_worldpath()
local points={{-11,4,-2},{-2,-11,4},{13,-7,22},{22,13,-7}}
local writes={set_node=0,swap_node=0,emerge_area=0,fix_light=0,vm_write=0}
local function instrument()
 for _,key in ipairs({'set_node','swap_node','emerge_area','fix_light'}) do
  local original=core[key];core[key]=function(...) writes[key]=writes[key]+1;return original(...) end
 end
 local mt=getmetatable(core.get_voxel_manip());local index=type(mt)=='table' and (type(mt.write_to_map)=='function' and mt or mt.__index)
 assert(type(index)=='table' and type(index.write_to_map)=='function')
 local original=index.write_to_map;index.write_to_map=function(...) writes.vm_write=writes.vm_write+1;return original(...) end
 core.safe_file_write(root..'/canvas-probe-ready','ready')
end
core.after(0,function()
 local pending=#points
 for _,p in ipairs(points) do
  local pos={x=p[1],y=p[2],z=p[3]}
  core.emerge_area(pos,pos,function(_,_,remaining)
   if remaining~=0 then return end
   core.set_node(pos,{name=core.registered_nodes['base:stone'] and 'base:stone' or 'mcl_core:stone'})
   core.get_meta(pos):set_string('axis-marker',table.concat(p,','))
   pending=pending-1;if pending==0 then instrument() end
  end)
 end
end)
core.register_globalstep(function()
 local file=io.open(root..'/canvas-probe-query.json','rb');if not file then return end
 local q=core.parse_json(file:read('*a'));file:close();os.remove(root..'/canvas-probe-query.json')
 local nodes={}
 for _,p in ipairs(q.points) do local pos={x=p[1],y=p[2],z=p[3]};nodes[#nodes+1]={position=p,node=core.get_node(pos),metadata=core.get_meta(pos):to_table(),timer=core.get_node_timer(pos):is_started()} end
 local function triple(v) return {v.x,v.y,v.z} end
 local turns={};for i=0,3 do turns[#turns+1]=triple(core.facedir_to_dir(i)) end
 local orientation={engineVersion=core.get_version().string,turns=turns,up=triple(core.wallmounted_to_dir(0)),
  yaw0=triple(core.yaw_to_dir(0)),yawMinusQuarter=triple(core.yaw_to_dir(-math.pi/2)),yawPlusQuarter=triple(core.yaw_to_dir(math.pi/2))}
 core.safe_file_write(root..'/'..q.id..'.json',core.write_json({id=q.id,nodes=nodes,writes=writes,edge=core.MAP_BLOCKSIZE,orientation=orientation}))
end)
`);
 const lease=await local.acquire({connectionRef:created.connectionRef,requesterRef:'native-test',userPath:profile,action:'BIND_RUNNING_WORLD'});
 paired=await local.pair({connectionRef:created.connectionRef,requesterRef:'native-test',leaseRef:lease.leaseRef});paired.leaseRef=lease.leaseRef;
 scope={worldRef:paired.worldRef,connectionRef:paired.connectionRef,connectionIncarnationRef:paired.connectionIncarnationRef};port=canvas.get('hanaworldsWorldFacts');
 await waitFor(join(created.worldPath,'canvas-probe-ready'));
 // This existing public read ensures actual fact_world_source/region_limits
 // commands execute even on the intentionally RED, pre-implementation baseline.
 const engine=await audit(()=>port.call('ReadEngineFacts',{contractVersion:'world-facts/v1',requestId:'native-baseline',worldRef:paired.worldRef}));
 assert.equal(engine.error,null,JSON.stringify(engine.error));checks.push({case:'native-baseline',source:traceResult('fact_world_source').response,partition:traceResult('region_limits').response});
 await coordinates();
 if(scenario==='coordinate-calibration'){
  // A working independent native calibration; the normal case additionally
  // binds this measurement to the new source-owned complete Frame.
 }else if(scenario==='native-source'){
  const raw=nativeCanvas();await loadNormalDeclaration();checkNativeFacts(raw);
 }else{
  await loadNormalDeclaration();const initial=await readComplete();await coordinates(initial.frame.value);
  if(scenario==='handedness-and-recovery'){
   const changed=plain(decl);changed.frame.handedness=decl.frame.handedness==='left'?'right':'left';
   const {handedness:normalHand,...normalRest}=decl.frame,{handedness:wrongHand,...wrongRest}=changed.frame;
   assert.notEqual(wrongHand,normalHand);assert.deepEqual(wrongRest,normalRest,'only handedness may change');
   const bytes=Buffer.from(JSON.stringify(changed));await writeFile(declarationPath(),bytes,{mode:0o600});
   try{
    const wrong=await readComplete(changed,bytes);
    assert.deepEqual(plain(wrong.frame.value),changed.frame,'flipped declaration must really reach the public Frame');
    assert.deepEqual(plain(wrong.frame.value.origin),plain(initial.frame.value.origin));
    assert.deepEqual(plain(wrong.frame.value.axes),plain(initial.frame.value.axes));
    // Expected TEST assertion, not a new production refusal code or wire ABI.
    await assert.rejects(coordinates(wrong.frame.value),e=>e instanceof assert.AssertionError&&
     e.message.startsWith('declared Frame handedness disagrees with independent native calibration'));
    checks.push({case:'wrong-handedness-detected',normalHand,wrongHand,origin:changed.frame.origin,axes:changed.frame.axes});
   }finally{await writeFile(declarationPath(),originalDeclaration,{mode:0o600});}
   const recovered=await readComplete();assert.deepEqual(plain(recovered),plain(initial));await coordinates(recovered.frame.value);
   checks.push({case:'handedness-recovery'});
  }else if(scenario==='missing-and-recovery'){
   for(const path of ['tools','tools.0.purpose','tools.0.typicalScale','unit','unit.name','frame','frame.profileVersion','frame.frameId',
    'frame.axes','frame.handedness','frame.origin','frame.gridUnit','frame.transformRevision']){
    const changed=plain(decl),parts=path.split('.'),key=parts.pop();delete parts.reduce((v,k)=>v[k],changed)[key];
    await writeFile(declarationPath(),JSON.stringify(changed),{mode:0o600});
    try{
     const begin=commands.length;await audit(()=>assert.rejects(port.readCanvasFacts(scope),refused('TARGET_FACTS_INCOMPLETE')));
     assert.ok(commands.slice(begin).some(q=>q.operation==='fact_world_source'),'missing source must exercise actual payload');checks.push({case:'missing',field:path});
    }finally{await writeFile(declarationPath(),originalDeclaration,{mode:0o600});}
    const recovered=await readComplete();assert.deepEqual(plain(recovered),plain(initial));checks.push({case:'recovery',field:path});
   }
  }else if(scenario==='content-drift-and-recovery'){
   const changed=plain(decl);changed.tools[0].purpose+=' (external revision)';changed.tools[0].typicalScale.size[0]+=3;
   changed.unit.name+='-revised';for(const tool of changed.tools)tool.typicalScale.unit=changed.unit.name;
   changed.frame.gridUnit={...changed.unit};
   const fault={path:declarationPath(),bytes:Buffer.from(JSON.stringify(changed)),fired:false};externalFault=fault;
   try{
    await audit(()=>assert.rejects(port.readCanvasFacts(scope),refused('CURRENT_WORLD_MISMATCH')));assert.equal(fault.fired,true,'real file drift was not injected');
    const revision=hash(fault.bytes);const changedRead=await audit(()=>port.readCanvasFacts(scope));checkNativeFacts(nativeCanvas(),changed,revision);
    for(const field of ['tools','unit','frame','partition'])assert.deepEqual(plain(changedRead[field]),nativeCanvas()[field]);
    assert.notEqual(changedRead.sourceRevision,initial.sourceRevision);assert.deepEqual(plain(changedRead.provider),plain(initial.provider));checks.push({case:'content-drift',revision,actual:changedRead});
   }finally{externalFault=null;await writeFile(declarationPath(),originalDeclaration,{mode:0o600});}
   assert.deepEqual(plain(await readComplete()),plain(initial));checks.push({case:'drift-recovery'});
  }else if(scenario==='scope-and-providers'){
   for(const field of ['worldRef','connectionIncarnationRef'])await audit(()=>assert.rejects(port.readCanvasFacts({...scope,[field]:'wrong'}),refused('CURRENT_WORLD_MISMATCH')));
   await audit(()=>assert.rejects(port.readCanvasFacts({...scope,connectionRef:'absent'}),refused('WORLD_NOT_BOUND')));
   await audit(()=>assert.rejects(ctx.get('hanaworldsWorldFacts').readCanvasFacts(scope),refused('CAPABILITY_UNAVAILABLE')));
   const read=port.readCanvasFacts;
   if(mode==='source')canvas.set('hanaworldsCanvasV5',{call(){throw Error('REPLACED_PROVIDER');}});
   else canvas.set('hanaworldsWorldFacts',{call(){throw Error('REPLACED_SOURCE_PROVIDER');}});
   await audit(()=>assert.rejects(read(scope),refused('CAPABILITY_UNAVAILABLE')));checks.push({case:'provider-replacement',provider:mode==='source'?'canvas':'source'});
  }else assert.equal(scenario,'normal');
 }
}catch(e){failure=e;}finally{
 externalFault=null;
 if(originalDeclaration&&created)await writeFile(declarationPath(),originalDeclaration,{mode:0o600});
 if(adapter)await adapter.close();await host.shutdown();if(canvasFiber)await canvasFiber.dispose();if(adapterFiber)await adapterFiber.dispose();await ctx.fiber.dispose();
 ServerResponse.prototype.end=originalEnd;Server.prototype.emit=originalEmit;
 for(const record of host.records.values()){
  assert.equal(record.exit?.code,0,`native exit failed: ${record.logfile}`);
  assert.throws(()=>process.kill(record.child.pid,0),e=>e.code==='ESRCH','native process was not reaped');
 }
 await writeFile(join(root,'native-protocol.json'),JSON.stringify({commands,results},null,2));
 await writeFile(join(root,'receipt.json'),JSON.stringify({status:failure?'RED':'PASS',mode,scenario,tarSHA256:cfg.tarSHA256,
  evidence:'REAL_ENGINE/COURIER; source or normally installed strict tgz; game/Canvas are environment peers',
  sourceMocked:false,UI:'NOT_RUN',owner:'NOT_ACCEPTED',scope,events,checks,failure:failure?{name:failure.name,message:failure.message}:null},null,2));
}
if(failure)throw failure;
