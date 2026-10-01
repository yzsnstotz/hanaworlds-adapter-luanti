export { discoverLocalWorlds, payloadDigest, provisionLocalPayload } from './local-worlds.mjs';
export { DurableJournal } from './journal.mjs';
export { EngineBridge } from './bridge.mjs';
export { LocalEngineTransport } from './local-transport.mjs';
export { RemoteEngineTransport } from './remote-transport.mjs';
export { WorldAdapterV2, worldAdapterOperations } from './v2-port.mjs';
export { createLuantiOperations } from './v2-operations.mjs';
export { V2TransactionBackend, projectionDigest } from './v2-transactions.mjs';
export { WorldAdapterV3, worldAdapterV3Operations } from './v3-port.mjs';
export { V3TransactionBackend } from './v3-transactions.mjs';

import { createLuantiOperations } from './v2-operations.mjs';
import { WorldAdapterV3 } from './v3-port.mjs';
import { provisionLocalPayload } from './local-worlds.mjs';
import { DurableJournal } from './journal.mjs';
import { V3TransactionBackend } from './v3-transactions.mjs';

export const name = 'hanaworlds-adapter-luanti';
export const inject = ['webServer'];

function optionalHostService(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
}

function loopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** DSH host plugin. Missing host identity/owner services fail closed. */
export function apply(ctx, config = {}) {
  async function createBackend({ worldRef, transport, proof }) {
    const authority = optionalHostService(ctx, 'hanaworldsAuthority');
    const storage = optionalHostService(ctx, 'hanaworldsProfileStorage');
    const revisionOracle = optionalHostService(ctx, 'hanaworldsWorldRevisionOracle');
    const capacity = optionalHostService(ctx, 'hanaworldsLuantiCapacity');
    const state = optionalHostService(ctx, 'hanaworldsLuantiStateProfile');
    const historyAuthority = optionalHostService(ctx, 'hanaworldsHistoryOriginAuthority');
    if (typeof authority?.verifyEngineBinding !== 'function' ||
        typeof authority?.verifyService !== 'function' ||
        typeof storage?.adapterJournalDirectory !== 'function' ||
        typeof revisionOracle?.read !== 'function' ||
        typeof revisionOracle?.readObjects !== 'function' ||
        typeof capacity?.check !== 'function' ||
        typeof state?.read !== 'function') return null;
    const profile = await state.read(worldRef, proof);
    if (profile?.profileVersion !== 'state-profile/v2') return null;
    const directory = await storage.adapterJournalDirectory(worldRef);
    if (typeof directory !== 'string' || !directory) return null;
    const journal = await DurableJournal.open(directory);
    const verifyBinding = async (request, action) => {
      const binding = await authority.verifyEngineBinding(request, action);
      if (!binding?.current || binding.worldRef !== worldRef ||
          binding.actorRef !== request.actorRef ||
          typeof binding.authorRef !== 'string' || !binding.authorRef ||
          binding.sessionRef !== request.sessionRef ||
          binding.authorizationRef !== request.authorizationRef ||
          !binding.allowedActions?.includes(action)) return null;
      try { await transport.verifyPrincipal(binding.engineActorName); }
      catch { return null; }
      return binding;
    };
    const verifyService = async recovery => {
      const verified = await authority.verifyService(recovery, 'RestoreTransaction');
      return verified?.current === true && verified.worldRef === worldRef;
    };
    return new V3TransactionBackend({ journal, engine: transport, revisionOracle,
      stateProfile: profile, verifyBinding, verifyService, capacity, historyAuthority });
  }
  const runtime = createLuantiOperations({
    roots: config.localWorldRoots ?? [], remoteProfiles: config.remoteProfiles ?? [],
    operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'),
    remoteTunnelFactory: optionalHostService(ctx, 'hanaworldsRemoteTunnelFactory'),
    createBackend,
    inspectContext: () => optionalHostService(ctx, 'hanaworldsLuantiInspectionContext'),
    serviceName: config.serviceName,
    onAction: typeof optionalHostService(ctx, 'hanaworldsWorkshop')?.invokeAction === 'function'
      ? (request, principal) => optionalHostService(ctx, 'hanaworldsWorkshop').invokeAction(request, principal) : undefined,
  });
  const worldAdapter = new WorldAdapterV3({ authority: optionalHostService(ctx, 'hanaworldsAuthority'),
    operations: runtime.operations });
  const service = {
    worldAdapter,
    async provisionLocal(worldPath, transportPort) {
      return provisionLocalPayload(worldPath, {
        operatorAuthority: optionalHostService(ctx, 'hanaworldsOperatorAuthority'), transportPort });
    },
    async presentFrame({ worldRef, engineActorName, frame, authorizationRef }) {
      const verify = optionalHostService(ctx, 'hanaworldsWorkshop')?.verifyFrameDelivery;
      if (typeof verify !== 'function') throw new Error('RENDERER_CAPABILITY_UNAVAILABLE');
      const proof = await verify({ worldRef, engineActorName, frame, authorizationRef });
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
        version: '0.1.1',
        payloadLifecycle: 'LOCAL_PROVISION_SOURCE',
        worldAdapterContract: 'world-adapter/v3',
        interactionSurfaceContract: 'interaction-surface/v2',
        recoverableTransport: 'GATED_BY_AUTHORITY_AND_STATE_PROFILE',
        currentBinding: 'CURRENT_NATIVE_PROOF_REQUIRED',
        productReadiness: 'UNPROVEN',
      };
    },
  };
  if (typeof ctx.provide === 'function') ctx.provide('hanaworldsWorldAdapterV3', worldAdapter);
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
