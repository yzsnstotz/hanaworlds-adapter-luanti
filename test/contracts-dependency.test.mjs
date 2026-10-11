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
test('contracts come from the contract source release tag and the installed version is that tag', () => {
  const r = verify(); assert.equal(r.exit, 0, JSON.stringify(r)); assert.equal(r.ok, true);
  assert.match(r.tag, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});
for (const [name, mutate] of [
  ['exact tag tarball', dependency('https://codeload.github.com/yzsnstotz/hanaworlds-contracts/tar.gz/refs/tags/v2.0.0')],
  ['commit pin', dependency(`${SOURCE}#3377ea81513d9a9446dccd4b626b4bfc183dc711`)],
  ['workspace link', dependency('file:../hanaworlds-contracts')],
  ['vendor copy', dir => mkdirSync(join(dir, 'vendor/hanaworlds-contracts'), { recursive: true })],
  // The #semver: range form is no longer accepted: the dependency is the published tag.
  ['semver range of the installed major', dependency(`${SOURCE}#semver:^2.0.0`)],
  ['github shorthand of the same tag', dependency('github:yzsnstotz/hanaworlds-contracts#v2.0.0')],
  // Installed is the formal 2.8.0: any other tag must refuse it.
  ['a later release tag', dependency(`${SOURCE}#v2.8.1`)],
  ['the old major tag', dependency(`${SOURCE}#v1.0.0`)],
  ['a prerelease tag of the same X.Y.Z', dependency(`${SOURCE}#v2.8.0-rc.3`)],
]) test(`tag verification refuses ${name}`, () => { const r = verify(mutate); assert.equal(r.exit, 1); assert.equal(r.ok, false); });
