// Installed, corrupted package observer. Setup uses official Cordis and actual
// Adapter. No world is created and no startup or write implementation is mocked.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const options = JSON.parse(process.argv[2]);
const cleanup = [], evidence = { nativeActions: [], refusal: null };
let f, error;
try {
  try {
    const { setup, ask, files, plain } = await import('./source-release-fixture.mjs');
    f = await setup({ after: callback => cleanup.push(callback) });
    const before = await files(f.worlds), actions = [...f.actions];
    try {
      const method = f.entry('readSourceReleaseMaterials');
      const d = await f.descriptor(), q = ask({ source: plain(d.source), worldRef: 'uncreated-release-trust-probe' });
      const result = await method(q);
      assert.equal(result.result, null);
      assert.equal(result.error?.code, 'ADAPTER_UNAVAILABLE', 'untrusted package release must precede unknown-world resolution');
      assert.equal(result.error.mutationState, 'NONE'); evidence.refusal = result.error;
    } catch (e) { error = e; }
    assert.deepEqual(await files(f.worlds), before, 'package release refusal must not create/repair/write any world');
    assert.deepEqual(f.actions, actions, 'package release refusal must not invoke native/runtime/lifecycle/Canvas');
    evidence.nativeActions = f.actions;
  } catch (e) { error = e; }
  if (error) {
    const publicError = error.publicError ?? error;
    assert.equal(publicError.code ?? error.message, 'ADAPTER_UNAVAILABLE');
    assert.equal(publicError.mutationState, 'NONE');
    evidence.refusal = { code: publicError.code, mutationState: publicError.mutationState };
  }
  assert.ok(evidence.refusal, 'actual corrupted release must be refused');
} finally {
  for (const callback of cleanup.reverse()) await callback();
  await writeFile(options.evidencePath, JSON.stringify(evidence, null, 2));
}
