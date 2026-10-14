import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, realpath } from 'node:fs/promises';

// Internal call lifetime, never a caller-supplied JSON credential. All source I/O
// checks the captured registration/root/world before and after yielding.
const scopes = new AsyncLocalStorage();
export const sourceCallActive = () => !!scopes.getStore();
export const sourceMutationState = () => scopes.getStore()?.mutationState ?? 'NONE';
export function markSourceMutation() { const scope = scopes.getStore(); if (scope) scope.mutationState = 'UNKNOWN'; }
export function addSourceCheck(check) { const scope = scopes.getStore(); if (scope) (scope.extraChecks ??= []).push(check); }
export function bindSourceWorld(world) {
  const scope = scopes.getStore();
  if (!scope) return;
  if (scope.world && (scope.world.path !== world.worldPath || scope.world.device !== String(world.device) || scope.world.inode !== String(world.inode)))
    throw Error('CURRENT_WORLD_MISMATCH');
  scope.world = { path: world.worldPath, device: String(world.device), inode: String(world.inode) };
}
export function movedSourceWorld(from, to) {
  const scope = scopes.getStore();
  if (scope?.world?.path === from) scope.world.path = to;
}
export function removedSourceWorld(path) {
  const scope = scopes.getStore();
  if (scope?.world?.path === path) scope.world = null;
}
export async function withSourceScope(check, run) {
  const scope = { check, active: true, mutationState: 'NONE' };
  try {
    const result = await scopes.run(scope, run);
    // Returning a business refusal cannot hide a binding/filesystem commit.
    if (scope.mutationState !== 'NONE' && result?.response?.error?.mutationState === 'NONE')
      result.response = { ...result.response, error: { ...result.response.error, mutationState: 'UNKNOWN', phase: 'apply' } };
    return result;
  }
  catch (error) {
    if (scope.mutationState !== 'NONE' && !error.mutationState)
      Object.defineProperty(error, 'mutationState', { value: scope.mutationState, configurable: true });
    throw error;
  } finally { scope.active = false; }
}
export async function checkSourceScope() {
  const scope = scopes.getStore();
  if (!scope) return;
  if (!scope.active) throw Error('CURRENT_WORLD_MISMATCH');
  try {
    for (const check of scope.extraChecks ?? []) check();
    await scope.check();
    for (const check of scope.extraChecks ?? []) check();
    if (scope.world) {
      const held = scope.world;
      const stat = await lstat(held.path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || String(stat.dev) !== held.device || String(stat.ino) !== held.inode ||
        await realpath(held.path) !== held.path) throw Error('CURRENT_WORLD_MISMATCH');
      await scope.check();
      for (const check of scope.extraChecks ?? []) check();
    }
  } catch (error) {
    if (scope.world && ['ENOENT', 'ENOTDIR'].includes(error.code)) error = new Error('CURRENT_WORLD_MISMATCH', { cause: error });
    if (error.message === 'CURRENT_WORLD_MISMATCH') error.sourceCurrency = true;
    if (scope.mutationState !== 'NONE' && !error.mutationState)
      Object.defineProperty(error, 'mutationState', { value: scope.mutationState, configurable: true });
    throw error;
  }
  if (!scope.active) throw Error('CURRENT_WORLD_MISMATCH');
}
export async function sourceRead(run) {
  await checkSourceScope();
  const result = await run();
  await checkSourceScope();
  return result;
}
export async function sourceWrite(run) {
  await checkSourceScope();
  const scope = scopes.getStore();
  if (scope) scope.mutationState = 'UNKNOWN';
  try {
    const result = await run();
    await checkSourceScope();
    return result;
  } catch (error) {
    if (scope && (!error.mutationState || error.mutationState === 'NONE'))
      Object.defineProperty(error, 'mutationState', { value: 'UNKNOWN', configurable: true });
    throw error;
  }
}
