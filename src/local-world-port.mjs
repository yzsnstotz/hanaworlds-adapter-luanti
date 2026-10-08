import { validateType } from '#contracts';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createServer } from 'node:net';
import { discoverLocalWorlds, provisionLocalPayload } from './local-worlds.mjs';
import { createFlatWorld, describeFlatWorldCreation } from './flat-world.mjs';
import { readCreatedMarker, removeWorldDirectory, worldData } from './local-world-deletion.mjs';

const ACTIONS = new Set(['PROVISION_PAYLOAD', 'BIND_RUNNING_WORLD']);
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
export function createLocalWorldPort({ roots = [], resolveControl, runtime, log = () => {} }) {
  let rootPaths = roots.map(root => resolve(root)), closed = false;
  const leases = new Map(), running = new Map(), bindings = new Map(), managed = new Set(), pending = new Set();
  // Latest Host control record per world path this service acquired; kept after the lease ends so a
  // later deletion runs inside that Host's own stopped-world callback for the exact owned process.
  const controls = new Map();
  let lifecycle = Promise.resolve();
  function track(run) {
    const work = lifecycle.then(() => { if (closed) deny('ADAPTER_UNAVAILABLE'); return run(); });
    lifecycle = work.catch(() => {});
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
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
    return { ...row, device: info.dev, inode: info.ino };
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
  async function inspectRow(row) {
    let phase = 'PROVIDER';
    try {
      const host = provider(row);
      if (row.retired) deny();
      phase = 'WORLD_IDENTITY';
      if (!sameWorld(row.world, await world(row.world.connectionRef))) deny();
      phase = 'NATIVE_INSPECT';
      const facts = await host.inspect({ ...row.nativeQuery });
      phase = 'NATIVE_FACTS';
      provider(row);
      if (!factsMatch(row, facts, 'CURRENT') || !sameWorld(row.world, await world(row.world.connectionRef))) deny();
      return facts;
    } catch { log('warn', `LOCAL_LEASE_${phase}_REJECTED`); forget(row); deny(); } // no provider error text or credentials escape
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
        await runtime.retireLocal(row.world.connectionRef);
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
      const activity = await runtime.localWorldActivity({ connectionRef: selected.connectionRef, worldRef: selected.worldRef });
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
        rootPaths = paths; runtime.setLocalRoots(paths);
      });
    },
    discover: () => track(discover),
    async acquire(input) {
      const request = validateType('LocalWorldAcquireInput', input);
      if (!Object.values(request).every(text) || !ACTIONS.has(request.action) || !isAbsolute(request.userPath))
        return Promise.reject(new Error('SCHEMA_INVALID'));
      return track(async () => {
        const selected = await world(request.connectionRef);
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
            return provisionLocalPayload(row.world.worldPath, { transportPort,
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
      const q = fields(input, ['requesterRef', 'userPath', 'root', 'gameId', 'worldName'], ['requesterRef', 'userPath']);
      if (!text(q.requesterRef) || !text(q.userPath) || !isAbsolute(q.userPath) ||
          ['root', 'gameId', 'worldName'].some(k => k in q && !text(q[k])) || ('root' in q && !isAbsolute(q.root)))
        return Promise.reject(new Error('SCHEMA_INVALID'));
      return track(async () => {
        const made = await createFlatWorld({ roots: rootPaths, root: q.root, userPath: resolve(q.userPath),
          gameId: q.gameId, worldName: q.worldName, transportPort: await freePort() });
        const rows = (await discover()).filter(row => row.worldPath === made.worldPath);
        if (rows.length !== 1 || rows[0].worldRef !== made.identity.worldRef) { log('warn', 'LOCAL_CREATE_DISCOVERY_MISMATCH'); deny('WORLD_NOT_FOUND'); }
        log('info', `LOCAL_FLAT_WORLD_CREATED ${rows[0].connectionRef}`);
        return { created: true, connectionRef: rows[0].connectionRef, worldPath: made.worldPath, worldName: made.worldName,
          worldRef: made.identity.worldRef, payloadVersion: made.identity.payloadVersion, payloadDigest: made.identity.payloadDigest,
          game: made.game, mapgen: made.mapgen, perCellMod: made.perCellMod, nextAction: 'BIND_RUNNING_WORLD' };
      });
    },
    /** What deleting one exact world would remove and whether it is allowed now. Changes nothing. */
    async describeWorldDeletion(input) {
      let q; try { q = deletionInput(input); } catch (error) { return Promise.reject(error); }
      return track(async () => {
        const f = await deletionFacts(q);
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
      let q; try { q = deletionInput(input); } catch (error) { return Promise.reject(error); }
      return track(async () => {
        const f = await deletionFacts(q);
        if (f.blockers.length) { log('warn', `LOCAL_DELETE_REJECTED ${f.blockers.map(b => b.reason).join(',')}`); deny(f.blockers[0].code, { blockers: f.blockers }); }
        const remove = async () => {
          const again = await world(q.connectionRef);
          if (again.worldRef !== f.world.worldRef || again.device !== f.world.device || again.inode !== f.world.inode) deny();
          await removeWorldDirectory(f.world);
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
            if (error?.message === 'DELETE_INCOMPLETE') throw error;
            deny();
          } finally { active = false; }
        } else await remove();
        const listed = (await discover()).some(row => row.connectionRef === f.world.connectionRef || row.worldPath === f.world.worldPath);
        const exists = !!await lstat(f.world.worldPath).catch(() => null);
        if (listed || exists) deny('READBACK_MISMATCH', { listed, pathExists: exists });
        managed.delete(f.world.worldPath); controls.delete(f.world.worldPath);
        log('info', `LOCAL_WORLD_DELETED ${f.world.connectionRef}`);
        return { deleted: true, connectionRef: f.world.connectionRef, worldRef: f.world.worldRef,
          worldName: basename(f.world.worldPath), worldPath: f.world.worldPath, removed: f.data,
          nativeStop: f.nativeStop, readback: { listed: false, pathExists: false } };
      });
    },
    async pair(input) {
      const { row } = query(input);
      if (row.action !== 'BIND_RUNNING_WORLD' || row.paired) return Promise.reject(new Error('CURRENT_WORLD_MISMATCH'));
      row.paired = true;
      return track(async () => {
        try {
          await inspectRow(row);
          for (const previous of bindings.values()) {
            if (previous.world.connectionRef === row.world.connectionRef) deny();
            await retireBinding(previous);
          }
          await inspectRow(row); // stopping A must not invalidate the acquired B
          if (running.has(row.world.worldPath)) deny();
          running.set(row.world.worldPath, row);
          const loaded = await runtime.pairLocal(row.world);
          bindings.set(row.world.connectionRef, row);
          const facts = await inspectRow(row);
          return { ...observations(row, facts), ...loaded, paired: true };
        } catch { await stopUnused(row); deny(); }
      });
    },

  };
  return { port,
    async inspectConnection(connectionRef) {
      const row = [...running.values()].find(x => x.world.connectionRef === connectionRef);
      if (!row || !row.paired) deny('WORLD_NOT_BOUND');
      return inspectRow(row);
    },
    manages: path => typeof path === 'string' && managed.has(resolve(path)),
    async close() {
      closed = true; await Promise.allSettled([...pending]);
      await Promise.all([...leases.values()].map(stopUnused));
      leases.clear(); running.clear(); bindings.clear();
    },
  };
}
