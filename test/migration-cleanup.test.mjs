import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('migration cleanup leaves current gates self-contained and preserves every active test entry',()=>{
 assert.equal(existsSync(join(root,'archive')),false);
 assert.equal(existsSync(join(root,'dev')),false);
 const pkg=JSON.parse(readFileSync(join(root,'package.json')));
 assert.ok(pkg.scripts.test.includes('test/migration-cleanup.test.mjs'));
 const inventory=JSON.parse(readFileSync(join(root,'scripts/migration-archive.json')));
 for(const entry of inventory.baselineDefaultTests)assert.ok(pkg.scripts.test.includes(entry),entry+' remains in the default gate');
 for(const name of inventory.baselineScriptNames)assert.ok(pkg.scripts[name],name+' remains available');
 for(const name of readdirSync(join(root,'scripts')).filter(n=>n.startsWith('final-gate-'))){
  const text=readFileSync(join(root,'scripts',name),'utf8');
  assert.doesNotMatch(text,/S1-AD-|F-DESKTOP-|adapter-07\/|0\.5\.2|HW_WORLDEDIT|47612|TO_TEST/);
 }
 for(const name of ['real-flat-world.mjs','real-world-switch.mjs','real-world-delete.mjs','real-region-io.mjs','real-native-paths.mjs']){
  const text=readFileSync(join(root,'test',name),'utf8');
  assert.doesNotMatch(text,/HW_WORLDEDIT|node_modules\/hanaworlds-contracts|fiber\.entry\s*=|name:\s*'hanaworlds-canvas'/,name);
 }
 assert.equal(pkg.files.some(p=>/^(dev|archive)\//.test(p)),false);
 assert.equal(pkg.devDependencies['hanaworlds-contracts'],'git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.14.0');
});
