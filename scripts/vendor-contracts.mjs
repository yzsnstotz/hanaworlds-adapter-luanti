// Regenerates vendor/hanaworlds-contracts from the admitted contracts npm-pack
// tarball: verifies its sha256, writes a manifest of all package entries and
// copies only the bundled subset (metadata/notices, runtime closure, test
// fixtures) byte-for-byte. Usage: node scripts/vendor-contracts.mjs <tarball>
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PINNED, METADATA, RUNTIME_ENTRIES, TEST_FIXTURES, VENDOR_DIR, MANIFEST } from './contracts-pin.mjs';
import { extractPack, importClosure, sha256 } from './contracts-pack.mjs';

const tarball = process.argv[2];
if (!tarball) throw new Error('usage: vendor-contracts.mjs <admitted contracts tarball>');
const digest = sha256(readFileSync(tarball));
if (digest !== PINNED.sha256) throw new Error(`tarball sha256 ${digest} is not the admitted ${PINNED.sha256}`);
const { dir, root, entries } = extractPack(tarball);
try {
  if (entries.length !== PINNED.entryCount) throw new Error(`expected ${PINNED.entryCount} entries, got ${entries.length}`);
  const vendored = [...new Set([...METADATA, ...importClosure(root, RUNTIME_ENTRIES), ...TEST_FIXTURES])].sort();
  const byPath = new Map(entries.map(e => [e.path, e]));
  for (const path of vendored) if (!byPath.has(path)) throw new Error(`${path} is not in the admitted package`);
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  for (const path of vendored) {
    mkdirSync(dirname(join(VENDOR_DIR, path)), { recursive: true });
    copyFileSync(join(root, path), join(VENDOR_DIR, path));
  }
  writeFileSync(MANIFEST, `${JSON.stringify({ ...PINNED, note:
    'Every entry of the admitted package; only `vendored` paths are bundled, byte-identical to their entry.',
    vendored, entries }, null, 1)}\n`);
  console.log(JSON.stringify({ ok: true, entries: entries.length, vendored: vendored.length }));
} finally { rmSync(dir, { recursive: true, force: true }); }
