import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('D-19 preserves retired files byte-for-byte and excludes them from active source/package',()=>{
 const manifest=JSON.parse(readFileSync(join(root,'archive/d19/MANIFEST.json')));
 assert.equal(manifest.decision,'D-19');assert.ok(manifest.items.length>=46);
 for(const entry of manifest.items){
  assert.equal(existsSync(join(root,entry.path)),false,entry.path);
  assert.equal(createHash('sha256').update(readFileSync(join(root,entry.archive))).digest('hex'),entry.sha256,entry.path);
 }
 const pkg=JSON.parse(readFileSync(join(root,'package.json')));
 assert.equal(pkg.files.some(p=>p.startsWith('archive/')),false);
 for(const name of readdirSync(join(root,'src')).filter(f=>f.endsWith('.mjs'))){
  const source=readFileSync(join(root,'src',name),'utf8');
  assert.equal(/from ['"]\.\/(v[2-5]-|bridge\.mjs|journal\.mjs|local-transport\.mjs|remote-transport\.mjs|workshop-relay\.mjs|session-authorization\.mjs)/.test(source),false,name);
 }
});
