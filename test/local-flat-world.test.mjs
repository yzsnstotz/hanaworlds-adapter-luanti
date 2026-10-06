// FIXTURE: temporary Luanti user path with stand-in games/mods. Real game and engine
// behaviour is covered by test/real-flat-world.mjs, never by this file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorldPort } from '../src/local-world-port.mjs';
import { payloadDigest } from '../src/local-worlds.mjs';

async function profile({ worldedit = true, games = ['flatgame', 'nopeflat'] } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hw-flat-'))), user = join(root, 'user'), worlds = join(user, 'worlds');
  await mkdir(worlds, { recursive: true });
  if (games.includes('flatgame')) {
    await mkdir(join(user, 'games/flatgame'), { recursive: true });
    await writeFile(join(user, 'games/flatgame/game.conf'), 'title = Flat fixture\nversion = 1.2.3\ndisallowed_mapgens = v6\n');
    await writeFile(join(user, 'games/flatgame/settingtypes.txt'), 'mcl_superflat_classic (Classic superflat) bool false\n');
  }
  if (games.includes('plain')) {
    await mkdir(join(user, 'games/plain'), { recursive: true });
    await writeFile(join(user, 'games/plain/game.conf'), 'title = Plain fixture\n');
  }
  if (games.includes('nopeflat')) {
    await mkdir(join(user, 'games/nopeflat'), { recursive: true });
    await writeFile(join(user, 'games/nopeflat/game.conf'), 'title = No flat\ndisallowed_mapgens = flat, v6\n');
  }
  if (worldedit) {
    await mkdir(join(user, 'mods/Minetest-WorldEdit/worldedit'), { recursive: true });
    await writeFile(join(user, 'mods/Minetest-WorldEdit/modpack.conf'), 'name = Minetest-WorldEdit\n');
    await writeFile(join(user, 'mods/Minetest-WorldEdit/worldedit/mod.conf'), 'name = worldedit\n');
  }
  // An existing world that must never be selected, migrated or overwritten.
  await mkdir(join(worlds, 'existing'));
  await writeFile(join(worlds, 'existing/world.mt'), 'gameid = flatgame\n');
  const logs = [];
  const local = createLocalWorldPort({ roots: [worlds], resolveControl: () => null, runtime: {}, log: (...x) => logs.push(x.join(' ')) });
  return { user, worlds, port: local.port, logs };
}
const req = (user, extra = {}) => ({ requesterRef: 'fixture-host', userPath: user, ...extra });
async function snapshot(worlds) { return (await readdir(worlds)).sort(); }

test('describe names what a creation uses and what is missing', async () => {
  const a = await profile();
  const d = await a.port.describeFlatWorldCreation(req(a.user));
  assert.equal(d.ready, true); assert.deepEqual(d.missing, []);
  assert.deepEqual(d.games.map(g => [g.gameId, g.flatAllowed]), [['flatgame', true], ['nopeflat', false]]);
  assert.deepEqual(d.games[0].flatOptions, [{ setting: 'mcl_superflat_classic', value: 'true' }]);
  assert.equal(d.mapgen.mg_name, 'flat'); assert.equal(d.perCellMod.name, 'worldedit');
  const b = await profile({ worldedit: false, games: ['nopeflat'] });
  const m = await b.port.describeFlatWorldCreation(req(b.user));
  assert.equal(m.ready, false); assert.deepEqual(m.missing.map(x => x.need), ['GAME', 'MOD']);
});

test('creates a new flat world with its payload; result names only that world', async () => {
  const a = await profile();
  const existing = await readFile(join(a.worlds, 'existing/world.mt'), 'utf8');
  const made = await a.port.createFlatWorld(req(a.user, { worldName: 'kid world' }));
  assert.equal(made.created, true); assert.equal(made.nextAction, 'BIND_RUNNING_WORLD');
  assert.equal(made.worldPath, join(a.worlds, 'kid world')); assert.equal(made.game.gameId, 'flatgame'); assert.equal(made.game.version, '1.2.3');
  assert.equal(made.payloadDigest, await payloadDigest()); assert.match(made.worldRef, /^luanti:/);
  const mt = await readFile(join(made.worldPath, 'world.mt'), 'utf8');
  assert.match(mt, /^gameid = flatgame$/m); assert.match(mt, /^world_name = kid world$/m); assert.match(mt, /^load_mod_worldedit = true$/m);
  const meta = await readFile(join(made.worldPath, 'map_meta.txt'), 'utf8');
  for (const line of ['mg_name = flat', 'mgflat_spflags = nolakes,nohills,nocaverns', 'mgflat_ground_level = 8', 'mcl_superflat_classic = true', '[end_of_params]'])
    assert.ok(meta.split('\n').includes(line), line);
  assert.match(meta, /^seed = \d+$/m); assert.equal(made.mapgen.seed, /^seed = (\d+)$/m.exec(meta)[1]);
  const identity = JSON.parse(await readFile(join(made.worldPath, 'worldmods/hanaworlds_adapter/payload.json'), 'utf8'));
  assert.equal(identity.worldRef, made.worldRef);
  const found = (await a.port.discover()).filter(w => w.connectionRef === made.connectionRef);
  assert.equal(found.length, 1); assert.equal(found[0].worldRef, made.worldRef); assert.equal(found[0].payloadStatus, 'INSTALLED_UNVERIFIED');
  assert.equal(await readFile(join(a.worlds, 'existing/world.mt'), 'utf8'), existing);
  assert.deepEqual(await snapshot(a.worlds), ['existing', 'kid world']); // no staging left
  const plain = await profile({ games: ['plain'] });
  const p = await plain.port.createFlatWorld(req(plain.user));
  assert.match(p.worldName, /^hanaworlds-flat-\d{8}T\d{6}-[0-9a-f]{4}$/);
  assert.equal('mcl_superflat_classic' in p.mapgen, false); // only a game that declares it gets it
});

test('failures create, select and overwrite nothing', async () => {
  const a = await profile({ games: ['flatgame', 'plain', 'nopeflat'] });
  const before = await snapshot(a.worlds);
  await assert.rejects(a.port.createFlatWorld(req(a.user)), e => e.message === 'GAME_SELECTION_REQUIRED' && e.details.choices.join() === 'flatgame,plain');
  await assert.rejects(a.port.createFlatWorld(req(a.user, { gameId: 'nopeflat' })), /MAPGEN_NOT_SUPPORTED/);
  await assert.rejects(a.port.createFlatWorld(req(a.user, { gameId: 'missing' })), /GAME_NOT_INSTALLED/);
  await assert.rejects(a.port.createFlatWorld(req(a.user, { gameId: 'flatgame', worldName: 'existing' })), e => e.message === 'WORLD_EXISTS');
  await assert.rejects(a.port.createFlatWorld(req(a.user, { gameId: 'flatgame', worldName: '../escape' })), /SCHEMA_INVALID/);
  await assert.rejects(a.port.createFlatWorld(req(a.user, { gameId: 'flatgame', root: '/elsewhere' })), /WORLD_ROOT_REQUIRED/);
  await assert.rejects(a.port.createFlatWorld({ requesterRef: 'x', userPath: a.user, connectionRef: 'injected' }), /SCHEMA_INVALID/);
  const b = await profile({ worldedit: false });
  await assert.rejects(b.port.createFlatWorld(req(b.user, { gameId: 'flatgame' })), e => e.message === 'PREREQUISITE_MISSING' && e.details.missing[0].mod === 'worldedit');
  assert.deepEqual(await snapshot(a.worlds), before); assert.deepEqual(await snapshot(b.worlds), ['existing']);
  assert.equal((await a.port.discover()).length, 1);
});
