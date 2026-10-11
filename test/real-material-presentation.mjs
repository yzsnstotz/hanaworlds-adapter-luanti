// REAL_RUNTIME component gate: own fixture game + actual Luanti/courier/payload.
// NativeControl lifecycle is a test peer. No product UI or VoxeLibre acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {PNG} from 'pngjs';
import {createFlatWorld} from '../src/flat-world.mjs';
import {createLocalRuntime} from '../src/local-runtime.mjs';
import {validateMaterialSourceFacts} from '#contracts';

const root=await realpath(process.env.HW_MATERIAL_E);
const profile=join(root,'profile'),worlds=join(profile,'worlds');
const game=join(profile,'games','hw_material_fixture'),base=join(game,'mods','base');
for(const path of [worlds,join(base,'textures'),join(root,'tmp'),join(root,'home')])await mkdir(path,{recursive:true});
await writeFile(join(game,'game.conf'),'title = Adapter material COMPONENT FIXTURE\nallowed_mapgens = flat\n');
await writeFile(join(base,'mod.conf'),'name = base\n');
await writeFile(join(base,'textures','base_source.png'),PNG.sync.write({width:1,height:1,data:Buffer.from([32,64,96,255])}));
await writeFile(join(base,'init.lua'),`
local S=core.get_translator('base_domain')
core.register_node('base:stone',{description=core.colorize('#ff0000',S('Stone')),tiles={'base_source.png'}})
core.register_node('base:debug',{description='base:debug',tiles={'base_source.png'}})
core.register_node('base:unknown',{description='No texture',tiles={'base_absent.png'}})
core.register_node('base:tinted',{description='Tinted stone',color='#ABCDEF',tiles={'base_source.png'}})
core.register_on_mods_loaded(function() assert(rawget(_G,'worldedit')==nil) end)
core.after(0,function() core.log('action','HW_MATERIAL_FIXTURE_READY') end)
`);
async function port(){
  const socket=createServer();await new Promise(y=>socket.listen(0,'127.0.0.1',y));
  const value=socket.address().port;await new Promise(y=>socket.close(y));return value;
}
const made=await createFlatWorld({roots:[worlds],root:worlds,userPath:profile,gameId:'hw_material_fixture',
  worldName:'material-presentation',transportPort:await port()});
const log=join(root,'luanti.log'),config=join(root,'luanti.conf');
await writeFile(config,`port = ${await port()}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\nenable_damage = false\n`);
const argv=['--server','--world',made.worldPath,'--config',config,'--logfile',log];
const child=spawn(process.env.HW_LUANTI??'/Applications/luanti.app/Contents/MacOS/luanti',argv,
  {env:{...process.env,HOME:profile,LUANTI_USER_PATH:profile,XDG_CACHE_HOME:join(profile,'cache'),TMPDIR:join(root,'tmp')},stdio:['ignore','pipe','pipe']});
let output='',exit=null,spawnError=null,runtime;
for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output+=b;});
child.on('exit',(code,signal)=>{exit={code,signal};});
child.on('error',error=>{spawnError=error;});
const evidence={layer:'REAL_RUNTIME component',game:'own fixture; not VoxeLibre',pid:child.pid,argv,checks:[]};
try {
  while(!(await readFile(log,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).includes('HW_MATERIAL_FIXTURE_READY')){
    if(spawnError)throw spawnError;
    assert.equal(exit,null,'Luanti exited before fixture readiness: '+output);
    await new Promise(y=>setTimeout(y,100));
  }
  runtime=createLocalRuntime({ctx:{},homePath:(...p)=>join(root,'home',...p),inspectConnection:async()=>{
    assert.equal(exit,null);process.kill(child.pid,0);
  }});
  const world={...made.identity,worldPath:made.worldPath,connectionRef:'material-fixture-connection'};
  const paired=await runtime.pairLocal(world);
  const read=async operation=>{
    const response=await runtime.worldFacts.call(operation,{contractVersion:'world-facts/v1',requestId:operation,worldRef:world.worldRef});
    assert.equal(response.error,null,JSON.stringify(response.error));return response.result;
  };
  const catalogue=await read('ReadCatalogue'),sources=await read('ReadMaterialSources');
  validateMaterialSourceFacts(sources,catalogue.catalogue,{worldRef:world.worldRef,connectionRef:world.connectionRef,
    connectionIncarnationRef:paired.connectionIncarnationRef});
  assert.deepEqual(Object.keys(sources.presentation).sort(),sources.snapshot.materials.map(m=>m.materialRef).sort());
  assert.equal(JSON.stringify(sources.presentation),JSON.stringify(catalogue.presentation));
  const find=name=>Object.entries(sources.presentation).find(([,p])=>p.displayName===name);
  const [stone,p]=find('Stone');assert.equal(p.color,'#204060');
  assert.equal(sources.snapshot.materials.find(m=>m.materialRef===stone).availability,'KNOWN');
  const [unknown]=find('No texture');assert.equal(sources.snapshot.materials.find(m=>m.materialRef===unknown).reason,'MISSING_TEXTURE');
  assert.equal(sources.presentation[unknown].color,null);
  const [tinted,tp]=find('Tinted stone');assert.equal(tp.color,'#abcdef');
  assert.equal(sources.snapshot.materials.find(m=>m.materialRef===tinted).reason,'UNSUPPORTED_APPEARANCE');
  assert.ok(Object.values(sources.presentation).some(p=>p.displayName===null&&p.color==='#204060'));
  assert.doesNotMatch(JSON.stringify(sources),/base:|base_source|base_domain|\\u001b/);
  evidence.checks=['CURRENT_BOUND_FACTS','EVERY_MATERIAL_HAS_PRESENTATION','NATIVE_ESCAPES_STRIPPED',
    'VERIFIED_PNG_COLOR','DECLARED_COLOR_WITH_UNSUPPORTED_TEXTURE','MISSING_TEXTURE_EXPLICIT_UNKNOWN','NO_NATIVE_NAME_ON_WIRE'];
  evidence.sources=sources;
  console.log('PASS material presentation over actual Luanti and courier ('+sources.snapshot.materials.length+' materials)');
} finally {
  try {if(runtime)await runtime.close();}
  finally {
    if(!exit&&!spawnError){const done=once(child,'exit');child.kill('SIGINT');await done;}
    evidence.exit=exit;
    await writeFile(join(root,'stdio.log'),output);
    await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  }
}
assert.equal(exit?.code,0,'owned Luanti process must stop cleanly');
