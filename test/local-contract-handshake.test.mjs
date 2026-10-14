// SOURCE/FIXTURE: real provider construction, installed-package handshake and G3 advertisements.
import './q282-material-reads.test.mjs';
import './q282-material-document.test.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../src/index.mjs';
import { checkContractsVersion, contractHandshake, validateType } from '#contracts';
import {version} from '#contracts';
test('current Adapter advertises the document protocol compatibility identity and required write capabilities',async()=>{
 const services=new Map();const service=apply({effect(run){run()},get(){},provide:(n,s)=>services.set(n,s),webServer:{register(){return()=>{}}}}, {localWorldRoots:[]});
 try {const p=services.get('hanaworldsWorldAdapterV6'),r=services.get('hanaworldsWorldAdapterRegionV1');
 assert.equal(p.contractHandshake.contracts,`hanaworlds-contracts@${version}`);checkContractsVersion(p.contractHandshake.contracts);
 assert.deepEqual(p.contractHandshake,contractHandshake);
 for(const port of [p,r])validateType('ProtocolHandshake',port.protocolHandshake);
 assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v8:callback-free-write'));assert.ok(p.protocolHandshake.capabilities.includes('world-adapter/v8:write-path-state-facts'));assert.ok(r.protocolHandshake.capabilities.includes('world-adapter-region/v3:callback-free-write'));
 }finally{await service.close()}
});
