// SOURCE/FIXTURE: the read-only NativeFacts.readRegionState supplier fails closed without a
// paired world. Its real engine reads are exercised by the dev page against real Luanti.
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.env.HW_CATALOGUE_PACKAGE;
const {apply}=await import(root?pathToFileURL(join(root,'src/index.mjs')):new URL('../src/index.mjs',import.meta.url));
const box={min:[-2,0,-2],max:[2,20,2]};

test('readRegionState fails closed for unbound, invalid or closed worlds and needs no Canvas peer',async()=>{
  const services=new Map();const instance=apply({get(){},effect(run){run();},provide(n,v){services.set(n,v);},webServer:{register(){return ()=>{};}}});
  try {
    const facts=services.get('hanaworldsLuantiNativeFacts');
    assert.equal(typeof facts.readRegionState,'function');
    await assert.rejects(()=>facts.readRegionState('unbound-world',box),/WORLD_NOT_BOUND/);
    await assert.rejects(()=>facts.readRegionState('',box),/SCHEMA_INVALID/);
    await assert.rejects(()=>facts.readRegionState('w',{min:[0,0],max:[1,1,1]}),/SCHEMA_INVALID/);
    await instance.close();
    await assert.rejects(()=>facts.readRegionState('unbound-world',box),/ADAPTER_UNAVAILABLE/);
  } finally {await instance.close();}
});
