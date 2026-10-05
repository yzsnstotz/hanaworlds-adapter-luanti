// Contract requests for the repeatable DSH-hosted real Luanti component gate.
// Canvas identity, authorizer and registry are explicit fixtures.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestValue, projectScopedPreparedTransaction } from
  '../vendor/hanaworlds-contracts/dist/v4/index.mjs';

const hash = (kind, value) => digestValue(kind, value).sha256;
const hex = value => createHash('sha256').update(value).digest('hex');

export function gateRequests(run, port) {
  const endpoint = `http://127.0.0.1:${port}/hw-ad-scoped-gate`;
  async function invoke(version, operation, request) {
    const response = await fetch(endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, operation, request }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`GATE_FIXTURE_${response.status}:${body.error}`);
    return body;
  }
  async function journalStatus(worldRef, transactionId) {
    const path = join(run, 'home', 'data', 'hanaworlds-adapter-luanti', 'journal',
      hex(worldRef), `${hex(transactionId)}.json`);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async function discover() {
    const response = await invoke('v4', 'DiscoverConnections', {
      contractVersion: 'world-adapter/v4', actorRef: 'fixture:canvas',
      sessionRef: 'fixture:session', requestId: randomUUID(),
      authorizationRef: 'fixture:authorization', adapterId: 'hanaworlds-adapter-luanti',
    });
    if (response.error || response.result?.connections?.length !== 1)
      throw new Error(response.error?.code ?? 'DISCOVERY_INCOMPLETE');
    const connection = response.result.connections[0];
    const bound = await invoke('v4', 'AuthorizeBinding', {
      contractVersion: 'world-adapter/v4', actorRef: 'fixture:canvas',
      sessionRef: 'fixture:session', requestId: randomUUID(),
      authorizationRef: 'fixture:authorization', worldRef: connection.worldRef,
      connectionRef: connection.connectionRef,
      expectedCapabilityRevision: connection.capabilityRevision,
    });
    if (bound.error || bound.result?.capabilities?.recoveryGuarantee !== 'RECOVERABLE_VERIFIED')
      throw new Error(bound.error?.code ?? 'BINDING_UNAVAILABLE');
    return connection.worldRef;
  }
  async function read(worldRef, positions, protectedPositions) {
    const response = await invoke('native', 'ReadScope',
      { worldRef, positions, protectedPositions });
    if (!response.result) throw new Error(response.error?.code ?? 'SCOPE_UNAVAILABLE');
    return response.result;
  }
  async function buildPrepare(name, worldRef) {
    const grantResponse = await invoke('native', 'CurrentGrant', { worldRef });
    const grant = grantResponse.result;
    if (!grant?.grantRef) throw new Error('GRANT_UNAVAILABLE');
    const profileResponse = await invoke('native', 'ReadProfile', { worldRef });
    const profile = profileResponse.result;
    const target = name === 'protected' ? [6, 1, 0] :
      name === 'revoke' ? [7, 1, 0] :
        name === 'new-after-revoke' ? [8, 1, 0] : [4, 1, 0];
    const positions = ['revoke', 'new-after-revoke'].includes(name)
      ? [target] : [target, [5, 1, 0]];
    // Capture the protected target as a read-only fact; the v5 Prepare call
    // must then enforce protection on the effect position itself.
    const observed = await read(worldRef, positions,
      name === 'protected' ? [[5, 1, 0]] : [target]);
    const transactionId = randomUUID();
    const sessionRef = `fixture:session:${randomUUID()}`;
    const authorizationRef = `fixture:grant:${hex(grant.grantRef).slice(0, 16)}`;
    const operations = { contractVersion: 'operations/v2',
      buildDigest: hex(`build:${transactionId}`), compilerRevision: 'dsh-fixture-gate',
      compilationConfigDigest: hex(`config:${transactionId}`), worldRef,
      frameDigest: hex(`frame:${transactionId}`),
      catalogueDigest: hex(`catalogue:${transactionId}`),
      targetFactsDigest: hex(`facts:${transactionId}`),
      effects: [{ position: target, nodeName: 'hw_scoped_gate:stone', param2: 0 }] };
    const operationDigest = hash('operations', operations);
    const authorizationBinding = { contractVersion: 'world-adapter/v2',
      authorizerRef: 'fixture:game-admin-grant', actorRef: 'fixture:actor',
      grantEpoch: hex(grant.grantRef).slice(0, 24),
      bindingRef: `fixture:binding:${transactionId}`, worldRef, sessionRef,
      turnRevision: `fixture:turn:${transactionId}`,
      intentDigest: hex(`intent:${transactionId}`),
      surfaceActionDigest: hex(`surface:${transactionId}`),
      allowedAction: 'APPLY_RECOVERABLE', transactionId, operationDigest,
      worldRevision: observed.stateDigest,
      selectionRevision: `fixture:selection:${transactionId}`,
      analysisDigest: null, decisionRevision: null };
    const objects = ['revoke', 'new-after-revoke'].includes(name) ? [] : [{
      objectRef: 'fixture:registered-object', worldRef,
      footprintRevision: 'fixture:r1', provenance: 'CANVAS_REGISTERED',
      positions: [[5, 1, 0]],
    }];
    const scope = { transactionId, worldRef, operationDigest,
      authorizationBindingDigest: hash('authorization-binding', authorizationBinding),
      stateProfile: profile, checkedPositions: [target], objects,
      cells: observed.cells };
    const request = { contractVersion: 'world-adapter/v5',
      actorRef: 'fixture:canvas', sessionRef, requestId: randomUUID(),
      authorizationRef, worldRef, transactionId, operationDigest, operations,
      authorizationBinding, scope, scopeDigest: hash('scoped-world', scope),
      guarantee: 'RECOVERABLE_VERIFIED' };
    return request;
  }
  async function submitPrepare(request) {
    const response = await invoke('v5', 'PrepareRecoverableTransaction', request);
    return { request, prepared: response.result ?? null, error: response.error?.code ?? null,
      journal: response.result ? await journalStatus(request.worldRef, request.transactionId) : null };
  }
  async function prepare(name, worldRef) {
    return submitPrepare(await buildPrepare(name, worldRef));
  }
  async function apply(preparation) {
    const request = preparation.request;
    const response = await invoke('v5', 'ApplyCompiledTransaction', {
      ...request, requestId: randomUUID(),
      preparedTransaction: projectScopedPreparedTransaction(preparation.prepared),
    });
    return { result: response.result ?? null, error: response.error?.code ?? null,
      journal: await journalStatus(request.worldRef, request.transactionId) };
  }
  async function query(preparation) {
    const request = preparation.request;
    const response = await invoke('v5', 'QueryPreparedTransaction', {
      contractVersion: 'world-adapter/v5', actorRef: request.actorRef,
      sessionRef: request.sessionRef, requestId: randomUUID(),
      authorizationRef: request.authorizationRef, worldRef: request.worldRef,
      transactionId: request.transactionId, operationDigest: request.operationDigest,
      authorizationBindingDigest: request.scope.authorizationBindingDigest,
      scopeDigest: request.scopeDigest });
    return { result: response.result ?? null, error: response.error?.code ?? null };
  }
  async function status() {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`GATE_STATUS_${response.status}`);
    return response.json();
  }
  return { discover, read, prepare, buildPrepare, submitPrepare, apply, query, status };
}
