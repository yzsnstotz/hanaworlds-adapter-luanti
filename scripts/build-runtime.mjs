// Preserve module/resource layout and native implementation; lower the private development
// alias to a plugin-local generated value module for every production runtime entry.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const runtime = new URL('dist/runtime/', root);
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
const names = new Set(['wireVersions','operationContracts','digestProfile','placementInvariants']);
const artifactHashes = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of (await readdir(new URL('src/', root))).filter(x => x.endsWith('.mjs')).sort()) {
 const source = await readFile(new URL(`src/${file}`, root), 'utf8');
 for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]#contracts['"]/g))
  for (const spec of m[1].split(',')) names.add(spec.trim().split(/\s+as\s+/)[0]);
 const compiled = source.replace(/(['"])#contracts\1/g, "'./contracts.mjs'")
  .replace(/(['"])\.\.\/fixtures\//g, '$1../../fixtures/')
  .replace(/(['"])\.\.\/payload\//g, '$1../../payload/')
  .replace(/(['"])\.\.\/(NOTICE|LICENSE)\1/g, '$1../../$2$1');
 await writeFile(new URL(file, runtime), compiled);
 artifactHashes[`dist/runtime/${file}`] = hash(compiled);
}
const generatedEntry=`export { ${[...names].sort().join(', ')} } from './src/protocol/values.mjs';`;
const result = await build({stdin: { contents: generatedEntry, resolveDir: new URL('.',root).pathname, sourcefile: 'adapter-contract-values.mjs' },
 outfile: new URL('contracts.mjs', runtime).pathname, bundle:true, platform:'node', format:'esm', target:'node24',
 external:['canonicalize'], metafile:true, legalComments:'inline' });
const external = Object.values(result.metafile.outputs).flatMap(x=>x.imports).filter(x=>x.external).map(x=>x.path);
if (external.some(x=>!x.startsWith('node:') && x!=='canonicalize')) throw Error('UNEXPECTED_ADAPTER_RUNTIME_EXTERNAL');
artifactHashes['dist/runtime/contracts.mjs'] = hash(await readFile(new URL('contracts.mjs', runtime)));
for(const directory of ['dist/contracts-types/','fixtures/','payload/']) {
 async function assets(path) { for(const row of await readdir(new URL(path,root),{withFileTypes:true})) {
 const name=path+row.name; if(row.isDirectory())await assets(name+'/');else artifactHashes[name]=hash(await readFile(new URL(name,root)));
 }}
 await assets(directory);
}
await writeFile(new URL('dist/protocol-source.json',root),await readFile(new URL('scripts/protocol-source.json',root)));
artifactHashes['dist/protocol-source.json']=hash(await readFile(new URL('dist/protocol-source.json',root)));
for(const name of ['dist/contracts-LICENSE','dist/contracts-NOTICE']) artifactHashes[name]=hash(await readFile(new URL(name,root)));
for(const name of ['NOTICE','LICENSE']) artifactHashes[name]=hash(await readFile(new URL(name,root)));
for(const file of (await readdir(new URL('src/',root))).filter(n=>n.endsWith('.d.ts')))artifactHashes['src/'+file]=hash(await readFile(new URL('src/'+file,root)));
const supply=JSON.parse(await readFile(new URL('scripts/protocol-source.json',root)));
const inputHashes={};
for(const path of Object.keys(result.metafile.inputs)) {
 if(path==='adapter-contract-values.mjs')continue;
 if(!path.startsWith('src/protocol/'))throw Error('UNVERIFIED_BUILD_INPUT:'+path);
 if(!supply.sha256[path]||hash(await readFile(new URL(path,root)))!==supply.sha256[path])throw Error('BUILD_INPUT_DIGEST_MISMATCH:'+path);
 inputHashes[path]=supply.sha256[path];
}
const source=JSON.parse(await readFile(new URL('dist/contracts-build.json',root)));
await writeFile(new URL('dist/runtime-build.json',root),JSON.stringify({owner:source.owner,mechanism:source.mechanism,
 sourceInputs:inputHashes,generatedEntrySHA256:hash(generatedEntry),protocolSourceSHA256:hash(await readFile(new URL('scripts/protocol-source.json',root))),
 builder:source.builder,contractExports:[...names].sort(),externalImports:[...new Set(external)].sort(),sha256:artifactHashes},null,2)+'\n');
console.log(`Generated ${Object.keys(artifactHashes).length} Adapter artifacts; ${names.size} protocol values selected by source imports.`);
