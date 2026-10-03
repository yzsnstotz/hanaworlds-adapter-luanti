import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { discoverLocalWorlds, payloadDigest } from './local-worlds.mjs';
import { LocalEngineTransport } from './local-transport.mjs';
import { RemoteEngineTransport, verifyRemoteOperator } from './remote-transport.mjs';
import { projectionDigest } from './v2-transactions.mjs';
import { ADAPTER_ID, PAYLOAD_VERSION } from './version.mjs';
import { ContractError } from 'hanaworlds-contracts/v4';

function fault(code) { throw new Error(code); }
const adapterId = ADAPTER_ID;
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Runtime-owned operation handlers. World mutation remains gated on the
 * frozen complete state profile and a real Canvas binding; no v1 fallback. */
export function createLuantiOperations({ roots = [], remoteProfiles = [], operatorAuthority,
  remoteTunnelFactory, serviceName, onAction, transactionBackends,
  createBackend, inspectContext } = {}) {
  // Host services may be passed as values or as resolvers called at each use,
  // so a provider registered after the Adapter is seen and a withdrawn one fails.
  const currentOperatorAuthority = () =>
    typeof operatorAuthority === 'function' ? operatorAuthority() : operatorAuthority;
  const currentTunnelFactory = () =>
    typeof remoteTunnelFactory === 'function' ? remoteTunnelFactory() : remoteTunnelFactory;
  const rootPaths = roots.map(root => resolve(root));
  const local = new Map();
  const remote = new Map(remoteProfiles.map(profile => [profile.connectionRef, profile]));
  const open = new Map();
  // worldRef -> connectionRef whose transport serves it. Inventory uniqueness
  // is (connectionRef, worldRef), so a local and a remote connection may share
  // a worldRef, while normal requests carry only worldRef: the connection that
  // owns the transport is the exact identity their operator check uses.
  const boundConnection = new Map();
  const ownedBackends = new Map();
  // PublicCapabilities facts for a bound world: the recoverable guarantee and
  // state profile are advertised only when a recoverable backend actually
  // exists for that world; otherwise they stay unavailable (null).
  function recoveryFacts(worldRef) {
    const built = ownedBackends.get(worldRef) ?? transactionBackends?.get?.(worldRef);
    const stateProfile = built?.stateProfile;
    return stateProfile?.profileVersion === 'state-profile/v2'
      ? { recoveryGuarantee: 'RECOVERABLE_VERIFIED', stateProfile }
      : { recoveryGuarantee: null, stateProfile: null };
  }
  // On operator or tunnel withdrawal nothing is torn down: the backend, its
  // journal and the existing tunnel stay as the recovery handle, because
  // trusted service recovery after revocation must still reach them
  // (CONTRACT_RULES §5). Every non-recovery call is refused by currentAccess
  // on each request, so the retained tunnel carries only recovery.
  // Trusted service recovery after revocation (CONTRACT_RULES §5) is not
  // gated by the operator authority.
  const serviceRecovery = new Set(['RestoreTransaction', 'AbortPreparedTransaction',
    'AbortPreparedHistoryTransaction']);
  // The local world's operator binding proof (the same BIND_RUNNING_WORLD
  // check AuthorizeBinding makes) must still stand.
  async function verifyLocalOperator(world) {
    const operatorAuthority = currentOperatorAuthority();
    if (typeof operatorAuthority?.verify !== 'function') return false;
    const operator = await operatorAuthority.verify({ worldPath: world.worldPath,
      worldRef: world.worldRef, action: 'BIND_RUNNING_WORLD' });
    return operator?.current === true && operator.worldPath === world.worldPath &&
      operator.worldRef === world.worldRef && operator.action === 'BIND_RUNNING_WORLD';
  }
  // The connection whose operator must stand for this call: the named one for
  // AuthorizeBinding, otherwise the one bound to the worldRef. An unbound
  // worldRef shared by several connections is ambiguous and fails closed.
  function accessTarget(operation, request) {
    let connectionRef;
    if (operation === 'AuthorizeBinding') connectionRef = request.connectionRef;
    else if (typeof request.worldRef !== 'string') return null;
    else connectionRef = boundConnection.get(request.worldRef);
    if (connectionRef === undefined) {
      const candidates = [...local.values(), ...remote.values()]
        .filter(entry => entry.worldRef === request.worldRef);
      if (candidates.length > 1) return { ambiguous: true };
      connectionRef = candidates[0]?.connectionRef;
    }
    if (local.has(connectionRef)) return { world: local.get(connectionRef) };
    if (remote.has(connectionRef)) return { profile: remote.get(connectionRef) };
    // A bound connection that is no longer in the inventory cannot be verified.
    return boundConnection.has(request.worldRef) && operation !== 'AuthorizeBinding'
      ? { missing: true } : null;
  }
  // Ownership of a worldRef is reserved synchronously (no await between check
  // and set), so concurrent AuthorizeBinding calls from different connections
  // cannot both pass before a transport exists. Opening a transport and
  // building a backend are shared per worldRef, so concurrent calls from the
  // same connection never open a second transport or journal.
  const opening = new Map();     // worldRef -> transport being opened
  const building = new Map();    // worldRef -> backend being built
  const inflight = new Map();    // worldRef -> AuthorizeBinding calls holding it
  const established = new Set(); // worldRefs with an accepted binding
  function reserveWorld(worldRef, connectionRef) {
    const owner = boundConnection.get(worldRef);
    if (owner !== undefined && owner !== connectionRef) fault('CONNECTION_UNAUTHORIZED');
    boundConnection.set(worldRef, connectionRef);
    inflight.set(worldRef, (inflight.get(worldRef) ?? 0) + 1);
  }
  // Releases one call's hold. Only when the last holder failed and nothing
  // usable exists for the world (no accepted binding and no backend, so no
  // recovery handle) is the reservation dropped and the transport it left
  // closed, so it is neither stuck nor orphaned. A close failure is attached
  // to `error`.
  async function releaseWorld(worldRef, connectionRef, error) {
    const left = (inflight.get(worldRef) ?? 1) - 1;
    if (left > 0) inflight.set(worldRef, left); else inflight.delete(worldRef);
    if (!error || left > 0 || boundConnection.get(worldRef) !== connectionRef ||
        established.has(worldRef) || ownedBackends.has(worldRef)) return;
    const transport = open.get(worldRef);
    open.delete(worldRef);
    boundConnection.delete(worldRef);
    if (!transport) return;
    try { await transport.close(); }
    catch (closeError) { error.closeError = closeError?.message ?? String(closeError); }
  }
  // One shared in-flight creation per worldRef; the result is stored before
  // the pending entry is removed, so no caller can start a second one.
  function shared(pending, worldRef, create, store) {
    if (!pending.has(worldRef)) {
      pending.set(worldRef, Promise.resolve().then(create)
        .then(value => { store(value); return value; })
        .finally(() => pending.delete(worldRef)));
    }
    return pending.get(worldRef);
  }
  async function transportFor(worldRef, create) {
    if (open.has(worldRef)) return { transport: open.get(worldRef), reused: true };
    const reused = opening.has(worldRef);
    const transport = await shared(opening, worldRef, create, value => open.set(worldRef, value));
    return { transport, reused };
  }
  async function backendFor(worldRef, create) {
    if (typeof createBackend !== 'function' || ownedBackends.has(worldRef)) return;
    await shared(building, worldRef, create,
      built => { if (built) ownedBackends.set(worldRef, built); });
  }
  /**
   * Current operator access, checked by the port after the grant and before
   * the replay cache (revocation precedes replay) and before any effect: a
   * local world's operator binding proof, or a remote world's operator
   * authority and tunnel factory, must still stand. Trusted service recovery
   * is unaffected, and the recovery handle (backend, journal, transport) is
   * retained.
   */
  async function currentAccess(operation, request) {
    if (serviceRecovery.has(operation)) return;
    const target = accessTarget(operation, request);
    if (!target) return;
    if (target.ambiguous)
      throw new ContractError('CAPABILITY_UNAVAILABLE', 'validate', 'POLICY_UNAVAILABLE');
    if (target.missing) throw new ContractError('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED');
    if (target.world) {
      if (target.world.worldRef && await verifyLocalOperator(target.world)) return;
      if (operation === 'AuthorizeBinding') fault('CONNECTION_UNAUTHORIZED');
      throw new ContractError('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED');
    }
    const profile = target.profile;
    try {
      await verifyRemoteOperator(profile, currentOperatorAuthority(), currentTunnelFactory());
    } catch (error) {
      // AuthorizeBinding keeps its existing binding codes.
      if (operation === 'AuthorizeBinding') throw error;
      if (error.message === 'CONNECTION_UNAUTHORIZED')
        throw new ContractError('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED');
      throw new ContractError('CAPABILITY_UNAVAILABLE', 'validate', 'POLICY_UNAVAILABLE');
    }
  }
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
      payloadVersion: world.payloadVersion ?? PAYLOAD_VERSION,
      readiness: world.payloadDigest === digest ? 'CONNECTION_UNAUTHORIZED' :
        'PAYLOAD_VERSION_MISMATCH' }));
    for (const profile of remote.values()) connections.push({ adapterId,
      connectionRef: profile.connectionRef, worldRef: profile.worldRef,
      displayName: profile.displayName, capabilityRevision: profile.capabilityRevision,
      payloadVersion: profile.payloadVersion ?? PAYLOAD_VERSION,
      readiness: 'CONNECTION_UNAUTHORIZED' });
    connections.sort((a, b) => compare(a.adapterId, b.adapterId) ||
      compare(a.connectionRef, b.connectionRef) || compare(a.worldRef, b.worldRef));
    return { capabilityRevision: revision(connections), connections };
  }

  // Remote binding: verified tunnel for the reserved connection (the existing
  // order of checks), then the engine principal, then the backend.
  async function bindRemote(request, proof, descriptor) {
    if (typeof proof.engineActorName !== 'string' || !proof.engineActorName)
      fault('CONNECTION_UNAUTHORIZED');
    const profile = remote.get(request.connectionRef);
    const { transport, reused } = await transportFor(request.worldRef, () =>
      RemoteEngineTransport.open(profile, {
        operatorAuthority: currentOperatorAuthority(), tunnelFactory: currentTunnelFactory() }));
    // A cached tunnel carries a new binding only while the current operator
    // authority and tunnel factory still stand (also checked by currentAccess
    // before replay).
    if (reused) await verifyRemoteOperator(profile, currentOperatorAuthority(), currentTunnelFactory());
    await transport.verifyPrincipal(proof.engineActorName);
    if (typeof proof.authorizerRef !== 'string' || typeof proof.bindingRef !== 'string' ||
        typeof proof.actorRef !== 'string' || !proof.actorRef ||
        typeof proof.grantEpoch !== 'string' || !Array.isArray(proof.allowedActions))
      fault('CONNECTION_UNAUTHORIZED');
    await backendFor(request.worldRef, () => createBackend({ worldRef: request.worldRef,
      transport, proof, connectionRef: request.connectionRef, remote: true }));
    return { connectionRef: request.connectionRef, worldRef: request.worldRef,
      payloadVersion: PAYLOAD_VERSION, payloadDigest: await payloadDigest(),
      binding: { authorizerRef: proof.authorizerRef, actorRef: proof.actorRef,
        bindingRef: proof.bindingRef, worldRef: request.worldRef,
        grantEpoch: proof.grantEpoch, allowedActions: proof.allowedActions },
      capabilities: { providerRef: adapterId, capabilityRevision: descriptor.capabilityRevision,
        worldRef: request.worldRef, engineBounds: null, limits: [],
        ...recoveryFacts(request.worldRef), regionProtectionWriters: [],
        sessionDeleteSupported: false, imageMediaTypes: [], model: null } };
  }
  // Local binding: the operator's BIND_RUNNING_WORLD proof, the world's courier
  // transport and payload handshake, the engine principal, then the backend.
  async function bindLocal(request, proof, descriptor) {
    const world = local.get(request.connectionRef);
    if (!world?.worldRef || typeof serviceName !== 'string' || !serviceName ||
        typeof proof.engineActorName !== 'string' || !proof.engineActorName ||
        !await verifyLocalOperator(world)) fault('CONNECTION_UNAUTHORIZED');
    const { transport } = await transportFor(world.worldRef, () =>
      LocalEngineTransport.open(world.worldPath, { serviceName, onAction }));
    const loaded = await transport.handshake();
    const principal = await transport.verifyPrincipal(proof.engineActorName);
    if (!principal.current) fault('CONNECTION_UNAUTHORIZED');
    if (typeof proof.authorizerRef !== 'string' || typeof proof.bindingRef !== 'string' ||
        typeof proof.actorRef !== 'string' || !proof.actorRef ||
        typeof proof.grantEpoch !== 'string' || !Array.isArray(proof.allowedActions))
      fault('CONNECTION_UNAUTHORIZED');
    const binding = { authorizerRef: proof.authorizerRef, actorRef: proof.actorRef,
      bindingRef: proof.bindingRef, worldRef: request.worldRef,
      grantEpoch: proof.grantEpoch, allowedActions: proof.allowedActions };
    await backendFor(request.worldRef, () => createBackend({ worldRef: request.worldRef,
      transport, proof, connectionRef: request.connectionRef, remote: false }));
    return { connectionRef: request.connectionRef, worldRef: request.worldRef,
      payloadVersion: loaded.payloadVersion, payloadDigest: loaded.payloadDigest, binding,
      capabilities: { providerRef: adapterId, capabilityRevision: descriptor.capabilityRevision,
        worldRef: request.worldRef, engineBounds: null, limits: [],
        ...recoveryFacts(request.worldRef), regionProtectionWriters: [],
        sessionDeleteSupported: false, imageMediaTypes: [], model: null } };
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
      reserveWorld(request.worldRef, request.connectionRef);
      let result;
      try {
        result = remote.has(request.connectionRef)
          ? await bindRemote(request, proof, descriptor)
          : await bindLocal(request, proof, descriptor);
      } catch (error) {
        await releaseWorld(request.worldRef, request.connectionRef, error);
        throw error;
      }
      established.add(request.worldRef);
      await releaseWorld(request.worldRef, request.connectionRef, null);
      return result;
    },
    async InspectWorld(request, proof) {
      // The frozen request has no objectRef. Only the authenticated consumer can
      // identify the selected object and provide its current catalogue/frame.
      const trustedContext = typeof inspectContext === 'function'
        ? inspectContext() : inspectContext;
      if (typeof trustedContext?.read !== 'function') fault('CAPABILITY_UNAVAILABLE');
      const context = await trustedContext.read(request, proof);
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
    QueryPreparedTransaction(request) { return backend(request).queryPrepared(request); },
    PrepareHistoryTransaction(request) { return backend(request).prepareHistory(request); },
    QueryPreparedHistoryTransaction(request) { return backend(request).queryPreparedHistory(request); },
    ApplyHistoryTransaction(request) { return backend(request).applyHistory(request); },
    AbortPreparedTransaction(request) { return backend(request).abortPrepared(request); },
    AbortPreparedHistoryTransaction(request) { return backend(request).abortPreparedHistory(request); },
    InspectRegion(request) { return backend(request).inspectRegion(request); },
  };
  return { operations, open, currentAccess, close: async () => {
    await Promise.all([...open.values()].map(transport => transport.close())); open.clear();
    boundConnection.clear(); ownedBackends.clear(); inflight.clear(); established.clear();
  } };
}
