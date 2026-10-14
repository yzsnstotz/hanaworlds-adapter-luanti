// Q-265: observe genuine Node operations; do not implement/delete a world here.
import assert from 'node:assert/strict';
import builtinFS from 'node:fs';
import promiseFS from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

export function observeNodeRenames(t, after) {
  const actualSync = builtinFS.renameSync, actualAsync = promiseFS.rename;
  const sync = t.mock.method(builtinFS, 'renameSync', function (from, to) {
    const result = actualSync.call(this, from, to);
    const observed = after({ from: String(from), to: String(to), result, api: 'renameSync' });
    assert.equal(typeof observed?.then, 'undefined', 'synchronous Node observation must not create an unawaited actor');
    return result;
  });
  const async = t.mock.method(promiseFS, 'rename', async function (from, to) {
    const result = await actualAsync.call(this, from, to);
    await after({ from: String(from), to: String(to), result, api: 'rename' });
    return result;
  });
  syncBuiltinESMExports();
  return () => { sync.mock.restore(); async.mock.restore(); syncBuiltinESMExports(); };
}
