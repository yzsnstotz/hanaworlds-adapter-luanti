// Own input → output page for hanaworlds-adapter-luanti Stage 1 fact supply.
// Output is produced by the real Adapter public path; the INPUT (engine core:
// players, collision boxes, loaded mods, WorldEdit global; native Host) is a
// FIXTURE and is labelled as such on every response. Loopback only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFixtureWorld } from './fixture-world.mjs';
import { ADAPTER_VERSION, PAYLOAD_VERSION } from '../../src/version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 47614);
const runRoot = process.env.HW_STAGE1_RUN;
if (!runRoot) throw Error('HW_STAGE1_RUN (own run directory) required');

const STAND = [-0.312, 0, -0.312, 0.312, 1.8, 0.312], SNEAK = [-0.312, 0, -0.312, 0.312, 1.5, 0.312];
export const PLAYERS = {
  'one-standing': { label: 'One player "alice", standing box', players: [{ name: 'alice', collisionbox: STAND }] },
  'one-sneaking': { label: 'Same player "alice", sneaking box', players: [{ name: 'alice', collisionbox: SNEAK }] },
  'none': { label: 'No connected player', players: [] },
  'two': { label: 'Two connected players', players: [{ name: 'alice', collisionbox: STAND }, { name: 'bob', collisionbox: STAND }] },
};
export const BACKEND = {
  'declared': { label: 'Payload declares its write backend (as shipped)', writeBackendDeclared: true },
  'not-declared': { label: 'Declaration removed (fixture only)', writeBackendDeclared: false },
};
export const WORLDEDIT = {
  'version-exposed': { label: 'WorldEdit loaded, exposes version 1.3', worldedit: { version_string: '1.3', version: { major: 1, minor: 3 } } },
  'version-hidden': { label: 'WorldEdit loaded, exposes no version', worldedit: { version_string: null } },
};
const choice = { player: 'one-standing', worldedit: 'version-exposed', backend: 'declared' };
const scenario = () => ({ gameId: 'fixture_game', nodes: ['air', 'fixture:stone'], modnames: ['fixture_core', 'worldedit'],
  worldedit: WORLDEDIT[choice.worldedit].worldedit, players: PLAYERS[choice.player].players,
  writeBackendDeclared: BACKEND[choice.backend].writeBackendDeclared });

const world = await openFixtureWorld({ runRoot, scenario: scenario() });
let connected = false;
const LAYERS = { input: 'FIXTURE (engine core + native Host model; not Luanti, not a real player/World/WorldEdit)',
  output: `REAL Adapter ${ADAPTER_VERSION} public path (payload ${PAYLOAD_VERSION} facts.lua + hanaworldsLuantiNativeFacts)` };
const errorOf = e => ({ code: e.message, reason: e.reason ?? null, detail: e.detail ?? null });
const state = () => ({ layers: LAYERS, worldRef: world.worldRef, connected, choice, players: PLAYERS, worldedit: WORLDEDIT, backend: BACKEND,
  notSupplied: [{ field: 'SafetyProfile.avatarDimensions', status: 'UNAVAILABLE (always)',
    why: 'actual collision boxes and their pose-dependent sizes stay inside the engine (INV-POSE-STAYS-IN-ENGINE). Changing the fixture players must not change any output. No 1x2x1 or other design size is produced.' }] });

const api = {
  'GET /api/state': async () => state(),
  'POST /api/scenario': async body => {
    if (body.player !== undefined) { if (!PLAYERS[body.player]) throw Object.assign(Error('SCHEMA_INVALID'), { detail: 'player' }); choice.player = body.player; }
    if (body.worldedit !== undefined) { if (!WORLDEDIT[body.worldedit]) throw Object.assign(Error('SCHEMA_INVALID'), { detail: 'worldedit' }); choice.worldedit = body.worldedit; }
    if (body.backend !== undefined) { if (!BACKEND[body.backend]) throw Object.assign(Error('SCHEMA_INVALID'), { detail: 'backend' }); choice.backend = body.backend; }
    await world.setScenario(scenario()); return state();
  },
  'POST /api/connect': async () => { if (!connected) { await world.connect(); connected = true; } return state(); },
  'POST /api/disconnect': async () => { if (connected) { await world.disconnect(); connected = false; } return state(); },
  'POST /api/read/config': async () => world.facts.readConfigEngineFacts(world.worldRef),
  'POST /api/read/worldedit': async () => world.facts.readWorldEditFacts(world.worldRef),
  'GET /api/ledger': async () => world.facts.readStage1FactLedger(world.worldRef),
};

const server = createServer(async (req, res) => {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.statusCode = 403; return res.end(); }
  res.setHeader('Cache-Control', 'no-store');
  const path = req.url.split('?')[0];
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(await readFile(join(here, 'page.html')));
  }
  const handler = api[`${req.method} ${path}`];
  if (!handler) { res.statusCode = 404; return res.end(); }
  let body = ''; for await (const c of req) body += c;
  res.setHeader('content-type', 'application/json');
  try { res.end(JSON.stringify({ layers: LAYERS, ok: true, value: await handler(body ? JSON.parse(body) : {}) })); }
  catch (e) { res.end(JSON.stringify({ layers: LAYERS, ok: false, error: errorOf(e) })); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/`, pid: process.pid, worldRef: world.worldRef, runRoot })));
const stop = async () => { server.close(); await world.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
