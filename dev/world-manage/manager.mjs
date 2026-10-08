import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

const deny = (code, blockers) => { const e = Error(code); e.details = { blockers }; throw e; };
// Independent development consumer of this plugin's public lifecycle ports.
// Session bindings are labelled contract-shaped fixtures, never Canvas/Host truth.
export function createWorldManager({ local, requesterRef, userPath, foreignActivity, game, validateContext }) {
  let current = null, chain = Promise.resolve();
  const bindings = new Map(), confirmations = new Map();
  const serial = fn => { const result = chain.then(fn); chain = result.catch(() => {}); return result; };
  const input = row => ({ requesterRef, connectionRef: row.connectionRef, worldRef: row.worldRef });
  async function world(ref) {
    const rows = (await local.discover()).filter(row => row.connectionRef === ref);
    if (rows.length !== 1) deny('CONNECTION_NOT_FOUND');
    return { ...rows[0], worldName: rows[0].worldName ?? basename(rows[0].worldPath) };
  }
  async function facts(row) {
    const preview = await local.describeWorldDeletion(input(row));
    const blockers = [...preview.blockers];
    const sessions = [...bindings].filter(([, c]) => c.worldRef === row.worldRef).map(([ref]) => ref);
    if (sessions.length) blockers.push({ code: 'WORLD_IN_USE', reason: 'LIVE_SESSION_BINDING', sessions });
    const processes = await foreignActivity(row.worldPath);
    if (processes.length) blockers.push({ code: 'WORLD_IN_USE', reason: 'EXTERNAL_NATIVE_PROCESS', processes });
    return { ...preview, worldName: row.worldName, category: preview.productCreated ? '本插件自建平地世界' : '未知归属世界',
      sessions, blockers, deletable: preview.deletable && blockers.length === 0 };
  }
  async function connect(ref) {
    const row = await world(ref);
    if (current?.connectionRef === ref) { await local.inspect(current.lease); return current; }
    if (game.running()) deny('WORLD_IN_USE', [{ code: 'WORLD_IN_USE', reason: 'GAME_CLIENT_RUNNING' }]);
    const processes = await foreignActivity(row.worldPath);
    if (processes.length) deny('WORLD_IN_USE', [{ code: 'WORLD_IN_USE', reason: 'EXTERNAL_NATIVE_PROCESS', processes }]);
    const lease = await local.acquire({ requesterRef, userPath, connectionRef: ref, action: 'BIND_RUNNING_WORLD' });
    const query = { requesterRef, connectionRef: ref, leaseRef: lease.leaseRef };
    try {
      const paired = await local.pair(query);
      const context = validateContext({ connectionRef: paired.connectionRef, worldRef: paired.worldRef,
        connectionIncarnationRef: paired.connectionIncarnationRef, selectionRevision: `fixture-selection:${randomUUID()}` });
      current = { ...row, ...paired, nativeProcessId: lease.nativeProcessId, lease: query, context };
      bindings.set('fixture-current-session', context);
      return current;
    } catch (error) {
      // Pair may already have retired the former world. Never display stale current truth.
      if (current) {
        try { await local.inspect(current.lease); }
        catch { current = null; bindings.delete('fixture-current-session'); }
      }
      throw error;
    }
  }
  return {
    state: () => serial(async () => {
      let currentError = null;
      if (current) {
        try { await local.inspect(current.lease); }
        catch (e) { currentError = e.message; current = null; bindings.delete('fixture-current-session'); }
      }
      return { current, currentError, gameRunning: game.running(),
        worlds: (await local.discover()).map(row => ({ ...row, worldName: row.worldName ?? basename(row.worldPath),
          current: current?.connectionRef === row.connectionRef,
          fixtureHeld: bindings.has(`fixture-hold:${row.connectionRef}`) })),
        prerequisites: await local.describeFlatWorldCreation({ requesterRef, userPath }),
        fixtureBindings: [...bindings].map(([sessionRef, context]) => ({ sessionRef, context })) };
    }),
    connect: ref => serial(() => connect(ref)),
    create: () => serial(async () => {
      if (game.running()) deny('WORLD_IN_USE', [{ code: 'WORLD_IN_USE', reason: 'GAME_CLIENT_RUNNING' }]);
      const row = await local.createFlatWorld({ requesterRef, userPath });
      await connect(row.connectionRef);
      return row;
    }),
    stop: () => serial(async () => {
      if (!current) deny('WORLD_NOT_BOUND');
      if (game.running()) deny('WORLD_IN_USE', [{ code: 'WORLD_IN_USE', reason: 'GAME_CLIENT_RUNNING' }]);
      const result = await local.stopWorld(input(current));
      current = null; bindings.delete('fixture-current-session'); return result;
    }),
    enter: () => serial(async () => {
      if (!current) deny('WORLD_NOT_BOUND');
      await local.inspect(current.lease); return game.enter(current);
    }),
    preview: ref => serial(async () => {
      const row = await world(ref), preview = await facts(row), confirmationRef = randomUUID();
      confirmations.set(confirmationRef, { row, preview });
      return { ...preview, confirmationRef };
    }),
    cancel: token => serial(async () => {
      if (!confirmations.delete(token)) deny('CONFIRMATION_NOT_FOUND');
      return { cancelled: true };
    }),
    confirm: token => serial(async () => {
      const confirmation = confirmations.get(token);
      if (!confirmation) deny('CONFIRMATION_NOT_FOUND');
      confirmations.delete(token); // one-shot; final facts are independently re-read.
      const row = await world(confirmation.row.connectionRef);
      if (row.worldRef !== confirmation.row.worldRef || row.worldPath !== confirmation.row.worldPath) deny('CURRENT_WORLD_MISMATCH');
      const now = await facts(row);
      if (!now.deletable) deny(now.blockers[0]?.code ?? 'REQUIRED_FACT_UNKNOWN', now.blockers);
      if (now.dataLoss.files !== confirmation.preview.dataLoss.files || now.dataLoss.bytes !== confirmation.preview.dataLoss.bytes)
        deny('CONFIRMATION_CHANGED');
      const result = await local.deleteWorld(input(row));
      if (!result.deleted || result.readback.listed || result.readback.pathExists ||
          (await local.discover()).some(r => r.connectionRef === row.connectionRef)) deny('READBACK_MISMATCH');
      return result;
    }),
    setFixtureBinding: (ref, enabled) => serial(async () => {
      const row = await world(ref), key = `fixture-hold:${ref}`;
      if (enabled) bindings.set(key, validateContext({ connectionRef: row.connectionRef, worldRef: row.worldRef,
        connectionIncarnationRef: `fixture-incarnation:${randomUUID()}`, selectionRevision: `fixture-selection:${randomUUID()}` }));
      else bindings.delete(key);
      return { fixtureHeld: !!enabled };
    }),
  };
}
