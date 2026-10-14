import { randomUUID } from 'node:crypto';
import { lstat as nativeLstat, readdir as nativeReaddir, readFile as nativeReadFile, realpath as nativeRealpath, rm } from 'node:fs/promises';
import { lstatSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { syncDirectory } from './local-worlds.mjs';
import { ioKind } from './resource-errors.mjs';
import { ADAPTER_ID } from './version.mjs';
import { sourceRead, sourceWrite, movedSourceWorld, removedSourceWorld } from './source-scope.mjs';
const lstat = (...args) => sourceRead(() => nativeLstat(...args));
const readdir = (...args) => sourceRead(() => nativeReaddir(...args));
const readFile = (...args) => sourceRead(() => nativeReadFile(...args));

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
  let info; try {info=await lstat(path);} catch(error) {if(error.code==='ENOENT')return {owned:false,reason:'NO_CREATION_MARKER'};return {owned:false,reason:'CREATION_MARKER_'+ioKind(error)};}
  if (!info) return { owned: false, reason: 'NO_CREATION_MARKER' };
  if (!info.isFile() || info.isSymbolicLink()) return { owned: false, reason: 'CREATION_MARKER_NOT_A_FILE' };
  let marker;
  let raw;try {raw=await readFile(path,'utf8');} catch(error) {return {owned:false,reason:'CREATION_MARKER_'+ioKind(error)};}
  try {marker=JSON.parse(raw);} catch {return {owned:false,reason:'CREATION_MARKER_CORRUPT'};}
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

const sameIdentity = (stat, held) => stat?.isDirectory() && !stat.isSymbolicLink() &&
  String(stat.dev) === held.device && String(stat.ino) === held.inode;
const identity = stat => ({ device: String(stat.dev), inode: String(stat.ino) });

function missingSync(path) {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function exactDirectorySync(path, held) {
  const stat = missingSync(path);
  return sameIdentity(stat, held) && realpathSync(path) === path;
}
function requireDirectorySync(path, held) {
  if (!exactDirectorySync(path, held)) throw fault('CURRENT_WORLD_MISMATCH');
}
async function captureDirectory(path) {
  const stat = await sourceRead(() => nativeLstat(path, { bigint: true }));
  const actual = await sourceRead(() => nativeRealpath(path));
  if (!stat.isDirectory() || stat.isSymbolicLink() || actual !== path) throw fault('CURRENT_WORLD_MISMATCH');
  const held = identity(stat);
  requireDirectorySync(path, held);
  return held;
}
async function observeMissing(path) {
  try { return await nativeLstat(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Diagnostics only. Search the captured ancestor's immediate children for the
// original parent, then that parent's immediate children for the original world.
// A relocated directory never grants authority to write at its new location.
function locateResidue(custody) {
  const { ancestor, ancestorIdentity, root, rootIdentity, worldIdentity } = custody;
  requireDirectorySync(ancestor, ancestorIdentity);
  let parents;
  if (exactDirectorySync(root, rootIdentity)) parents = [root];
  else parents = readdirSync(ancestor).map(name => join(ancestor, name))
    .filter(path => exactDirectorySync(path, rootIdentity));
  requireDirectorySync(ancestor, ancestorIdentity);
  if (parents.length !== 1) throw fault('RESIDUE_PARENT_LOCATION_UNKNOWN');
  const parent = parents[0];
  requireDirectorySync(parent, rootIdentity);
  const matches = readdirSync(parent).map(name => join(parent, name))
    .filter(path => exactDirectorySync(path, worldIdentity));
  requireDirectorySync(ancestor, ancestorIdentity);
  requireDirectorySync(parent, rootIdentity);
  if (matches.length !== 1) throw fault('RESIDUE_WORLD_LOCATION_UNKNOWN');
  requireDirectorySync(matches[0], worldIdentity);
  return matches[0];
}
function annotateFailure(error, mutationState, details) {
  const diagnostic = details ? { ...error.details, ...details } : undefined;
  if (diagnostic?.residueLocationReason) delete diagnostic.residuePath;
  try {
    Object.defineProperty(error, 'mutationState', { value: mutationState, configurable: true });
    if (diagnostic) error.details = diagnostic;
    return error;
  } catch {
    return Object.assign(new Error(error.message, { cause: error }), {
      ...(error.code ? { code: error.code } : {}), mutationState,
      ...(diagnostic ? { details: diagnostic } : {}),
      ...(error.sourceCurrency ? { sourceCurrency: true } : {}),
    });
  }
}
function residueDetails(custody, recoveryReason) {
  try { return { recoveryReason, residuePath: locateResidue(custody) }; }
  catch (error) { return { recoveryReason, residueLocationReason: error.code ?? error.message, residueLocationFailure: error }; }
}

/**
 * Move the exact world to hidden staging, then remove only its captured identity.
 * A failed move/postcheck can compensate once into the observed empty original
 * target. Compensation cannot write into a changed parent or move a replacement
 * staging, and never restores a directory after removal has begun. Original I/O
 * errors survive, with private actual-custody diagnostics when recovery refuses.
 */
export async function removeWorldDirectory(world) {
  const original = world.worldPath, root = dirname(original), ancestor = dirname(root);
  const staging = join(root, `${STAGING_PREFIX}deleting-${randomUUID()}`);
  const rootIdentity = await captureDirectory(root);
  const ancestorIdentity = await captureDirectory(ancestor);
  const worldIdentity = await captureDirectory(original);
  if (worldIdentity.device !== String(world.device) || worldIdentity.inode !== String(world.inode))
    throw fault('CURRENT_WORLD_MISMATCH');
  const custody = { root, ancestor, rootIdentity, ancestorIdentity, worldIdentity };
  if (await sourceRead(() => observeMissing(staging))) throw fault('DELETE_STAGING_OCCUPIED');
  let forwardAttempted = false, removalStarted = false;
  try {
    await sourceWrite(() => {
      forwardAttempted = true;
      renameSync(original, staging);
      movedSourceWorld(original, staging);
    }, () => {
      requireDirectorySync(ancestor, ancestorIdentity);
      requireDirectorySync(root, rootIdentity);
      requireDirectorySync(original, worldIdentity);
      if (missingSync(staging)) throw fault('DELETE_STAGING_OCCUPIED');
    });
    await syncDirectory(root);
    const moved = await lstat(staging);
    if (!sameIdentity(moved, worldIdentity)) throw fault('CURRENT_WORLD_MISMATCH');
    await sourceWrite(async () => {
      removalStarted = true;
      await rm(staging, { recursive: true });
      removedSourceWorld(staging);
    }, () => {
      requireDirectorySync(ancestor, ancestorIdentity);
      requireDirectorySync(root, rootIdentity);
      requireDirectorySync(staging, worldIdentity);
    });
    await syncDirectory(root);
  } catch (error) {
    if (!forwardAttempted) throw error;
    // The primitive may move and then throw, or sourceWrite's postcheck may
    // reject. Actual custody is checked outside that callback in both cases.
    if (removalStarted) {
      const details = residueDetails(custody, 'REMOVAL_INCOMPLETE');
      throw annotateFailure(error, details.residuePath ? 'PARTIAL' : 'UNKNOWN', details);
    }
    let moved, observationFailure;
    try { moved = exactDirectorySync(staging, worldIdentity); }
    catch (failure) { moved = false; observationFailure = failure; }
    if (!moved)
      throw annotateFailure(error, 'UNKNOWN', {
        ...residueDetails(custody, observationFailure ? 'STAGING_OBSERVATION_FAILED' : 'STAGING_IDENTITY_CHANGED'),
        ...(observationFailure ? { observationFailure } : {}),
      });
    movedSourceWorld(original, staging);
    let recoveryReason, recoveryFailure;
    try {
      // This observation deliberately uses captured custody rather than a lost
      // registration. Only the one inverse of this call's actual move is allowed.
      const occupied = await nativeLstat(original, { bigint: true }).catch(failure => {
        if (failure.code === 'ENOENT') return null;
        throw failure;
      });
      if (!exactDirectorySync(ancestor, ancestorIdentity)) recoveryReason = 'ANCESTOR_IDENTITY_CHANGED';
      else if (!exactDirectorySync(root, rootIdentity)) recoveryReason = 'PARENT_IDENTITY_CHANGED';
      else if (!exactDirectorySync(staging, worldIdentity)) recoveryReason = 'STAGING_IDENTITY_CHANGED';
      else if (occupied || missingSync(original)) recoveryReason = 'TARGET_OCCUPIED';
      else {
        // No await separates these identity/absence checks and the Node move.
        renameSync(staging, original);
        movedSourceWorld(staging, original);
      }
    } catch (recoveryError) {
      recoveryReason = 'RECOVERY_IO_FAILED';
      recoveryFailure = recoveryError;
    }
    throw annotateFailure(error, 'UNKNOWN', recoveryReason ? {
      ...residueDetails(custody, recoveryReason), ...(recoveryFailure ? { recoveryFailure } : {}),
    } : undefined);
  }
}
