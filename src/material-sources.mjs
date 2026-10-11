import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, open } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { validateType, validateMaterialSources, validateMaterialSourceFacts, digestValue } from '#contracts';
import { PNG } from 'pngjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw new Error('CURRENT_WORLD_MISMATCH');};

/** Representative sRGB of a verified simple PNG asset. pngjs owns decoding;
 * alpha weights visible pixels. Unsupported, corrupt, non-sRGB or very large
 * images have no colour fact, never an invented substitute. */
export function textureColor({mediaType,bytes}) {
  if(mediaType!=='image/png')return null;
  const buffer=Buffer.from(bytes);
  if(buffer.length<33||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||buffer.toString('ascii',12,16)!=='IHDR')return null;
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  if(!width||!height||width*height>1048576)return null;
  // A conflicting gamma/ICC profile would require explicit colour conversion.
  for(let at=8;at+12<=buffer.length;) {
    const length=buffer.readUInt32BE(at),kind=buffer.toString('ascii',at+4,at+8);
    if(at+12+length>buffer.length)return null;
    if(kind==='iCCP'||kind==='cHRM')return null;
    if(kind==='gAMA'&&(length!==4||buffer.readUInt32BE(at+8)!==45455))return null;
    at+=12+length;
  }
  try {
    const png=PNG.sync.read(buffer),sum=[0,0,0];let weight=0;
    for(let at=0;at<png.data.length;at+=4) {
      const alpha=png.data[at+3];weight+=alpha;
      for(let c=0;c<3;c++)sum[c]+=png.data[at+c]*alpha;
    }
    return weight?'#'+sum.map(n=>Math.round(n/weight).toString(16).padStart(2,'0')).join(''):null;
  }catch{return null;}
}

/** Named C-world-facts projection: one presentation per opaque material ref,
 * including UNKNOWN sources. Native asset names and byte blobs stay private.
 * Missing names/colours remain explicit null; verified PNGs supply sRGB facts. */
export function materialSourceFacts(sources, declaredPresentation, catalogue, connection) {
  const verified=validateMaterialSources(sources,catalogue,connection);
  const textures=new Map(verified.textures.map(t=>[t.bytesDigest,t.bytes]));
  const presentation={};
  const {sourceRevision,...projection}=verified.snapshot;
  const materials=projection.materials.map(row=>{
    const declared=declaredPresentation[row.materialRef];
    const color=row.texture?textureColor({mediaType:row.texture.mediaType,bytes:textures.get(row.texture.bytesDigest)}):null;
    presentation[row.materialRef]={displayName:declared?.displayName??null,color:color??declared?.color??null};
    return {...row,texture:row.texture?{...row.texture,textureName:`asset:${row.texture.bytesDigest}`,
      sourceRef:`source:${sha(JSON.stringify(row.texture.sourceRef))}`}:null};
  });
  const snapshot={...projection,materials};
  return validateMaterialSourceFacts({profileVersion:'material-source-facts/v1',
    snapshot:{...snapshot,sourceRevision:digestValue('material-sources',snapshot).sha256},presentation},catalogue,connection);
}

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
      else if(row.isDirectory()){if(!'_.'.includes(row.name[0]))await walk(path);}
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
// Luanti 5.17 src/server.cpp fillMediaCache: user textures/server, then game
// textures, then each mod in reverse load order (textures, sounds, media,
// models, locale, fonts). The first listed file name wins; inside one
// recursive root, sub-directory order is the OS listing order, so a duplicate
// there is unresolved. Server media accepts .png/.jpg/.tga; empty or oversized
// files are skipped by the engine and are therefore not claimed here.
const MEDIA_MAX=16700000;
const MEDIA_TYPES={png:'image/png',jpg:'image/jpeg'};
export async function resolveMaterialSources(metadata,connection){
  const catalogue=validateType('Catalogue',metadata.catalogue);
  validateType('MaterialSourceConnection',connection);
  if(!isAbsolute(metadata.gamePath)||!isAbsolute(metadata.userPath)||!Array.isArray(metadata.mods))fail();
  const groups=[{kind:'SERVER',...await files(join(metadata.userPath,'textures','server'))},
    {kind:'GAME',...await files(join(metadata.gamePath,'textures'))}];
  for(const mod of [...metadata.mods].reverse()){
    if(typeof mod?.name!=='string'||!mod.name||!isAbsolute(mod.path))fail();
    for(const dir of ['textures','sounds','media','models','locale','fonts'])
      groups.push({kind:'MOD',mod:mod.name,dir,...await files(join(mod.path,dir))});
  }
  const unresolved=groups.some(g=>g.unresolved)||typeof metadata.texturePath!=='string'||metadata.texturePath!==''||
    groups[1].entries.some(f=>f.name==='override.txt');
  const materials=[],blobs=new Map();
  for(const materialRef of Object.keys(catalogue.materials).sort()){
    const node=catalogue.materials[materialRef],appearance=metadata.appearance?.[materialRef];
    // For uniform colour-invariant cubes, one actual legal representative is
    // sufficient. Unknown legal domain stays null, never an implied zero.
    const orientation=node.orientations?.[0]??null;
    const unknown=reason=>materials.push({materialRef,orientation,definitionRevision:node.definitionRevision,availability:'UNKNOWN',texture:null,reason});
    if(node.orientations===null||orientation===null){unknown('UNKNOWN_ORIENTATION');continue;}
    if(node.definitionRevision===null){unknown('UNKNOWN_DEFINITION');continue;}
    const ext=/^[-a-zA-Z0-9_.]+\.([a-z]+)$/.exec(appearance?.textureName??'')?.[1];
    if(appearance?.supported!==true||!Object.hasOwn(MEDIA_TYPES,ext??'')){unknown('UNSUPPORTED_APPEARANCE');continue;}
    const textureName=appearance.textureName;
    if(unresolved){unknown('UNRESOLVED_SOURCE');continue;}
    const group=groups.find(g=>g.entries.some(f=>f.name===textureName));
    if(!group){unknown('MISSING_TEXTURE');continue;}
    const candidates=group.entries.filter(f=>f.name===textureName);
    if(group.kind==='SERVER'||candidates.length!==1){unknown('UNRESOLVED_SOURCE');continue;}
    const chosen=candidates[0];let bytes;
    try{bytes=await bytesOf(chosen.path,chosen.canonicalPath);}catch(e){if(e.message==='CURRENT_WORLD_MISMATCH')throw e;unknown('UNRESOLVED_SOURCE');continue;}
    if(!bytes.length||bytes.length>MEDIA_MAX){unknown('UNRESOLVED_SOURCE');continue;}
    const bytesDigest=sha(bytes);
    const sourceRef=group.kind==='GAME'?`game:${catalogue.engineRevisions.registry}/textures/${chosen.relative}`:`mod:${group.mod}/${group.dir}/${chosen.relative}`;
    materials.push({materialRef,orientation,definitionRevision:node.definitionRevision,availability:'KNOWN',texture:{
      textureName,sourceKind:group.kind,sourceRef,interpretation:'SIMPLE_UNIFORM_NODE_TILES',mediaType:MEDIA_TYPES[ext],bytesDigest,byteLength:bytes.length}});
    blobs.set(bytesDigest,{bytesDigest,bytes});
  }
  const projection={profileVersion:'material-sources/v2',connection,catalogueDigest:digestValue('catalogue',catalogue).sha256,
    engineRevisions:catalogue.engineRevisions,sourceBasis:'WORLD_SOURCE_ASSET_ONLY',materials};
  return validateMaterialSources({snapshot:{...projection,sourceRevision:digestValue('material-sources',projection).sha256},textures:[...blobs.values()]},catalogue,connection);
}
