// Shared helpers: read an npm-pack tarball's entries, and the static relative
// import closure of ESM entry modules inside a package directory.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function extractPack(tarball) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-contracts-pack-'));
  execFileSync('tar', ['-xzf', tarball, '-C', dir]);
  const root = join(dir, 'package');
  const entries = [];
  const walk = d => { for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else { const bytes = readFileSync(p); entries.push({ path: relative(root, p), size: bytes.length, sha256: sha256(bytes) }); }
  } };
  walk(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { dir, root, entries };
}
const IMPORT = /(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gs;
export function importClosure(root, entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = normalize(stack.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    const path = join(root, file);
    if (!existsSync(path)) continue;  // reported by the caller as missing
    for (const m of readFileSync(path, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) stack.push(join(dirname(file), spec));
      else if (!/^(node:|canonicalize$)/.test(spec)) throw new Error(`unexpected import ${spec} in ${file}`);
    }
  }
  return [...seen].sort();
}
