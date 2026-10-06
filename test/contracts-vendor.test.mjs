// The bundled contracts subset is verified offline against the manifest of the
// admitted contracts@0.3.9 package; tampering of any kind is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
function verifyIn(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-vendor-verify-'));
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
    cpSync(join(root, 'vendor'), join(dir, 'vendor'), { recursive: true });
    mutate?.(dir);
    try {
      return JSON.parse(execFileSync(process.execPath, ['scripts/verify-contracts-pin.mjs'],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch (error) { return JSON.parse(error.stdout); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const V = 'vendor/hanaworlds-contracts';

test('bundled contracts subset matches the admitted package manifest', () => {
  const result = verifyIn();
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.sha256, '324ef459c78a4eb249939f4828128b87ff897d134b48d9cf8cbe6e69a6f4bbdc');
  assert.equal(result.manifestEntries, 1021);
});

for (const [label, mutate] of [
  ['a changed byte', dir => { const p = join(dir, V, 'dist/v4/index.mjs');
    writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from('\n')])); }],
  ['an extra unlisted file', dir => writeFileSync(join(dir, V, 'dist/extra.mjs'), 'export {};\n')],
  ['a missing runtime module', dir => unlinkSync(join(dir, V, 'dist/v4/runtime.mjs'))],
  ['a manifest naming another digest', dir => { const p = join(dir, 'vendor/hanaworlds-contracts.manifest.json');
    const m = JSON.parse(readFileSync(p, 'utf8')); m.sha256 = '0'.repeat(64); writeFileSync(p, JSON.stringify(m)); }],
]) {
  test(`contracts verification refuses ${label}`, () => {
    const result = verifyIn(mutate);
    assert.equal(result.ok, false);
    assert.ok(result.problems.length > 0);
  });
}
