// Own Lua registry projection for material sources; registry stub is FIXTURE.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// HW_MATERIAL_PACKAGE selects an extracted npm package; the stub script stays in source.
const cwd = process.env.HW_MATERIAL_PACKAGE ?? fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./support/material-facts.lua', import.meta.url));
const run = (...a) => JSON.parse(execFileSync('lua', [script, ...a], { cwd, encoding: 'utf8' }));
const C = await import('#contracts');
const load=p=>import(pathToFileURL(join(cwd,p)));
const {WorldVocabulary,NeutralEngine}=await load('src/world-vocabulary.mjs');
const {checkWritePathFacts}=await load('src/world-source-facts.mjs');
const staticMaterial=(native,nodeName,param2)=>{
  const vocabulary=new WorldVocabulary(native);
  return C.validateStaticMaterials({m:vocabulary.material(nodeName,param2)},vocabulary.catalogue);
};

test('one native snapshot carries Catalogue, actual paths, load-ordered mods and appearance', () => {
  const m = run();
  C.validateType('Catalogue', new WorldVocabulary(m.catalogue).catalogue);
  assert.deepEqual(Object.keys(m).sort(), ['appearance', 'catalogue', 'gamePath', 'mods', 'texturePath', 'userPath']);
  assert.equal(m.gamePath, '/abs/games/fx_game'); assert.equal(m.userPath, '/abs/user'); assert.equal(m.texturePath, '');
  assert.deepEqual(m.mods, [{ name: 'fx_b', path: '/abs/mods/fx_b' }, { name: 'fx_a', path: '/abs/mods/fx_a' },
    { name: 'hanaworlds_adapter', path: '/abs/mods/hanaworlds_adapter' }]);
  assert.deepEqual(Object.keys(m.appearance).sort(), Object.keys(m.catalogue.nodes).sort());
  assert.deepEqual(run('catalogue'), m.catalogue, 'readCatalogue and material metadata share one projection');
});
test('existing engine-verified none/facedir and unknown modes retain their semantics', () => {
  const n = run().catalogue.nodes;
  assert.deepEqual(n['fx:plain'].allowedParam2, [0]);
  assert.deepEqual(n['fx:placed'].allowedParam2, [7], 'engine item_place_node uses place_param2');
  assert.deepEqual(n['fx:facedir'].allowedParam2, Array.from({ length: 24 }, (_, i) => i));
  for (const k of ['fx:wall', 'fx:palette']) { assert.equal(n[k].allowedParam2, null); assert.ok(n[k].unknownFields.includes('allowedParam2')); }
  assert.ok(!n['fx:plain'].unknownFields.includes('allowedParam2'));
  for (const [name, v] of Object.entries(n)) { assert.equal(v.hasPersistentState, null);
    if (!['air', 'fx:noncolliding'].includes(name)) assert.equal(v.collisionBoxes, null); }
});
test('effective collision facts require actual non-walkability, never a node name/drawtype/default', () => {
  const cat = run().catalogue;
  C.validateType('Catalogue', new WorldVocabulary(cat).catalogue);
  for (const name of ['air', 'fx:noncolliding']) {
    assert.deepEqual(cat.nodes[name].collisionBoxes, []);
    assert.ok(!cat.nodes[name].unknownFields.includes('collisionBoxes'));
  }
  for (const name of ['fx:plain', 'fx:airlike_solid', 'ignore']) {
    assert.equal(cat.nodes[name].collisionBoxes, null);
    assert.ok(cat.nodes[name].unknownFields.includes('collisionBoxes'));
  }
  for (const mode of ['collision-air-solid', 'collision-air-unknown', 'collision-air-nonbool']) {
    const air = run(mode).catalogue.nodes.air;
    assert.equal(air.collisionBoxes, null, mode);
    assert.ok(air.unknownFields.includes('collisionBoxes'), mode);
    assert.notEqual(air.definitionRevision, cat.nodes.air.definitionRevision, mode);
  }
  assert.equal(run().catalogue.nodes.air.definitionRevision, cat.nodes.air.definitionRevision);
  // Node collision facts do not advertise safe material callbacks/state.
  assert.equal(cat.nodes['fx:noncolliding'].hasCallbacks, null);
  assert.equal(cat.nodes['fx:noncolliding'].hasPersistentState, null);
});
test('documented glass bitfield domain admits valid glass without relaxing static-state or unknown gates', () => {
  const cat = run('glass').catalogue, domain = Array.from({ length: 256 }, (_, i) => i);
  for (const nodeName of ['fx:glass', 'fx:glass_optional']) {
    const node = cat.nodes[nodeName];
    assert.deepEqual(node.allowedParam2, domain);
    assert.ok(!node.unknownFields.includes('allowedParam2'));
    for (const param2 of domain) assert.doesNotThrow(() => staticMaterial(cat,nodeName,param2));
    for (const param2 of [-1, 256, 0.5]) assert.throws(() => staticMaterial(cat,nodeName,param2));
    assert.deepEqual(run('glass').appearance[nodeName], { supported: false, textureName: null }, 'appearance support is a separate gate');
  }
  assert.equal(cat.nodes['fx:glass_wrong_drawtype'].allowedParam2, null);
  for (const nodeName of ['fx:glass_wrong_drawtype', 'fx:wall', 'fx:palette', 'fx:glass_state'])
    assert.throws(() => staticMaterial(cat,nodeName,0), /UNSUPPORTED_MUTATION_SEMANTICS/);
  for (const mode of ['glass-global', 'catalogue'])
    assert.throws(() => staticMaterial(run(mode).catalogue ?? run(mode),'fx:glass',0), /UNSUPPORTED_MUTATION_SEMANTICS/);
});
test('write-path-init/v1: facts from initialization/state callbacks and the write-path global registry', async () => {
  const n = run('state').nodes, f = k => [n[k].hasCallbacks, n[k].hasPersistentState];
  assert.deepEqual(f('air'), [false, false]); assert.deepEqual(f('fx:stone'), [false, false]); // player hooks/ABM out of scope
  assert.deepEqual(f('fx:chest'), [true, null]); assert.deepEqual(f('fx:timer'), [true, null]);
  assert.deepEqual(f('fx:form'), [false, null]); assert.deepEqual(f('fx:keep'), [false, null]);
  assert.deepEqual(f('ignore'), [null, null], 'engine placeholder stays unknown (stricter)');
  for (const m of ['state-global', 'state-unknown', 'catalogue']) // handler present, registry unreadable, or no registry
    for (const v of Object.values(run(m).nodes)) { assert.equal(v.hasCallbacks, null, m); assert.equal(v.hasPersistentState, null, m); }
  const g = run('state-global').nodes;
  assert.notEqual(g['fx:stone'].definitionRevision, n['fx:stone'].definitionRevision, 'facts are part of the definition revision');
  assert.equal(run('state').nodes['fx:stone'].definitionRevision, n['fx:stone'].definitionRevision, 'revision is deterministic');
  // The exported inventory satisfies the public derivation; the Catalogue is never looser.
  const wp = run('state', 'write_path'), nodes = [...wp.evidence.nodes].sort((a, b) => a.nodeName < b.nodeName ? -1 : 1);
  assert.deepEqual(wp.catalogue, run('state'));
  assert.deepEqual(wp.evidence.globalWriteCallbacks, []);
  assert.deepEqual(nodes.find(x => x.nodeName === 'fx:stone').definedCallbacks, ['after_dig_node', 'on_blast', 'on_dig', 'on_punch']);
  const neutral = await new NeutralEngine({writePath:async()=>wp}).writePath();
  const check = checkWritePathFacts(neutral.catalogue,{...neutral.evidence,
    catalogueDigest:C.digestValue('catalogue',neutral.catalogue).sha256});
  const vocabulary = new WorldVocabulary(wp.catalogue);
  assert.deepEqual([...check.verified].sort(), ['air', 'fx:stone'].map(n=>vocabulary.material(n,0).materialRef).sort());
  assert.deepEqual(check.stricter, [vocabulary.material('ignore',0).materialRef]);
  const gw = run('state-global', 'write_path');
  assert.deepEqual(gw.evidence.globalWriteCallbacks, ['register_on_mapblocks_changed']);
  assert.equal(run('state-unknown', 'write_path').evidence.globalWriteCallbacks, null);
  // Public admission on these facts: air+stone admitted; init/state nodes and unknown rejected.
  const cat = run('state');
  for (const name of ['air','fx:stone']) assert.doesNotThrow(() => staticMaterial(cat,name,0));
  for (const k of ['fx:chest', 'fx:timer', 'fx:form', 'ignore'])
    assert.throws(() => staticMaterial(cat,k,0), /UNSUPPORTED_MUTATION_SEMANTICS/, k);
  assert.throws(() => staticMaterial(run('state-global'),'fx:stone',0), /UNSUPPORTED_MUTATION_SEMANTICS/);
});
test('only identical unmodified opaque normal tiles are a supported appearance', () => {
  const a = run().appearance;
  for (const k of ['fx:plain', 'fx:six', 'fx:placed']) assert.deepEqual(a[k], { supported: true, textureName: 'fx_plain.png' });
  assert.deepEqual(a['fx:facedir'], { supported: true, textureName: 'fx_dir.png' });
  for (const k of ['air', 'fx:faces', 'fx:modifier', 'fx:anim', 'fx:tinted', 'fx:tile_tint', 'fx:overlay', 'fx:palette', 'fx:mesh', 'fx:blend', 'fx:notiles'])
    assert.deepEqual(a[k], { supported: false, textureName: null }, k);
});
test('missing native path source fails closed instead of guessing', () => {
  assert.deepEqual(run('nopath'), { error: 'CAPABILITY_UNAVAILABLE' });
});
test('native presentation uses clean human labels without engine names or escape markup', () => {
  const n = run('presentation').catalogue.nodes;
  assert.equal(n['fx:facedir'].displayName, 'Stone');
  assert.equal(n['fx:facedir'].color, '#abcdef');
  assert.equal(n['fx:placed'].displayName, 'Placed stone');
  for (const name of ['fx:plain', 'fx:six', 'fx:faces', 'fx:notiles'])
    assert.equal(n[name].displayName, null, name);
  assert.equal(run('presentation-no-strip').catalogue.nodes['fx:facedir'].displayName, null);
});
