import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
function verify(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-formal-pin-test-'));
  try {
    for (const name of ['scripts', 'node_modules', 'package.json', 'package-lock.json'])
      cpSync(join(root, name), join(dir, name), { recursive: true });
    mutate?.(dir);
    const run = spawnSync(process.execPath, ['scripts/verify-contracts-pin.mjs'], { cwd: dir, encoding: 'utf8' });
    return { exit: run.status, ...JSON.parse(run.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('installed formal dependency matches all admitted pack entries', () => {
  const r = verify(); assert.equal(r.exit, 0, JSON.stringify(r)); assert.equal(r.ok, true);
});
for (const [name, mutate] of [
  ['changed runtime byte', dir => { const p = join(dir, 'node_modules/hanaworlds-contracts/dist/local/runtime.mjs'); writeFileSync(p, readFileSync(p, 'utf8') + '\n'); }],
  ['missing module', dir => unlinkSync(join(dir, 'node_modules/hanaworlds-contracts/dist/local/runtime.mjs'))],
  ['wrong dependency tag', dir => { const p = join(dir, 'package.json'); const v = JSON.parse(readFileSync(p)); v.dependencies['hanaworlds-contracts'] = '0.5.3'; writeFileSync(p, JSON.stringify(v)); }],
]) test(`formal verification refuses ${name}`, () => { const r = verify(mutate); assert.equal(r.exit, 1); assert.equal(r.ok, false); });
