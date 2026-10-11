import { TRANSPORT_DEFAULTS } from '../src/transport-policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCourier } from '../src/local-courier.mjs';
import { PAYLOAD_VERSION } from '../src/version.mjs';
import { ENGINE_GUARDS } from '../src/safety-capabilities.mjs';

test('current payload pairs without WorldEdit while payload and safety checks remain mandatory', async () => {
  const courier = new LocalCourier({worldRef:'world', payloadDigest:'digest'}, {token:'a'.repeat(64)});
  const facts = {worldRef:'world', payloadVersion:PAYLOAD_VERSION, payloadMatches:true,
    loadedSourceDigest:'digest', transportSettings:TRANSPORT_DEFAULTS, engineGuards:ENGINE_GUARDS, worldeditAvailable:false};
  courier.dispatch = async () => facts;
  assert.equal(await courier.handshake(), facts);
  delete facts.worldeditAvailable;
  assert.equal(await courier.handshake(), facts);
  facts.loadedSourceDigest = 'other';
  await assert.rejects(courier.handshake(), /PAYLOAD_VERSION_MISMATCH/);
  facts.loadedSourceDigest = 'digest'; facts.engineGuards = {};
  await assert.rejects(courier.handshake(), /CAPABILITY_UNAVAILABLE/);
});
