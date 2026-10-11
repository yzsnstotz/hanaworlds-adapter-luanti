import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('D-19 inventory remains byte-preserved outside current source and package',()=>{
 const inventory=JSON.parse(readFileSync(join(root,'scripts/migration-archive.json')));
 const manifest=inventory.d19;
 assert.equal(manifest.decision,'D-19');assert.ok(manifest.items.length>=46);
 for(const entry of manifest.items){
  assert.equal(existsSync(join(root,entry.path)),false,entry.path);
  assert.equal(existsSync(join(root,entry.archive)),false,entry.archive);
  const saved=inventory.items.find(item=>item.path===entry.archive);
  assert.equal(saved?.sha256,entry.sha256,entry.path);
 }
 // Run this same default gate with HW_MIGRATION_ARCHIVE_ROOT to verify the retained original bytes.
 if(process.env.HW_MIGRATION_ARCHIVE_ROOT)for(const item of inventory.items){
  const data=readFileSync(join(process.env.HW_MIGRATION_ARCHIVE_ROOT,item.path));
  assert.equal(data.length,item.bytes,item.path);
  assert.equal(createHash('sha256').update(data).digest('hex'),item.sha256,item.path);
 }
 const pkg=JSON.parse(readFileSync(join(root,'package.json')));
 assert.equal(pkg.files.some(p=>p.startsWith('archive/')),false);
 for(const name of readdirSync(join(root,'src')).filter(f=>f.endsWith('.mjs'))){
  const source=readFileSync(join(root,'src',name),'utf8');
  assert.equal(/from ['"]\.\/(v[2-5]-|bridge\.mjs|journal\.mjs|local-transport\.mjs|remote-transport\.mjs|workshop-relay\.mjs|session-authorization\.mjs)/.test(source),false,name);
 }
});
