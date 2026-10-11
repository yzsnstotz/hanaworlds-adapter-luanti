// Compile the pinned development SDK into one plugin-local runtime module.
// No contract-repository package is needed by an installed production tarball.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['scripts/verify-contracts-range.mjs'], { cwd: root, stdio: 'inherit' });
const source = dirname(fileURLToPath(import.meta.resolve('hanaworlds-contracts/package.json')));
const meta = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const out = join(root, 'dist');
await mkdir(join(out, 'contracts-types'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [fileURLToPath(import.meta.resolve('hanaworlds-contracts'))],
  outfile: join(out, 'contracts.mjs'), bundle: true, platform: 'node', format: 'esm',
  target: 'node24', external: ['canonicalize'], metafile: true, legalComments: 'inline',
  banner: { js: `// Build-generated plugin runtime structures from the pinned development SDK ${meta.version}.` },
});
const external = Object.values(result.metafile.outputs).flatMap(row => row.imports).filter(row => row.external);
if (external.some(row => !row.path.startsWith('node:') && row.path !== 'canonicalize'))
  throw Error('UNEXPECTED_COMPILED_CONTRACT_DEPENDENCY');
const files = ['contracts.mjs'];
for (const name of ['index.d.ts', 'contracts.d.ts']) {
  const target = `contracts-types/${name}`;
  await writeFile(join(out, target), await readFile(join(source, 'types/local', name)));
  files.push(target);
}
for (const name of ['LICENSE', 'NOTICE']) {
  const target = `contracts-${name}`;
  await writeFile(join(out, target), await readFile(join(source, name)));
  files.push(target);
}
const hashes = Object.fromEntries(await Promise.all(files.map(async name => [name,
  createHash('sha256').update(await readFile(join(out, name))).digest('hex')])));
await writeFile(join(out, 'contracts-build.json'), JSON.stringify({
  sourceVersion: meta.version, sourceResolved: lock.packages['node_modules/hanaworlds-contracts'].resolved,
  builder: 'esbuild@0.28.2', externalImports: external.map(row => row.path), sha256: hashes,
}, null, 2) + '\n');
console.log(`Compiled plugin-local contract structures ${meta.version}; external imports: ${external.map(row => row.path).join(', ')}`);
