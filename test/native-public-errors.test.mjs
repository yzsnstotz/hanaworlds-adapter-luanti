import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.mjs';
import * as C from 'hanaworlds-contracts';
test('unbound native fact reads and invalid ledger input expose the public Error', async () => {
  const services = new Map([['webServer', { register: () => () => {} }]]);
  const ctx = {get: n => services.get(n), provide: (n,v) => services.set(n,v), effect: () => {}, webServer: services.get("webServer")};
  const adapter = apply(ctx), facts = services.get('hanaworldsLuantiNativeFacts');
  try {
    for (const [name,args] of [['readScopedState',['c', [[0,1,0]]]], ['readCatalogue',['w']],
      ['readConfigEngineFacts',['w']], ['readRegionState',['w',{min:[0,1,0],max:[0,1,0]}]]]) {
      await assert.rejects(facts[name](...args), e => {
        assert.equal(e.publicError?.code, 'WORLD_NOT_BOUND', name);
        C.validateType('Error', e.publicError); assert.equal(e.publicError.mutationState, 'NONE'); return true;
      });
    }
    assert.throws(() => facts.readStage1FactLedger(''), e => e.publicError?.code === 'SCHEMA_INVALID');
  } finally { await adapter.close(); }
});
