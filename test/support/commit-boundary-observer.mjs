// D-154 observation requirement, not an implementation of identity binding.
// The callback is invoked by the genuine native code AFTER its final identity
// check and BEFORE its real rename commit. Its return value has no authority.
// Auditing the shipped native call site is necessary: moving this notification
// before a later stat would merely move the same uncovered race window.
import assert from 'node:assert/strict';

export function observeCommitBoundary(binding, actor) {
  assert.equal(typeof binding.observeCommitBoundary, 'function',
    'ATOMIC_COMMIT_OBSERVER_MISSING: observe the last native identity check -> real commit, not whole-call before/after');
  const stop = binding.observeCommitBoundary(event => {
    assert.equal(event.phase, 'AFTER_FINAL_IDENTITY_CHECK_BEFORE_COMMIT');
    assert.equal(typeof event.fromName, 'string');
    assert.equal(typeof event.toName, 'string');
    for (const identity of [event.verifiedDirectory, event.verifiedParent]) {
      assert.equal(typeof identity?.device, 'string');
      assert.equal(typeof identity?.inode, 'string');
    }
    actor(event); // Actor changes real FS only; cannot replace commit/receipt.
  });
  assert.equal(typeof stop, 'function', 'observer subscription must be removable');
  return stop;
}
