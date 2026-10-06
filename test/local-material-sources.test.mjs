import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=process.env.HW_MATERIAL_PACKAGE;
const load=p=>import(root?pathToFileURL(join(root,p)):new URL('../'+p,import.meta.url));
const C=await load('vendor/hanaworlds-contracts/dist/local/index.mjs');
const {apply}=await load('src/index.mjs');
const connection={worldRef:'fixture-world',connectionRef:'fixture-connection',connectionIncarnationRef:'fixture-incarnation'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function setup(run){
 const dir=await mkdtemp(join(tmpdir(),'hw-material-unit-'));
 try{
  const game=join(dir,'game'),mod=join(game,'mods','native'),user=join(dir,'user');
  for(const d of [join(game,'textures'),join(mod,'textures'),user])await mkdir(d,{recursive:true});
  await writeFile(join(mod,'textures','native.png'),png);
  const node={walkable:true,collisionBoxes:null,liquidType:'none',damagePerSecond:0,lightSource:0,param2Type:'none',allowedParam2:[0,1],hasCallbacks:false,hasPersistentState:null,definitionRevision:hash('definition'),unknownFields:['collisionBoxes','hasPersistentState']};
  const metadata={catalogue:{profileVersion:'catalogue/v2',engineProfile:'fixture-engine',gameId:'fixture-game',gameRevision:hash('game'),modRevisions:{native:hash('mod')},nodes:{'native:stone':node}},
   gamePath:game,userPath:user,texturePath:'',mods:[{name:'native',path:mod}],appearance:{'native:stone':{textureName:'native.png',supported:true}}};
  await run(metadata,{game,mod,user});
 }finally{await rm(dir,{recursive:true,force:true});}
}
const resolver=async()=> (await load('src/material-sources.mjs')).resolveMaterialSources;

test('public readonly supplier exists and rejects unbound, invalid and closed worlds',async()=>{
 const services=new Map();const instance=apply({get(){},effect(f){f();},provide(n,v){services.set(n,v);},webServer:{register(){return()=>{};}}});
 try{
  const facts=services.get('hanaworldsLuantiNativeFacts');
  assert.equal(typeof facts.readMaterialSources,'function');
  await assert.rejects(()=>facts.readMaterialSources('unbound'),/WORLD_NOT_BOUND/);
  await assert.rejects(()=>facts.readMaterialSources({worldRef:'fake'}),/SCHEMA_INVALID/);
  await instance.close();
  await assert.rejects(()=>facts.readMaterialSources('unbound'),/ADAPTER_UNAVAILABLE/);
 }finally{await instance.close();}
});
test('actual mod bytes and game priority bind to legal node and fresh contract facts',()=>setup(async(m,{game})=>{
 const resolve=await resolver();let result=await resolve(m,connection);
 const row=result.snapshot.materials[0];assert.equal(row.availability,'KNOWN');assert.equal(row.texture.sourceKind,'MOD');
 assert.equal(row.param2,0);assert.equal(row.texture.bytesDigest,hash(png));assert.deepEqual(Buffer.from(result.textures[0].bytes),png);
 assert.equal(m.catalogue.nodes['native:stone'].hasPersistentState,null);
 C.validateMaterialSources(result,m.catalogue,connection);
 await writeFile(join(game,'textures','native.png'),Buffer.concat([png,Buffer.from('game-specific fixture bytes')]));
 result=await resolve(m,connection);assert.equal(result.snapshot.materials[0].texture.sourceKind,'GAME');
 assert.notEqual(result.snapshot.sourceRevision,row.texture.bytesDigest);
}));
test('unresolved legality remains null with no fake texture; static unknowns stay unknown',()=>setup(async m=>{
 m.catalogue.nodes['native:stone'].allowedParam2=null;m.catalogue.nodes['native:stone'].unknownFields.push('allowedParam2');m.catalogue.nodes['native:stone'].unknownFields.sort();
 const result=await(await resolver())(m,connection);assert.equal(result.snapshot.materials[0].reason,'UNKNOWN_PARAM2');
 assert.equal(result.snapshot.materials[0].param2,null);assert.equal(result.snapshot.materials[0].texture,null);assert.equal(result.textures.length,0);
}));
test('unsupported appearance and server override are explicitly UNKNOWN',()=>setup(async(m,{game})=>{
 const resolve=await resolver();m.appearance['native:stone'].supported=false;
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNSUPPORTED_APPEARANCE');
 m.appearance['native:stone'].supported=true;await writeFile(join(game,'textures','override.txt'),'native:stone all other.png\n');
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNRESOLVED_SOURCE');
}));
test('fresh byte changes alter sourceRevision without forging game revision',()=>setup(async(m,{mod})=>{
 const resolve=await resolver(),a=await resolve(m,connection);
 await writeFile(join(mod,'textures','native.png'),Buffer.concat([png,Buffer.from('changed fixture bytes')]));
 const b=await resolve(m,connection);assert.notEqual(a.snapshot.sourceRevision,b.snapshot.sourceRevision);
 assert.equal(a.snapshot.gameRevision,b.snapshot.gameRevision);assert.notEqual(a.textures[0].bytesDigest,b.textures[0].bytesDigest);
}));
test('missing file is never guessed; Luanti 5.17 reverse load order resolves cross-mod names',()=>setup(async(m,{mod,game})=>{
 const resolve=await resolver();await rm(join(mod,'textures','native.png'));
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'MISSING_TEXTURE');
 // server.cpp fillMediaCache + ServerModManager::getModsMediaPaths: a later
 // loaded mod's media is listed first and therefore wins the file name.
 const other=join(game,'mods','other');await mkdir(join(other,'textures'),{recursive:true});
 const late=Buffer.concat([png,Buffer.from('later mod')]);
 await writeFile(join(mod,'textures','native.png'),png);await writeFile(join(other,'textures','native.png'),late);
 m.mods.push({name:'other',path:other});
 let row=(await resolve(m,connection)).snapshot.materials[0];
 assert.equal(row.texture.sourceRef,'mod:other/textures/native.png');assert.equal(row.texture.bytesDigest,hash(late));
 m.mods.reverse();row=(await resolve(m,connection)).snapshot.materials[0];
 assert.equal(row.texture.sourceRef,'mod:native/textures/native.png');
 // Two copies inside the winning mod depend on directory listing order.
 await mkdir(join(mod,'textures','sub'));await writeFile(join(mod,'textures','sub','native.png'),late);
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNRESOLVED_SOURCE');
}));
test('engine-ignored directories and formats are not sources; empty winner is unresolved',()=>setup(async(m,{mod,user})=>{
 const resolve=await resolver();
 // GetRecursiveDirs skips sub-directories starting with "_" or ".".
 for(const d of ['_hidden','.git']){await mkdir(join(mod,'textures',d),{recursive:true});await writeFile(join(mod,'textures',d,'native.png'),Buffer.from('ignored'));}
 assert.equal((await resolve(m,connection)).snapshot.materials[0].texture.bytesDigest,hash(png));
 // Server media accepts .png/.jpg/.tga only; .jpeg/.webp are never served.
 for(const name of ['native.jpeg','native.webp','native.tga']){
  m.appearance['native:stone'].textureName=name;await writeFile(join(mod,'textures',name),png);
  assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNSUPPORTED_APPEARANCE',name);
 }
 m.appearance['native:stone'].textureName='native.jpg';await writeFile(join(mod,'textures','native.jpg'),png);
 assert.equal((await resolve(m,connection)).snapshot.materials[0].texture.mediaType,'image/jpeg');
 m.appearance['native:stone'].textureName='native.png';
 await writeFile(join(mod,'textures','native.png'),Buffer.alloc(0));
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNRESOLVED_SOURCE','engine skips empty media and falls through');
 await writeFile(join(mod,'textures','native.png'),png);
 await mkdir(join(user,'textures','server'),{recursive:true});await writeFile(join(user,'textures','server','native.png'),png);
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNRESOLVED_SOURCE','user server media outranks game/mod');
 await rm(join(user,'textures'),{recursive:true});m.texturePath=null;
 assert.equal((await resolve(m,connection)).snapshot.materials[0].reason,'UNRESOLVED_SOURCE','unknown texture_path override');
}));
