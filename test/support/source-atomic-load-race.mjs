// A real loader is called, even in rejection cases. No fake dlopen refusal.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tree, requireMover } from './source-atomic-probe.mjs';

const { mode, modulePath, artifactPath, hostilePath, parentPath, evidencePath, expectedProfile } = JSON.parse(process.argv[2]);
const marker = join(dirname(evidencePath), 'foreign-execution.marker');
process.env.SOURCE_ATOMIC_ATTACK_MARKER = marker;
const evidence = { mode, marker, realDlopenCalls: 0, actorReached: false, moves: 0 };
const real = process.dlopen;
let failure, rawError, mover, originalTree, foreignTree;
try {
  if (mode === 'control') {
    const module = { exports: {} };
    real(module, hostilePath);
    assert.equal(module.exports.foreignCodeExecuted, true);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'UNTRUSTED_NATIVE_EXECUTED\n');
    evidence.validExecutableFixture = true;
  } else {
    const before = tree(parentPath);
    process.dlopen = function (nativeModule, filename, ...flags) {
      assert.equal(evidence.actorReached, false, 'one actual own load point');
      evidence.actorReached = true;
      // At entry to the real load call, all preceding JS hash checks have
      // finished. A second hash inside this observer would invalidate the test.
      const source = mode === 'binary' ? artifactPath : dirname(artifactPath);
      const saved = source + '.captured-original';
      originalTree = tree(source);
      fs.renameSync(source, saved);
      if (mode === 'parent') {
        fs.mkdirSync(source);
        fs.copyFileSync(hostilePath, artifactPath);
        fs.writeFileSync(join(source, 'new-owner'), 'new parent owner');
      } else fs.copyFileSync(hostilePath, artifactPath);
      foreignTree = tree(source);
      evidence.savedPath = saved; evidence.replacementPath = source;
      evidence.loadPath = String(filename);
      evidence.realDlopenCalls++;
      try {
        const result = real.call(this, nativeModule, filename, ...flags);
        evidence.loadedExports = Object.keys(nativeModule.exports);
        const binding = nativeModule.exports;
        assert.notEqual(binding.foreignCodeExecuted, true, 'replacement initializer must not execute');
        if (typeof binding.moveDirectoryNoReplace === 'function') {
          const genuineMove = binding.moveDirectoryNoReplace;
          binding.moveDirectoryNoReplace = function (...args) { evidence.moves++; return genuineMove.apply(this, args); };
        }
        return result;
      } catch (error) { rawError = error; throw error; }
    };
    try {
      const { openAtomicMover } = await requireMover(modulePath);
      mover = await openAtomicMover({ parentPath });
      const { loadAtomicNative } = await import(pathToFileURL(join(dirname(modulePath), 'source-atomic-native.mjs')).href);
      const binding = await loadAtomicNative();
      assert.equal(binding.runtimeProfile, expectedProfile, 'success must load the original bound trusted image');
    } catch (error) { failure = error; }
    assert.equal(evidence.actorReached, true, 'the verified-byte -> real dlopen window must actually be reached');
    assert.equal(evidence.realDlopenCalls, 1, 'observer must invoke the genuine OS loader');
    assert.equal(fs.existsSync(marker), false, 'replacement code must not execute even if later identity checks fail');
    assert.equal(evidence.moves, 0); assert.deepEqual(tree(parentPath), before, 'caller worlds and neighbours remain byte/identity exact');
    assert.deepEqual(tree(evidence.savedPath), originalTree);
    assert.deepEqual(tree(evidence.replacementPath), foreignTree);
    if (failure) {
      assert.match(failure.code ?? failure.message, /^ATOMIC_NATIVE_(?:TRUST_INVALID|UNAVAILABLE)/);
      assert.equal(failure.mutationState, 'NONE');
      if (rawError) {
        let cursor = failure;
        while (cursor && cursor !== rawError) cursor = cursor.cause;
        assert.equal(cursor, rawError, 'original actual loader failure must survive unchanged or as exact cause');
      }
      evidence.terminal = 'REJECTED_NONE';
    } else {
      assert.ok(mover, 'safe success must hold original verified bytes, not always reject');
      evidence.terminal = 'BOUND_ORIGINAL_SUCCESS';
    }
  }
  evidence.proven = true;
} finally {
  await mover?.close(); process.dlopen = real;
  evidence.failure = failure && { code: failure.code, message: failure.message, mutationState: failure.mutationState };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
}
