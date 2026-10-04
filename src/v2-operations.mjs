import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { discoverLocalWorlds, payloadDigest } from './local-worlds.mjs';
import { LocalEngineTransport } from './local-transport.mjs';
import { RemoteEngineTransport, verifyRemoteOperator } from './remote-transport.mjs';
import { projectionDigest } from './v2-transactions.mjs';
import { ADAPTER_ID, PAYLOAD_VERSION } from './version.mjs';
import { ContractError, canonicalJSON, validateResponse, validateType } from '#contracts/v4';

function fault(code) { throw new Error(code); }
// Fixed, provider-text-free code for a rejected transport close.
const CLOSE_FAILED = 'TRANSPORT_CLOSE_FAILED';
const adapterId = ADAPTER_ID;
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Runtime-owned operation handlers. World mutation remains gated on the
 * frozen complete state profile and a real Canvas binding; no v1 fallback. */
export function createLuantiOperations({ roots = [], remoteProfiles = [], operatorAuthority,
  remoteTunnelFactory, serviceName, onAction, transactionBackends,
  createBackend, inspectContext, log } = {}) {
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
  const evidenceBusy = new Map(); // worldRef -> temporary local proof read
  let closed = false;
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
  // Releases one call's hold. When the last holder failed, the world is kept
  // only if a binding was accepted or its journal holds unsettled records that
  // trusted recovery may still need; a backend merely existing is not a
  // recovery record. Otherwise the reservation, the backend built for it and
  // the transport it left are all dropped (transport closed), so nothing is
  // stuck or orphaned. A close failure is attached to `error`.
  async function releaseWorld(worldRef, connectionRef, error) {
    const left = (inflight.get(worldRef) ?? 1) - 1;
    if (left > 0) inflight.set(worldRef, left); else inflight.delete(worldRef);
    if (!error || left > 0 || boundConnection.get(worldRef) !== connectionRef ||
        established.has(worldRef) || building.has(worldRef) ||
        ownedBackends.get(worldRef)?.hasUnsettledRecords) return;
    const closed = await closeWorld(worldRef);
    if (!closed.ok) error.closeError = closed.code;
  }
  // A world held only as a recovery handle (reserved, never accepted) is
  // retired once trusted recovery has settled its last unsettled record and no
  // binding or other recovery call for it is still in flight: its reservation,
  // backend and transport are dropped and the transport closed, so the next
  // currently authorized connection can bind. A close failure is logged.
  const recovering = new Map(); // worldRef -> trusted recovery calls in flight
  async function retireIfSettled(worldRef) {
    const owned = ownedBackends.get(worldRef);
    if (!boundConnection.has(worldRef) || established.has(worldRef) || inflight.has(worldRef) ||
        recovering.has(worldRef) || building.has(worldRef) || opening.has(worldRef) ||
        closing.has(worldRef) || !owned || owned.hasUnsettledRecords) return;
    await closeWorld(worldRef);
  }
  // Transport teardown and ownership are one lifecycle: the world's
  // reservation and transport are released only after the transport has
  // actually closed. A rejected close leaves the transport reachable in
  // `open` and the world owned (close-pending), so no competing binding or
  // second transport can start while the old one may still live; the failure
  // is logged. The next AuthorizeBinding for that world, or shutdown,
  // attempts the close again; concurrent callers share one attempt.
  const closing = new Map();      // worldRef -> close attempt in flight
  const closePending = new Set(); // worldRefs whose last close was rejected
  function closeWorld(worldRef) {
    if (closing.has(worldRef)) return closing.get(worldRef);
    const attempt = (async () => {
      const transport = open.get(worldRef);
      // The backend held no record that needs recovery; it is not kept.
      ownedBackends.delete(worldRef);
      try { if (transport) await transport.close(); }
      catch {
        // The provider's exception text is untrusted (it may carry a URL or
        // credential), so only a fixed code and the Adapter's worldRef are
        // reported.
        closePending.add(worldRef);
        const text = `world ${worldRef}: ${CLOSE_FAILED}; world stays held until a later close succeeds`;
        if (typeof log === 'function') log('error', text); else console.error(text);
        return { ok: false, code: CLOSE_FAILED };
      }
      open.delete(worldRef);
      boundConnection.delete(worldRef);
      closePending.delete(worldRef);
      return { ok: true };
    })().finally(() => closing.delete(worldRef));
    closing.set(worldRef, attempt);
    return attempt;
  }
  async function recover(request, run) {
    const worldRef = request.worldRef;
    recovering.set(worldRef, (recovering.get(worldRef) ?? 0) + 1);
    try { return await run(backend(request, { recovery: true })); }
    finally {
      const left = recovering.get(worldRef) - 1;
      if (left > 0) recovering.set(worldRef, left); else recovering.delete(worldRef);
      await retireIfSettled(worldRef);
    }
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
    // A backend kept only as a recovery handle (no accepted binding) is not
    // reused once its records have settled: the binding gets a fresh one.
    const kept = ownedBackends.get(worldRef);
    if (kept && !established.has(worldRef) && !kept.hasUnsettledRecords) ownedBackends.delete(worldRef);
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
  // A world reserved by a binding that was never accepted (pending, or kept
  // only as a recovery handle) is not usable for normal operations; trusted
  // service recovery needs only the backend (its journal records).
  const unaccepted = worldRef => boundConnection.has(worldRef) && !established.has(worldRef);
  function backend(request, { recovery = false } = {}) {
    const owned = ownedBackends.get(request.worldRef);
    if (!recovery && unaccepted(request.worldRef)) fault('CAPABILITY_UNAVAILABLE');
    const value = owned ?? transactionBackends?.get?.(request.worldRef);
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

  async function withLocalGrantEvidence(world, read) {
    if (closed) fault('ADAPTER_UNAVAILABLE');
    if (!world?.worldRef || !await verifyLocalOperator(world)) return null;
    const owner = boundConnection.get(world.worldRef);
    if (owner !== undefined && owner !== world.connectionRef) fault('CONNECTION_UNAUTHORIZED');
    if (open.has(world.worldRef)) {
      if (owner !== world.connectionRef || closePending.has(world.worldRef))
        fault('CONNECTION_UNAUTHORIZED');
      const transport = open.get(world.worldRef);
      await transport.handshake();
      return read(transport);
    }
    // A binding already in flight owns the port. Refuse an ambiguous read;
    // binding waits for any earlier temporary proof read before opening it.
    if (inflight.has(world.worldRef) || evidenceBusy.has(world.worldRef))
      fault('ADAPTER_UNAVAILABLE');
    const pending = (async () => {
      const transport = await LocalEngineTransport.open(world.worldPath, { serviceName });
      try { await transport.handshake(); return await read(transport); }
      finally { await transport.close(); }
    })();
    evidenceBusy.set(world.worldRef, pending);
    try { return await pending; }
    finally { evidenceBusy.delete(world.worldRef); }
  }

  async function localGrantWorlds() {
    return (await discoverLocalWorlds(rootPaths)).filter(world => world.worldRef);
  }
  const grantEvidence = {
    async listCurrentLocalGrants() {
      const results = [];
      const seenWorlds = new Set();
      for (const world of await localGrantWorlds()) {
        if (seenWorlds.has(world.worldRef)) fault('CONNECTION_UNAUTHORIZED');
        seenWorlds.add(world.worldRef);
        const grants = await withLocalGrantEvidence(world,
          transport => transport.listCurrentGrants());
        if (grants) for (const grant of grants)
          results.push({ connectionRef: world.connectionRef, ...grant });
      }
      return results;
    },
    async verifyCurrentLocalGrant({ worldRef, engineActorName, expectedGrantRef } = {}) {
      if (typeof worldRef !== 'string' || !worldRef ||
          typeof engineActorName !== 'string' || !engineActorName ||
          typeof expectedGrantRef !== 'string' || !expectedGrantRef)
        fault('CONNECTION_UNAUTHORIZED');
      const matches = (await localGrantWorlds()).filter(world => world.worldRef === worldRef);
      if (matches.length !== 1) return { current: false };
      let proof;
      try { proof = await withLocalGrantEvidence(matches[0],
        transport => transport.verifyPrincipal(engineActorName)); }
      catch (error) {
        if (error?.message === 'CONNECTION_UNAUTHORIZED') return { current: false };
        throw error;
      }
      return proof?.grantRef === expectedGrantRef
        ? { connectionRef: matches[0].connectionRef, ...proof } : { current: false };
    },
  };

  async function readNativeFact({ worldRef, engineActorName, expectedGrantRef } = {}, read) {
    if (typeof worldRef !== 'string' || !worldRef ||
        typeof engineActorName !== 'string' || !engineActorName ||
        typeof expectedGrantRef !== 'string' || !expectedGrantRef)
      fault('CONNECTION_UNAUTHORIZED');
    const matches = (await localGrantWorlds()).filter(world => world.worldRef === worldRef);
    if (matches.length !== 1) fault('WORLD_NOT_BOUND');
    const result = await withLocalGrantEvidence(matches[0], async transport => {
      const first = await transport.verifyPrincipal(engineActorName);
      if (first.grantRef !== expectedGrantRef) fault('AUTHORIZATION_REVOKED');
      const binding = { ...first, nativeGrantRef: first.grantRef };
      const value = await read(transport, binding);
      const last = await transport.verifyPrincipal(engineActorName);
      if (last.grantRef !== expectedGrantRef) fault('AUTHORIZATION_REVOKED');
      return value;
    });
    if (result === null) fault('CONNECTION_UNAUTHORIZED');
    return result;
  }
  const nativeFacts = {
    async readScopedState(input = {}) {
      const normalize = source => {
        if (!Array.isArray(source) || source.length === 0) fault('SCHEMA_INVALID');
        const result = source.map(position => {
          if (!Array.isArray(position) || position.length !== 3 ||
            position.some(coordinate => !Number.isSafeInteger(coordinate))) fault('SCHEMA_INVALID');
          return [...position];
        }).sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]) || compare(a[2], b[2]));
        if (result.some((position, index) => index > 0 &&
            position.every((coordinate, axis) => coordinate === result[index - 1][axis])))
          fault('SCHEMA_INVALID');
        return result;
      };
      const positions = normalize(input.positions);
      const protectedPositions = input.protectedPositions === undefined ? undefined :
        normalize(input.protectedPositions);
      if (protectedPositions?.some(position => !positions.some(covered =>
        position.every((coordinate, axis) => coordinate === covered[axis]))))
        fault('SCHEMA_INVALID');
      return readNativeFact(input, async (transport, binding) => {
        const profile = await transport.readStateProfile(binding);
        const raw = await transport.snapshot({ coveredPositions: positions,
          protectedPositions }, binding);
        const projection = { ...raw, stateProfile: profile };
        try { validateType('ReadbackProjection', projection); }
        catch { fault('CAPABILITY_UNAVAILABLE'); }
        if (projection.worldRef !== input.worldRef ||
            JSON.stringify(projection.coveredPositions) !== JSON.stringify(positions))
          fault('CAPABILITY_UNAVAILABLE');
        return { worldRef: input.worldRef, coveredPositions: positions,
          stateDigest: projectionDigest('readback', projection),
          cells: projection.records.map(record => ({ position: record.position,
            availability: 'KNOWN', stateDigest: createHash('sha256')
              .update('HanaWorlds|adapter-scoped-cell/v1\n')
              .update(canonicalJSON({ profile, record })).digest('hex') })),
          source: 'PAIRED_LUANTI_STATE_READBACK' };
      });
    },
    async readStateProfile(input) {
      const value = await readNativeFact(input, (transport, binding) =>
        transport.readStateProfile(binding));
      try { return validateType('StateProfile', value); }
      catch { fault('CAPABILITY_UNAVAILABLE'); }
    },
    async checkCapacity(input = {}) {
      if (!Number.isSafeInteger(input.cellCount) || input.cellCount < 0)
        fault('CAPABILITY_UNAVAILABLE');
      const value = await readNativeFact(input, (transport, binding) =>
        transport.checkCapacity(input.cellCount, binding));
      if (typeof value?.allowed !== 'boolean' ||
          !Number.isSafeInteger(value.maxCells) || value.maxCells < 0 ||
          value.source !== 'PAIRED_COURIER_RESPONSE_BYTES' ||
          value.allowed !== (input.cellCount <= value.maxCells))
        fault('CAPABILITY_UNAVAILABLE');
      return value;
    },
    async readCatalogue(input) {
      const value = await readNativeFact(input, (transport, binding) =>
        transport.readCatalogue(binding));
      try { return validateType('Catalogue', value); }
      catch { fault('CAPABILITY_UNAVAILABLE'); }
    },
    async readWorldRevision(input) {
      const value = await readNativeFact(input, (transport, binding) =>
        transport.readWorldRevision(binding));
      if (typeof value !== 'string' || !value) fault('CAPABILITY_UNAVAILABLE');
      return value;
    },
    async readObjectRevisions(input = {}) {
      const refs = input.objectRefs;
      if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !ref))
        fault('CAPABILITY_UNAVAILABLE');
      const value = await readNativeFact(input, (transport, binding) =>
        transport.readObjectRevisions(refs, binding));
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).length !== refs.length ||
          refs.some(ref => typeof value[ref] !== 'string' || !value[ref]))
        fault('CAPABILITY_UNAVAILABLE');
      return value;
    },
  };

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
    if (evidenceBusy.has(world.worldRef)) await evidenceBusy.get(world.worldRef);
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
      // A world whose old transport is still being (or failed to be) closed is
      // bound by nobody until that close succeeds; no transport is reused.
      if (closing.has(request.worldRef) || closePending.has(request.worldRef)) {
        const closed = await closeWorld(request.worldRef);
        if (!closed.ok) fault('ADAPTER_UNAVAILABLE');
      }
      reserveWorld(request.worldRef, request.connectionRef);
      let result;
      try {
        result = remote.has(request.connectionRef)
          ? await bindRemote(request, proof, descriptor)
          : await bindLocal(request, proof, descriptor);
        // The binding is accepted only once its public response is valid (the
        // same check the port applies next), so a late projection or contract
        // failure is cleaned up here instead of stranding the world.
        validateResponse('world-adapter/v4', 'AuthorizeBinding', {
          contractVersion: 'world-adapter/v4', requestId: request.requestId, result, error: null });
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
      if (!transport || unaccepted(request.worldRef)) fault('WORLD_NOT_BOUND');
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
      const principal = await transport.verifyPrincipal(proof.engineActorName);
      const raw = await transport.inspect(positions, { current: true,
        worldRef: request.worldRef, engineActorName: proof.engineActorName,
        nativeGrantRef: principal.grantRef });
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
    RestoreTransaction(request) { return recover(request, owned => owned.restore(request)); },
    QueryPreparedTransaction(request) { return backend(request).queryPrepared(request); },
    PrepareHistoryTransaction(request) { return backend(request).prepareHistory(request); },
    QueryPreparedHistoryTransaction(request) { return backend(request).queryPreparedHistory(request); },
    ApplyHistoryTransaction(request) { return backend(request).applyHistory(request); },
    AbortPreparedTransaction(request) { return recover(request, owned => owned.abortPrepared(request)); },
    AbortPreparedHistoryTransaction(request) { return recover(request, owned => owned.abortPreparedHistory(request)); },
    InspectRegion(request) { return backend(request).inspectRegion(request); },
  };
  const scopedOperations = {
    PrepareRecoverableTransaction(request) { return backend(request).scoped.prepare(request); },
    ApplyCompiledTransaction(request) { return backend(request).scoped.apply(request); },
    QueryPreparedTransaction(request) { return backend(request).scoped.queryPrepared(request); },
  };
  return { operations, scopedOperations, open, currentAccess, grantEvidence, nativeFacts, close: async () => {
    closed = true;
    await Promise.allSettled([...evidenceBusy.values()]);
    // Every transport gets a close attempt; one that is rejected stays in
    // `open` and the failure is reported, not hidden.
    const entries = [...open.entries()];
    const results = await Promise.allSettled(entries.map(([, transport]) => transport.close()));
    const failed = [];
    results.forEach((result, i) => {
      const [worldRef] = entries[i];
      if (result.status === 'fulfilled') { open.delete(worldRef); closePending.delete(worldRef); }
      else { closePending.add(worldRef); failed.push(worldRef); }  // provider text not forwarded
    });
    // A world whose transport did not close stays owned and close-pending.
    for (const worldRef of [...boundConnection.keys()])
      if (!open.has(worldRef)) boundConnection.delete(worldRef);
    ownedBackends.clear(); inflight.clear(); established.clear(); recovering.clear();
    if (failed.length) {
      const text = `${CLOSE_FAILED}: transport close failed for ${failed.length} world(s): ${failed.join(', ')}`;
      if (typeof log === 'function') log('error', text); else console.error(text);
      const error = new Error(text);
      error.code = CLOSE_FAILED;
      throw error;
    }
  } };
}
