import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git';
function verify(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-contracts-range-test-'));
  try {
    for (const name of ['scripts', 'node_modules', 'package.json', 'package-lock.json'])
      cpSync(join(root, name), join(dir, name), { recursive: true });
    mutate?.(dir);
    const run = spawnSync(process.execPath, ['scripts/verify-contracts-range.mjs'], { cwd: dir, encoding: 'utf8' });
    return { exit: run.status, ...JSON.parse(run.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const edit = (file, change) => dir => { const p = join(dir, file); const v = JSON.parse(readFileSync(p)); change(v); writeFileSync(p, JSON.stringify(v)); };
const dependency = spec => dir => {
  edit('package.json', v => { v.dependencies['hanaworlds-contracts'] = spec; })(dir);
  edit('package-lock.json', v => { v.packages[''].dependencies['hanaworlds-contracts'] = spec; })(dir);
};
test('contracts come from the contract source git semver range and the installed version satisfies it', () => {
  const r = verify(); assert.equal(r.exit, 0, JSON.stringify(r)); assert.equal(r.ok, true);
  assert.match(r.range, /^\^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});
for (const [name, mutate] of [
  ['exact tag tarball', dependency('https://codeload.github.com/yzsnstotz/hanaworlds-contracts/tar.gz/refs/tags/v0.5.6')],
  ['commit pin', dependency(`${SOURCE}#f84974eb07e30b683f4c1b1712145b756d5671ed`)],
  ['workspace link', dependency('file:../hanaworlds-contracts')],
  ['vendor copy', dir => mkdirSync(join(dir, 'vendor/hanaworlds-contracts'), { recursive: true })],
  // Installed is a 1.0.0 prerelease (rc.3): a later prerelease, the plain release, the old
  // major and a different X.Y.Z prerelease lower bound must all refuse it.
  ['installed below a later prerelease', dependency(`${SOURCE}#semver:^1.0.0-rc.4`)],
  ['prerelease below a release bound', dependency(`${SOURCE}#semver:^1.0.0`)],
  ['installed outside the old major', dependency(`${SOURCE}#semver:^0.5.6`)],
  ['prerelease of another X.Y.Z', dependency(`${SOURCE}#semver:^0.9.0-rc.1`)],
]) test(`range verification refuses ${name}`, () => { const r = verify(mutate); assert.equal(r.exit, 1); assert.equal(r.ok, false); });
