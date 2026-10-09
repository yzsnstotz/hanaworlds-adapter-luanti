// REAL Luanti/VoxeLibre registry + own production public API; Host/Canvas are
// explicit SDK fixtures. Own new World only; no client, model or proposal writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRealWorld } from './real-world.mjs';
const root = process.env.HW_GLASS_RUN_ROOT;
assert.ok(root && process.env.HW_GLASS_BASELINE && process.env.HW_VOXELIBRE && process.env.HW_WORLDEDIT, 'explicit own run, baseline, game and WorldEdit paths required');
await mkdir(root, { recursive: false });
const w = await openRealWorld({ runRoot: root, game: process.env.HW_VOXELIBRE, worldedit: process.env.HW_WORLDEDIT, log: console.log });
const probe = join(w.worldPath, 'worldmods/hw_probe');
await copyFile(process.env.HW_GLASS_BASELINE, join(probe, 'baseline-facts.lua'));
await writeFile(join(probe, 'mod.conf'), 'name = hw_probe\ndepends = worldedit, mcl_core\noptional_depends = hanaworlds_adapter\n');
await writeFile(join(probe, 'init.lua'), `
-- TEST ENVIRONMENT FIXTURE: negative definitions in this new World only.
core.register_node('hw_probe:glass_wrong_drawtype', {paramtype2='glasslikeliquidlevel', drawtype='normal'})
core.register_node('hw_probe:glass_state', {paramtype2='glasslikeliquidlevel', drawtype='glasslike_framed', on_construct=function() end})
core.register_node('hw_probe:wall_unknown', {paramtype2='wallmounted'})
core.register_node('hw_probe:glass_framed', {paramtype2='glasslikeliquidlevel', drawtype='glasslike_framed'})
core.after(0, function()
  local baseline=dofile(core.get_modpath('hw_probe') .. '/baseline-facts.lua')
  local old=assert(baseline.catalogue(core)).raw_json
  assert(core.safe_file_write(core.get_worldpath() .. '/baseline-catalogue.json',old))
  local nodes={}
  for _, name in ipairs({'mcl_core:glass','mcl_core:stonebrick','mcl_core:brick_block','hw_probe:glass_wrong_drawtype','hw_probe:glass_state','hw_probe:wall_unknown','hw_probe:glass_framed'}) do
    local d=assert(core.registered_nodes[name]); local callbacks={}
    for k,v in pairs(d) do if type(v)=='function' then callbacks[#callbacks+1]=k end end
    table.sort(callbacks)
    nodes[name]={drawtype=d.drawtype,paramtype2=d.paramtype2,place_param2=d.place_param2,callbacks=callbacks}
  end
  local current=dofile(core.get_modpath('hanaworlds_adapter') .. '/facts.lua')
  local appearance=core.parse_json(assert(current.material_metadata(core)).raw_json).appearance['mcl_core:glass']
  assert(core.safe_file_write(core.get_worldpath() .. '/material-semantics-source.json',core.write_json({engine=core.get_version(),game=core.get_game_info(),nodes=nodes,glassAppearance=appearance,players=#core.get_connected_players()})))
  core.log('action','HW_REAL_READY=' .. tostring(rawget(_G,'hanaworlds_adapter') ~= nil))
end)
`);
const result = { level: 'REAL_ENGINE_REGISTRY_PUBLIC_SUPPLY', fixtures: ['NativeEngineControl Host', 'Canvas selection caller', 'hw_probe negative definitions and baseline projection'], modelCalls: 0, clients: 0, proposalWrites: 0, checks: [] };
const save = (file, x) => writeFile(join(root,file), JSON.stringify(x,null,2)+'\n');
try {
  await w.connect();
  const source=JSON.parse(await readFile(join(w.worldPath,'material-semantics-source.json'),'utf8'));
  assert.equal(source.players,0); assert.equal(source.nodes['mcl_core:glass'].drawtype,'glasslike_framed_optional');
  assert.equal(source.nodes['mcl_core:glass'].paramtype2,'glasslikeliquidlevel');
  const wp=await w.facts.readWritePathEvidence(w.worldRef), cat=await w.facts.readCatalogue(w.worldRef), C=w.C;
  assert.deepEqual(cat,wp.catalogue); C.validateCatalogueWritePathFacts(cat,wp.evidence);
  await save('catalogue.json',cat); await save('write-path-evidence.json',wp.evidence); await save('native-source.json',source);
  const materials={wall:{nodeName:'mcl_core:stonebrick',param2:0},roof:{nodeName:'mcl_core:brick_block',param2:0},window:{nodeName:'mcl_core:glass',param2:0}};
  const oldCat=JSON.parse(await readFile(join(w.worldPath,'baseline-catalogue.json'),'utf8'));
  C.validateType('Catalogue',oldCat); await save('baseline-catalogue.json',oldCat);
  assert.throws(()=>C.validateStaticMaterials(materials,oldCat),/UNSUPPORTED_MUTATION_SEMANTICS/);
  assert.equal(oldCat.nodes['mcl_core:glass'].allowedParam2,null);
  result.checks.push('same-actual-registry-baseline-reproduces-null-and-static-rejection');
  assert.doesNotThrow(()=>C.validateStaticMaterials(materials,cat));
  result.checks.push('actual-IMAGE-three-material-map-admitted-by-formal-v1-static-gate');
  const domain=Array.from({length:256},(_,i)=>i);
  for (const nodeName of ['mcl_core:glass','hw_probe:glass_framed']) {
    assert.deepEqual(cat.nodes[nodeName].allowedParam2,domain);
    assert.ok(!cat.nodes[nodeName].unknownFields.includes('allowedParam2'));
    assert.equal(cat.nodes[nodeName].hasCallbacks,false); assert.equal(cat.nodes[nodeName].hasPersistentState,false);
    for (const param2 of domain) C.validateStaticMaterials({glass:{nodeName,param2}},cat);
  }
  result.checks.push('both-actual-registered-glass-drawtypes-all-256-documented-values-admitted');
  result.negatives=[];
  for (const nodeName of ['hw_probe:glass_wrong_drawtype','hw_probe:wall_unknown','hw_probe:glass_state','ignore']) {
    let error; try {C.validateStaticMaterials({glass:{nodeName,param2:0}},cat);} catch(e) {error=C.publicError(e);}
    assert.equal(error?.code,'UNSUPPORTED_MUTATION_SEMANTICS'); assert.equal(error.reason,'REQUIRED_FACT_UNKNOWN');
    result.negatives.push({nodeName,error});
  }
  for (const param2 of [-1,256,0.5]) {
    let error;try{C.validateStaticMaterials({glass:{nodeName:'mcl_core:glass',param2}},cat);}catch(e){error=C.publicError(e);}
    assert.ok(error); result.negatives.push({param2,error});
  }
  assert.equal(cat.nodes['hw_probe:glass_wrong_drawtype'].allowedParam2,null);
  assert.equal(cat.nodes['hw_probe:wall_unknown'].allowedParam2,null);
  assert.equal(cat.nodes['hw_probe:glass_state'].hasCallbacks,true);
  result.checks.push('incompatible-drawtype-unknown-mode-stateful-ignore-and-out-of-domain-refused');
  assert.equal(source.glassAppearance.supported,false); // Lua write_json omits parsed JSON nulls in the independent source dump.
  result.checks.push('transparent-glass-appearance-support-not-widened');
  result.materials=materials; result.connection=w.paired; result.catalogueDigest=wp.evidence.catalogueDigest;
  result.engine=source.engine; result.gameId=source.game.id;result.worldPath=w.worldPath;result.status='PASS';
} catch(error) {result.status='FAIL';result.failure={message:error.message,stack:error.stack};throw error;}
finally {await w.close();result.processes=w.processes;await save('results.json',result);}
console.log(JSON.stringify({status:result.status,checks:result.checks,negativeCases:result.negatives.length,worldPath:result.worldPath}));
