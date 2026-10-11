// Compile Adapter-owned protocol values and declarations from audited local inputs.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),out=new URL('dist/',root);
execFileSync(process.execPath,['scripts/verify-contracts-range.mjs'],{cwd:root,stdio:'inherit'});
await mkdir(new URL('contracts-types/',out),{recursive:true});
const result=await build({absWorkingDir:root.pathname,entryPoints:['src/protocol/values.mjs'],outfile:new URL('contracts.mjs',out).pathname,
 bundle:true,platform:'node',format:'esm',target:'node24',external:['canonicalize'],metafile:true,legalComments:'inline',
 banner:{js:'// Build-generated Adapter-owned document protocol structures; Q-98/Q-99.'}});
const external=Object.values(result.metafile.outputs).flatMap(x=>x.imports).filter(x=>x.external).map(x=>x.path);
if(external.some(x=>!x.startsWith('node:')&&x!=='canonicalize'))throw Error('UNEXPECTED_COMPILED_CONTRACT_DEPENDENCY');
const files=['contracts.mjs'];
for(const name of ['index.d.ts','contracts.d.ts']){const target='contracts-types/'+name;await writeFile(new URL(target,out),await readFile(new URL('src/protocol/'+name,root)));files.push(target);}
for(const [source,target] of [['LICENSE','contracts-LICENSE'],['historical-NOTICE','contracts-NOTICE']]){await writeFile(new URL(target,out),await readFile(new URL('src/protocol/'+source,root)));files.push(target);}
const source=JSON.parse(await readFile(new URL('scripts/protocol-source.json',root)));
const hashes=Object.fromEntries(await Promise.all(files.map(async n=>[n,createHash('sha256').update(await readFile(new URL(n,out))).digest('hex')])));
await writeFile(new URL('contracts-build.json',out),JSON.stringify({owner:source.owner,mechanism:source.mechanism,sourceInputs:source.sha256,builder:'esbuild@0.28.2',externalImports:external,sha256:hashes},null,2)+'\n');
console.log('Compiled Adapter-owned document protocol values and declarations');
