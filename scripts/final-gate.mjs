// Own isolated source + packed-artifact diagnostics. Never reuses a historical card profile.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync,openSync,closeSync,realpathSync} from 'node:fs';
import {dirname,basename,join,resolve,relative} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source=fileURLToPath(new URL('../',import.meta.url));
const [gate,commit,directory]=process.argv.slice(2);
assert.ok(['flat-world','world-switch','world-delete','region-io'].includes(gate),'unknown gate');
assert.ok(commit&&directory,'tested commit and fresh evidence directory required');
const runRoot=realpathSync(process.env.HW_ADAPTER_RUN_ROOT??join(homedir(),'.cache/hana-world-runs/adapter-migration-cleanup-01'));
const evidence=resolve(directory);assert.ok(!existsSync(evidence),'fresh evidence required');
assert.ok(!relative(runRoot,realpathSync(dirname(evidence))).startsWith('..')&&evidence!==runRoot,'evidence must be inside this card run directory');
const [major,minor,patch]=process.versions.node.split('.').map(Number);
assert.ok(major===24&&(minor>13||minor===13&&patch>=1),'Node >=24.13.1 <25 required');
const env={...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH,npm_config_update_notifier:'false',npm_config_cache:join(homedir(),'.npm')};
const git=args=>execFileSync('git',args,{cwd:source,env,encoding:'utf8'}).trim();
assert.equal(git(['rev-parse','HEAD']),commit,'tested commit mismatch');assert.equal(git(['status','--porcelain']),'','clean checkout required');
env.HW_LUANTI_MODE=env.HW_LUANTI_MODE??(basename(env.HW_LUANTI??'').includes('server')?'server':'client');
assert.ok(env.HW_LUANTI&&env.HW_GAME,'explicit Luanti and own VoxeLibre directory required');
mkdirSync(evidence);for(const name of ['tmp','tests','stage1'])mkdirSync(join(evidence,name));
Object.assign(env,{TMPDIR:join(evidence,'tmp'),HW_ADAPTER_TEST_ROOT:join(evidence,'tests'),HW_BIND_TEST_ROOT:join(evidence,'tests'),HW_STAGE1_RUN:join(evidence,'stage1')});
const npm=join(dirname(process.execPath),'npm');const steps=[],recordedRuns=[];
function run(name,file,args,cwd=source,extra={}){
 const log=join(evidence,name+'.log'),fd=openSync(log,'w');
 try{execFileSync(file,args,{cwd,env:{...env,...extra},stdio:['ignore',fd,fd]});steps.push({name,exit:0,log});}
 catch(error){steps.push({name,exit:error.status??null,signal:error.signal,log});throw error;}
 finally{closeSync(fd);writeFileSync(join(evidence,'steps.json'),JSON.stringify(steps,null,2)+'\n');}
}
try{
 run('runtime',env.HW_LUANTI,['--version']);
 writeFileSync(join(evidence,'source.json'),JSON.stringify({commit,node:process.version,gate,contracts:JSON.parse(readFileSync(join(source,'scripts/protocol-source.json')))},null,2)+'\n');
 run('verify-contracts',npm,['run','verify:contracts']);run('contract-tests',npm,['run','test:contracts']);run('source-tests',npm,['test']);run('build',npm,['run','build']);run('lua-tests',npm,['run','test:lua']);
 run('pack',npm,['pack','--json','--pack-destination',evidence]);
 const meta=JSON.parse(readFileSync(join(source,'package.json')));
 const tar=join(evidence,meta.name+'-'+meta.version+'.tgz');assert.ok(existsSync(tar),'npm pack artifact missing');
 writeFileSync(join(evidence,'tar.sha256'),createHash('sha256').update(readFileSync(tar)).digest('hex')+'\n');
 const extract=join(evidence,'extract');mkdirSync(extract);run('extract','tar',['-xzf',tar,'-C',extract]);
 const packed=join(extract,'package');run('production-install',npm,['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],packed);
 const files=execFileSync('tar',['-tzf',tar],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.endsWith('/')).map(p=>{assert.ok(p.startsWith('package/'));return {path:p.slice('package/'.length)};});
 writeFileSync(join(evidence,'pack-files.json'),JSON.stringify(files,null,2)+'\n');
 assert.ok(files.every(f=>! /^(archive|dev|test|scripts)\//.test(f.path)),'development file in package');
 const rows=files.map(({path})=>{const original=readFileSync(join(source,path)),actual=readFileSync(join(packed,path));assert.deepEqual(actual,original,path);return {path,sha256:createHash('sha256').update(actual).digest('hex')};});
 writeFileSync(join(evidence,'artifact-entries.json'),JSON.stringify(rows,null,2)+'\n');
 for(const [kind,pkg] of [['source',source],['package',packed]]){
  const e=join(evidence,kind+'-runtime');mkdirSync(e);recordedRuns.push(e);
  const common={HW_LOCAL_E:e,HW_LOCAL_PACKAGE:pkg,HW_CORDIS_MODULE:join(source,'node_modules/@deepseek-ai/cordis/lib/index.js')};
  if(gate==='region-io'){
   run(kind+'-native',process.execPath,[join(source,'test/real-native-paths.mjs')],source,{HW_NATIVE_E:e,HW_NATIVE_PACKAGE:pkg,HW_NATIVE_PATH:'ALL'});
   const detailed=join(evidence,kind+'-detailed-region');mkdirSync(detailed);recordedRuns.push(detailed);
   run(kind+'-detailed-region',process.execPath,[join(source,'test/real-region-io.mjs')],source,{...common,HW_LOCAL_E:detailed});
   const base=join(evidence,kind+'-base-region');mkdirSync(base);recordedRuns.push(base);
   run(kind+'-base-region',process.execPath,[join(source,'test/real-native-paths.mjs')],source,{HW_NATIVE_E:base,HW_NATIVE_PACKAGE:pkg,HW_NATIVE_PATH:'region',HW_GAME:''});
  }else run(kind+'-runtime',process.execPath,[join(source,'test/real-'+gate+'.mjs')],source,common);
 }
 const runtimeRuns=recordedRuns.map(dir=>{const result=JSON.parse(readFileSync(join(dir,'results.json')));assert.notEqual(result.pass,false,dir);assert.ok(!result.cleanupError,dir);
  if(result.requiredSteps)assert.ok(result.requiredSteps.every(name=>result.steps.some(s=>s.name===name)),dir);
  const processes=result.processes??JSON.parse(readFileSync(join(dir,'processes.json')));
  for(const p of processes){assert.equal(p.exit?.code??p.exitCode,0,dir+' pid '+p.pid);assert.ok(!(p.exit?.signal??p.signal),dir);try{process.kill(p.pid,0);assert.fail('still running '+p.pid);}catch(e){if(e.code!=='ESRCH')throw e;}}
  return {directory:dir,processes,steps:result.steps?.map(s=>s.name)??result.events?.map(s=>s.event)};
 });
 writeFileSync(join(evidence,'runtime-runs.json'),JSON.stringify(runtimeRuns,null,2)+'\n');
 writeFileSync(join(evidence,'summary.json'),JSON.stringify({pass:true,gate,commit,level:'REAL_ENGINE_WITH_CONTRACT_HOST_FIXTURES',realHost:'NOT_RUN',realUI:'NOT_RUN',owner:'NOT_ACCEPTED'},null,2)+'\n');
}catch(error){writeFileSync(join(evidence,'summary.json'),JSON.stringify({pass:false,gate,commit,failure:error.message,steps},null,2)+'\n');throw error;}
