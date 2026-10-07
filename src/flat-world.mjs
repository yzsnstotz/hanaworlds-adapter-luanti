import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { syncDirectory, syncFile, writePayload } from './local-worlds.mjs';

// New local single-player world, generated flat by Luanti's own `flat` mapgen.
// The mapgen parameters are written into the new world's map_meta.txt before its
// first start, so the world itself carries them: no global Luanti setting, Host
// config or other world is read for them or changed. Values are Luanti's
// documented flat-mapgen parameters with hills, lakes, caverns, caves, dungeons
// and decorations off. They are returned with every creation result.
const FLAT_MAPGEN = Object.freeze({
  mg_name: 'flat', chunksize: '5', water_level: '1', mapgen_limit: '31000',
  mg_flags: 'nocaves,nodungeons,light,nodecorations,biomes,ores',
  mgflat_spflags: 'nolakes,nohills,nocaverns', mgflat_ground_level: '8',
});
// A game's own declared flat option, applied only when that game's settingtypes.txt
// declares it (VoxeLibre/MineClone2: classic superflat grass/dirt/bedrock layers).
const GAME_FLAT_OPTIONS = Object.freeze([{ setting: 'mcl_superflat_classic', type: 'bool', value: 'true' }]);
// The current per-cell StateProfile needs WorldEdit's set/set_param2 in the world.
const PER_CELL_MOD = 'worldedit';
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

function fault(code, details) { const error = new Error(code); if (details) error.details = details; return error; }
function conf(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}
const list = value => (value ?? '').split(',').map(x => x.trim()).filter(Boolean);
async function realDir(path) { const s = await lstat(path).catch(() => null); return !!s?.isDirectory() && !s.isSymbolicLink(); }
async function dirOrLink(path) { const s = await lstat(path).catch(() => null); return !!s && (s.isDirectory() || s.isSymbolicLink()); }

/** Games installed in the Luanti user path, as Luanti itself finds them (games/<id>/game.conf). */
export async function discoverLocalGames(userPath) {
  const root = join(userPath, 'games'), games = [];
  if (!await dirOrLink(root)) return games;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const dir = join(root, entry.name);
    const raw = await readFile(join(dir, 'game.conf'), 'utf8').catch(() => null);
    if (raw === null) continue;
    const c = conf(raw);
    const types = await readFile(join(dir, 'settingtypes.txt'), 'utf8').catch(() => '');
    const options = GAME_FLAT_OPTIONS.filter(o => new RegExp(`^\\s*${o.setting.replace('.', '\\.')}\\s*\\(.*\\)\\s*${o.type}\\b`, 'm').test(types));
    const allowed = list(c.allowed_mapgens), disallowed = list(c.disallowed_mapgens);
    games.push({ gameId: entry.name, title: c.title ?? null, version: c.version ?? null,
      gameConfDigest: createHash('sha256').update(raw).digest('hex'),
      flatAllowed: !disallowed.includes('flat') && (allowed.length === 0 || allowed.includes('flat')),
      flatOptions: options.map(o => ({ setting: o.setting, value: o.value })) });
  }
  return games.sort((a, b) => a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0);
}

/** Installed mods in the Luanti user path (plain mods and modpacks), by mod name. */
async function findUserMod(userPath, name) {
  const root = join(userPath, 'mods');
  if (!await dirOrLink(root)) return null;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const dir = join(root, entry.name);
    const own = await readFile(join(dir, 'mod.conf'), 'utf8').catch(() => null);
    const isMod = own !== null || !!await lstat(join(dir, 'init.lua')).catch(() => null);
    if (isMod && (conf(own ?? '').name ?? entry.name) === name) return dir;
    const pack = await readFile(join(dir, 'modpack.conf'), 'utf8').catch(() => null) ??
      await readFile(join(dir, 'modpack.txt'), 'utf8').catch(() => null);
    if (pack === null) continue;
    for (const sub of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const c = conf(await readFile(join(dir, sub.name, 'mod.conf'), 'utf8').catch(() => ''));
      if (c.name === name) return join(dir, sub.name);
    }
  }
  return null;
}

/** Everything a creation would use, and what is missing, without creating anything. */
export async function describeFlatWorldCreation({ roots, userPath }) {
  const games = await discoverLocalGames(userPath);
  const perCell = await findUserMod(userPath, PER_CELL_MOD);
  const missing = [];
  if (roots.length === 0) missing.push({ need: 'WORLD_ROOT', detail: 'no configured local world root' });
  if (!games.some(g => g.flatAllowed)) missing.push({ need: 'GAME', detail: `no installed game in ${join(userPath, 'games')} allows the flat mapgen` });
  if (!perCell) missing.push({ need: 'MOD', mod: PER_CELL_MOD, detail: `per-cell writes need the ${PER_CELL_MOD} mod installed in ${join(userPath, 'mods')}` });
  return { roots: [...roots], games, mapgen: { ...FLAT_MAPGEN }, perCellMod: perCell ? { name: PER_CELL_MOD, path: perCell } : null,
    ready: missing.length === 0, missing };
}

/**
 * Creates a new world directory under `root` (staged, fsynced, then renamed into place;
 * an existing name is never reused or overwritten). The new world carries world.mt,
 * map_meta.txt with the flat mapgen, and this Adapter's payload with a fresh identity.
 */
export async function createFlatWorld({ roots, root, userPath, gameId, worldName, transportPort }) {
  const plan = await describeFlatWorldCreation({ roots, userPath });
  let base = root;
  if (base === undefined) {
    if (roots.length !== 1) throw fault('WORLD_ROOT_REQUIRED', { choices: [...roots] });
    base = roots[0];
  } else if (!roots.includes(resolve(base))) throw fault('WORLD_ROOT_REQUIRED', { choices: [...roots] });
  base = resolve(base);
  if (!await realDir(base)) throw fault('CONNECTION_NOT_FOUND');
  const usable = plan.games.filter(g => g.flatAllowed);
  let game;
  if (gameId === undefined) {
    if (usable.length !== 1) throw fault(usable.length ? 'GAME_SELECTION_REQUIRED' : 'GAME_NOT_INSTALLED',
      { choices: usable.map(g => g.gameId), gamesPath: join(userPath, 'games') });
    [game] = usable;
  } else {
    game = plan.games.find(g => g.gameId === gameId);
    if (!game) throw fault('GAME_NOT_INSTALLED', { gameId, choices: usable.map(g => g.gameId) });
    if (!game.flatAllowed) throw fault('MAPGEN_NOT_SUPPORTED', { gameId, mapgen: 'flat' });
  }
  if (!plan.perCellMod) throw fault('PREREQUISITE_MISSING', { missing: plan.missing.filter(m => m.need === 'MOD') });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const name = worldName ?? `hanaworlds-flat-${stamp}-${randomBytes(2).toString('hex')}`;
  if (typeof name !== 'string' || !NAME.test(name) || name.includes('..')) throw fault('SCHEMA_INVALID');
  const target = join(base, name);
  if (await lstat(target).catch(() => null)) throw fault('WORLD_EXISTS', { worldPath: target });
  const seed = BigInt(`0x${randomBytes(8).toString('hex')}`).toString();
  const mapgen = { ...FLAT_MAPGEN, seed };
  for (const o of game.flatOptions) mapgen[o.setting] = o.value;
  const staging = join(base, `.hanaworlds-new-world-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    await syncFile(join(staging, 'world.mt'), [`gameid = ${game.gameId}`, `world_name = ${name}`,
      'backend = sqlite3', 'player_backend = sqlite3', 'auth_backend = sqlite3', 'mod_storage_backend = sqlite3',
      `load_mod_${PER_CELL_MOD} = true`, ''].join('\n'));
    await syncFile(join(staging, 'map_meta.txt'),
      `${Object.entries(mapgen).map(([k, v]) => `${k} = ${v}`).join('\n')}\n[end_of_params]\n`);
    const mods = join(staging, 'worldmods'), payload = join(mods, 'hanaworlds_adapter');
    await mkdir(mods, { mode: 0o700 }); await mkdir(payload, { mode: 0o700 });
    const identity = await writePayload(payload, { transportPort });
    await syncDirectory(mods); await syncDirectory(staging);
    if (await lstat(target).catch(() => null)) throw fault('WORLD_EXISTS', { worldPath: target });
    await rename(staging, target);
    await syncDirectory(base);
    return { worldPath: target, worldName: name, identity,
      game: { gameId: game.gameId, title: game.title, version: game.version, gameConfDigest: game.gameConfDigest },
      mapgen, perCellMod: plan.perCellMod };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
