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
const C = await import(pathToFileURL(join(cwd, 'vendor/hanaworlds-contracts/dist/local/index.mjs')));

test('one native snapshot carries Catalogue, actual paths, load-ordered mods and appearance', () => {
  const m = run();
  C.validateType('Catalogue', m.catalogue);
  assert.deepEqual(Object.keys(m).sort(), ['appearance', 'catalogue', 'gamePath', 'mods', 'texturePath', 'userPath']);
  assert.equal(m.gamePath, '/abs/games/fx_game'); assert.equal(m.userPath, '/abs/user'); assert.equal(m.texturePath, '');
  assert.deepEqual(m.mods, [{ name: 'fx_b', path: '/abs/mods/fx_b' }, { name: 'fx_a', path: '/abs/mods/fx_a' },
    { name: 'hanaworlds_adapter', path: '/abs/mods/hanaworlds_adapter' }]);
  assert.deepEqual(Object.keys(m.appearance).sort(), Object.keys(m.catalogue.nodes).sort());
  assert.deepEqual(run('catalogue'), m.catalogue, 'readCatalogue and material metadata share one projection');
});
test('legal param2 only for engine-verified none/facedir; others stay null', () => {
  const n = run().catalogue.nodes;
  assert.deepEqual(n['fx:plain'].allowedParam2, [0]);
  assert.deepEqual(n['fx:placed'].allowedParam2, [7], 'engine item_place_node uses place_param2');
  assert.deepEqual(n['fx:facedir'].allowedParam2, Array.from({ length: 24 }, (_, i) => i));
  for (const k of ['fx:wall', 'fx:palette']) { assert.equal(n[k].allowedParam2, null); assert.ok(n[k].unknownFields.includes('allowedParam2')); }
  assert.ok(!n['fx:plain'].unknownFields.includes('allowedParam2'));
  for (const v of Object.values(n)) { assert.equal(v.hasPersistentState, null); assert.equal(v.collisionBoxes, null); }
});
test('hasPersistentState is false only where no engine dispatch can reach state code', () => {
  const n = run('state').nodes;
  for (const k of ['air', 'fx:plain', 'fx:hidden_dug', 'fx:zero_group']) {
    assert.equal(n[k].hasPersistentState, false, k); assert.ok(!n[k].unknownFields.includes('hasPersistentState'), k);
  }
  for (const k of ['ignore', 'fx:dug', 'fx:built', 'fx:fields', 'fx:abm_name', 'fx:abm_group', 'fx:lbm']) {
    assert.equal(n[k].hasPersistentState, null, k); assert.ok(n[k].unknownFields.includes('hasPersistentState'), k);
  }
  const g = run('state-global').nodes; // a global punch handler reaches every pointable node
  assert.equal(g['fx:plain'].hasPersistentState, null); assert.equal(g.air.hasPersistentState, false);
  assert.notEqual(g['fx:plain'].definitionRevision, n['fx:plain'].definitionRevision, 'the fact is part of the definition revision');
  // Without dispatch tables (no native source) every node stays unknown.
  for (const v of Object.values(run('catalogue').nodes)) assert.equal(v.hasPersistentState, null);
  C.validateType('Catalogue', run('state'));
  const cat = run('state');
  assert.doesNotThrow(() => C.validateStaticMaterials({ a: { nodeName: 'air', param2: 0 } }, cat));
  assert.throws(() => C.validateStaticMaterials({ s: { nodeName: 'fx:dug', param2: 0 } }, cat), /UNSUPPORTED_MUTATION_SEMANTICS/);
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
