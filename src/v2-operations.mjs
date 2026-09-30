import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { discoverLocalWorlds, payloadDigest } from './local-worlds.mjs';
import { LocalEngineTransport } from './local-transport.mjs';
import { RemoteEngineTransport } from './remote-transport.mjs';
import { projectionDigest } from './v2-transactions.mjs';

function fault(code) { throw new Error(code); }
const adapterId = 'hanaworlds-adapter-luanti';
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Runtime-owned operation handlers. World mutation remains gated on the
 * frozen complete state profile and a real Canvas binding; no v1 fallback. */
export function createLuantiOperations({ roots = [], remoteProfiles = [], operatorAuthority,
  remoteTunnelFactory, serviceName, onAction, transactionBackends,
  createBackend, inspectContext } = {}) {
  const rootPaths = roots.map(resolve);
  const local = new Map();
  const remote = new Map(remoteProfiles.map(profile => [profile.connectionRef, profile]));
  const open = new Map();
  const ownedBackends = new Map();
  function backend(request) {
    const value = ownedBackends.get(request.worldRef) ?? transactionBackends?.get?.(request.worldRef);
    if (!value) fault('CAPABILITY_UNAVAILABLE');
    return value;
  }

  async function inventory() {
    const worlds = await discoverLocalWorlds(rootPaths);
    local.clear();
    for (const world of worlds) local.set(world.connectionRef, world);
    const digest = await payloadDigest();
    const connections = worlds.filter(world => world.worldRef).map(world => ({
      adapterId, connectionRef: world.connectionRef,
      worldRef: world.worldRef,
      displayName: world.worldPath.split('/').at(-1),
      capabilityRevision: revision({ connectionRef: world.connectionRef, digest }),
      payloadVersion: world.payloadVersion ?? '0.1.0',
      readiness: world.payloadDigest === digest ? 'CONNECTION_UNAUTHORIZED' :
        'PAYLOAD_VERSION_MISMATCH' }));
    for (const profile of remote.values()) connections.push({ adapterId,
      connectionRef: profile.connectionRef, worldRef: profile.worldRef,
      displayName: profile.displayName, capabilityRevision: profile.capabilityRevision,
      payloadVersion: profile.payloadVersion ?? '0.1.0',
      readiness: 'CONNECTION_UNAUTHORIZED' });
    connections.sort((a, b) => compare(a.adapterId, b.adapterId) ||
      compare(a.connectionRef, b.connectionRef) || compare(a.worldRef, b.worldRef));
    return { capabilityRevision: revision(connections), connections };
  }

  const operations = {
    async DiscoverConnections() { return inventory(); },
    async ListWorlds(request) {
      const all = await inventory();
      const descriptor = all.connections.find(row => row.connectionRef === request.connectionRef);
      if (!descriptor) fault('CONNECTION_NOT_FOUND');
      return { capabilityRevision: all.capabilityRevision, connections: [descriptor] };
    },
    async AuthorizeBinding(request, proof) {
      const all = await inventory();
      const descriptor = all.connections.find(row => row.connectionRef === request.connectionRef);
      if (!descriptor) fault('CONNECTION_NOT_FOUND');
      if (descriptor.worldRef !== request.worldRef) fault('WORLD_NOT_FOUND');
      if (descriptor.capabilityRevision !== request.expectedCapabilityRevision)
        fault('STALE_REVISION');
      if (remote.has(request.connectionRef)) {
        if (typeof proof.engineActorName !== 'string' || !proof.engineActorName)
          fault('CONNECTION_UNAUTHORIZED');
        let transport = open.get(request.worldRef);
        if (!transport) {
          transport = await RemoteEngineTransport.open(remote.get(request.connectionRef), {
            operatorAuthority, tunnelFactory: remoteTunnelFactory });
          open.set(request.worldRef, transport);
        }
        await transport.verifyPrincipal(proof.engineActorName);
        if (typeof proof.authorizerRef !== 'string' || typeof proof.bindingRef !== 'string' ||
            typeof proof.grantEpoch !== 'string' || !Array.isArray(proof.allowedActions))
          fault('CONNECTION_UNAUTHORIZED');
        if (typeof createBackend === 'function' && !ownedBackends.has(request.worldRef)) {
          const built = await createBackend({ worldRef: request.worldRef, transport, proof,
            connectionRef: request.connectionRef, remote: true });
          if (built) ownedBackends.set(request.worldRef, built);
        }
        return { connectionRef: request.connectionRef, worldRef: request.worldRef,
          payloadVersion: '0.1.0', payloadDigest: await payloadDigest(),
          binding: { authorizerRef: proof.authorizerRef, actorRef: request.actorRef,
            bindingRef: proof.bindingRef, worldRef: request.worldRef,
            grantEpoch: proof.grantEpoch, allowedActions: proof.allowedActions },
          capabilities: { providerRef: adapterId, capabilityRevision: descriptor.capabilityRevision,
            worldRef: request.worldRef, engineBounds: null, limits: [], recoveryGuarantee: null,
            stateProfile: null, regionProtectionWriters: [], sessionDeleteSupported: false,
            imageMediaTypes: [], model: null } };
      }
      const world = local.get(request.connectionRef);
      if (!world?.worldRef || typeof serviceName !== 'string' || !serviceName ||
          typeof proof.engineActorName !== 'string' || !proof.engineActorName ||
          typeof operatorAuthority?.verify !== 'function') fault('CONNECTION_UNAUTHORIZED');
      const operator = await operatorAuthority.verify({ worldPath: world.worldPath,
        worldRef: world.worldRef, action: 'BIND_RUNNING_WORLD' });
      if (!operator?.current || operator.worldPath !== world.worldPath ||
          operator.worldRef !== world.worldRef || operator.action !== 'BIND_RUNNING_WORLD')
        fault('CONNECTION_UNAUTHORIZED');
      let transport = open.get(world.worldRef);
      if (!transport) {
        transport = await LocalEngineTransport.open(world.worldPath, { serviceName, onAction });
        open.set(world.worldRef, transport);
      }
      const loaded = await transport.handshake();
      const principal = await transport.verifyPrincipal(proof.engineActorName);
      if (!principal.current) fault('CONNECTION_UNAUTHORIZED');
      if (typeof proof.authorizerRef !== 'string' || typeof proof.bindingRef !== 'string' ||
          typeof proof.grantEpoch !== 'string' || !Array.isArray(proof.allowedActions))
        fault('CONNECTION_UNAUTHORIZED');
      const binding = { authorizerRef: proof.authorizerRef, actorRef: request.actorRef,
        bindingRef: proof.bindingRef, worldRef: request.worldRef,
        grantEpoch: proof.grantEpoch, allowedActions: proof.allowedActions };
      if (typeof createBackend === 'function' && !ownedBackends.has(request.worldRef)) {
        const built = await createBackend({ worldRef: request.worldRef, transport, proof,
          connectionRef: request.connectionRef, remote: false });
        if (built) ownedBackends.set(request.worldRef, built);
      }
      return { connectionRef: request.connectionRef, worldRef: request.worldRef,
        payloadVersion: loaded.payloadVersion, payloadDigest: loaded.payloadDigest, binding,
        capabilities: { providerRef: adapterId, capabilityRevision: descriptor.capabilityRevision,
          worldRef: request.worldRef, engineBounds: null, limits: [], recoveryGuarantee: null,
          stateProfile: null, regionProtectionWriters: [], sessionDeleteSupported: false,
          imageMediaTypes: [], model: null } };
    },
    async InspectWorld(request, proof) {
      // The frozen request has no objectRef. Only the authenticated consumer can
      // identify the selected object and provide its current catalogue/frame.
      if (typeof inspectContext?.read !== 'function') fault('CAPABILITY_UNAVAILABLE');
      const context = await inspectContext.read(request, proof);
      if (!context?.current || context.worldRef !== request.worldRef ||
          context.worldRevision !== request.expectedWorldRevision ||
          typeof context.objectRef !== 'string' || !context.objectRef ||
          typeof context.objectRevision !== 'string' || !context.objectRevision ||
          !/^[0-9a-f]{64}$/.test(context.catalogueDigest ?? '') ||
          !/^[0-9a-f]{64}$/.test(context.frameDigest ?? '') ||
          !Array.isArray(context.portals) ||
          typeof context.capacity?.check !== 'function' ||
          typeof proof.engineActorName !== 'string') fault('TARGET_FACTS_INCOMPLETE');
      const transport = open.get(request.worldRef);
      if (!transport) fault('WORLD_NOT_BOUND');
      const span = request.sampledBounds.max.map((n, i) =>
        BigInt(n) - BigInt(request.sampledBounds.min[i]) + 1n);
      const count = span.reduce((a, b) => a * b, 1n);
      if (count > BigInt(Number.MAX_SAFE_INTEGER)) fault('LIMIT_EXCEEDED');
      const capacity = await context.capacity.check(Number(count), request);
      if (capacity?.allowed !== true) fault(capacity?.allowed === false ?
        'LIMIT_EXCEEDED' : 'CAPABILITY_UNAVAILABLE');
      const positions = [];
      for (let x = request.sampledBounds.min[0]; x <= request.sampledBounds.max[0]; x++)
        for (let y = request.sampledBounds.min[1]; y <= request.sampledBounds.max[1]; y++)
          for (let z = request.sampledBounds.min[2]; z <= request.sampledBounds.max[2]; z++)
            positions.push([x, y, z]);
      await transport.verifyPrincipal(proof.engineActorName);
      const raw = await transport.inspect(positions, { current: true,
        worldRef: request.worldRef, engineActorName: proof.engineActorName });
      if (!Array.isArray(raw?.occupiedCells) || !Array.isArray(raw.knownEmptyCells) ||
          !Array.isArray(raw.unknownCells) ||
          raw.occupiedCells.length + raw.knownEmptyCells.length + raw.unknownCells.length !== positions.length)
        fault('TARGET_FACTS_INCOMPLETE');
      const coverage = { profileVersion: 'coverage/v2',
        sampledBounds: request.sampledBounds, sampledPositions: positions };
      const usableVolume = raw.unknownCells.length ||
        typeof context.projectUsableVolume !== 'function' ? null :
        await context.projectUsableVolume(raw, coverage);
      return { profileVersion: 'target-facts/v2', source: 'INSPECTED',
        worldRef: request.worldRef, objectRef: context.objectRef,
        worldRevision: context.worldRevision, objectRevision: context.objectRevision,
        buildDigest: null, planRevision: null,
        catalogueDigest: context.catalogueDigest, frameDigest: context.frameDigest,
        sampledBounds: request.sampledBounds,
        coverageDigest: projectionDigest('coverage', coverage),
        occupiedCells: raw.occupiedCells, knownEmptyCells: raw.knownEmptyCells,
        unknownCells: raw.unknownCells, portals: context.portals, usableVolume };
    },
    PrepareRecoverableTransaction(request) { return backend(request).prepare(request); },
    ApplyCompiledTransaction(request) { return backend(request).apply(request); },
    Readback(request) { return backend(request).readback(request); },
    QueryTransaction(request) { return backend(request).query(request); },
    RestoreTransaction(request) { return backend(request).restore(request); },
  };
  return { operations, open, close: async () => {
    await Promise.all([...open.values()].map(transport => transport.close())); open.clear();
    ownedBackends.clear();
  } };
}
