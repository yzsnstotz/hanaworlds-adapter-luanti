// SOURCE/FIXTURE: real provider construction, exact package and G3 advertisements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';
import { contractHandshake, validateType } from '#contracts';
test('current Adapter advertises the installed exact package and required write capabilities',async()=>{
 const services=new Map();const service=apply({effect(run){run()},get(){},provide:(n,s)=>services.set(n,s),webServer:{register(){return()=>{}}}}, {localWorldRoots:[]});
 try {const p=services.get('hanaworldsWorldAdapterV6'),r=services.get('hanaworldsWorldAdapterRegionV1');
 assert.equal(p.contractHandshake.contracts,process.env.HW_EXPECT_CONTRACTS??'hanaworlds-contracts@0.5.5-rc.1');
 assert.deepEqual(p.contractHandshake,contractHandshake);
 for(const port of [p,r])validateType('ProtocolHandshake',port.protocolHandshake);
 assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v6:callback-free-write'));assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v6:write-path-state-facts'));assert.ok(r.protocolHandshake.capabilities.includes('world-adapter-region/v1:callback-free-write'));
 }finally{await service.close()}
});
