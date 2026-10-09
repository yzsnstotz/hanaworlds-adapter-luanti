// SOURCE/FIXTURE only: exact public candidate fixtures plus Adapter-owned fact producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as c from 'hanaworlds-contracts';
import { createStage1Facts } from '../src/stage1-facts.mjs';
const fx = JSON.parse(readFileSync(new URL(import.meta.resolve('hanaworlds-contracts/fixtures/config-engine-facts'))));
const catalogue = JSON.parse(readFileSync(new URL(import.meta.resolve('hanaworlds-contracts/fixtures/main')))).request.catalogue;
const named = (error, want) => { const e = c.publicError(error); assert.equal(e.code, want.code); assert.equal(e.reason, want.reason); return true; };
test('exact candidate provider valid and invalid public fixtures', () => {
  assert.equal(c.version, '0.5.5-rc.1');
  for (const x of fx.provider.valid) c.validateConfigEngineFacts(x.facts, catalogue, fx.connection);
  for (const x of fx.provider.invalid) assert.throws(() => c.validateConfigEngineFacts(x.facts, catalogue, fx.connection), e => named(e, x.expect));
});
test('exact candidate consumer known backend, unavailable backend and avatar refusal', () => {
  for (const x of fx.consumer.assemble) {
    if (typeof x.backendProfileId === 'object') assert.throws(() => c.requireKnownWriteBackend(x.facts), e => named(e, x.backendProfileId));
    else assert.equal(c.requireKnownWriteBackend(x.facts), x.backendProfileId);
  }
  for (const x of fx.provider.valid) assert.throws(() => c.requireKnownAvatarEnvelope(x.facts), e => named(e, fx.consumer.avatarDimensions.refusal));
  for (const x of fx.consumer.lifecycle) {
    const cur = c.validateConfigEngineFacts(x.current, catalogue, x.currentConnection);
    if ('previousStillCurrent' in x) assert.equal(cur.sourceRevision === x.previous.sourceRevision, x.previousStillCurrent);
    if (x.previousRejected) assert.throws(() => c.validateConfigEngineFacts(x.previous, catalogue, x.currentConnection), e => named(e, x.previousRejected));
  }
});
test('Adapter provider records satisfy candidate and existing typed refusals survive publicError', async () => {
  const row = { ...fx.connection, incarnation: fx.connection.connectionIncarnationRef, payloadVersion: 'fixture-payload', payloadDigest: 'fixture-digest' };
  const producer = createStage1Facts();
  const declaration = fx.provider.valid[1].facts.writeBackend;
  const engine = raw => ({ catalogue: async () => catalogue, writeBackend: async () => raw });
  for (const raw of [{ ...declaration, ready: true }, { ...declaration, ready: false }, { notDeclared: true }, {}]) {
    const f = await producer.configEngineFacts(row, engine(raw));
    c.validateConfigEngineFacts(f, catalogue, fx.connection);
    assert.equal(f.writeBackend.availability, raw.ready === true ? 'KNOWN' : 'UNAVAILABLE');
    assert.throws(() => c.requireKnownAvatarEnvelope(f), e => named(e, fx.consumer.avatarDimensions.refusal));
  }
  await assert.rejects(producer.configEngineFacts(row, engine({ ...declaration, ready: true, nodeWriteSemantics: 'unsupported' })), e => named(e, { code: 'CAPABILITY_UNAVAILABLE', reason: 'REQUIRED_FACT_UNKNOWN' }));
  const changed = structuredClone(catalogue); changed.gameRevision = 'changed-revision';
  let reads = 0;
  await assert.rejects(producer.configEngineFacts(row, { catalogue: async () => ++reads === 1 ? catalogue : changed, writeBackend: async () => ({ ...declaration, ready: true }) }), e => named(e, { code: 'CURRENT_WORLD_MISMATCH', reason: 'REVISION_CHANGED' }));
});
