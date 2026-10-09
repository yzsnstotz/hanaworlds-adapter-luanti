// REAL current engine registry + production Catalogue supplier. Own new World;
// Host/Canvas and two additional registered nodes are explicit environment fixtures.
// No GUI, model, build/transaction, region gate or player/body data.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRealWorld } from './real-world.mjs';
const root=process.env.HW_COLLISION_RUN_ROOT;
assert.ok(root && process.env.HW_COLLISION_BASELINE && process.env.HW_VOXELIBRE && process.env.HW_WORLDEDIT);
await mkdir(root,{recursive:false});
const w=await openRealWorld({runRoot:root,game:process.env.HW_VOXELIBRE,worldedit:process.env.HW_WORLDEDIT,log:console.log});
const probe=join(w.worldPath,'worldmods/hw_probe');
await copyFile(process.env.HW_COLLISION_BASELINE,join(probe,'baseline-facts.lua'));
await writeFile(join(probe,'mod.conf'),'name = hw_probe\ndepends = worldedit, mcl_core\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe,'init.lua'),`
-- TEST ENVIRONMENT FIXTURE: collision-negative/positive definitions, no world cells written.
core.register_node('hw_probe:airlike_solid',{drawtype='airlike',walkable=true})
core.register_node('hw_probe:noncolliding_raw_cube',{walkable=false,collision_box={type='fixed',fixed={-0.5,-0.5,-0.5,0.5,0.5,0.5}}})
core.after(0,function()
 local base=dofile(core.get_modpath('hw_probe') .. '/baseline-facts.lua')
 assert(core.safe_file_write(core.get_worldpath() .. '/baseline-catalogue.json',assert(base.catalogue(core)).raw_json))
 local nodes={}
 for _,name in ipairs({'air','ignore','mcl_core:stonebrick','hw_probe:airlike_solid','hw_probe:noncolliding_raw_cube'}) do
  local d=assert(core.registered_nodes[name])
  nodes[name]={walkable=d.walkable,drawtype=d.drawtype,rawCollisionBoxes=core.get_node_boxes('collision_box',{x=0,y=9,z=0},{name=name,param1=0,param2=0})}
 end
 assert(core.safe_file_write(core.get_worldpath() .. '/collision-native.json',core.write_json({engine=core.get_version(),game=core.get_game_info(),nodes=nodes,players=#core.get_connected_players()})))
 core.log('action','HW_REAL_READY=' .. tostring(rawget(_G,'hanaworlds_adapter')~=nil))
end)
`);
const result={level:'REAL_ENGINE_REGISTRY_PUBLIC_COLLISION_SUPPLY',fixtures:['NativeEngineControl Host','Canvas selection caller','hw_probe registered test nodes and old projection'],modelCalls:0,clients:0,buildOrTransactionCalls:0,regionCalls:0,checks:[]};
const save=(n,x)=>writeFile(join(root,n),JSON.stringify(x,null,2)+'\n');
try {
 await w.connect();const C=w.C;
 const native=JSON.parse(await readFile(join(w.worldPath,'collision-native.json'),'utf8'));
 assert.equal(native.players,0);assert.equal(native.nodes.air.walkable,false);
 const baseline=JSON.parse(await readFile(join(w.worldPath,'baseline-catalogue.json'),'utf8'));C.validateType('Catalogue',baseline);
 const wp=await w.facts.readWritePathEvidence(w.worldRef),catalogue=await w.facts.readCatalogue(w.worldRef);
 assert.deepEqual(catalogue,wp.catalogue);C.validateCatalogueWritePathFacts(catalogue,wp.evidence);
 await save('native-source.json',native);await save('catalogue.json',catalogue);await save('write-path-evidence.json',wp.evidence);await save('baseline-catalogue.json',baseline);
 const collisionRequirement=n=>n.walkable===false && Array.isArray(n.collisionBoxes) && n.collisionBoxes.length===0;
 assert.equal(baseline.nodes.air.collisionBoxes,null);assert.ok(baseline.nodes.air.unknownFields.includes('collisionBoxes'));
 assert.equal(collisionRequirement(baseline.nodes.air),false);
 result.checks.push('same-real-air-registry-baseline-null-reproduces-public-empty-collision-requirement-failure');
 for(const name of ['air','hw_probe:noncolliding_raw_cube']) {
  const n=catalogue.nodes[name];assert.equal(native.nodes[name].walkable,false);assert.deepEqual(n.collisionBoxes,[]);
  assert.ok(!n.unknownFields.includes('collisionBoxes'));assert.equal(collisionRequirement(n),true);
  assert.notEqual(n.definitionRevision,baseline.nodes[name].definitionRevision);
 }
 result.checks.push('known-non-walkable-effective-empty-array-supplied-not-a-shape-or-name-default');
 for(const name of ['ignore','mcl_core:stonebrick','hw_probe:airlike_solid']) {
  const n=catalogue.nodes[name];assert.equal(n.collisionBoxes,null);assert.ok(n.unknownFields.includes('collisionBoxes'));
  assert.equal(collisionRequirement(n),false);assert.equal(n.definitionRevision,baseline.nodes[name].definitionRevision);
 }
 assert.equal(native.nodes.ignore.walkable,false);assert.equal(native.nodes['hw_probe:airlike_solid'].drawtype,'airlike');
 result.checks.push('ignore-solid-and-airlike-solid-remain-unknown-and-fail-requirement');
 assert.notEqual(wp.evidence.catalogueDigest,C.digestValue('catalogue',baseline).sha256);
 const reread=await w.facts.readCatalogue(w.worldRef);assert.deepEqual(reread,catalogue);
 result.checks.push('collision-fact-changes-air-definition-and-catalogue-digests-stable-on-fresh-reread');
 result.native=native;result.connection=w.paired;result.catalogueDigest=wp.evidence.catalogueDigest;result.worldPath=w.worldPath;result.status='PASS';
} catch(error){result.status='FAIL';result.failure={message:error.message,stack:error.stack};throw error;}
finally{await w.close();result.processes=w.processes;await save('results.json',result);}
console.log(JSON.stringify({status:result.status,checks:result.checks,worldPath:result.worldPath}));
