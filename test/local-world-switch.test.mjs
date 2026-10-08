// FIXTURE: Host-owned lifecycle records and transport, not real engine evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';

test('same service retires A only inside exact Host stopped callback, then pairs B', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hw-switch-')));
  await mkdir(join(root, 'worlds'));
  await mkdir(join(root, 'games/fixture'), { recursive: true });
  await writeFile(join(root, 'games/fixture/game.conf'), 'title = Fixture\n');
  await mkdir(join(root, 'mods/worldedit'), { recursive: true });
  await writeFile(join(root, 'mods/worldedit/mod.conf'), 'name = worldedit\n');
  const records = new Map(), calls = []; let mode = 'exact', bound;
  const host = {
    async acquire(q) {
      const controlRef = `host:${records.size}`;
      records.set(controlRef, { ...q, pid: 1234 + records.size, stopped: false });
      return { controlRef, worldPath: q.worldPath };
    },
    async inspect(q) {
      const r = records.get(q.controlRef);
      if (!r || r.stopped) throw Error('NOT_CURRENT');
      return { state: 'CURRENT', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
    },
    async withStoppedWorld(q, callback) {
      const r = records.get(q.controlRef);
      if (mode === 'unknown') throw Error('UNKNOWN');
      r.stopped = true;
      const facts = { state: 'STOPPED', worldPath: r.worldPath, processId: r.pid, operationRef: r.operationRef };
      if (mode === 'wrong-pid') facts.processId++;
      calls.push(q.worldPath);
      return callback(facts);
    },
  };
  const runtime = {
    async pairLocal(w) { if (bound) throw Error('CURRENT_WORLD_MISMATCH'); bound = w; return { connectionIncarnationRef: w.worldRef }; },
    async retireLocal(ref) { assert.equal(ref, bound.connectionRef); bound = undefined; },
  };
  const local = createLocalWorldPort({ roots: [join(root, 'worlds')], resolveControl: () => host, runtime });
  const query = lease => ({ leaseRef: lease.leaseRef, requesterRef: 'host', connectionRef: lease.connectionRef });
  const acquire = made => local.port.acquire({ requesterRef: 'host', userPath: root, connectionRef: made.connectionRef, action: 'BIND_RUNNING_WORLD' });
  try {
    const a = await local.port.createFlatWorld({ requesterRef: 'host', userPath: root, worldName: 'A' });
    const b = await local.port.createFlatWorld({ requesterRef: 'host', userPath: root, worldName: 'B' });
    const la = await acquire(a); await local.port.pair(query(la));
    records.values().next().value.stopped = true; // actual Host-owned stop precedes B acquisition
    await assert.rejects(local.port.inspect(query(la)), /CURRENT_WORLD_MISMATCH/);
    mode = 'unknown'; const unknown = await acquire(b);
    await assert.rejects(local.port.pair(query(unknown)), /CURRENT_WORLD_MISMATCH/);
    assert.equal(bound.connectionRef, a.connectionRef);
    mode = 'wrong-pid'; const wrong = await acquire(b);
    await assert.rejects(local.port.pair(query(wrong)), /CURRENT_WORLD_MISMATCH/);
    assert.equal(bound.connectionRef, a.connectionRef);
    mode = 'exact'; const lb = await acquire(b);
    const result = await local.port.pair(query(lb));
    assert.equal(result.paired, true); assert.equal(bound.connectionRef, b.connectionRef);
    assert.ok(calls.includes(a.worldPath));
    await assert.rejects(local.port.inspect(query(la)), /CURRENT_WORLD_MISMATCH/);
    await assert.rejects(local.inspectConnection(a.connectionRef), /WORLD_NOT_BOUND/);
    assert.equal((await local.port.inspect(query(lb))).current, true);
    assert.equal(typeof local.port.stopWorld, 'function', 'public stopped-world retirement is missing');
    await assert.rejects(local.port.stopWorld({requesterRef:'other', connectionRef:b.connectionRef, worldRef:b.worldRef}), /CURRENT_WORLD_MISMATCH/);
    const stopped = await local.port.stopWorld({requesterRef:'host', connectionRef:b.connectionRef, worldRef:b.worldRef});
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.worldRef, b.worldRef);
    assert.equal(bound, undefined);
    await assert.rejects(local.inspectConnection(b.connectionRef), /WORLD_NOT_BOUND/);
    const la2 = await acquire(a); await local.port.pair(query(la2));
    assert.equal(bound.connectionRef, a.connectionRef, 'stopping does not close the reusable Adapter service');

  } finally { await local.close(); await rm(root, { recursive: true, force: true }); }
});
