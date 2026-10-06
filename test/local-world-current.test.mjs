import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';

test('public local acquire and inspect correlate process/world without account fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hw-local-040-'));
  const world = join(root, 'world'); await mkdir(world);
  await writeFile(join(world, 'world.mt'), 'gameid = local_fixture\n');
  let input;
  const host = { // Explicit NativeControl public peer fixture, not a real process.
    async acquire(value) { input = value; return { controlRef: 'process-control', worldPath: world }; },
    async inspect(q) { return { state: 'CURRENT', worldPath: world, processId: 1234, operationRef: q.operationRef }; },
    async withStoppedWorld(q, cb) { return cb({ state: 'STOPPED', worldPath: world, processId: 1234, operationRef: q.operationRef }); },
  };
  const local = createLocalWorldPort({ roots: [root], resolveControl: () => host, runtime: {} });
  try {
    const [found] = await local.port.discover();
    const opened = await local.port.acquire({ connectionRef: found.connectionRef,
      requesterRef: 'desktop', userPath: root, action: 'PROVISION_PAYLOAD' });
    assert.equal(opened.nativeProcessId, 1234);
    assert.equal('username' in input || 'password' in input, false);
    assert.equal('engineActorName' in opened, false);
    assert.deepEqual(await local.port.inspect({ leaseRef: opened.leaseRef,
      requesterRef: 'desktop', connectionRef: found.connectionRef }), opened);
  } finally { await local.close(); await rm(root, { recursive: true }); }
});
