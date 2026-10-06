import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.env.HW_CATALOGUE_PACKAGE;
const {apply}=await import(root?pathToFileURL(join(root,'src/index.mjs')):new URL('../src/index.mjs',import.meta.url));

test('public Catalogue supplier fails closed for unbound or invalid worlds without peer Canvas facts',async()=>{
  const services=new Map();const instance=apply({get(){},effect(run){run();},provide(n,v){services.set(n,v);},webServer:{register(){return ()=>{};}}});
  try {
    const facts=services.get('hanaworldsLuantiNativeFacts');
    assert.equal(typeof facts.readCatalogue,'function','complete Catalogue must have a public supplier');
    await assert.rejects(()=>facts.readCatalogue('unbound-world'),/WORLD_NOT_BOUND/);
    await assert.rejects(()=>facts.readCatalogue({worldRef:'invented',catalogue:{}}),/SCHEMA_INVALID/);
    await instance.close();
    await assert.rejects(()=>facts.readCatalogue('unbound-world'),/ADAPTER_UNAVAILABLE/);
  } finally {await instance.close();}
});
