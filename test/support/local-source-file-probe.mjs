// Ordinary desktop SOURCE/installed-package file observations. Actors use real
// Node files; this support file supplies no Adapter deletion implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const identity = stat => [String(stat.dev), String(stat.ino)];
export async function tree(path) {
  const rows = {};
  async function walk(p, relative) {
    const stat = await fs.lstat(p, { bigint: true });
    rows[relative] = { identity: identity(stat), mode: String(stat.mode),
      bytes: stat.isFile() ? createHash('sha256').update(await fs.readFile(p)).digest('hex') : null,
      link: stat.isSymbolicLink() ? await fs.readlink(p) : null };
    if (stat.isDirectory()) for (const name of (await fs.readdir(p)).sort()) await walk(join(p, name), relative ? `${relative}/${name}` : name);
  }
  await walk(path, ''); return rows;
}
export async function filesFixture(t) {
  const run = process.env.SOURCE_FILE_RUN ?? fileURLToPath(new URL('../../../', import.meta.url));
  const base = join(run, 'tmp', 'source-node-files'); await fs.mkdir(base, { recursive: true });
  const parent = await fs.realpath(await fs.mkdtemp(join(base, 'case-')));
  const worlds = join(parent, 'worlds'); await fs.mkdir(worlds);
  const worldPath = join(worlds, 'Target'); await fs.mkdir(worldPath);
  await fs.writeFile(join(worldPath, 'world.mt'), 'gameid = fixture\n');
  await fs.writeFile(join(worldPath, 'original.txt'), 'original world bytes');
  const stat = await fs.lstat(worldPath); const target = { worldPath, device: stat.dev, inode: stat.ino };
  const neighbour = join(worlds, 'Neighbour'); await fs.mkdir(neighbour);
  await fs.writeFile(join(neighbour, 'keep.txt'), 'independent neighbour');
  const rootId = identity(await fs.lstat(worlds, { bigint: true }));
  const f = { parent, worlds, target, neighbour, rootId, before: await tree(worldPath), neighbourBefore: await tree(neighbour), moves: [] };
  f.checkRoot = async () => {
    const current = await fs.lstat(worlds, { bigint: true });
    if (current.isSymbolicLink() || !current.isDirectory() || await fs.realpath(worlds) !== worlds ||
        JSON.stringify(identity(current)) !== JSON.stringify(rootId)) throw Error('CURRENT_WORLD_MISMATCH');
  };
  f.checkNeighbour = async () => assert.deepEqual(await tree(neighbour), f.neighbourBefore);
  t.after(async () => {
    f.final = { tree: await tree(parent), moves: f.moves, refusal: f.refusal };
    await fs.writeFile(join(base, `${t.name.replace(/[^a-zA-Z0-9]+/g, '-')}-${parent.split('/').at(-1)}.json`), JSON.stringify(f.final, null, 2));
    // The program owns cleanup; retain actual identities and bytes.
  });
  return f;
}
export function recordError(f, error) {
  f.refusal = { message: error?.message, code: error?.code, mutationState: error?.mutationState,
    cause: error?.cause?.message, details: error?.details };
}
