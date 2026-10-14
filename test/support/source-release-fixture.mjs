// Test harness only: actual Adapter and official Cordis, with contract-shaped peers.
// It cannot supply the missing release capability or authorize a release candidate.
import assert from 'node:assert/strict';
import { Context, symbols } from '@deepseek-ai/cordis';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const adapter = await import(process.env.SOURCE_RELEASE_ADAPTER_URL || new URL('../../src/index.mjs', import.meta.url).href);
const RUN = process.env.SOURCE_RELEASE_RUN || fileURLToPath(new URL('../../../', import.meta.url));
export const WIRE = 'local-worlds/v2';
export const plain = value => JSON.parse(JSON.stringify(value));
export const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
let serial = 0;
export const ask = extra => ({ contractVersion: WIRE, requestId: `release-materials:${++serial}`, ...extra });
export function envelope(q, value) {
  keys(value, ['contractVersion', 'requestId', 'result', 'error']);
  assert.equal(value.contractVersion, WIRE); assert.equal(value.requestId, q.requestId);
  assert.notEqual(value.result === null, value.error === null);
  return plain(value);
}
export function denied(q, value, code, reason = 'REQUIRED_FACT_UNKNOWN') {
  const out = envelope(q, value); assert.equal(out.result, null);
  assert.deepEqual(out.error, { code, phase: 'validate', retryability: 'AFTER_NEW_FACTS',
    mutationState: 'NONE', transactionRef: null, causeCode: null, reason });
}
export function replace(owner, name, value) {
  const record = owner.reflect.store[owner[symbols.isolate][name]];
  assert.equal(record.fiber, owner.fiber); assert.equal(owner.set(name, value), true);
  assert.equal(record.value, value);
}
export async function files(root) {
  const out = [];
  async function walk(path) {
    for (const name of (await fs.readdir(path)).sort()) {
      const child = join(path, name), st = await fs.lstat(child, { bigint: true });
      out.push([child, String(st.dev), String(st.ino), String(st.mode), String(st.mtimeNs),
        st.isSymbolicLink() ? await fs.readlink(child) : st.isFile()
          ? createHash('sha256').update(await fs.readFile(child)).digest('hex') : null]);
      if (st.isDirectory()) await walk(child);
    }
  }
  await walk(root); return out;
}
export async function setup(t) {
  const tmp = join(RUN, 'tmp', 'source-release-materials'); await fs.mkdir(tmp, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(join(tmp, 'case-')));
  const user = join(root, 'user'), worlds = join(user, 'worlds'), home = join(root, 'home');
  await fs.mkdir(worlds, { recursive: true }); await fs.mkdir(home);
  await fs.mkdir(join(user, 'games/flatgame'), { recursive: true });
  await fs.writeFile(join(user, 'games/flatgame/game.conf'), 'title = Release fixture\n');
  const ctx = new Context(), fibers = [], actions = [];
  ctx.provide('webServer', { register: () => () => {} });
  ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
  let owner, consumer, service;
  async function plugin(spec) { const fiber = ctx.plugin(spec); fibers.push(fiber); await fiber.await(); return fiber; }
  await plugin({ name: 'actual-adapter-release-fixture', inject: adapter.inject, apply(c) {
    owner = c; service = adapter.apply(c, { localUserPath: user, localWorldRoots: [worlds],
      localCreationRoot: worlds, localGameId: 'flatgame' });
  } });
  await plugin({ name: 'contract-shaped-release-consumer', apply(c) {
    consumer = c;
    const forbidden = name => async () => { actions.push(name); throw Error(`UNEXPECTED_NATIVE_ACTION:${name}`); };
    c.provide('hanaworldsNativeEngineControl', Object.fromEntries(
      ['acquire', 'inspect', 'withStoppedWorld'].map(name => [name, forbidden(name)])));
    c.provide('hanaworldsEngineRuntime', Object.fromEntries(
      ['StartWorldRuntime', 'StopWorldRuntime', 'ReadRuntimeStatus'].map(name => [name, forbidden(name)])));
    c.provide('hanaworldsWorldLifecycle', { launch: forbidden('launch') });
    c.provide('hanaworldsCanvasV5', { call: forbidden('canvas') });
  } });
  t.after(async () => { await service.close(); for (const fiber of fibers.reverse()) await fiber.dispose();
    await ctx.fiber.dispose(); }); // program owns cleanup; keep observed bytes
  const local = () => consumer.get('hanaworldsLocalWorlds');
  function entry(name) {
    const port = local(), method = port[name];
    assert.equal(typeof method, 'function', `Adapter must provide ${name}: runtime needs independently verifiable release bytes before native startup`);
    return q => method.call(port, q);
  }
  async function descriptor() {
    const q = ask(), out = envelope(q, await entry('getRuntimeSource')(q));
    assert.equal(out.error, null); return out.result;
  }
  async function audit(action) {
    const before = await files(root), prior = [...actions];
    try { return await action(); } finally {
      assert.deepEqual(await files(root), before, 'release read/refusal changed files, identities or timestamps');
      assert.deepEqual(actions, prior, 'release read/refusal acquired native control or invoked runtime/lifecycle/Canvas');
    }
  }
  async function scoped(source, operation, payload) {
    const q = ask({ source: plain(source), operation, payload });
    const out = envelope(q, await entry('callScoped')(q)); assert.equal(out.error, null, JSON.stringify(out.error)); return out.result;
  }
  async function create(source, name = 'Release owned world') {
    const made = await scoped(source, 'createWorld', { templateId: 'flat', displayName: name });
    return { ...made, worldPath: join(worlds, name), payloadPath: join(worlds, name, 'worldmods/hanaworlds_adapter') };
  }
  function request(source, worldRef) { return ask({ source: plain(source), worldRef }); }
  return { root, user, worlds, home, ctx, owner, consumer, service, actions, local, entry, descriptor, audit, scoped, create, request };
}
