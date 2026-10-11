import { canonicalJSON, digestValue, validateType, validateCatalogueFacts,
  validateEngineFacts, validateWriteProfile,
  validateWorldSourceCapabilities, ContractError } from '#contracts';
import { WORLD_GEOMETRY } from './world-vocabulary.mjs';
import { engineGuardDeclaration } from './safety-capabilities.mjs';
import { resolveMaterialSources, materialSourceFacts } from './material-sources.mjs';
import { createHash } from 'node:crypto';
const digest = (kind, value) => digestValue(kind, value).sha256;
const opaqueRevision = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
const refuse = code => { throw new ContractError(code,'validate','REQUIRED_FACT_UNKNOWN'); };
const INIT = new Set(['after_destruct','after_place_node','on_construct','on_destruct','on_timer']);
const STATE = new Set(['allow_metadata_inventory_move','allow_metadata_inventory_put','allow_metadata_inventory_take',
  'on_metadata_inventory_move','on_metadata_inventory_put','on_metadata_inventory_take','on_receive_fields','preserve_metadata']);

/** Adapter-owned native callback derivation. Retained evidence readers may inspect the
 * inventory; named capabilities carry only conclusions. Never delegates engine semantics
 * to the contracts SDK. Unknown inventory or revision cannot establish a clean material. */
export function writePathConclusions(catalogue, evidence) {
  evidence=validateType('WritePathEvidence',{...evidence,catalogueDigest:digest('catalogue',catalogue),
    materials:[...evidence.materials].sort((a,b)=>a.materialRef<b.materialRef?-1:a.materialRef>b.materialRef?1:0)});
  const globals=evidence.globalWriteCallbacks;
  const clean=Array.isArray(globals)&&globals.length===0;
  const materials={};
  for(const m of evidence.materials) {
    const known=clean&&Array.isArray(m.definedCallbacks)&&m.definitionRevision!==null;
    const init=known&&m.definedCallbacks.some(c=>INIT.has(c));
    const state=known&&m.definedCallbacks.some(c=>STATE.has(c));
    materials[m.materialRef]={hasSideEffects:known?init:null,
      hasPersistentState:known&&!init&&!state?false:null};
    if(catalogue.materials[m.materialRef]?.definitionRevision!==m.definitionRevision)refuse('CATALOGUE_MISMATCH');
  }
  const path={hasSideEffects:globals===null?null:!clean,hasPersistentState:clean?false:null};
  const out=validateType('WritePathConclusions',{profileVersion:'write-path-conclusions/v1',
    catalogueDigest:digest('catalogue',catalogue),path,materials});
  for(const [ref,tags] of Object.entries(catalogue.materials))
    if(tags.placeable===true&&(!clean||materials[ref]?.hasSideEffects!==false||materials[ref]?.hasPersistentState!==false))refuse('CATALOGUE_MISMATCH');
  return out;
}

/** Compatibility reader validation, using the world's conclusions rather than SDK
 * callback rules. The evidence digest and per-material revisions are still bound. */
export function checkWritePathFacts(catalogue,evidence) {
  if(evidence.catalogueDigest!==digest('catalogue',catalogue))refuse('CATALOGUE_MISMATCH');
  const conclusions=writePathConclusions(catalogue,evidence),verified=[],stricter=[];
  for(const [ref,tags] of Object.entries(catalogue.materials)) {
    const c=conclusions.materials[ref];
    if(tags.placeable===true)verified.push(ref);
    else if(c?.hasSideEffects===false&&c?.hasPersistentState===false)stricter.push(ref);
  }
  return {scope:evidence.scope,writePath:evidence.writePath,verified,stricter};
}

/** Read-only projections from one loaded registry and the payload's own declaration.
 * The runtime checks connection currency before/after this operation. */
export async function readWorldSourceFact(operation,row) {
  const engine=row.engine;
  const connection={worldRef:row.worldRef,connectionRef:row.connectionRef,connectionIncarnationRef:row.incarnation};
  const before=await engine.catalogue();
  const catalogueDigest=digest('catalogue',before);
  let out;
  if(operation==='ReadCatalogue'||operation==='ReadMaterialSources') {
    const metadata=await engine.materialMetadata();
    if(canonicalJSON(metadata.catalogue)!==canonicalJSON(before))refuse('CURRENT_WORLD_MISMATCH');
    const sources=await resolveMaterialSources(metadata,connection);
    const materialFacts=materialSourceFacts(sources,engine.vocabulary.presentation,before,connection);
    const presentation=materialFacts.presentation;
    if(operation==='ReadCatalogue') {
      const orientations=[...new Set(Object.values(before.materials).flatMap(m=>m.orientations??[]))].sort((a,b)=>a-b);
      out=validateCatalogueFacts({profileVersion:'catalogue-facts/v1',connection,catalogue:before,catalogueDigest,
        presentation,orientationIndex:orientations.map(orientation=>({orientation,quarterTurnsAboutUp:null,upsideDown:null}))},connection);
    } else {
      out=materialFacts;
    }
    const confirmed=await engine.materialMetadata();
    if(canonicalJSON(confirmed)!==canonicalJSON(metadata))refuse('CURRENT_WORLD_MISMATCH');
    const reread=await resolveMaterialSources(confirmed,connection);
    if(reread.snapshot.sourceRevision!==sources.snapshot.sourceRevision)refuse('CURRENT_WORLD_MISMATCH');
  } else {
    const declaration=async()=>{
      try {return await engine.sourceDeclaration();}
      catch(error){if(error.message!=='NOT_DECLARED_BY_PAYLOAD')throw error;return {notDeclared:true};}
    };
    const raw=await declaration();
    const known=raw?.ready===true&&typeof raw?.writeBackend?.profileId==='string'&&raw.writeBackend.profileId.length>0
      &&typeof raw.writeBackend.revision==='string'&&raw.writeBackend.revision.length>0;
    const writeBackend=known?{availability:'KNOWN',basis:'LOADED_PAYLOAD_DECLARATION',writeBackend:validateType('WriteBackendRef',raw.writeBackend)}
      :{availability:'UNAVAILABLE',reason:raw?.notDeclared?'NOT_DECLARED_BY_PAYLOAD':'ENGINE_FACT_UNREADABLE'};
    const writeMethods=validateType('WriteMethods',known?raw.writeMethods:[]);
    const compilationConfig=known?validateType('CompilationConfig',{profileVersion:'compilation-config/v3',writeBackend:writeBackend.writeBackend,
      overlapRule:'last-writer-wins',effectOrder:'numeric-x-y-z',compressionRule:'exact-final-effects-only'}):null;
    const avatarEnvelope=validateType('AvatarEnvelope',raw?.avatarEnvelope??{availability:'UNAVAILABLE',reason:'NO_PUBLIC_SOURCE'});
    const limits=await engine.regionLimits();
    const transportPolicy=engine.transportPolicy?.();
    const transport=transportPolicy?{transportPolicy:validateType('WorldSourceTransportPolicy',transportPolicy)}:{};
    if(limits.mapblockSize!==WORLD_GEOMETRY.partition.edge[0])refuse('CAPABILITY_GAP');
    const bound=limits.mapgenLimit;
    const engineBounds=Number.isSafeInteger(bound)&&bound>0?{min:[-bound,-bound,-bound],max:[bound,bound,bound]}:null;
    if(operation==='ReadEngineFacts')out=validateEngineFacts({profileVersion:'engine-facts/v1',connection,
      ...transport,worldGeometry:WORLD_GEOMETRY,engineBounds,frame:{axes:['+X','+Y','+Z'],handedness:'left',gridUnit:{name:'cell',metersPerGridUnit:null}},writeMethods,writeBackend},connection);
    else if(operation==='ReadWriteProfile')out=validateWriteProfile({profileVersion:'write-profile/v1',connection,catalogueDigest,
      ...transport,writeBackend,compilationConfig,writeMethods,avatarEnvelope},before,connection);
    else if(operation==='ReadWorldSourceCapabilities') {
      const rawPath=await engine.writePath();
      if(canonicalJSON(rawPath.catalogue)!==canonicalJSON(before))refuse('CURRENT_WORLD_MISMATCH');
      const writePath=writePathConclusions(before,rawPath.evidence);
      const body={...transport,profileVersion:'world-source-capabilities/v1',owner:'world-source',connection,catalogueDigest,
        worldGeometry:WORLD_GEOMETRY,engineBounds,stateProfile:await engine.profile(),writeBackend,compilationConfig,writeMethods,
        writePath,engineGuards:engineGuardDeclaration(engine.engineGuards),avatarEnvelope};
      out=validateWorldSourceCapabilities({...body,capabilityRevision:opaqueRevision(body)},before,connection);
    } else refuse('UNSUPPORTED_OPERATION');
    if(canonicalJSON(raw)!==canonicalJSON(await declaration())||canonicalJSON(limits)!==canonicalJSON(await engine.regionLimits()))
      refuse('CURRENT_WORLD_MISMATCH');
  }
  if(canonicalJSON(before)!==canonicalJSON(await engine.catalogue()))refuse('CURRENT_WORLD_MISMATCH');
  return out;
}
