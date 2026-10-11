// Document conformance and provider-owned build inputs; no shared SDK installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('all dependency and lock graphs are free of the retired contracts package',()=>{
 const pkg=JSON.parse(readFileSync(new URL('package.json',root)));
 for(const key of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])
  assert.doesNotMatch(JSON.stringify(pkg[key]??{}),/hanaworlds-contracts/);
 assert.doesNotMatch(readFileSync(new URL('package-lock.json',root),'utf8'),/hanaworlds-contracts/);
});
test('provider-owned structure generation is bound to its documented and hashed inputs',async()=>{
 const provenance=JSON.parse(readFileSync(new URL('scripts/protocol-source.json',root)));
 assert.equal(provenance.owner,'adapter');assert.equal(provenance.mechanism,'Q-98/Q-99 document protocol');
 for(const [path,want] of Object.entries(provenance.sha256))
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),want,path);
 const development=await import('#contracts'),production=await import('../dist/runtime/contracts.mjs');
 assert.deepEqual(production.contractHandshake,development.contractHandshake);
 for(const key of ['schemaBundle','wireVersions','operationContracts','digestProfile','placementInvariants'])
  assert.equal(production.canonicalJSON(production[key]),development.canonicalJSON(development[key]),key);
 assert.notEqual(production.ContractError,development.ContractError);
 assert.ok(Object.keys(production.schemaBundle.definitions).length<593,'only Adapter and public peer schemas retained');
 production.validateType('ScopedStateFacts',{worldRef:'W',stateProfile:{profileVersion:'state-profile/v3',derivedFields:['lighting'],preservedFields:[],clearedFields:['inventory','metadata','timer']},cells:[{position:[0,0,0],availability:'KNOWN',stateDigest:'a'.repeat(64)}]});
 for(const value of [{}, {worldRef:'W',stateProfile:{},cells:[]}])assert.throws(()=>production.validateType('ScopedStateFacts',value));
});

test('protocol errors cross independent private exception constructors',async()=>{
 const C=await import('#contracts');
 class PeerError extends Error {constructor(){super('peer');this.publicError={code:'CAPABILITY_UNAVAILABLE',phase:'validate',retryability:'AFTER_NEW_FACTS',mutationState:'NONE',transactionRef:null,causeCode:null,reason:'REQUIRED_FACT_UNKNOWN'};}}
 const error=new PeerError();assert.equal(error instanceof C.ContractError,false);
 assert.deepEqual(JSON.parse(JSON.stringify(C.publicError(error))),error.publicError);
 assert.throws(()=>C.publicError({publicError:{...error.publicError,extra:true}}),e=>e.publicError?.code==='UNKNOWN_REQUIRED_FIELD');
});

test('subsequent provider optional transport facts and logical error source retain their protocol',async()=>{
 const C=await import('#contracts'),policy=JSON.parse(readFileSync(new URL('test/fixtures/transport-policy.json',root)));
 C.validateType('WorldSourceTransportPolicy',policy);
 for(const name of ['ReadEngineFacts','ReadWriteProfile','ReadWorldSourceCapabilities']) {
  const example=JSON.parse(readFileSync(new URL('fixtures/world-source-facts.json',root))).exchanges.find(e=>e.operation===name);
  C.validateBoundResponse(example.wire,name,example.request,{...example.response,result:{...example.response.result,transportPolicy:policy}});
 }
 const source={owner:'world-source',operation:'read',resource:'payload-identity',kind:'CORRUPT',nativeCode:null};
 const e=new C.ContractError('PAYLOAD_VERSION_MISMATCH','validate','REQUIRED_FACT_UNKNOWN',{source});
 assert.deepEqual(JSON.parse(JSON.stringify(C.validateType('Error',e.publicError).source)),source);
 for(const wrong of [{...policy,settings:[policy.settings[0],policy.settings[0]]},{...policy,settings:[{...policy.settings[0],value:0}]},{...policy,extra:true}])assert.throws(()=>C.validateType('WorldSourceTransportPolicy',wrong));
 assert.throws(()=>C.validateType('FailureSource',{...source,path:'/private/path'}));
});
