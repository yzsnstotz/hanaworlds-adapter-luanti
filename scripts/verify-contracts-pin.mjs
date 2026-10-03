// Verifies the bundled hanaworlds-contracts subset against the admitted
// contracts@0.3.0 artifact (sha256 47a2e5cc…). Offline (default): the manifest
// names the admitted digest and all 923 entries; every bundled file must be a
// manifest entry with identical bytes, nothing else may be bundled, and the
// static import closure of the #contracts entries must be bundled.
// --source [tarball]: additionally re-derive the admitted pack from public
// source (codeload at the pinned revision, or a given source tarball) with
// `npm pack`, require the pinned sha256 and that the manifest equals it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PINNED, RUNTIME_ENTRIES, VENDOR_DIR, MANIFEST } from './contracts-pin.mjs';
import { extractPack, importClosure, sha256 } from './contracts-pack.mjs';

const problems = [];
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const key of ['name', 'version', 'revision', 'sha256', 'entryCount'])
  if (manifest[key] !== PINNED[key]) problems.push(`manifest ${key} ${manifest[key]} != ${PINNED[key]}`);
if (manifest.entries.length !== PINNED.entryCount) problems.push(`manifest lists ${manifest.entries.length} entries`);
const byPath = new Map(manifest.entries.map(e => [e.path, e]));
const bundled = [];
const walk = d => { for (const name of readdirSync(d)) {
  const p = join(d, name);
  if (statSync(p).isDirectory()) walk(p); else bundled.push(relative(VENDOR_DIR, p));
} };
walk(VENDOR_DIR);
bundled.sort();
if (JSON.stringify(bundled) !== JSON.stringify(manifest.vendored)) problems.push('bundled files differ from manifest.vendored');
for (const path of bundled) {
  const entry = byPath.get(path);
  const bytes = readFileSync(join(VENDOR_DIR, path));
  if (!entry) problems.push(`${path} is not an admitted package entry`);
  else if (entry.size !== bytes.length || entry.sha256 !== sha256(bytes)) problems.push(`${path} bytes differ from the admitted entry`);
}
for (const path of importClosure(VENDOR_DIR, RUNTIME_ENTRIES))
  if (!bundled.includes(path)) problems.push(`runtime module ${path} is not bundled`);

let source = null;
const at = process.argv.indexOf('--source');
if (at >= 0) {
  const work = mkdtempSync(join(tmpdir(), 'hw-contracts-source-'));
  try {
    let srcTarball = process.argv[at + 1];
    if (!srcTarball || srcTarball.startsWith('--')) {
      srcTarball = join(work, 'source.tgz');
      const response = await fetch(PINNED.source);
      if (!response.ok) throw new Error(`source fetch ${response.status}`);
      writeFileSync(srcTarball, Buffer.from(await response.arrayBuffer()));
    }
    execFileSync('tar', ['-xzf', srcTarball, '-C', work]);
    const srcDir = join(work, readdirSync(work).find(n => n.startsWith('hanaworlds-contracts')));
    const out = JSON.parse(execFileSync('npm', ['pack', srcDir, '--ignore-scripts',
      '--pack-destination', work, '--json'], { encoding: 'utf8' }));
    const packed = join(work, out[0].filename);
    const digest = sha256(readFileSync(packed));
    const { dir, entries } = extractPack(packed);
    rmSync(dir, { recursive: true, force: true });
    const same = JSON.stringify(entries) === JSON.stringify(manifest.entries);
    source = { sourceTarballSha256: sha256(readFileSync(srcTarball)), packSha256: digest, manifestMatchesPack: same };
    if (digest !== PINNED.sha256) problems.push(`source pack sha256 ${digest} != ${PINNED.sha256}`);
    if (!same) problems.push('manifest entries differ from the source pack');
  } finally { rmSync(work, { recursive: true, force: true }); }
}
const ok = problems.length === 0;
console.log(JSON.stringify({ version: PINNED.version, revision: PINNED.revision, sha256: PINNED.sha256,
  bundledFiles: bundled.length, manifestEntries: manifest.entries.length, source, ok, problems }));
if (!ok) process.exitCode = 1;
