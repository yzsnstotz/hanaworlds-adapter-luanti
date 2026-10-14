// Test observer only. Every successful primitive call below invokes the installed
// OWN native function; actors change real directories before/after that call.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import builtinFS from 'node:fs';
import promiseFS from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { observeCommitBoundary } from './commit-boundary-observer.mjs';

export const directoryIdentity = path => {
  const s = fs.lstatSync(path, { bigint: true });
  assert.ok(s.isDirectory() && !s.isSymbolicLink());
  return { device: String(s.dev), inode: String(s.ino) };
};
export function tree(path) {
  if (!fs.existsSync(path)) return null;
  const s = fs.lstatSync(path, { bigint: true });
  const row = { device: String(s.dev), inode: String(s.ino), mode: String(s.mode) };
  if (s.isSymbolicLink()) return { ...row, link: fs.readlinkSync(path) };
  if (s.isFile()) return { ...row, bytes: fs.readFileSync(path).toString('hex') };
  return { ...row, children: Object.fromEntries(fs.readdirSync(path).sort().map(n => [n, tree(join(path, n))])) };
}
export async function requireMover(path) {
  let module;
  try { module = await import(pathToFileURL(path).href); } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  assert.equal(typeof module?.openAtomicMover, 'function',
    'ATOMIC_MOVE_CAPABILITY_MISSING: Adapter must ship its trusted OWN no-overwrite directory mover');
  return module;
}

async function probe({ modulePath, caseRoot, scenario }) {
  fs.mkdirSync(caseRoot, { recursive: true });
  const root = fs.realpathSync(caseRoot), parentPath = join(root, 'parent');
  fs.mkdirSync(parentPath);
  const source = join(parentPath, 'source'), target = join(parentPath, 'target');
  fs.mkdirSync(source); fs.mkdirSync(join(source, 'nested'));
  fs.writeFileSync(join(source, 'nested', 'bytes.bin'), Buffer.from([0, 255, 17, 0, 92]));
  fs.mkdirSync(join(parentPath, 'neighbour')); fs.writeFileSync(join(parentPath, 'neighbour', 'keep'), 'neighbour');
  const expectedDirectory = directoryIdentity(source), before = tree(source), neighbour = tree(join(parentPath, 'neighbour'));
  const request = { fromName: 'source', toName: 'target', expectedDirectory };
  const evidence = { scenario, platform: process.platform, arch: process.arch, node: process.version,
    napi: process.versions.napi, targetVolumeDevice: expectedDirectory.device, primitiveCalls: 0, openedParents: 0, closedParents: 0, dlopenPaths: [] };
  let actor, mover, failure, receipt, stopCommitObserver;
  const actualRenameSync = builtinFS.renameSync, actualCallbackRename = builtinFS.rename, actualRename = promiseFS.rename;
  const forbiddenRename = () => { throw Error('FALLBACK_RENAME_FORBIDDEN: OWN native exclusive move required'); };
  builtinFS.renameSync = forbiddenRename; builtinFS.rename = forbiddenRename; promiseFS.rename = forbiddenRename; syncBuiltinESMExports();
  const realDlopen = process.dlopen;
  process.dlopen = function (nativeModule, nativePath, ...rest) {
    evidence.dlopenPaths.push(String(nativePath));
    const result = realDlopen.call(this, nativeModule, nativePath, ...rest);
    const native = nativeModule.exports, actual = native.moveDirectoryNoReplace;
    assert.equal(typeof native.runtimeProfile, 'string'); assert.ok(native.runtimeProfile.length,
      'compiled OWN binary must identify its audited runtime profile');
    evidence.runtimeProfile = native.runtimeProfile;
    evidence.profileTuple = { platform: process.platform, arch: process.arch, napi: 8, runtimeProfile: native.runtimeProfile };
    assert.equal(typeof actual, 'function', 'OWN atomic native ABI must expose moveDirectoryNoReplace');
    for (const name of ['openParent', 'inspectParent', 'closeParent'])
      assert.equal(typeof native[name], 'function', `OWN native ABI must expose ${name}`);
    const actualOpen = native.openParent, actualClose = native.closeParent;
    native.openParent = function (...args) { const handle = actualOpen.apply(this, args); evidence.openedParents++; return handle; };
    native.closeParent = function (...args) { const result = actualClose.apply(this, args); evidence.closedParents++; return result; };
    native.moveDirectoryNoReplace = function (...args) {
      evidence.primitiveCalls++;
      actor?.('before', args);
      const moved = actual.apply(this, args);
      evidence.nativeReceipt = moved;
      actor?.('after', args, moved);
      return moved;
    };
    return result;
  };
  try {
    const { openAtomicMover } = await requireMover(modulePath);
    const { loadAtomicNative } = await import(pathToFileURL(join(dirname(modulePath), 'source-atomic-native.mjs')).href);
    const binding = await loadAtomicNative(), profileField = Object.getOwnPropertyDescriptor(binding, 'runtimeProfile');
    assert.equal(binding.runtimeProfile, evidence.runtimeProfile);
    assert.ok(profileField?.writable === false || (typeof profileField?.get === 'function' && profileField.set === undefined),
      'selected cached OWN binding runtimeProfile metadata must be read-only');
    mover = await openAtomicMover({ parentPath });
    assert.equal(typeof mover.move, 'function'); assert.equal(typeof mover.close, 'function');
    if (scenario.startsWith('commit-')) {
      const replaceParent = scenario.includes('parent'), occupied = scenario.endsWith('-occupied');
      const held = join(root, replaceParent ? 'held-parent' : 'held-source');
      const sourceObject = replaceParent ? parentPath : source;
      const originalObject = tree(sourceObject);
      let replacement, occupant, attempted = false, denied;
      stopCommitObserver = observeCommitBoundary(binding, event => {
        if (event.fromName !== request.fromName || event.toName !== request.toName) return;
        assert.equal(attempted, false, 'exactly one final native check/commit notification');
        attempted = true; evidence.commitBoundary = event;
        assert.deepEqual(event.verifiedDirectory, expectedDirectory);
        assert.deepEqual(event.verifiedParent, directoryIdentity(parentPath));
        try { actualRenameSync(sourceObject, held); }
        catch (error) {
          assert.ok(['EBUSY', 'EACCES', 'EPERM'].includes(error.code), 'only actual kernel exclusion counts as denied actor');
          denied = error.code; evidence.actorKernelRefusal = denied;
          assert.deepEqual(tree(sourceObject), originalObject);
        }
        if (!denied) {
          fs.mkdirSync(sourceObject);
          fs.writeFileSync(join(sourceObject, 'foreign'), 'replacement owner');
          if (replaceParent) {
            fs.mkdirSync(source); fs.writeFileSync(join(source, 'foreign'), 'foreign world');
            fs.mkdirSync(join(parentPath, 'neighbour')); fs.writeFileSync(join(parentPath, 'neighbour', 'foreign'), 'foreign neighbour');
          }
          replacement = tree(sourceObject);
        }
        if (occupied) { fs.mkdirSync(target); fs.writeFileSync(join(target, 'new-owner'), 'new destination owner'); occupant = tree(target); }
        // No recheck/mock rejection here. Return and let the real native commit
        // run. An implementation cannot rename a replacement then repair it.
      });
      try { receipt = await mover.move(request); } catch (error) { failure = error; }
      assert.equal(attempted, true, 'replacement must occur inside native after the LAST identity check');
      if (denied && !occupied) {
        if (failure) throw failure;
        assert.deepEqual(receipt.movedDirectory, expectedDirectory);
        assert.deepEqual(tree(target), before); assert.equal(tree(source), null);
        assert.deepEqual(tree(join(parentPath, 'neighbour')), neighbour);
      } else {
        assert.ok(failure, 'post-check replacement/occupancy must not move any replacement');
        assert.equal(failure.mutationState, 'NONE', 'detection after moving the wrong object is too late');
        if (!denied) assert.equal(failure.code ?? failure.message, 'CURRENT_WORLD_MISMATCH');
        assert.deepEqual(tree(target), occupied ? occupant : null);
        if (denied) assert.deepEqual(tree(source), before);
        else {
          assert.deepEqual(tree(held), originalObject);
          // Include an actor's newly occupied destination in expected parent.
          if (replaceParent && occupied) replacement.children.target = occupant;
          assert.deepEqual(tree(sourceObject), replacement);
          if (!replaceParent) assert.deepEqual(tree(join(parentPath, 'neighbour')), neighbour);
        }
      }
    } else if (scenario === 'occupied-empty' || scenario === 'occupied-nonempty') {
      fs.mkdirSync(target); if (scenario === 'occupied-nonempty') fs.writeFileSync(join(target, 'owned'), 'owned');
      const occupied = tree(target);
      try { await mover.move(request); } catch (e) { failure = e; }
      assert.ok(failure, 'existing empty/nonempty directory must refuse');
      assert.equal(failure.mutationState, 'NONE');
      assert.deepEqual(tree(target), occupied); assert.deepEqual(tree(source), before);
    } else if (scenario === 'parent-replaced' || scenario === 'parent-symlink') {
      const held = join(root, 'held-parent'); actualRenameSync(parentPath, held);
      if (scenario === 'parent-symlink') fs.symlinkSync(held, parentPath, 'dir');
      else { fs.mkdirSync(parentPath); fs.mkdirSync(join(parentPath, 'source')); fs.writeFileSync(join(parentPath, 'source', 'foreign'), 'foreign'); }
      const replacement = tree(parentPath), heldBefore = tree(held);
      try { await mover.move(request); } catch (e) { failure = e; }
      assert.ok(failure, 'replaced held-parent pathname must revoke mover');
      assert.equal(failure.mutationState, 'NONE'); assert.equal(failure.code ?? failure.message, 'CURRENT_WORLD_MISMATCH');
      assert.deepEqual(tree(parentPath), replacement); assert.deepEqual(tree(held), heldBefore);
    } else if (scenario === 'source-replaced') {
      actor = when => { if (when !== 'before') return;
        actualRenameSync(source, join(parentPath, 'saved-original')); fs.mkdirSync(source);
        fs.writeFileSync(join(source, 'foreign'), 'foreign'); evidence.replacement = tree(source);
      };
      try { await mover.move(request); } catch (e) { failure = e; }
      assert.ok(failure, 'replacement at actual primitive boundary must refuse');
      assert.notEqual(failure.mutationState, undefined);
      assert.deepEqual(tree(join(parentPath, 'saved-original')), before);
      assert.deepEqual(tree(source), evidence.replacement); assert.equal(tree(target), null);
    } else if (scenario === 'post-source-replaced') {
      actor = when => { if (when !== 'after') return;
        fs.mkdirSync(source); fs.writeFileSync(join(source, 'new-owner'), 'new owner'); evidence.replacement = tree(source);
      };
      receipt = await mover.move(request);
      assert.deepEqual(receipt.movedDirectory, expectedDirectory);
      assert.deepEqual(tree(target), before); assert.deepEqual(tree(source), evidence.replacement);
    } else if (scenario === 'post-target-replaced') {
      actor = when => { if (when !== 'after') return;
        actualRenameSync(target, join(parentPath, 'actual-moved')); fs.mkdirSync(target);
        fs.writeFileSync(join(target, 'foreign'), 'foreign'); evidence.replacement = tree(target);
      };
      try { await mover.move(request); } catch (e) { failure = e; }
      assert.ok(failure, 'mover must not report replacement as the moved expected directory');
      assert.equal(failure.mutationState, 'UNKNOWN');
      assert.deepEqual(tree(join(parentPath, 'actual-moved')), before);
      assert.deepEqual(tree(target), evidence.replacement); assert.equal(tree(source), null);
    } else if (scenario === 'native-error-after-move') {
      let original;
      actor = (when, _args, moved) => { if (when !== 'after') return;
        original = Object.assign(new Error('EIO_AFTER_ACTUAL_MOVE'), { code: 'EIO', mutationState: 'UNKNOWN',
          details: { movedDirectory: moved.movedDirectory, custodyName: 'target', recoveryReason: 'NATIVE_REPORT_FAILED' } });
        throw original;
      };
      try { await mover.move(request); } catch (e) { failure = e; }
      assert.ok(original, 'real native move must occur before fault');
      assert.ok(failure === original || failure?.cause === original, 'preserve exact native error or exact cause');
      assert.equal(failure.mutationState, 'UNKNOWN');
      assert.deepEqual(failure.details?.movedDirectory, expectedDirectory);
      assert.equal(failure.details?.custodyName, 'target');
      assert.deepEqual(tree(target), before); assert.equal(tree(source), null);
    } else if (scenario === 'identity-mismatch') {
      await assert.rejects(mover.move({ ...request, expectedDirectory: { device: expectedDirectory.device, inode: '0' } }),
        e => { assert.equal(e.mutationState, 'NONE'); return (e.code ?? e.message) === 'CURRENT_WORLD_MISMATCH'; });
      assert.deepEqual(tree(source), before); assert.equal(tree(target), null);
    } else if (scenario === 'invalid-name') {
      for (const name of ['../source', resolve(source), 'nested/source', '', '.'])
        for (const field of ['fromName', 'toName'])
          await assert.rejects(mover.move({ ...request, [field]: name }), e => e.mutationState === 'NONE');
      assert.equal(evidence.primitiveCalls, 0, 'invalid names never reach native move');
      assert.deepEqual(tree(source), before); assert.equal(tree(target), null);
    } else if (scenario === 'closed') {
      await mover.close(); await mover.close();
      await assert.rejects(mover.move(request), e => e.mutationState === 'NONE');
      assert.deepEqual(tree(source), before); assert.equal(tree(target), null);
    } else {
      assert.equal(scenario, 'success');
      try { receipt = await mover.move(request); } catch (e) { failure = e; }
      if (failure?.code === 'ATOMIC_MOVE_UNSUPPORTED') {
        assert.equal(failure.mutationState, 'NONE'); assert.deepEqual(tree(source), before); assert.equal(tree(target), null);
        assert.fail('ATOMIC_TARGET_VOLUME_UNPROVEN: explicit refusal is safe, but no required positive move was proved');
      }
      if (failure) throw failure;
      assert.deepEqual(receipt.movedDirectory, expectedDirectory);
      assert.equal(receipt.fromName, 'source'); assert.equal(receipt.toName, 'target');
      assert.deepEqual(tree(target), before); assert.equal(tree(source), null);
      assert.ok(evidence.primitiveCalls > 0, 'success must use OWN shipped native primitive');
    }
    if (!scenario.startsWith('parent-') && !scenario.startsWith('commit-')) assert.deepEqual(tree(join(parentPath, 'neighbour')), neighbour);
    evidence.receipt = receipt; evidence.failure = failure && { code: failure.code, message: failure.message, mutationState: failure.mutationState, details: failure.details };
    evidence.proven = true;
  } finally {
    stopCommitObserver?.();
    await mover?.close(); process.dlopen = realDlopen;
    builtinFS.renameSync = actualRenameSync; builtinFS.rename = actualCallbackRename; promiseFS.rename = actualRename; syncBuiltinESMExports();
    fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(evidence, null, 2));
  }
  assert.ok(evidence.openedParents > 0, 'mover must hold OWN native parent handle');
  assert.equal(evidence.closedParents, evidence.openedParents, 'close releases every OWN parent handle exactly once');
  return evidence;
}

async function trustProbe({ modulePath, parentPath, evidencePath }) {
  const calls = [], before = tree(parentPath), realDlopen = process.dlopen;
  process.dlopen = function (_module, path) {
    calls.push(String(path));
    // Rejection tests must reject in JS before executing any untrusted code.
    throw Error('UNTRUSTED_NATIVE_DLOPEN_REACHED');
  };
  let failure;
  try {
    try { const { openAtomicMover } = await requireMover(modulePath); await openAtomicMover({ parentPath }); }
    catch (e) { failure = e; }
    assert.ok(failure, 'corrupted/untrusted native release must refuse');
    assert.match(failure.code ?? failure.message, /^ATOMIC_NATIVE_(?:TRUST_INVALID|UNAVAILABLE|PLATFORM_UNSUPPORTED|ABI_UNSUPPORTED)/);
    assert.equal(failure.mutationState, 'NONE');
    assert.deepEqual(calls, [], 'trust checks must run before dlopen');
    assert.deepEqual(tree(parentPath), before, 'trust refusal must not move or probe caller directories');
  } finally {
    process.dlopen = realDlopen;
    fs.writeFileSync(evidencePath, JSON.stringify({ calls, failure: { code: failure?.code, message: failure?.message, mutationState: failure?.mutationState } }, null, 2));
  }
}
if (process.argv[2] === '--probe' || process.argv[2] === '--trust') {
  try { const result = await (process.argv[2] === '--probe' ? probe : trustProbe)(JSON.parse(process.argv[3])); console.log(JSON.stringify(result ?? { proven: true })); }
  catch (e) { console.error(e.stack); process.exitCode = 1; }
}
