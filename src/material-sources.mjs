import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, open } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { validateType, validateMaterialSources, digestValue } from '#contracts';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw new Error('CURRENT_WORLD_MISMATCH');};

// Only the actual native game/mod media roots are read. Symlinked/unreadable
// sources are unresolved; a possible hidden duplicate must never be ignored.
async function files(root) {
  if(!isAbsolute(root))return {unresolved:true,entries:[]};
  const entries=[];let unresolved=false;
  const canonicalRoot=await realpath(root).catch(()=>null);
  async function walk(dir){
    const stat=await lstat(dir).catch(e=>{if(e.code!=='ENOENT')unresolved=true;return null;});
    if(!stat)return;
    if(stat.isSymbolicLink()||!stat.isDirectory()){unresolved=true;return;}
    if(await realpath(dir)!==join(canonicalRoot,relative(root,dir))){unresolved=true;return;}
    let rows;try{rows=await readdir(dir,{withFileTypes:true});}catch{unresolved=true;return;}
    for(const row of rows){
      const path=join(dir,row.name);
      if(row.isSymbolicLink())unresolved=true;
      else if(row.isDirectory())await walk(path);
      else if(row.isFile())entries.push({path,name:row.name,relative:relative(root,path),canonicalPath:join(canonicalRoot,relative(root,path))});
    }
  }
  await walk(root);return {unresolved,entries};
}
async function bytesOf(path,canonicalPath){
  if(await realpath(path)!==canonicalPath)fail();
  const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink())fail();
  const f=await open(path,'r');
  try{
    const s=await f.stat();if(s.dev!==before.dev||s.ino!==before.ino)fail();
    const bytes=await f.readFile(),after=await f.stat(),named=await lstat(path);
    if(await realpath(path)!==canonicalPath)fail();
    if(s.dev!==named.dev||s.ino!==named.ino||s.size!==after.size||s.mtimeMs!==after.mtimeMs||s.ctimeMs!==after.ctimeMs||bytes.length!==s.size)fail();
    return new Uint8Array(bytes);
  }finally{await f.close();}
}
export async function resolveMaterialSources(metadata,connection){
  const catalogue=validateType('Catalogue',metadata.catalogue);
  validateType('MaterialSourceConnection',connection);
  if(!isAbsolute(metadata.gamePath)||!isAbsolute(metadata.userPath)||!Array.isArray(metadata.mods))fail();
  const game=await files(join(metadata.gamePath,'textures'));
  const server=await files(join(metadata.userPath,'textures','server'));
  const mods=[];
  for(const mod of metadata.mods){
    if(typeof mod.name!=='string'||!isAbsolute(mod.path))fail();
    for(const dir of ['textures','sounds','media','models','fonts','locale']){
      const listed=await files(join(mod.path,dir));
      mods.push({...listed,name:mod.name,dir});
    }
  }
  const unresolved=game.unresolved||server.unresolved||mods.some(m=>m.unresolved)||
    typeof metadata.texturePath!=='string'||metadata.texturePath!==''||
    game.entries.some(f=>f.name==='override.txt');
  const materials=[],blobs=new Map();
  for(const nodeName of Object.keys(catalogue.nodes).sort()){
    const node=catalogue.nodes[nodeName],appearance=metadata.appearance?.[nodeName];
    // For uniform colour-invariant cubes, one actual legal representative is
    // sufficient. Unknown legal domain stays null, never an implied zero.
    const param2=node.allowedParam2?.[0]??null;
    const unknown=reason=>materials.push({nodeName,param2,definitionRevision:node.definitionRevision,availability:'UNKNOWN',texture:null,reason});
    if(node.allowedParam2===null||param2===null){unknown('UNKNOWN_PARAM2');continue;}
    if(node.definitionRevision===null){unknown('UNKNOWN_DEFINITION');continue;}
    if(!appearance?.supported||!/^[-a-zA-Z0-9_]+(?:\.[-a-zA-Z0-9_]+)*\.(png|jpg|jpeg|webp)$/.test(appearance.textureName??'')){
      unknown('UNSUPPORTED_APPEARANCE');continue;
    }
    const textureName=appearance.textureName;
    if(unresolved||server.entries.some(f=>f.name===textureName)){unknown('UNRESOLVED_SOURCE');continue;}
    const gameCandidates=game.entries.filter(f=>f.name===textureName);
    const modCandidates=mods.flatMap(m=>m.entries.filter(f=>f.name===textureName).map(f=>({...f,mod:m.name,dir:m.dir})));
    const candidates=gameCandidates.length?gameCandidates:modCandidates;
    if(!candidates.length){unknown('MISSING_TEXTURE');continue;}
    if(candidates.length!==1){unknown('UNRESOLVED_SOURCE');continue;}
    const chosen=candidates[0];let bytes;
    try{bytes=await bytesOf(chosen.path,chosen.canonicalPath);}catch(e){if(e.message==='CURRENT_WORLD_MISMATCH')throw e;unknown('UNRESOLVED_SOURCE');continue;}
    if(!bytes.length){unknown('MISSING_TEXTURE');continue;}
    const mediaType=textureName.endsWith('.png')?'image/png':textureName.endsWith('.webp')?'image/webp':'image/jpeg';
    const bytesDigest=sha(bytes),sourceKind=gameCandidates.length?'GAME':'MOD';
    const sourceRef=sourceKind==='GAME'?`game:${catalogue.gameId}/textures/${chosen.relative}`:`mod:${chosen.mod}/${chosen.dir}/${chosen.relative}`;
    materials.push({nodeName,param2,definitionRevision:node.definitionRevision,availability:'KNOWN',texture:{
      textureName,sourceKind,sourceRef,interpretation:'SIMPLE_UNIFORM_NODE_TILES',mediaType,bytesDigest,byteLength:bytes.length}});
    blobs.set(bytesDigest,{bytesDigest,bytes});
  }
  const projection={profileVersion:'material-sources/v1',connection,catalogueDigest:digestValue('catalogue',catalogue).sha256,
    gameId:catalogue.gameId,gameRevision:catalogue.gameRevision,sourceBasis:'SERVER_ASSET_ONLY',materials};
  return validateMaterialSources({snapshot:{...projection,sourceRevision:digestValue('material-sources',projection).sha256},textures:[...blobs.values()]},catalogue,connection);
}
