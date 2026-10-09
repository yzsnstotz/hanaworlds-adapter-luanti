// Verify, offline, that contracts come from the contract source as a git semver range
// (no vendor copy, tarball/commit pin or workspace link) and that the installed
// package satisfies that range by npm semantics and the SDK's own major predicate.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const NAME = 'hanaworlds-contracts';
const SOURCE = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git';
const SPEC = new RegExp(`^${SOURCE.replace(/[.+]/g, '\\$&')}#semver:\\^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$`);
const LOCKED = /^git\+(?:ssh:\/\/git@|https:\/\/)github\.com\/yzsnstotz\/hanaworlds-contracts\.git#[0-9a-f]{40}$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
// semver prerelease precedence: dot identifiers, numeric ones compared numerically and lower
// than alphanumeric ones; a shorter equal prefix is lower.
function comparePre(a, b) {
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny) { const d = Number(x[i]) - Number(y[i]); if (d) return d; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
// npm caret: ^X.Y.Z with X>0 allows <X+1; ^0.Y.Z allows <0.(Y+1). A prerelease version
// satisfies only a range whose lower bound is a prerelease of the same X.Y.Z, at or above it.
function satisfiesCaret(version, [x, y, z], pre = null) {
  const m = VERSION.exec(version);
  if (!m) return false;
  const v = m.slice(1, 4).map(Number), cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const vpre = version.includes('-') ? version.slice(version.indexOf('-') + 1) : null;
  if (vpre !== null) return pre !== null && cmp(v, [x, y, z]) === 0 && comparePre(vpre, pre) >= 0;
  if (cmp(v, [x, y, z]) < 0) return false;
  return x > 0 ? v[0] === x : y > 0 ? v[0] === 0 && v[1] === y : v[0] === 0 && v[1] === 0 && v[2] === z;
}
const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let range = null, installed = null, locked = null;
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  const spec = pkg.dependencies?.[NAME];
  const m = SPEC.exec(spec ?? '');
  if (!m) problems.push(`dependency must be ${SOURCE}#semver:^X.Y.Z[-pre], got ${spec}`);
  else range = `^${m[1]}.${m[2]}.${m[3]}${m[4] ? '-' + m[4] : ''}`;
  if (pkg.imports?.['#contracts'] !== NAME) problems.push('#contracts must name the installed package');
  if (existsSync(join(root, 'vendor', NAME))) problems.push('contracts vendor copy is forbidden');
  if (lock.packages?.['']?.dependencies?.[NAME] !== spec) problems.push('lock root dependency differs from package.json');
  const item = lock.packages?.[`node_modules/${NAME}`];
  locked = item ? { version: item.version, resolved: item.resolved } : null;
  if (!item || item.link || !LOCKED.test(item.resolved ?? '')) problems.push('lock must resolve the contract source git repository');
  installed = dirname(fileURLToPath(import.meta.resolve(`${NAME}/package.json`)));
  const meta = JSON.parse(readFileSync(join(installed, 'package.json')));
  if (meta.name !== NAME || meta.version !== item?.version) problems.push('installed package differs from lock');
  if (m && !satisfiesCaret(meta.version, m.slice(1, 4).map(Number), m[4] ?? null)) problems.push(`installed ${meta.version} does not satisfy ${range}`);
  const sdk = await import(NAME);
  sdk.checkContractsVersion(sdk.contractHandshake.contracts);
  installed = { path: installed, version: meta.version, handshake: sdk.contractHandshake.contracts };
} catch (error) { problems.push(error.message); }
const ok = problems.length === 0;
console.log(JSON.stringify({ name: NAME, source: SOURCE, range, locked, installed, ok, problems }));
if (!ok) process.exitCode = 1;
