import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createServer } from 'node:net';
import { discoverLocalWorlds, provisionLocalPayload } from './local-worlds.mjs';

const ACTIONS = new Set(['PROVISION_PAYLOAD', 'BIND_RUNNING_WORLD']);
function deny(code = 'CONNECTION_UNAUTHORIZED') { throw new Error(code); }
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

/** Trusted in-process Host port. Never accepts operator JSON. Native SRP and
 * child lifecycle stay in the public Host; stopped facts exist only in its callback. */
export function createLocalWorldPort({ roots = [], resolveControl, runtime, log = () => {} }) {
  let rootPaths = roots.map(root => resolve(root)), closed = false;
  const leases = new Map(), running = new Map(), managed = new Set(), pending = new Set();
  function track(run) {
    const work = Promise.resolve().then(() => { if (closed) deny('ADAPTER_UNAVAILABLE'); return run(); });
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
      facts.operationRef === row.nativeQuery.operationRef && facts.username === row.username &&
      Number.isSafeInteger(facts.processId) && facts.processId > 0 &&
      (row.processId === undefined || facts.processId === row.processId);
  }
  function provider(row) {
    if (closed || resolveControl() !== row.host) deny();
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
      engineActorName: facts.username, nativeProcessId: facts.processId };
  }
  async function stopUnused(row) {
    try {
      if (resolveControl() === row.host)
        await row.host.withStoppedWorld({ ...row.nativeQuery }, async () => undefined);
    } catch { /* Host owns cleanup of rejected or dead native sessions */ }
    forget(row);
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
      const request = fields(input, ['connectionRef', 'requesterRef', 'userPath', 'username', 'password', 'action']);
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
            worldPath: selected.worldPath, userPath: request.userPath,
            username: request.username, password: request.password });
          if (!text(lease?.controlRef) || lease.worldPath !== selected.worldPath) deny();
          row = { leaseRef: randomUUID(), requesterRef: request.requesterRef, world: selected,
            action: request.action, username: request.username, host,
            nativeQuery: { controlRef: lease.controlRef, requesterRef: request.requesterRef,
              operationRef, worldPath: selected.worldPath } };
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
      if (row.action !== 'PROVISION_PAYLOAD' || row.paired) return Promise.reject(new Error('CONNECTION_UNAUTHORIZED'));
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
            let verified = false;
            // Private one-shot bridge into existing installer. Never returned or persisted.
            const operatorAuthority = { verify: async request => {
              provider(row);
              if (!callbackActive || verified || request.worldPath !== row.world.worldPath || request.action !== row.action) deny();
              verified = true;
              return { current: true, worldStopped: true, worldPath: row.world.worldPath, action: row.action };
            } };
            return provisionLocalPayload(row.world.worldPath, { operatorAuthority, transportPort });
          });
        } catch (error) {
          log('warn', `LOCAL_PROVISION_${phase}_REJECTED`);
          if (callbackUsed && ['PAYLOAD_VERSION_MISMATCH', 'WORLD_NOT_FOUND'].includes(error?.message)) throw error;
          deny();
        } finally { callbackActive = false; forget(row); }
      });
    },
    async pair(input) {
      const { row } = query(input);
      if (row.action !== 'BIND_RUNNING_WORLD' || row.paired) return Promise.reject(new Error('CONNECTION_UNAUTHORIZED'));
      row.paired = true;
      return track(async () => {
        try {
          await inspectRow(row);
          if (running.has(row.world.worldPath)) deny();
          running.set(row.world.worldPath, row);
          const loaded = await runtime.pairLocal(row.world);
          const facts = await inspectRow(row);
          return { ...observations(row, facts), ...loaded, paired: true };
        } catch { await stopUnused(row); deny(); }
      });
    },
    async readCurrentGrants(input) {
      const { row } = query(input);
      return track(async () => {
        if (!row.paired || running.get(row.world.worldPath) !== row) {
          log('warn', 'LOCAL_GAME_PAIRED_LEASE_REJECTED'); deny();
        }
        await inspectRow(row);
        let received;
        try { received = await runtime.grantEvidence.listCurrentLocalGrants(); }
        catch { log('warn', 'LOCAL_GAME_GRANTS_READ_REJECTED'); deny(); }
        const grants = received
          .filter(proof => proof.connectionRef === row.world.connectionRef && proof.worldRef === row.world.worldRef);
        await inspectRow(row);
        return { worldRef: row.world.worldRef, connectionRef: row.world.connectionRef, grants };
      });
    },
  };
  return { port, manages: path => typeof path === 'string' && managed.has(resolve(path)),
    async verifyOperator(input) {
      const row = running.get(input.worldPath);
      if (!row || input.action !== 'BIND_RUNNING_WORLD' || input.worldRef !== row.world.worldRef) return { current: false };
      try { await inspectRow(row); return { current: true, worldPath: row.world.worldPath,
        worldRef: row.world.worldRef, action: row.action }; } catch { return { current: false }; }
    },
    async close() {
      closed = true; await Promise.allSettled([...pending]);
      await Promise.all([...leases.values()].map(stopUnused));
      leases.clear(); running.clear();
    },
  };
}
