export { discoverLocalWorlds, payloadDigest, provisionLocalPayload, restoreLocalPayload,
  rollbackLocalPayload }
  from './local-worlds.mjs';
export { DurableJournal } from './journal.mjs';
export { EngineBridge } from './bridge.mjs';
export { LocalEngineTransport } from './local-transport.mjs';
export { RemoteEngineTransport } from './remote-transport.mjs';
export { WorldAdapterV2, worldAdapterOperations } from './v2-port.mjs';
export { createLuantiOperations } from './v2-operations.mjs';
export { V2TransactionBackend, projectionDigest } from './v2-transactions.mjs';
export { WorldAdapterV3, worldAdapterV3Operations } from './v3-port.mjs';
export { V3TransactionBackend } from './v3-transactions.mjs';
export { WorldAdapterV4, worldAdapterV4Operations } from './v4-port.mjs';
export { V4TransactionBackend } from './v4-transactions.mjs';
export { workshopRelay } from './workshop-relay.mjs';
export { nativeJournalDirectory } from './native-storage.mjs';

import { placementInvariants } from 'hanaworlds-contracts/v4';
import { createLuantiOperations } from './v2-operations.mjs';
import { WorldAdapterV4 } from './v4-port.mjs';
import { payloadDigest, provisionLocalPayload, restoreLocalPayload, rollbackLocalPayload }
  from './local-worlds.mjs';
import { DurableJournal } from './journal.mjs';
import { V4TransactionBackend } from './v4-transactions.mjs';
import { workshopRelay } from './workshop-relay.mjs';
import { nativeJournalDirectory } from './native-storage.mjs';
import { ADAPTER_ID, ADAPTER_VERSION } from './version.mjs';

export const name = ADAPTER_ID;

// Correctness invariants this Adapter enforces, projected read-only into the
// Shell management interface (HW-A023/HW-A030); none can be switched off.
const ownedInvariants = placementInvariants.filter(row =>
  row.owner.includes('hanaworlds-adapter-luanti'));
export const inject = ['webServer'];

function optionalHostService(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
}

function loopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** DSH host plugin. Missing host identity/owner services fail closed. */
export function apply(ctx, config = {}) {
  // Fail-closed paths keep their cause in the host log (never pose or owner data).
  // A strict host context may refuse un-injected properties; the console then
  // remains the log sink, so a cause is never dropped.
  let logger = null;
  try { logger = typeof ctx.logger === 'function' ? ctx.logger(name) : null; }
  catch { logger = null; }
  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message);
    else console.error(`[${name}] ${level}: ${message}`);
  };
  async function createBackend({ worldRef, transport, proof }) {
    const authority = optionalHostService(ctx, 'hanaworldsAuthority');
    const revisionOracle = optionalHostService(ctx, 'hanaworldsWorldRevisionOracle');
    const capacity = optionalHostService(ctx, 'hanaworldsLuantiCapacity');
    const state = optionalHostService(ctx, 'hanaworldsLuantiStateProfile');
    const historyAuthority = optionalHostService(ctx, 'hanaworldsHistoryOriginAuthority');
    if (typeof authority?.verifyEngineBinding !== 'function' ||
        typeof authority?.verifyService !== 'function' ||
        typeof revisionOracle?.read !== 'function' ||
        typeof revisionOracle?.readObjects !== 'function' ||
        typeof capacity?.check !== 'function' ||
        typeof state?.read !== 'function') {
      log('warn', `world ${worldRef}: transaction backend not created; missing host providers: ${[
        typeof authority?.verifyEngineBinding !== 'function' && 'hanaworldsAuthority.verifyEngineBinding',
        typeof authority?.verifyService !== 'function' && 'hanaworldsAuthority.verifyService',
        typeof revisionOracle?.read !== 'function' && 'hanaworldsWorldRevisionOracle',
        typeof capacity?.check !== 'function' && 'hanaworldsLuantiCapacity',
        typeof state?.read !== 'function' && 'hanaworldsLuantiStateProfile',
      ].filter(Boolean).join(', ')}`);
      return null;
    }
    const profile = await state.read(worldRef, proof);
    if (profile?.profileVersion !== 'state-profile/v2') return null;
    // Adapter-owned journal under the native DSH home (ctx dshHomePath).
    let directory;
    try { directory = await nativeJournalDirectory(optionalHostService(ctx, 'dshHomePath'), worldRef); }
    catch (error) {
      log('error', `world ${worldRef}: journal storage unavailable: ${error.reason ?? error.message}`);
      return null;
    }
    const journal = await DurableJournal.open(directory);
    // world-adapter/v4: the grant (authorizationRef) and, where present, the
    // request authorizationBinding identify the acting principal. The request
    // actorRef is Canvas' service principal and is never trusted here.
    const verifyBinding = async (request, action, { requireOnline = true } = {}) => {
      const binding = await authority.verifyEngineBinding(request, action);
      if (!binding?.current || binding.worldRef !== worldRef ||
          typeof binding.actorRef !== 'string' || !binding.actorRef ||
          (request.authorizationBinding !== undefined &&
            binding.actorRef !== request.authorizationBinding.actorRef) ||
          typeof binding.authorRef !== 'string' || !binding.authorRef ||
          binding.sessionRef !== request.sessionRef ||
          binding.authorizationRef !== request.authorizationRef ||
          !binding.allowedActions?.includes(action)) return null;
      // Mutation needs the principal connected with its privileges; a
      // read-only region inspection for a Shell-started turn does not.
      if (requireOnline) {
        try { await transport.verifyPrincipal(binding.engineActorName); }
        catch (error) {
          log('warn', `${action}: grant principal not verifiable in engine: ${error?.message ?? error}`);
          return null;
        }
      }
      return binding;
    };
    const inspection = optionalHostService(ctx, 'hanaworldsLuantiInspectionContext');
    const catalogue = typeof inspection?.readCatalogue === 'function'
      ? { read: (ref, binding) => inspection.readCatalogue(ref, binding) } : null;
    const verifyService = async recovery => {
      const verified = await authority.verifyService(recovery, 'RestoreTransaction');
      return verified?.current === true && verified.worldRef === worldRef;
    };
    return new V4TransactionBackend({ journal, engine: transport, revisionOracle,
      stateProfile: profile, verifyBinding, verifyService, capacity, historyAuthority,
      catalogue, log,
      executionRevision: `${ADAPTER_ID}@${ADAPTER_VERSION}+payload.${await payloadDigest()}` });
  }
  const runtime = createLuantiOperations({
    roots: config.localWorldRoots ?? [], remoteProfiles: config.remoteProfiles ?? [],
    operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'),
    remoteTunnelFactory: optionalHostService(ctx, 'hanaworldsRemoteTunnelFactory'),
    createBackend,
    inspectContext: () => optionalHostService(ctx, 'hanaworldsLuantiInspectionContext'),
    serviceName: config.serviceName,
    onAction: workshopRelay(() => optionalHostService(ctx, 'hanaworldsWorkshop'), log),
  });
  const worldAdapter = new WorldAdapterV4({ authority: optionalHostService(ctx, 'hanaworldsAuthority'),
    operations: runtime.operations });
  const service = {
    worldAdapter,
    async provisionLocal(worldPath, transportPort, { freshIdentity = false } = {}) {
      return provisionLocalPayload(worldPath, {
        operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'), transportPort,
        freshIdentity });
    },
    async restoreLocal(worldPath, directory) {
      return restoreLocalPayload(worldPath, {
        operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'), directory });
    },
    async rollbackLocal(worldPath, toVersion) {
      return rollbackLocalPayload(worldPath, {
        operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'), toVersion });
    },
    async presentFrame({ worldRef, engineActorName, frame, authorizationRef }) {
      // Resolved now, not at start; called as a method of the current facade.
      const workshop = optionalHostService(ctx, 'hanaworldsWorkshop');
      if (typeof workshop?.verifyFrameDelivery !== 'function') {
        log('warn', 'frame not delivered: hanaworldsWorkshop.verifyFrameDelivery is not provided');
        throw new Error('RENDERER_CAPABILITY_UNAVAILABLE');
      }
      const proof = await workshop.verifyFrameDelivery({ worldRef, engineActorName, frame,
        authorizationRef });
      if (proof?.current !== true || proof.worldRef !== worldRef ||
          proof.engineActorName !== engineActorName ||
          proof.sessionRef !== frame?.sessionRef ||
          proof.authorizationRef !== authorizationRef)
        throw new Error('ACTION_NOT_AUTHORIZED');
      const transport = runtime.open.get(worldRef);
      if (!transport) throw new Error('WORLD_NOT_BOUND');
      await transport.verifyPrincipal(engineActorName);
      return transport.presentFrame(engineActorName, { ...frame, actorRef: proof.actorRef,
        authorizationRef });
    },
    close() { return runtime.close(); },
    status() {
      return {
        component: name,
        version: ADAPTER_VERSION,
        payloadLifecycle: 'LOCAL_PROVISION_SOURCE',
        worldAdapterContract: 'world-adapter/v4',
        interactionSurfaceContract: 'interaction-surface/v3',
        contractHandshake: worldAdapter.contractHandshake,
        inWorldRenderer: { inputKinds: ['DECISION', 'NAME', 'PICK_WORLD_POINT',
          'SELECT_OBJECTS', 'TEXT'], selectChoice: 'RENDERER_CAPABILITY_UNAVAILABLE (choose in Shell)' },
        invariants: ownedInvariants.map(row => ({ id: row.id, owner: row.owner,
          switchable: false, text: row.text, whyNotSwitchable: row.whyNotSwitchable,
          consequence: row.consequence })),
        attributedEngineCaps: [{ id: 'CAP-INSPECTION-CELLS',
          source: 'host hanaworldsLuantiCapacity', settingOwner: null,
          text: 'A region window beyond the host capacity is LIMIT_EXCEEDED; nothing is truncated.' }],
        recoverableTransport: 'GATED_BY_AUTHORITY_AND_STATE_PROFILE',
        currentBinding: 'CURRENT_NATIVE_PROOF_REQUIRED',
        productReadiness: 'UNPROVEN',
      };
    },
  };
  if (typeof ctx.provide === 'function') ctx.provide('hanaworldsWorldAdapterV4', worldAdapter);
  if (typeof ctx.on === 'function') ctx.on('dispose', () => service.close());
  ctx.webServer.register({
    kind: 'prefix',
    path: '/api-hanaworlds-luanti',
    async handler(req, res) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!loopback(req.socket?.remoteAddress)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'PERMISSION_DENIED' }));
        return;
      }
      if (req.method !== 'GET' || req.url !== '/api-hanaworlds-luanti/status') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'UNKNOWN_ACTION' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify(service.status()));
    },
  });
  return service;
}

export default { apply, inject, name };
