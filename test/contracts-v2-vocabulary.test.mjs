import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateType } from '#contracts';
import { WorldVocabulary, NeutralEngine, STATE_PROFILE, WORLD_GEOMETRY } from '../src/world-vocabulary.mjs';
const native = () => JSON.parse(execFileSync('lua',['test/support/material-facts.lua','glass'],{encoding:'utf8'})).catalogue;
test('authority is synchronously rechecked after the final asynchronous admission and before native dispatch',async()=>{
 for(const method of ['apply','applyState','restore','regionWrite']) {
  let live=true,calls=0;
  const e=new NeutralEngine({catalogue:async()=>native(),[method]:()=>{calls++;}});
  e.beforeWrite=async()=>{queueMicrotask(()=>{live=false;});};
  e.writeAuthorityCheck=()=>{if(!live)throw Error('CAPABILITY_UNAVAILABLE');};
  await assert.rejects(e[method](),/CAPABILITY_UNAVAILABLE/);
  assert.equal(calls,0);
 }
});
test('native catalogue becomes SDK catalogue/v3 with opaque materials and neutral tags', () => {
  const v = new WorldVocabulary(native());
  const c = validateType('Catalogue',v.catalogue);
  const empty = c.materials[c.emptyMaterialRef];
  assert.equal(empty.passable,true);
  assert.equal(empty.liquid,false);
  assert.equal(empty.hazardPerSecond,0);
  assert.equal(empty.emitsLight,false);
  assert.equal(empty.placeable,true);
  const placed = v.material('fx:placed',7);
  assert.equal(placed.orientation,0);
  assert.deepEqual(v.nativeMaterial(placed),{nodeName:'fx:placed',param2:7});
  assert.deepEqual(c.materials[placed.materialRef].orientations,[0]);
  assert.equal(c.materials[v.material('fx:wall',0).materialRef].orientations,null);
  assert.throws(()=>v.nativeMaterial(v.material('fx:wall',0)),/CAPABILITY_UNAVAILABLE/);
  assert.throws(()=>v.nativeMaterial({materialRef:'made-up',orientation:0}),/CATALOGUE_MISMATCH/);
  assert.throws(()=>v.nativeMaterial({...placed,orientation:1}),/CAPABILITY_UNAVAILABLE/);
  assert.equal('nodes' in c,false);
  for (const [ref,tags] of Object.entries(c.materials)) {
    assert.equal(ref.includes('fx:'),false);
    assert.equal('param2' in tags,false);
  }
});
test('state records and restoration keep native fields entirely inside the adapter', () => {
  const v = new WorldVocabulary(native());
  const raw={position:[1,2,3],nodeName:'fx:placed',param1:13,param2:7,metadata:{owner:'fixture'},inventory:{main:['item']},timer:{timeout:4,elapsed:2}};
  const record=v.record(raw);
  validateType('Record',record);
  assert.equal(record.geometryProfile,'voxel-grid/v1');
  assert.equal('nodeName' in record || 'param2' in record,false);
  assert.deepEqual(JSON.parse(JSON.stringify(v.nativeRecord(record))),raw);
  validateType('StateProfile',STATE_PROFILE);
  validateType('WorldGeometry',WORLD_GEOMETRY);
  assert.deepEqual(WORLD_GEOMETRY.geometryProfiles,['voxel-grid/v1']);
  assert.deepEqual(WORLD_GEOMETRY.partition.edge,[16,16,16]);
  assert.equal(WORLD_GEOMETRY.postWriteLighting,'REQUIRED');
});

test('changed native orientation table cannot reinterpret a durable neutral image',async()=>{
  let registry=native(), writes=0;
  const engine=new NeutralEngine({catalogue:async()=>registry,restore:async()=>{writes++;return {status:'ROLLED_BACK'};}});
  await engine.catalogue();
  const saved={records:[engine.vocabulary.record({position:[0,0,0],nodeName:'fx:placed',param1:0,param2:7,metadata:{},inventory:{},timer:null})]};
  registry=structuredClone(registry);registry.nodes['fx:placed'].allowedParam2=[9];
  await engine.catalogue();
  await assert.rejects(()=>engine.restore(saved,'history'),/CATALOGUE_MISMATCH/);
  assert.equal(writes,0);
});
