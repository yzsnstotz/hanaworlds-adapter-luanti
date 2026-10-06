/** Readonly in-process asset facts. No filesystem, renderer, model or world writes. */
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {requireFact} from '../errors.mjs';
import {validateType, digestValue, canonicalJSON, compareUTF16} from './runtime.mjs';

// Inspect the typed channel without invoking accessors. JSON facts use the
// ordinary strict snapshot path. Neither URLs nor JSON byte arrays are bytes.
function record(value, keys) {
 requireFact(value !== null && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value));
 const proto=Object.getPrototypeOf(value);
 requireFact(proto===null || proto===Object.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 requireFact(Reflect.ownKeys(descriptors).length===keys.length && keys.every(k=>Object.hasOwn(descriptors,k) && Object.hasOwn(descriptors[k],'value') && descriptors[k].enumerable));
 return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
function blobs(value) {
 requireFact(value !== null && typeof value === 'object' && !types.isProxy(value) && Array.isArray(value));
 const d=Object.getOwnPropertyDescriptors(value);
 const length=d.length.value;
 requireFact(Reflect.ownKeys(d).length===length+1);
 return Array.from({length},(_,i)=>{
  requireFact(Object.hasOwn(d,String(i)) && Object.hasOwn(d[i],'value') && d[i].enumerable);
  return record(d[i].value,['bytesDigest','bytes']);
 });
}
export function validateMaterialSources(input, catalogue, currentConnection) {
 const envelope=record(input,['snapshot','textures']);
 const snapshot=validateType('MaterialSourcesSnapshot',envelope.snapshot);
 const cat=validateType('Catalogue',catalogue);
 const current=validateType('MaterialSourceConnection',currentConnection);
 requireFact(canonicalJSON(snapshot.connection)===canonicalJSON(current),'CURRENT_WORLD_MISMATCH');
 requireFact(snapshot.catalogueDigest===digestValue('catalogue',cat).sha256 && snapshot.gameId===cat.gameId && snapshot.gameRevision===cat.gameRevision,'CATALOGUE_MISMATCH');
 const {sourceRevision,...projection}=snapshot;
 requireFact(sourceRevision===digestValue('material-sources',projection).sha256,'NON_CANONICAL_AMBIGUITY');
 const needed=new Map();let previous=null;
 for(const row of snapshot.materials){
  // Stable order: UTF-16 node name, then null (-1) or numeric param2. A null
  // variant represents unresolved node facts, never an implied param2=0.
  if(previous)requireFact(compareUTF16(previous.nodeName,row.nodeName)<0 || (previous.nodeName===row.nodeName && (previous.param2??-1)<(row.param2??-1)));
  previous=row;
  requireFact(Object.hasOwn(cat.nodes,row.nodeName),'CATALOGUE_MISMATCH');
  const node=cat.nodes[row.nodeName];
  requireFact(row.definitionRevision===node.definitionRevision,'CATALOGUE_MISMATCH');
  if(row.param2!==null)requireFact(node.allowedParam2!==null && node.allowedParam2.includes(row.param2),'UNSUPPORTED_MUTATION_SEMANTICS');
  else requireFact(node.allowedParam2===null,'UNSUPPORTED_MUTATION_SEMANTICS');
  if(row.availability==='UNKNOWN'){
   if(row.reason==='UNKNOWN_PARAM2')requireFact(node.allowedParam2===null);
   if(row.reason==='UNKNOWN_DEFINITION')requireFact(node.definitionRevision===null);
   continue;
  }
  // Known texture is only a source fact, not static-material eligibility.
  // The regular validateStaticMaterials check is still mandatory downstream.
  const texture=row.texture;
  if(needed.has(texture.bytesDigest))requireFact(needed.get(texture.bytesDigest).byteLength===texture.byteLength && needed.get(texture.bytesDigest).mediaType===texture.mediaType);
  needed.set(texture.bytesDigest,texture);
 }
 const seen=new Set();const textures=[];
 for(const item of blobs(envelope.textures)){
  const digest=validateType('Digest',item.bytesDigest);
  requireFact(needed.has(digest) && !seen.has(digest));seen.add(digest);
  requireFact(types.isUint8Array(item.bytes) && !types.isProxy(item.bytes));
  // Copy internal typed-array elements; do not consult provider iterator/getters.
  let bytes;try{bytes=new Uint8Array(item.bytes);}catch{requireFact(false);}
  requireFact(bytes.byteLength===needed.get(digest).byteLength && createHash('sha256').update(bytes).digest('hex')===digest,'NON_CANONICAL_AMBIGUITY');
  textures.push(Object.freeze({bytesDigest:digest,bytes}));
 }
 requireFact(seen.size===needed.size);
 // Freeze records, not non-empty TypedArrays. Caller owns these byte copies.
 return Object.freeze({snapshot,textures:Object.freeze(textures)});
}
