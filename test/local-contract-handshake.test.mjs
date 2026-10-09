// SOURCE/FIXTURE: real provider construction, installed-package handshake and G3 advertisements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';
import { checkContractsVersion, contractHandshake, validateType } from '#contracts';
import { createRequire } from 'node:module';
const installed = createRequire(import.meta.url)('hanaworlds-contracts/package.json');
test('current Adapter advertises the installed contracts package and required write capabilities',async()=>{
 const services=new Map();const service=apply({effect(run){run()},get(){},provide:(n,s)=>services.set(n,s),webServer:{register(){return()=>{}}}}, {localWorldRoots:[]});
 try {const p=services.get('hanaworldsWorldAdapterV6'),r=services.get('hanaworldsWorldAdapterRegionV1');
 assert.equal(p.contractHandshake.contracts,`${installed.name}@${installed.version}`);checkContractsVersion(p.contractHandshake.contracts);
 assert.deepEqual(p.contractHandshake,contractHandshake);
 for(const port of [p,r])validateType('ProtocolHandshake',port.protocolHandshake);
 assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v7:callback-free-write'));assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v7:write-path-state-facts'));assert.ok(r.protocolHandshake.capabilities.includes('world-adapter-region/v1:callback-free-write'));
 }finally{await service.close()}
});
