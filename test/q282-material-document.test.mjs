// DOCUMENT_FIXTURE only: the full provider examples must be independently usable
// without being mistaken for production provenance or read authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as C from '#contracts';
const data=JSON.parse(await readFile(new URL('./fixtures/q282-material-reads.json',import.meta.url)));
test('Q282 complete document exchanges close all old operations, host bytes and named failures',()=>{
 assert.equal(data.evidenceLevel,'DOCUMENT_FIXTURE');
 const normal=data.examples.find(e=>e.case==='catalogue-normal').outcome.result;
 C.validateCatalogueFacts(normal.facts,normal.facts.connection);
 const observed=new Set();
 for(const example of data.examples){
  assert.equal(typeof example.precondition,'string');assert.ok(example.precondition.length);
  assert.equal(example.zeroExtraActions,true);assert.equal(observed.has(example.case),false);observed.add(example.case);
  if(example.operation){
   C.validateBoundRequest('world-facts/v1',example.operation,example.input);
   C.validateBoundResponse('world-facts/v1',example.operation,example.input,example.outcome);
  }else if(example.outcome.promiseRejection){
   C.validateType('Error',example.outcome.promiseRejection.publicError);
  }else if(example.entry.endsWith('.readCatalogue')){
   C.validateType('FactsProviderIdentity',example.outcome.result.provider);
   C.validateCatalogueFacts(example.outcome.result.facts,example.input);
  }else{
   const value=example.outcome.result;
   C.validateType('FactsProviderIdentity',value.provider);
   C.validateMaterialSourceFacts(value.facts,normal.facts.catalogue,example.input);
   const textures=value.textures.map(t=>({bytesDigest:t.bytesDigest,bytes:Uint8Array.from(t.bytes)}));
   C.validateMaterialSources({snapshot:value.facts.snapshot,textures},normal.facts.catalogue,example.input);
  }
 }
 for(const name of ['catalogue-normal','material-normal','unknown-connection','connection-reopened','source-provider-replaced',
  'bridge-provider-replaced','forged-receiver','foreign-root','wrong-role','registry-drift','texture-drift','missing-texture',
  'texture-budget','decode-failed','same-instance-recovery','original-unknown-exception',
  'original-wire-ReadCatalogue','original-wire-ReadMaterialSources','original-wire-ReadEngineFacts','original-wire-ReadWriteProfile'])assert.ok(observed.has(name),name);
});
