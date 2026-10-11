// Verify, offline, that contracts come from the contract source as the published release tag
// (git+https://…/hanaworlds-contracts.git#vX.Y.Z — no #semver: range, vendor copy,
// tarball/commit pin or workspace link), that the lock resolves that tag from the contract
// source git repository, and that the installed package is exactly the tagged version and
// passes the SDK's own major predicate.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const NAME = 'hanaworlds-contracts';
const SOURCE = 'git+https://github.com/yzsnstotz/hanaworlds-contracts.git';
const SPEC = new RegExp(`^${SOURCE.replace(/[.+]/g, '\\$&')}#v(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)$`);
const LOCKED = /^git\+(?:ssh:\/\/git@|https:\/\/)github\.com\/yzsnstotz\/hanaworlds-contracts\.git#[0-9a-f]{40}$/;
const root = fileURLToPath(new URL('..', import.meta.url));
const supply=JSON.parse(readFileSync(join(root,'scripts/contracts-source.json')));
const problems = [];
let tag = null, installed = null, locked = null;
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  const spec = pkg.devDependencies?.[NAME];
  if (pkg.dependencies?.[NAME] || pkg.optionalDependencies?.[NAME] || pkg.peerDependencies?.[NAME]) problems.push('contracts must be development-only');
  const m = SPEC.exec(spec ?? '');
  if (!m) problems.push(`dependency must be ${SOURCE}#vX.Y.Z[-pre], got ${spec}`);
  else tag = m[1];
  if (pkg.imports?.['#contracts'] !== './dist/runtime/contracts.mjs') problems.push('#contracts must resolve the local compiled SDK');
  if (existsSync(join(root, 'vendor', NAME))) problems.push('contracts vendor copy is forbidden');
  if (lock.packages?.['']?.devDependencies?.[NAME] !== spec) problems.push('lock root dependency differs from package.json');
  if (lock.packages?.['']?.dependencies?.[NAME]) problems.push('lock root contracts must be development-only');
  const item = lock.packages?.[`node_modules/${NAME}`];
  if (item?.dev !== true) problems.push('locked contracts must be development-only');
  locked = item ? { version: item.version, resolved: item.resolved } : null;
  if (!item || item.link || !LOCKED.test(item.resolved ?? '')) problems.push('lock must resolve the contract source git repository');
  if (tag && ('v'+tag!==supply.tag || !item?.resolved?.endsWith('#'+supply.commit))) problems.push('locked source differs from the verified published tag');
  if (tag && item?.version !== tag) problems.push(`lock resolves ${item?.version}, not the pinned tag v${tag}`);
  installed = dirname(fileURLToPath(import.meta.resolve(`${NAME}/package.json`)));
  const meta = JSON.parse(readFileSync(join(installed, 'package.json')));
  if (meta.name !== NAME || meta.version !== item?.version) problems.push('installed package differs from lock');
  if (tag && meta.version !== tag) problems.push(`installed ${meta.version} is not the pinned tag v${tag}`);
  for(const [path,expected] of Object.entries(supply.sha256)) {
    const actual=createHash('sha256').update(readFileSync(join(installed,path))).digest('hex');
    if(actual!==expected) problems.push(`tagged source content mismatch: ${path}`);
  }
  const sdk = await import(NAME);
  sdk.checkContractsVersion(sdk.contractHandshake.contracts);
  installed = { path: installed, version: meta.version, handshake: sdk.contractHandshake.contracts };
} catch (error) { problems.push(error.message); }
const ok = problems.length === 0;
console.log(JSON.stringify({ name: NAME, source: SOURCE, tag, locked, installed, ok, problems }));
if (!ok) process.exitCode = 1;
