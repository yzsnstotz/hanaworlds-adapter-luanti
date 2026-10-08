import { randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { syncDirectory } from './local-worlds.mjs';
import { ADAPTER_ID } from './version.mjs';

// Written by createFlatWorld into the new world's own directory (outside the
// payload, so the payload digest is unchanged). It is the only proof that this
// Adapter created a world: worlds without it (user worlds, provisioned worlds,
// copies or moves) are never deletable through this Adapter.
export const CREATED_MARKER = 'hanaworlds-created-world.json';
export const CREATED_FORMAT = 'hanaworlds-adapter-created-world/1';
export const STAGING_PREFIX = '.hanaworlds-';

function fault(code, details) { const error = new Error(code); if (details) error.details = details; return error; }

export function createdMarker({ worldRef, worldName, root, adapterVersion }) {
  return `${JSON.stringify({ format: CREATED_FORMAT, createdBy: ADAPTER_ID, adapterVersion,
    worldRef, worldName, root, createdAt: new Date().toISOString() })}\n`;
}

/** The marker of an Adapter-created world, or a named reason it is not one. */
export async function readCreatedMarker(world) {
  const path = join(world.worldPath, CREATED_MARKER);
  const info = await lstat(path).catch(() => null);
  if (!info) return { owned: false, reason: 'NO_CREATION_MARKER' };
  if (!info.isFile() || info.isSymbolicLink()) return { owned: false, reason: 'CREATION_MARKER_NOT_A_FILE' };
  let marker;
  try { marker = JSON.parse(await readFile(path, 'utf8')); } catch { return { owned: false, reason: 'CREATION_MARKER_UNREADABLE' }; }
  if (marker?.format !== CREATED_FORMAT || marker.createdBy !== ADAPTER_ID) return { owned: false, reason: 'CREATION_MARKER_FOREIGN' };
  if (!world.worldRef || marker.worldRef !== world.worldRef) return { owned: false, reason: 'CREATION_MARKER_WORLD_MISMATCH' };
  if (marker.worldName !== basename(world.worldPath) || marker.root !== dirname(world.worldPath))
    return { owned: false, reason: 'CREATION_MARKER_LOCATION_MISMATCH' };
  return { owned: true, marker };
}

/** Exact files and bytes that a deletion removes (real files only; links are counted, not followed). */
export async function worldData(path) {
  let files = 0, bytes = 0;
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) await walk(child);
      else { const info = await lstat(child); files++; bytes += info.size; }
    }
  };
  await walk(path);
  return { files, bytes };
}

/**
 * Removes one exact world directory. It is first renamed (same root, atomic) to a
 * hidden staging name that discovery never lists, then removed. The staging
 * directory must still be the exact device/inode that was checked. If removal
 * fails after the rename, the residue path is named in DELETE_INCOMPLETE; it is
 * never silently left or reported as deleted.
 */
export async function removeWorldDirectory(world) {
  const root = dirname(world.worldPath);
  const staging = join(root, `${STAGING_PREFIX}deleting-${randomUUID()}`);
  await rename(world.worldPath, staging);
  await syncDirectory(root);
  const moved = await lstat(staging);
  if (moved.dev !== world.device || moved.ino !== world.inode) {
    await rename(staging, world.worldPath); await syncDirectory(root);
    throw fault('CURRENT_WORLD_MISMATCH');
  }
  try { await rm(staging, { recursive: true }); await syncDirectory(root); }
  catch (error) { throw fault('DELETE_INCOMPLETE', { residuePath: staging, cause: error.code ?? error.message }); }
}
