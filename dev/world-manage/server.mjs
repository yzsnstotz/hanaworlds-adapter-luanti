import { appendFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as C from '#contracts';
import * as adapter from '../../src/index.mjs';
import { ADAPTER_VERSION } from '../../src/version.mjs';
import { createWorldManager } from './manager.mjs';
import { createNativeHost } from './host.mjs';
import { readSurface } from '../world-readback/surface.mjs';

const state = process.env.HW_WORLD_MANAGE_STATE;
if (!state || !process.env.HW_CORDIS_MODULE) throw Error('HW_WORLD_MANAGE_STATE and HW_CORDIS_MODULE required');
const profile = join(state, 'profile'), worlds = join(profile, 'worlds'), home = join(state, 'home');
for (const p of [worlds, home, join(profile, 'games'), join(profile, 'mods'), join(state, 'logs'), join(state, 'tmp')]) await mkdir(p, { recursive: true, mode: 0o700 });
const event = (kind, facts) => appendFileSync(join(state, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, ...facts }) + '\n', { mode: 0o600 });
const owned = createNativeHost({ C, state, profile, worlds,
  luanti: process.env.HW_LUANTI ?? '/Applications/luanti.app/Contents/MacOS/luanti',
  luantiClient: process.env.HW_LUANTI_CLIENT ?? process.env.HW_LUANTI ?? '/Applications/luanti.app/Contents/MacOS/luanti', event });
const { Context } = await import(pathToFileURL(process.env.HW_CORDIS_MODULE));
const ctx = new Context();
ctx.provide('webServer', { register() { return () => {}; } });
ctx.provide('dshHomePath', (...parts) => join(home, ...parts));
ctx.provide('hanaworldsNativeEngineControl', owned.host);
let service;
const fiber = ctx.plugin({ name: adapter.name, inject: adapter.inject,
  apply(c) { service = adapter.apply(c, { localWorldRoots: [worlds] }); } });
await fiber.await();
const manager = createWorldManager({ local: ctx.get('hanaworldsLuantiLocalWorlds'), requesterRef: 'dev-world-manager', userPath: profile,
  foreignActivity: owned.foreignActivity, game: owned.game, validateContext: input => C.validateType('LocalWorldContext', input) });
const page = await readFile(new URL('./page.html', import.meta.url));
const port = 47607;
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Error('SCHEMA_INVALID');
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 65536) throw Error('SCHEMA_INVALID'); }
  return JSON.parse(text);
}
async function handle(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, { ...await manager.state(),
      adapterVersion: ADAPTER_VERSION, contracts: ctx.get('hanaworldsWorldAdapterV6').contractHandshake?.contracts,
      fixture: '会话绑定为合约形状 fixture；世界、Luanti 服务与游戏界面是真实隔离运行。', pid: process.pid });
    if (req.method === 'POST' && path.startsWith('/api/')) {
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'ORIGIN_REJECTED' });
      const input = await body(req); let result;
      switch (path) {
        case '/api/create': result = await manager.create(); break;
        case '/api/connect': result = await manager.connect(input.connectionRef); break;
        case '/api/stop': result = await manager.stop(); break;
        case '/api/enter': result = await manager.enter(); break;
        case '/api/preview-delete': result = await manager.preview(input.connectionRef); break;
        case '/api/cancel-delete': result = await manager.cancel(input.confirmationRef); break;
        case '/api/confirm-delete': result = await manager.confirm(input.confirmationRef); break;
        case '/api/fixture-binding': result = await manager.setFixtureBinding(input.connectionRef, input.enabled === true); break;
        case '/api/readback': {
          const snapshot = await manager.state(); if (!snapshot.current) throw Error('WORLD_NOT_BOUND');
          const ref = snapshot.current.worldRef;
          result = await readSurface((w, b) => ctx.get('hanaworldsLuantiNativeFacts').readRegionState(w, b), ref,
            { cx: 0, cz: 0, radius: 24 }, C.expandRegionBlock);
          result.worldRef = ref; break;
        }
        default: return json(res, 404, { error: 'NOT_FOUND' });
      }
      event('PUBLIC_ACTION', { path, result }); return json(res, 200, { ok: true, result });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" });
      return res.end(req.method === 'HEAD' ? undefined : page);
    }
    return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const failure = { code: error.message, details: error.details ?? null };
    event('PUBLIC_ACTION_FAILED', { path, failure }); return json(res, 409, { ok: false, error: failure });
  }
}
const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const server = createServer(handle);
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, host, yes); }); servers.push(server);
}
event('SERVICE_STARTED', { pid: process.pid, port, state, adapterVersion: ADAPTER_VERSION });
console.log(`Adapter ${ADAPTER_VERSION} world manager at http://127.0.0.1:${port}/worlds`);
async function shutdown() {
  for (const server of servers) server.close();
  await service.close(); await owned.shutdown(); process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
