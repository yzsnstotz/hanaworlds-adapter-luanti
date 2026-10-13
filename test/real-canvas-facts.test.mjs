// REAL_ENGINE/COURIER/PACKAGE gate. Source facts must come from the normal payload,
// never from a test mock. The minimal game and Canvas caller are environment peers.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyPackage } from '../scripts/package-boundary.mjs';
const exec = promisify(execFile);
const source = fileURLToPath(new URL('..', import.meta.url));
const card = resolve(source, '..');
const helper = fileURLToPath(new URL('./support/real-canvas-facts-runner.mjs', import.meta.url));
let root, packed, tarSHA256;
const command = async (file, args, cwd, env, log) => {
 try { const r=await exec(file,args,{cwd,env,maxBuffer:16*1024*1024});await writeFile(log,r.stdout+r.stderr);return r; }
 catch(e){await writeFile(log,(e.stdout??'')+(e.stderr??''));throw e;}
};
before(async()=>{
 await mkdir(join(card,'_evidence'),{recursive:true});
 root=await realpath(await mkdtemp(join(card,'_evidence','real-canvas-facts-')));
 const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
 const npm=join(dirname(process.execPath),'npm');
 await command(npm,['pack','--cache',join(card,'npm-cache'),'--pack-destination',root],source,
  {...process.env,HW_ADAPTER_BOUNDARY_PACK:'1'},join(root,'pack.log'));
 const tar=join(root,`${manifest.name}-${manifest.version}.tgz`);
 tarSHA256=createHash('sha256').update(await readFile(tar)).digest('hex');
 const consumer=join(root,'strict-consumer');await mkdir(consumer);
 await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(npm_config_|PNPM_|NODE_OPTIONS$|NODE_PATH$|HW_)/i.test(k)));
 env.HOME=join(consumer,'home');env.XDG_CONFIG_HOME=join(consumer,'config');
 const pnpm=join(source,'node_modules/pnpm/bin/pnpm.cjs');
 const version=await exec(process.execPath,[pnpm,'--version'],{env,cwd:consumer});assert.equal(version.stdout.trim(),'11.28.5');
 await command(process.execPath,[pnpm,'install','--prod','--store-dir',join(card,'pnpm-store'),tar,'@deepseek-ai/cordis@4.0.4'],consumer,env,join(root,'strict-install.log'));
 packed=await realpath(join(consumer,'node_modules',manifest.name));
 assert.doesNotMatch(await readFile(join(consumer,'pnpm-lock.yaml'),'utf8'),/hanaworlds-contracts|esbuild|typescript/);
 const graph=verifyPackage(packed);await writeFile(join(root,'artifact-graph.json'),JSON.stringify(graph,null,2));
 await writeFile(join(root,'artifact.json'),JSON.stringify({tar,tarSHA256,packed,pnpm:'11.28.5',strictDefaultPolicy:true},null,2));
 console.log(`REAL_CANVAS_FACTS_EVIDENCE ${root}`);
});
const scenarios=['native-source','coordinate-calibration','normal','missing-and-recovery','content-drift-and-recovery','scope-and-providers'];
for(const mode of ['source','packed'])for(const scenario of scenarios)
 test(`${mode}: actual Luanti ${scenario}`,async t=>{
  const run=join(root,`${mode}-${scenario}`);await mkdir(run);
  const options={root:run,artifact:mode==='source'?source:packed,mode,scenario,tarSHA256,
   cordis:mode==='source'?null:await realpath(join(root,'strict-consumer/node_modules/@deepseek-ai/cordis/lib/index.js')),
   luanti:process.env.HW_LUANTI_BINARY??'/Applications/luanti.app/Contents/MacOS/luanti',game:process.env.HW_GAME??null};
  const args=[...(mode==='source'?['--conditions=development']:[]),helper,JSON.stringify(options)];
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  t.diagnostic(`actual native evidence: ${run}; tgz ${tarSHA256}`);
  await command(process.execPath,args,source,env,join(run,'runner.log'));
 });
