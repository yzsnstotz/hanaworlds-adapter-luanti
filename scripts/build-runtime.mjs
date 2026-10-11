// Preserve module/resource layout and native implementation; lower the private development
// alias to a plugin-local generated value module for every production runtime entry.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const runtime = new URL('dist/runtime/', root);
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
const names = new Set();
const artifactHashes = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of (await readdir(new URL('src/', root))).filter(x => x.endsWith('.mjs')).sort()) {
 const source = await readFile(new URL(`src/${file}`, root), 'utf8');
 for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]#contracts['"]/g))
  for (const spec of m[1].split(',')) names.add(spec.trim().split(/\s+as\s+/)[0]);
 const compiled = source.replace(/(['"])#contracts\1/g, "'./contracts.mjs'")
  .replace(/(['"])\.\.\/fixtures\//g, '$1../../fixtures/')
  .replace(/(['"])\.\.\/payload\//g, '$1../../payload/');
 await writeFile(new URL(file, runtime), compiled);
 artifactHashes[`dist/runtime/${file}`] = hash(compiled);
}
const result = await build({stdin: { contents: `export { ${[...names].sort().join(', ')} } from 'hanaworlds-contracts';`, resolveDir: new URL('.',root).pathname, sourcefile: 'adapter-contract-values.mjs' },
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
for(const name of ['dist/contracts-LICENSE','dist/contracts-NOTICE']) artifactHashes[name]=hash(await readFile(new URL(name,root)));
const supply=JSON.parse(await readFile(new URL('scripts/contracts-source.json',root)));
const inputHashes={};
for(const path of Object.keys(result.metafile.inputs)) {
 if(!path.includes('node_modules/hanaworlds-contracts/'))continue;
 const relative=path.split('node_modules/hanaworlds-contracts/')[1];
 if(!supply.sha256[relative])throw Error('UNVERIFIED_BUILD_INPUT:'+relative);
 inputHashes[relative]=supply.sha256[relative];
}
const source = JSON.parse(await readFile(new URL('dist/contracts-build.json',root)));
await writeFile(new URL('dist/runtime-build.json',root),JSON.stringify({sourceVersion:source.sourceVersion,sourceResolved:source.sourceResolved,sourceTag:'v'+source.sourceVersion,
 sourceTagObject:supply.tagObject, sourceCommit:supply.commit, sourceInputs:inputHashes, builder:source.builder, contractExports:[...names].sort(),externalImports:[...new Set(external)].sort(),sha256:artifactHashes},null,2)+'\n');
console.log(`Generated ${Object.keys(artifactHashes).length} Adapter artifacts; ${names.size} contract values selected by source imports.`);
