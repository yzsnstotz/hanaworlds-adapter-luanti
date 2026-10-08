// Verify installed formal dependency offline; --source also verifies public tag
// objects and repacks its installed source to the exact admitted npm artifact.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED, MANIFEST, RUNTIME_ENTRIES } from './contracts-pin.mjs';
import { importClosure, sha256 } from './contracts-pack.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
let installed = null, source = null;
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST)));
  for (const [key, value] of Object.entries(PINNED))
    if (manifest[key] !== value) problems.push(`manifest ${key} differs from formal pin`);
  if (manifest.entries.length !== PINNED.entryCount) problems.push('wrong entry count');
  if (pkg.imports?.['#contracts'] !== PINNED.name || pkg.dependencies?.[PINNED.name] !== PINNED.source)
    problems.push('dependency/import does not name published tag');
  const item = lock.packages?.[`node_modules/${PINNED.name}`];
  if (lock.packages?.['']?.dependencies?.[PINNED.name] !== PINNED.source ||
      item?.version !== PINNED.version || item?.resolved !== PINNED.source || !item?.integrity)
    problems.push('lock does not pin exact tag dependency and integrity');
  if (existsSync(join(root, 'vendor/hanaworlds-contracts'))) problems.push('contracts vendor copy is forbidden');
  installed = dirname(fileURLToPath(import.meta.resolve('hanaworlds-contracts/package.json')));
  const meta = JSON.parse(readFileSync(join(installed, 'package.json')));
  if (meta.name !== PINNED.name || meta.version !== PINNED.version) problems.push('installed exact package differs');
  const paths = new Set();
  for (const entry of manifest.entries) {
    if (paths.has(entry.path) || entry.path.startsWith('/') || entry.path.split('/').includes('..'))
      throw Error('INVALID_MANIFEST_ENTRY');
    paths.add(entry.path);
    const path = join(installed, entry.path);
    if (!existsSync(path)) { problems.push(`missing ${entry.path}`); continue; }
    const bytes = readFileSync(path);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) problems.push(`changed ${entry.path}`);
  }
  for (const path of importClosure(installed, RUNTIME_ENTRIES))
    if (!paths.has(path)) problems.push(`unadmitted runtime module ${path}`);
  if (process.argv.includes('--source')) {
    const refs = execFileSync('git', ['ls-remote', 'https://github.com/yzsnstotz/hanaworlds-contracts.git',
      `refs/tags/${PINNED.tag}`, `refs/tags/${PINNED.tag}^{}`], { encoding: 'utf8' });
    const pairs = new Map(refs.trim().split('\n').map(line => line.split(/\s+/).reverse()));
    const tagMatches = pairs.get(`refs/tags/${PINNED.tag}`) === PINNED.tagObject &&
      pairs.get(`refs/tags/${PINNED.tag}^{}`) === PINNED.revision;
    if (!tagMatches) problems.push('public annotated/peeled tag differs');
    const work = mkdtempSync(join(tmpdir(), 'hw-contracts-formal-'));
    try {
      const out = JSON.parse(execFileSync('npm', ['pack', installed, '--ignore-scripts',
        '--pack-destination', work, '--json'], { encoding: 'utf8' }));
      const bytes = readFileSync(join(work, out[0].filename));
      source = { tagMatches, packSha256: sha256(bytes), packBytes: bytes.length };
      if (source.packSha256 !== PINNED.sha256 || source.packBytes !== PINNED.bytes)
        problems.push('installed tag repack differs from formal artifact');
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
} catch (error) { problems.push(error.message); }
const ok = problems.length === 0;
console.log(JSON.stringify({ ...PINNED, installed, publishedSource: source, ok, problems }));
if (!ok) process.exitCode = 1;
