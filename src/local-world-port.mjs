import { validateType, validateBoundRequest, validateBoundResponse, ContractError } from '#contracts';
import { randomUUID } from 'node:crypto';
import { lstat as nativeLstat, realpath as nativeRealpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createServer } from 'node:net';
import { discoverLocalWorlds, provisionLocalPayload } from './local-worlds.mjs';
import { createFlatWorld, describeFlatWorldCreation, FLAT_WORLD_TEMPLATE_ID } from './flat-world.mjs';
import { readCreatedMarker, removeWorldDirectory, worldData } from './local-world-deletion.mjs';
import { readWorldSelections, withWorldRetirement } from './world-retirement.mjs';
import { readSourceStartupFacts } from './source-startup.mjs';
import { SOURCE_LOCATOR_VERSION } from './source-locator.mjs';

import { sourceLog } from './resource-errors.mjs';
import { attachLocalSource } from './local-source-port.mjs';
import { creationMaterials, closedObject, sourceError } from './local-source-protocol.mjs';
import { sourceRead, checkSourceScope, sourceCallActive, bindSourceWorld, addSourceCheck, sourceMutationState } from './source-scope.mjs';
const lstat = (...args) => sourceRead(() => nativeLstat(...args));
const realpath = (...args) => sourceRead(() => nativeRealpath(...args));

const ACTIONS = new Set(['PROVISION_PAYLOAD', 'BIND_RUNNING_WORLD']);
const original = value => value?.[Symbol.for('cordis.original')] ?? value;
function deny(code = 'CURRENT_WORLD_MISMATCH', details) { const error = new Error(code); if (details) error.details = details; throw error; }
function text(value) { return typeof value === 'string' && value.length > 0; }
function fields(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) deny('SCHEMA_INVALID');
  return { ...value };
}
async function freePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  return port;
}

/** In-process Host lifecycle port. Never accepts lifecycle facts from request JSON. Native process and
 * child lifecycle stay in the public Host; stopped facts exist only in its callback. */
export function createLocalWorldPort({ ctx, roots = [], userPath, creationRoot, gameId, localSourceCreationMaterials, resolveEngineRuntime, resolveControl, resolveCanvas, runtime, transportSettings = {}, log = (_,message) => {if(message.startsWith('WORLD_SOURCE_FAILURE'))console.warn(message);} }) {
  let rootPaths = roots.map(root => resolve(root)), closed = false;
  const materials = creationMaterials(localSourceCreationMaterials);
  let source;
  const leases = new Map(), running = new Map(), bindings = new Map(), managed = new Set(), pending = new Set();
  // Latest Host control record per world path this service acquired; kept after the lease ends so a
  // later deletion runs inside that Host's own stopped-world callback for the exact owned process.
  const controls = new Map();
  let lifecycle = Promise.resolve();
  function track(run) {
    const work = lifecycle.then(async () => { if (closed) deny('ADAPTER_UNAVAILABLE'); await checkSourceScope(); return run(); });
    lifecycle = work.catch(() => {});
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
  }
  // Contract admission snapshots the caller before lifecycle work is queued.
  async function lifecycleCall(operation, input, run) {
    const request = validateBoundRequest('local-worlds/v2', operation, input);
    let result = null, error = null;
    try { result = await run(request); }
    catch (failure) {
      const origin = operation === 'pair' && !failure.source ? (failure.cause ?? failure) : failure;
      const cause = origin.code ?? origin.message;
      if (sourceCallActive() && ['CURRENT_WORLD_MISMATCH', 'UNKNOWN_REQUIRED_FIELD'].includes(cause)) throw failure;
      if(sourceLog(origin)) log('warn',sourceLog(origin));
      const code = operation === 'deleteWorld'
        ? (cause === 'WORLD_NOT_FOUND' ? 'WORLD_NOT_FOUND' : 'TRANSACTION_CONFLICT')
        : operation === 'pair'
        ? (cause === 'PAYLOAD_VERSION_MISMATCH' ? cause : 'CONNECTION_NOT_FOUND')
        : operation === 'describeSourceWorld'
        ? (['WORLD_NOT_FOUND', 'CURRENT_WORLD_MISMATCH'].includes(cause) ? cause : 'ADAPTER_UNAVAILABLE')
        : (operation === 'createWorld' && ['INVALID_NAME', 'WORLD_EXISTS'].includes(cause) ? 'INVALID_NAME' : 'ADAPTER_UNAVAILABLE');
      const mutationState = operation === 'describeSourceWorld' ? 'NONE' : failure.mutationState ?? (cause === 'DELETE_INCOMPLETE' ? 'PARTIAL'
        : ['READBACK_MISMATCH', 'LOCAL_CREATE_DISCOVERY_MISMATCH'].includes(cause) ? 'UNKNOWN'
        : failure.code?.startsWith('E') ? 'UNKNOWN' : 'NONE');
      error = new ContractError(code, operation === 'deleteWorld' ? 'apply' : 'validate',
        code === 'INVALID_NAME' ? 'INVALID_SHAPE' : code === 'PAYLOAD_VERSION_MISMATCH' ? 'VERSION_UNSUPPORTED'
          : 'REQUIRED_FACT_UNKNOWN', { mutationState, ...(origin.source?{source:origin.source}:{}) }).publicError;
    }
    return validateBoundResponse('local-worlds/v2', operation, request,
      { contractVersion: 'local-worlds/v2', requestId: request.requestId, result, error });
  }
  const sourceRef = row => row.worldRef ?? row.connectionRef;
  async function selectWorld(worldRef) {
    const rows = (await discover()).filter(row => sourceRef(row) === worldRef);
    if (!rows.length) deny('WORLD_NOT_FOUND');
    if (rows.length !== 1) deny('TRANSACTION_CONFLICT');
    const stat = await lstat(rows[0].worldPath);
    bindSourceWorld({ ...rows[0], device: stat.dev, inode: stat.ino });
    return rows[0];
  }
  // Read-only source description: one exact discovered world by worldRef, its canonical directory
  // and identity observed twice; any change in between, a duplicate reference or a non-canonical
  // path refuses. Display names never select. Shape: docs/source-locator.md.
  async function describeSource(worldRef) {
    const reject = (code, reason) => { log('warn', `LOCAL_SOURCE_DESCRIBE_REJECTED ${reason}`); deny(code); };
    const observe = async () => {
      const rows = (await discover()).filter(row => sourceRef(row) === worldRef);
      if (!rows.length) reject('WORLD_NOT_FOUND', 'WORLD_NOT_DISCOVERED');
      if (rows.length !== 1) reject('CURRENT_WORLD_MISMATCH', 'WORLD_REF_NOT_UNIQUE');
      const row = rows[0], root = dirname(row.worldPath);
      if (!rootPaths.includes(root)) reject('CURRENT_WORLD_MISMATCH', 'WORLD_OUTSIDE_ROOTS');
      const info = await lstat(row.worldPath, { bigint: true }).catch(() => null);
      if (!info) reject('WORLD_NOT_FOUND', 'WORLD_DIRECTORY_GONE');
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(row.worldPath).catch(() => null) !== row.worldPath)
        reject('CURRENT_WORLD_MISMATCH', 'WORLD_PATH_NOT_CANONICAL');
      return { row, root, device: String(info.dev), inode: String(info.ino) };
    };
    let user = null;
    if (userPath !== undefined) {
      const info = text(userPath) && isAbsolute(userPath) ? await lstat(userPath).catch(() => null) : null;
      if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(userPath) !== resolve(userPath))
        reject('ADAPTER_UNAVAILABLE', 'USER_PATH_NOT_CANONICAL');
      user = resolve(userPath);
    }
    const first = await observe();
    const startupFirst = await readSourceStartupFacts(first.row, {device:first.device,inode:first.inode});
    const again = await observe();
    const sourceStartupFacts = await readSourceStartupFacts(again.row, {device:again.device,inode:again.inode});
    if (JSON.stringify(startupFirst) !== JSON.stringify(sourceStartupFacts)) reject('CURRENT_WORLD_MISMATCH', 'PAYLOAD_CHANGED_DURING_READ');
    if (!['connectionRef', 'worldPath', 'worldRef', 'gameId', 'payloadStatus', 'payloadVersion', 'payloadDigest']
      .every(k => first.row[k] === again.row[k]) || first.device !== again.device || first.inode !== again.inode)
      reject('CURRENT_WORLD_MISMATCH', 'WORLD_IDENTITY_CHANGED');
    const last = await observe();
    if (JSON.stringify(last) !== JSON.stringify(again)) reject('CURRENT_WORLD_MISMATCH', 'WORLD_CHANGED_AFTER_PAYLOAD_READ');
    const { row } = again;
    return { worldRef, sourceStartupFacts, sourceLocator: { locatorVersion: SOURCE_LOCATOR_VERSION, worldRef,
      connectionRef: row.connectionRef, worldPath: row.worldPath, worldRoot: again.root, userPath: user,
      directory: { device: again.device, inode: again.inode }, gameId: row.gameId,
      payload: { status: row.payloadStatus, payloadVersion: row.payloadVersion, payloadDigest: row.payloadDigest } } };
  }
  async function discover() {
    if (closed) deny('ADAPTER_UNAVAILABLE');
    return discoverLocalWorlds(rootPaths);
  }
  async function world(connectionRef) {
    if (!text(connectionRef)) deny('SCHEMA_INVALID');
    const rows = (await discover()).filter(row => row.connectionRef === connectionRef);
    if (rows.length !== 1) deny('CONNECTION_NOT_FOUND');
    const row = rows[0], path = await realpath(row.worldPath);
    if (path !== row.worldPath) deny();
    const info = await lstat(path);
    const selected = { ...row, device: info.dev, inode: info.ino };
    bindSourceWorld(selected);
    return selected;
  }
  function sameWorld(left, right) {
    return ['connectionRef', 'worldPath', 'worldRef', 'payloadVersion', 'payloadDigest', 'device', 'inode']
      .every(k => left[k] === right[k]);
  }
  function factsMatch(row, facts, state) {
    return facts?.state === state && facts.worldPath === row.world.worldPath &&
      facts.operationRef === row.nativeQuery.operationRef &&
      Number.isSafeInteger(facts.processId) && facts.processId > 0 &&
      (row.processId === undefined || facts.processId === row.processId);
  }
  function provider(row) {
    if (closed || (resolveControl()?.[Symbol.for('cordis.original')] ?? resolveControl()) !== (row.host[Symbol.for('cordis.original')] ?? row.host)) deny();
    return row.host;
  }
  function forget(row) {
    leases.delete(row.leaseRef);
    if (running.get(row.world.worldPath) === row) running.delete(row.world.worldPath);
  }
  async function inspectRow(row, { readOnly = false } = {}) {
    let phase = 'PROVIDER';
    try {
      const host = provider(row);
      if (row.retired) deny();
      phase = 'WORLD_IDENTITY';
      if (!sameWorld(row.world, await world(row.world.connectionRef))) deny();
      phase = 'NATIVE_INSPECT';
      if (row.sourceCheck) await row.sourceCheck();
      const facts = await sourceRead(() => host.inspect({ ...row.nativeQuery }));
      phase = 'NATIVE_FACTS';
      provider(row);
      if (!factsMatch(row, facts, 'CURRENT') || !sameWorld(row.world, await world(row.world.connectionRef))) deny();
      if (row.sourceCheck) await row.sourceCheck();
      return facts;
    } catch (error) {
      log('warn', `LOCAL_LEASE_${phase}_REJECTED`);
      // A fact read cannot revoke a binding or prove the process stopped. Keep
      // its custody record and require fresh evidence on the next read. Lease
      // actions retain their original withdrawal on failure.
      if (!readOnly) forget(row);
      if (readOnly && error?.publicError !== undefined) {
        validateType('Error', error.publicError);
        throw error;
      }
      deny(); // no provider error text or credentials escape
    }
  }
  function query(input, extra = []) {
    const q = fields(input, ['leaseRef', 'requesterRef', 'connectionRef', ...extra],
      ['leaseRef', 'requesterRef', 'connectionRef']);
    if (![q.leaseRef, q.requesterRef, q.connectionRef].every(text)) deny('SCHEMA_INVALID');
    const row = leases.get(q.leaseRef);
    if (!row) { log('warn', 'LOCAL_QUERY_LEASE_UNKNOWN'); deny(); }
    if (row.requesterRef !== q.requesterRef || row.world.connectionRef !== q.connectionRef) {
      log('warn', 'LOCAL_QUERY_BINDING_MISMATCH'); deny();
    }
    return { q, row };
  }
  function observations(row, facts) {
    return { current: true, leaseRef: row.leaseRef, connectionRef: row.world.connectionRef,
      worldPath: row.world.worldPath, worldRef: row.world.worldRef, action: row.action,
      nativeProcessId: facts.processId };
  }
  async function stopUnused(row) {
    try {
      if ((resolveControl()?.[Symbol.for('cordis.original')] ?? resolveControl()) === (row.host[Symbol.for('cordis.original')] ?? row.host))
        await row.host.withStoppedWorld({ ...row.nativeQuery }, async () => undefined);
    } catch { /* Host owns cleanup of rejected or dead native sessions */ }
    forget(row);
  }
  // Keep the original Host query even after CURRENT inspection fails. A failure
  // revokes a lease, but cannot prove that its native process has stopped.
  async function retireBinding(row) {
    const host = provider(row);
    let active = true, used = false;
    try {
      await host.withStoppedWorld({ ...row.nativeQuery }, async facts => {
        if (!active || used || !factsMatch(row, facts, 'STOPPED')) deny();
        used = true; provider(row);
        if (!sameWorld(row.world, await world(row.world.connectionRef))) deny();
        if (!active || !factsMatch(row, facts, 'STOPPED')) deny();
        provider(row);
        row.retired = true;
        for (const lease of leases.values()) {
          if (lease.world.connectionRef === row.world.connectionRef) { lease.retired = true; forget(lease); }
        }
        forget(row);
        await runtime.retireLocal(row.publicConnectionRef ?? row.world.connectionRef);
        provider(row);
        if (!active) deny();
        bindings.delete(row.world.connectionRef);
      });
      if (!used) deny();
    } finally { active = false; }
  }
  function deletionInput(input) {
    const q = fields(input, ['requesterRef', 'connectionRef', 'worldRef']);
    if (![q.requesterRef, q.connectionRef, q.worldRef].every(text)) deny('SCHEMA_INVALID');
    return q;
  }
  // Every fact a deletion depends on, read now from the world, this service and the
  // runtime journal. Blockers are named; nothing is mutated.
  async function deletionFacts(q) {
    const selected = await world(q.connectionRef);
    if (selected.worldRef !== q.worldRef) deny('CURRENT_WORLD_MISMATCH');
    if (!rootPaths.includes(dirname(selected.worldPath))) deny('CONNECTION_NOT_FOUND');
    const blockers = [], ownership = await readCreatedMarker(selected);
    if (!ownership.owned) blockers.push({ code: 'WORLD_OWNERSHIP_UNKNOWN', reason: ownership.reason });
    const same = row => row.world.connectionRef === selected.connectionRef || row.world.worldPath === selected.worldPath;
    if ([...leases.values()].some(same)) blockers.push({ code: 'WORLD_IN_USE', reason: 'LIFECYCLE_LEASE_OPEN' });
    if ([...bindings.values()].some(same) || running.has(selected.worldPath))
      blockers.push({ code: 'WORLD_IN_USE', reason: 'ADAPTER_CONNECTION_BOUND' });
    if (typeof runtime.localWorldActivity !== 'function') blockers.push({ code: 'REQUIRED_FACT_UNKNOWN', reason: 'RUNTIME_ACTIVITY_UNAVAILABLE' });
    else {
        const activity = await sourceRead(() => runtime.localWorldActivity({ connectionRef: selected.connectionRef, worldRef: selected.worldRef }));
      if (activity.bound) blockers.push({ code: 'WORLD_IN_USE', reason: 'RUNTIME_CONNECTION_OPEN' });
      if (activity.journal.state === 'UNKNOWN') blockers.push({ code: 'REQUIRED_FACT_UNKNOWN', reason: 'JOURNAL_UNREADABLE', detail: activity.journal.reason });
      else if (activity.journal.state === 'PRESENT' && activity.journal.unsettled.length)
        blockers.push({ code: 'WORLD_IN_USE', reason: 'TRANSACTION_IN_FLIGHT', transactions: activity.journal.unsettled });
    }
    const control = controls.get(selected.worldPath);
    if (control && (resolveControl()?.[Symbol.for('cordis.original')] ?? resolveControl()) !== (control.host[Symbol.for('cordis.original')] ?? control.host))
      blockers.push({ code: 'CURRENT_WORLD_MISMATCH', reason: 'NATIVE_CONTROL_PROVIDER_REPLACED' });
    return { world: selected, marker: ownership.marker ?? null, blockers, control,
      nativeStop: control ? 'HOST_STOPPED_CALLBACK' : 'NOT_LAUNCHED_BY_THIS_SERVICE', data: await worldData(selected.worldPath) };
  }
  async function createFlatWorldProduct(input, material) {
      const q = fields(input, ['requesterRef', 'userPath', 'root', 'gameId', 'worldName'], ['requesterRef', 'userPath']);
      if (!text(q.requesterRef) || !text(q.userPath) || !isAbsolute(q.userPath) ||
          ['root', 'gameId', 'worldName'].some(k => k in q && !text(q[k])) || ('root' in q && !isAbsolute(q.root)))
        return Promise.reject(new Error('SCHEMA_INVALID'));
      return track(async () => {
        const made = await createFlatWorld({ transportSettings, roots: rootPaths, root: q.root, userPath: resolve(q.userPath),
          gameId: q.gameId, worldName: q.worldName, transportPort: await sourceRead(freePort),
          ...(material ? { creationFacts: material.creationFacts } : {}) });
        const rows = (await discover()).filter(row => row.worldPath === made.worldPath);
        if (rows.length !== 1 || rows[0].worldRef !== made.identity.worldRef) { log('warn', 'LOCAL_CREATE_DISCOVERY_MISMATCH'); deny('LOCAL_CREATE_DISCOVERY_MISMATCH'); }
        log('info', `LOCAL_FLAT_WORLD_CREATED ${rows[0].connectionRef}`);
        return { created: true, connectionRef: rows[0].connectionRef, worldPath: made.worldPath, worldName: made.worldName,
          worldRef: made.identity.worldRef, payloadVersion: made.identity.payloadVersion, payloadDigest: made.identity.payloadDigest,
          game: made.game, mapgen: made.mapgen, nextAction: 'BIND_RUNNING_WORLD', creationFacts: made.creationFacts };
      });
    }
  const port = {
    async setRoots(input) {
      const { roots: selected } = fields(input, ['roots']);
      if (!Array.isArray(selected) || selected.some(path => !text(path) || !isAbsolute(path)))
        return Promise.reject(new Error('SCHEMA_INVALID'));
      const paths = [...new Set(selected.map(path => resolve(path)))];
      return track(async () => {
        for (const path of paths) {
          const info = await lstat(path).catch(() => null);
          if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) deny('CONNECTION_NOT_FOUND');
        }
        rootPaths = paths; source?.invalidate(); runtime.setLocalRoots(paths);
      });
    },
    // No-input discovery is the native Host inventory; v2 returns only neutral world descriptors.
    discover: input => input === undefined ? track(discover) : lifecycleCall('discover', input, q => track(async () => {
      if (!isAbsolute(q.worldRoot) || !rootPaths.includes(resolve(q.worldRoot))) deny('ADAPTER_UNAVAILABLE');
      const rows = await discoverLocalWorlds([resolve(q.worldRoot)]);
      if (new Set(rows.map(sourceRef)).size !== rows.length) deny('ADAPTER_UNAVAILABLE');
      return { worlds: rows.map(row => ({ worldId: row.connectionRef, worldRef: sourceRef(row), displayName: basename(row.worldPath), tags: [] })) };
    })),
    /** Read-only: where one exact world of this source is now. Never provisions, pairs, starts,
     * writes or binds; the locator is interpreted only inside this world source (docs/source-locator.md). */
    describeSourceWorld: input => lifecycleCall('describeSourceWorld', input, q => track(() => describeSource(q.worldRef))),
    async createWorld(input) {
      return lifecycleCall('createWorld', input, async q => {
        const material = materials.find(row => row.templateId === q.templateId);
        if ((q.templateId !== FLAT_WORLD_TEMPLATE_ID && !material) || !text(userPath) || !isAbsolute(userPath)) deny('ADAPTER_UNAVAILABLE');
        // The template owns engine configuration; consumers supply only template and name.
        const made = await createFlatWorldProduct({ requesterRef: 'world-source', userPath,
          ...(creationRoot === undefined ? {} : { root: creationRoot }),
          ...(gameId === undefined ? {} : { gameId }), worldName: q.displayName }, material);
        return { worldRef: made.worldRef, templateId: q.templateId, displayName: made.worldName, creationFacts: made.creationFacts };
      });
    },
    async acquire(input) {
      const request = validateType('LocalWorldAcquireInput', input);
      if (!Object.values(request).every(text) || !ACTIONS.has(request.action) || !isAbsolute(request.userPath))
        return Promise.reject(new Error('SCHEMA_INVALID'));
      return track(async () => {
        const selected = await world(request.connectionRef);
        if (bindings.has(selected.connectionRef) || running.has(selected.worldPath)) deny();
        if (request.action === 'BIND_RUNNING_WORLD' && !selected.worldRef) deny('WORLD_NOT_BOUND');
        const host = resolveControl();
        if (![host?.acquire, host?.inspect, host?.withStoppedWorld].every(f => typeof f === 'function')) deny();
        managed.add(selected.worldPath);
        const operationRef = `${request.action}:${randomUUID()}`;
        let row;
        try {
          const lease = await host.acquire({ requesterRef: request.requesterRef, operationRef,
            worldPath: selected.worldPath, userPath: request.userPath });
          if (!text(lease?.controlRef) || lease.worldPath !== selected.worldPath) deny();
          row = { leaseRef: randomUUID(), requesterRef: request.requesterRef, world: selected,
            action: request.action, host,
            nativeQuery: { controlRef: lease.controlRef, requesterRef: request.requesterRef,
              operationRef, worldPath: selected.worldPath } };
          controls.set(selected.worldPath, row);
          const facts = await inspectRow(row); row.processId = facts.processId;
          if (closed) deny();
          leases.set(row.leaseRef, row);
          return observations(row, facts);
        } catch { if (row) await stopUnused(row); deny(); }
      });
    },
    async inspect(input) {
      const { row } = query(input);
      return track(async () => observations(row, await inspectRow(row)));
    },
    async provision(input) {
      const { row, q } = query(input, ['transportPort']);
      if (row.action !== 'PROVISION_PAYLOAD' || row.paired) return Promise.reject(new Error('CURRENT_WORLD_MISMATCH'));
      if (q.transportPort !== undefined && (!Number.isSafeInteger(q.transportPort) || q.transportPort < 1 || q.transportPort > 65535)) return Promise.reject(new Error('SCHEMA_INVALID'));
      leases.delete(row.leaseRef); // synchronous one-shot reservation before any await
      return track(async () => {
        let phase = 'CURRENT';
        let callbackUsed = false, callbackActive = true;
        try {
          await inspectRow(row);
          const host = provider(row); phase = 'STOP';
          return await host.withStoppedWorld({ ...row.nativeQuery }, async facts => {
            phase = 'STOPPED_FACTS';
            if (!callbackActive || callbackUsed || !factsMatch(row, facts, 'STOPPED')) deny();
            callbackUsed = true; provider(row);
            phase = 'WORLD_IDENTITY';
            if (!sameWorld(row.world, await world(row.world.connectionRef))) deny();
            phase = 'INSTALL';
            const transportPort = q.transportPort ?? await freePort();
            return provisionLocalPayload(row.world.worldPath, { transportPort, transportSettings,
              stoppedWorld: () => {
                provider(row);
                if (!callbackActive || !factsMatch(row, facts, 'STOPPED')) deny();
                return facts;
              } });
          });
        } catch (error) {
          log('warn', `LOCAL_PROVISION_${phase}_REJECTED`);
          if (callbackUsed && ['PAYLOAD_VERSION_MISMATCH', 'WORLD_NOT_FOUND'].includes(error?.message)) throw error;
          deny();
        } finally { callbackActive = false; forget(row); }
      });
    },
    /** What a new flat world would use (roots, installed games, mapgen) and what is missing. */
    async describeFlatWorldCreation(input) {
      const q = fields(input, ['requesterRef', 'userPath']);
      if (!text(q.requesterRef) || !text(q.userPath) || !isAbsolute(q.userPath)) return Promise.reject(new Error('SCHEMA_INVALID'));
      return track(() => describeFlatWorldCreation({ roots: rootPaths, userPath: resolve(q.userPath) }));
    },
    /** Creates a new local single-player world, flat by default, with this Adapter's payload
     * already installed. The result names only that new world; on any failure nothing is
     * selected, created or overwritten. The next step is BIND_RUNNING_WORLD on its connectionRef. */
    async createFlatWorld(input) {
      const { creationFacts, ...result } = await createFlatWorldProduct(input);
      return result;
    },
    /** What deleting one exact world would remove and whether it is allowed now. Changes nothing. */
    async describeWorldDeletion(input) {
      let q; try { q = deletionInput(input); } catch (error) { return Promise.reject(error); }
      return track(async () => {
        const f = await deletionFacts(q);
        try {
          const inventory = await readWorldSelections(resolveCanvas, q.worldRef);
          if (inventory.sessionRefs.length || inventory.retirementReservationRef) f.blockers.push({code:'TRANSACTION_CONFLICT',reason:'LIVE_SESSION_BINDING_OR_RETIREMENT',sessions:inventory.sessionRefs});
        } catch (error) { f.blockers.push({code:error.message,reason:'SELECTION_INVENTORY_UNAVAILABLE'}); }
        return { connectionRef: f.world.connectionRef, worldRef: f.world.worldRef, worldName: basename(f.world.worldPath),
          worldPath: f.world.worldPath, root: dirname(f.world.worldPath), productCreated: !!f.marker,
          createdAt: f.marker?.createdAt ?? null, dataLoss: { scope: 'ENTIRE_WORLD_DIRECTORY', ...f.data },
          nativeStop: f.nativeStop, deletable: f.blockers.length === 0, blockers: f.blockers,
          callerMustVerify: ['NO_LIVE_SESSION_BINDING'] };
      });
    },
    /** Deletes one exact Adapter-created world that is not bound, leased or mid-transaction here,
     * then reads back that discovery no longer lists it and its directory is gone. */
    async deleteWorld(input) {
      return lifecycleCall('deleteWorld', input, request => track(async () => {
        const selected = await selectWorld(request.worldRef);
        if (basename(selected.worldPath) !== request.confirmationName) deny('TRANSACTION_CONFLICT');
        const q = { connectionRef: selected.connectionRef, worldRef: selected.worldRef };
        let removalState = 'NONE';
        try { return await withWorldRetirement(resolveCanvas, request.worldRef, async () => {
          const f = await deletionFacts(q);
          if (f.blockers.length) { log('warn', `LOCAL_DELETE_REJECTED ${f.blockers.map(b => b.reason).join(',')}`); deny(f.blockers[0].code, { blockers: f.blockers }); }
          const remove = async () => {
            const again = await world(q.connectionRef);
            if (again.worldRef !== f.world.worldRef || again.device !== f.world.device || again.inode !== f.world.inode) deny();
            removalState = 'UNKNOWN';
            try { await removeWorldDirectory(f.world); }
            catch (error) { removalState = error.mutationState ?? (error.message === 'DELETE_INCOMPLETE' ? 'PARTIAL' : removalState); throw error; }
          };
          if (f.control) {
            const control = f.control, host = provider(control);
            let active = true, used = false;
            try {
              await host.withStoppedWorld({ ...control.nativeQuery }, async facts => {
                if (!active || used || !factsMatch(control, facts, 'STOPPED')) deny();
                used = true; provider(control);
                await remove();
              });
              if (!used) deny();
            } catch (error) {
              log('warn', `LOCAL_DELETE_STOP_REJECTED ${error?.message}`);
              throw error;
            } finally { active = false; }
          } else await remove();
          const listed = (await discover()).some(row => row.connectionRef === f.world.connectionRef || row.worldPath === f.world.worldPath);
          const exists = !!await lstat(f.world.worldPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (listed || exists) deny('READBACK_MISMATCH', { listed, pathExists: exists });
          managed.delete(f.world.worldPath); controls.delete(f.world.worldPath);
          log('info', `LOCAL_WORLD_DELETED ${f.world.connectionRef}`);
          return { deleted: true, worldRef: request.worldRef, confirmationName: request.confirmationName };
        }); } catch (error) {
          const mutationState = error.mutationState && error.mutationState !== 'NONE' ? error.mutationState : removalState;
          try {
            Object.defineProperty(error, 'mutationState', { value: mutationState, configurable: true });
          } catch {
            // Preserve the exact cause when an SDK error forbids annotation.
            throw Object.assign(new Error(error.code ?? error.message, { cause: error }), {
              mutationState, ...(error.details ? { details: error.details } : {}),
              ...(error.source ? { source: error.source } : {}), ...(error.sourceCurrency ? { sourceCurrency: true } : {}),
            });
          }
          throw error;
        }
      }));
    },
    /** Stop one exact current world through its original Host callback and retire the binding.
     * The Adapter service remains open; no stopped evidence is accepted from caller JSON. */
    async stopWorld(input) {
      let q; try { q = deletionInput(input); } catch (error) { return Promise.reject(error); }
      return track(async () => {
        const selected = await world(q.connectionRef);
        if (selected.worldRef !== q.worldRef) deny('CURRENT_WORLD_MISMATCH');
        const row = bindings.get(q.connectionRef);
        if (!row) deny('WORLD_NOT_BOUND');
        if (row.requesterRef !== q.requesterRef || !sameWorld(row.world, selected)) deny();
        await retireBinding(row);
        return { stopped: true, connectionRef: q.connectionRef, worldRef: q.worldRef };
      });
    },
    async pair(input) {
      if (input && Object.hasOwn(input, 'contractVersion')) return lifecycleCall('pair', input, async q => {
        // Start/stop remains with the native lifecycle owner. Consume its exact
        // running-world lease, or read an already paired connection; never pick
        // a different world or implicitly stop another session's connection.
        const selected = await track(async () => {
          const selectedWorld = await world((await selectWorld(q.worldRef)).connectionRef);
          if (bindings.has(selectedWorld.connectionRef)) return { world: selectedWorld };
          const candidates = [...leases.values()].filter(row => row.action === 'BIND_RUNNING_WORLD' &&
            !row.paired && sameWorld(row.world, selectedWorld));
          if (candidates.length !== 1) deny('CONNECTION_NOT_FOUND');
          return { world: selectedWorld, lease: candidates[0] };
        });
        if (selected.lease) await port.pair({ leaseRef: selected.lease.leaseRef,
          requesterRef: selected.lease.requesterRef, connectionRef: selected.world.connectionRef });
        const request = { contractVersion: 'world-adapter/v8', requestId: `${q.requestId}:readback`,
          sessionRef: 'world-source:local-pair', connectionRef: bindings.get(selected.world.connectionRef)?.publicConnectionRef ?? selected.world.connectionRef };
        const response = validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', request,
          await runtime.port.call('ReadLocalConnection', request));
        if (response.error) deny(response.error.code);
        if (response.result.worldRef !== q.worldRef || response.result.capabilities.worldRef !== q.worldRef)
          deny('CONNECTION_NOT_FOUND');
        return response.result;
      });
      const { row } = query(input);
      if (row.action !== 'BIND_RUNNING_WORLD' || row.paired) return Promise.reject(new Error('CURRENT_WORLD_MISMATCH'));
      return track(async () => {
        let runtimePaired = false;
        try {
          await inspectRow(row);
          if (row.paired) deny();
          await checkSourceScope(); row.paired = true;
          // Native connections are independent. Canvas owns which Session selects each world.
          // Pairing B must never retire A: another Session may still select A.
          if (bindings.has(row.world.connectionRef)) deny();
          if (running.has(row.world.worldPath)) deny();
          running.set(row.world.worldPath, row);
          const loaded = await sourceRead(async () => {
            const result = await runtime.pairLocal(row.runtimeWorld ?? row.world);
            runtimePaired = true; // committed even when sourceRead's post-check fails
            return result;
          });
          bindings.set(row.world.connectionRef, row);
          const facts = await inspectRow(row);
          return { ...observations(row, facts), ...loaded, paired: true };
        } catch (error) {
          // A late inspection failure owns only this new row, never another world's runtime.
          try {
            if (runtimePaired) { bindings.delete(row.world.connectionRef); await runtime.retireLocal(row.publicConnectionRef ?? row.world.connectionRef); }
          } catch (cleanup) {
            throw Object.assign(new Error('CONNECTION_NOT_FOUND', { cause: error }), { mutationState: 'UNKNOWN', cleanup });
          } finally {
            // A scoped pair never borrows stale source authority to stop the
            // original runtime's native process. Its lifecycle owner cleans it.
            if (sourceCallActive()) forget(row); else await stopUnused(row);
          }
          throw new Error('CURRENT_WORLD_MISMATCH', { cause: error });
        }
      });
    },

  };
  async function scopedPair(q, check) {
    try {
      // The public status read deliberately runs outside the lifecycle queue.
      // Its provider may itself reobserve this source without a pair/read cycle.
      const selected = await track(async () => world((await selectWorld(q.payload.worldRef)).connectionRef));
      const startup = await sourceRead(() => readSourceStartupFacts(selected, { device: String(selected.device), inode: String(selected.inode) }));
      if (startup.availability !== 'KNOWN') deny('PAYLOAD_VERSION_MISMATCH');
      const engine = resolveEngineRuntime?.();
      const key = ctx?.[Symbol.for('cordis.isolate')]?.hanaworldsEngineRuntime;
      const registered = key && ctx.reflect?.store?.[key];
      const checkRuntime = () => {
        if (!engine || !registered || registered.fiber?.state !== 2 || registered.fiber.ctx?.root !== ctx.root ||
          ctx.reflect.store[key] !== registered || original(registered.value) !== original(engine) ||
          original(resolveEngineRuntime()) !== original(engine)) deny('CURRENT_WORLD_MISMATCH');
      };
      if (typeof engine?.ReadRuntimeStatus !== 'function') deny('CONNECTION_NOT_FOUND');
      addSourceCheck(checkRuntime);
      const checkPair = async () => {
        await check(); checkRuntime();
        const request = { contractVersion: 'engine-runtime/v2', requestId: `${q.requestId}:runtime-read:${randomUUID()}`, connectionRef: q.payload.connectionRef };
        const response = await engine.ReadRuntimeStatus(request);
        await check(); checkRuntime();
        try {
          closedObject(response, ['contractVersion', 'requestId', 'result', 'error']);
          if (response.contractVersion !== request.contractVersion || response.requestId !== request.requestId || response.error !== null) deny('CONNECTION_NOT_FOUND');
          closedObject(response.result, ['worldRef', 'connectionRef', 'connectionIncarnationRef', 'state']);
          if (response.result.worldRef !== q.payload.worldRef || response.result.connectionRef !== q.payload.connectionRef ||
            response.result.connectionIncarnationRef !== q.payload.connectionIncarnationRef || response.result.state !== 'RUNNING') deny('CONNECTION_NOT_FOUND');
        } catch (error) { throw new Error('CONNECTION_NOT_FOUND', { cause: error }); }
      };
      await checkPair(); await checkSourceScope();
      const confirmed = await sourceRead(() => readSourceStartupFacts(selected, { device: String(selected.device), inode: String(selected.inode) }));
      if (JSON.stringify(confirmed) !== JSON.stringify(startup)) deny('PAYLOAD_VERSION_MISMATCH');
      await track(async () => {
        await check(); checkRuntime(); await checkSourceScope();
        let row = bindings.get(selected.connectionRef);
        if (row) {
          if (row.publicConnectionRef !== q.payload.connectionRef || row.runtimeWorld.runtimeIncarnationRef !== q.payload.connectionIncarnationRef) deny('CONNECTION_NOT_FOUND');
        } else {
          const candidates = [...leases.values()].filter(row => row.action === 'BIND_RUNNING_WORLD' && !row.paired && sameWorld(row.world, selected));
          if (candidates.length !== 1) deny('CONNECTION_NOT_FOUND');
          row = candidates[0];
          row.publicConnectionRef = q.payload.connectionRef;
          row.runtimeWorld = { ...selected, connectionRef: q.payload.connectionRef, runtimeIncarnationRef: q.payload.connectionIncarnationRef };
          row.sourceCheck = async () => { await check(); checkRuntime(); };
          row.runtimeStatusCheck = checkPair;
        }
      });
      const lease = [...leases.values()].find(row => row.publicConnectionRef === q.payload.connectionRef);
      if (!bindings.has(selected.connectionRef)) await port.pair({ leaseRef: lease.leaseRef, requesterRef: lease.requesterRef, connectionRef: selected.connectionRef });
      const request = { contractVersion: 'world-adapter/v8', requestId: `${q.requestId}:readback`, sessionRef: 'world-source:local-pair', connectionRef: q.payload.connectionRef };
      const response = validateBoundResponse('world-adapter/v8', 'ReadLocalConnection', request, await runtime.port.call('ReadLocalConnection', request));
      if (response.error) deny(response.error.code);
      await checkPair();
      return { contractVersion: 'local-worlds/v2', requestId: q.requestId, result: response.result, error: null };
    } catch (failure) {
      if ((failure.code ?? failure.message) === 'UNKNOWN_REQUIRED_FIELD' ||
        (failure.code ?? failure.message) === 'CURRENT_WORLD_MISMATCH' && (!failure.cause || failure.sourceCurrency || failure.cause?.sourceCurrency)) throw failure;
      const origin = failure.cause ?? failure;
      const code = (origin.code ?? origin.message) === 'PAYLOAD_VERSION_MISMATCH' ? 'PAYLOAD_VERSION_MISMATCH' : 'CONNECTION_NOT_FOUND';
      return { contractVersion: 'local-worlds/v2', requestId: q.requestId, result: null,
        error: sourceError(code, failure.mutationState ?? sourceMutationState(), code === 'PAYLOAD_VERSION_MISMATCH' ? 'VERSION_UNSUPPORTED' : 'REQUIRED_FACT_UNKNOWN') };
    }
  }
  source = attachLocalSource(port, { ctx, roots: () => [...rootPaths], userPath, creationRoot, materials, closed: () => closed, pair: scopedPair });
  return { port,
    async inspectConnection(connectionRef) {
      const row = [...running.values()].find(x => (x.publicConnectionRef ?? x.world.connectionRef) === connectionRef);
      if (!row || !row.paired) deny('WORLD_NOT_BOUND');
      if (row.runtimeStatusCheck) await row.runtimeStatusCheck();
      const result = await inspectRow(row, { readOnly: true });
      if (row.runtimeStatusCheck) await row.runtimeStatusCheck();
      return result;
    },
    manages: path => typeof path === 'string' && managed.has(resolve(path)),
    async close() {
      closed = true; await Promise.allSettled([...pending]);
      await Promise.all([...leases.values()].map(stopUnused));
      leases.clear(); running.clear(); bindings.clear();
    },
  };
}
