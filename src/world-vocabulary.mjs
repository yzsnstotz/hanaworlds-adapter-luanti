import { createHash } from 'node:crypto';
import { validateType, canonicalJSON } from '#contracts';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
export const GEOMETRY_PROFILE = 'voxel-grid/v1';
export const STATE_PROFILE = validateType('StateProfile', { profileVersion:'state-profile/v3',
  derivedFields:['lighting'], preservedFields:[], clearedFields:['inventory','metadata','timer'] });
export const WORLD_GEOMETRY = validateType('WorldGeometry', { profileVersion:'world-geometry/v1',
  geometryProfiles:[GEOMETRY_PROFILE], partition:{edge:[16,16,16]}, postWriteLighting:'REQUIRED' });

/** The loaded native registry owns these translations. No consumer decodes a material ref
 * or treats an orientation index as param2. Read/restore can preserve all native bytes;
 * normal writes accept only the registry's documented legal orientations. */
export class WorldVocabulary {
  constructor(native) {
    if (native?.profileVersion !== 'catalogue/v2' || !native.nodes?.air) fail('CAPABILITY_UNAVAILABLE');
    this.native = native; this.byName = new Map(); this.byRef = new Map();
    const materials = {}; this.presentation = {};
    for (const name of Object.keys(native.nodes).sort()) {
      const n = native.nodes[name];
      const legal = n.allowedParam2;
      if (legal !== null && (!Array.isArray(legal) || !legal.length || new Set(legal).size !== legal.length ||
        legal.some(p => !Number.isInteger(p) || p < 0 || p > 255))) fail('CAPABILITY_UNAVAILABLE');
      const bytes = [...(legal ?? []), ...Array.from({length:256},(_,i)=>i).filter(i=>!legal?.includes(i))];
      // Bind the opaque reference to its translation table so old images cannot
      // silently decode under a different registry orientation declaration.
      const materialRef = `material:${hash(canonicalJSON({name,bytes}))}`;
      const entry = { materialRef, name, bytes, legal };
      this.byName.set(name,entry); this.byRef.set(materialRef,entry);
      this.presentation[materialRef] = {displayName:typeof n.displayName==='string'&&n.displayName?n.displayName:null,
        color:typeof n.color==='string'&&/^#[0-9a-f]{6}$/.test(n.color)?n.color:null};
      const tags = { passable:typeof n.walkable === 'boolean' ? !n.walkable : null,
        liquid:n.liquidType === null ? null : n.liquidType !== 'none', hazardPerSecond:n.damagePerSecond,
        emitsLight:n.lightSource === null ? null : n.lightSource > 0,
        placeable:name === 'ignore' ? null : n.hasCallbacks === true ? false :
          n.hasCallbacks === false && n.hasPersistentState === false ? true : null,
        orientations:legal === null ? null : legal.map((_,i)=>i), definitionRevision:n.definitionRevision,
        unknownFields:[], extension:{native:n} };
      tags.unknownFields = Object.keys(tags).filter(k=>tags[k]===null).sort();
      materials[materialRef] = tags;
    }
    const engineRevisions = {registry:native.gameRevision};
    for (const [mod,revision] of Object.entries(native.modRevisions)) engineRevisions[`source:${hash(mod)}`] = revision;
    this.catalogue = validateType('Catalogue', {profileVersion:'catalogue/v3',engineRevisions,
      emptyMaterialRef:this.byName.get('air').materialRef,materials});
  }
  material(nodeName,param2) {
    const entry=this.byName.get(nodeName);
    if(!entry || !Number.isInteger(param2) || param2<0 || param2>255) fail('CAPABILITY_UNAVAILABLE');
    return {materialRef:entry.materialRef,orientation:entry.bytes.indexOf(param2)};
  }
  nativeMaterial({materialRef,orientation},restore=false) {
    const entry=this.byRef.get(materialRef);
    if(!entry) fail('CATALOGUE_MISMATCH');
    if(!restore && this.catalogue.materials[materialRef].placeable !== true) fail('CAPABILITY_UNAVAILABLE');
    if(!Number.isInteger(orientation) || orientation<0 || orientation>=entry.bytes.length ||
      (!restore && (entry.legal === null || orientation>=entry.legal.length))) fail('CAPABILITY_UNAVAILABLE');
    return {nodeName:entry.name,param2:entry.bytes[orientation]};
  }
  record(raw) {
    const state={lighting:raw.param1};
    if(Object.keys(raw.metadata).length) state.metadata=raw.metadata;
    if(Object.keys(raw.inventory).length) state.inventory=raw.inventory;
    if(raw.timer!==null) state.timer=raw.timer;
    return validateType('Record',{geometryProfile:GEOMETRY_PROFILE,position:raw.position,
      ...this.material(raw.nodeName,raw.param2),state});
  }
  nativeRecord(record) {
    validateType('Record',record);
    return {position:record.position,...this.nativeMaterial(record,true),param1:record.state.lighting,
      metadata:record.state.metadata ?? {},inventory:record.state.inventory ?? {},timer:record.state.timer ?? null};
  }
}

/** Private adapter-side view of the existing native courier, with neutral public records. */
export class NeutralEngine {
  constructor(native) { this.native=native; }
  get closed() {return this.native.closed;}
  get engineGuards() {return this.native.engineGuards;}
  get connectionIncarnationRef() {return this.native.connectionIncarnationRef;}
  async catalogue() {this.vocabulary=new WorldVocabulary(await this.native.catalogue()); return this.vocabulary.catalogue;}
  async profile() {await this.native.profile(); return STATE_PROFILE;}
  material(...args) {return this.vocabulary.material(...args);}
  nativeMaterial(...args) {return this.vocabulary.nativeMaterial(...args);}
  async image(method,positions) {
    const before=await this.catalogue(),raw=await this.native[method](positions);
    const records=raw.records.map(r=>this.vocabulary.record(r));
    if(canonicalJSON(before)!==canonicalJSON(await this.catalogue())) fail('CURRENT_WORLD_MISMATCH');
    return {...raw,records};
  }
  snapshot(positions) {return this.image('snapshot',positions);}
  readback(positions) {return this.image('readback',positions);}
  nativeImage(image) {return {...image,records:image.records.map(r=>this.vocabulary.nativeRecord(r))};}
  effects(effects,restore=false) {return effects.map(e=>({position:e.position,...this.nativeMaterial(e,restore)}));}
  prepareCheck(positions,effects,restore=false) {return this.native.prepareCheck(positions,effects ? this.effects(effects,restore) : undefined);}
  async apply(effects,before,scope,digest) {await this.catalogue(); return this.native.apply(this.effects(effects),this.nativeImage(before),this.nativeImage(scope),digest);}
  async applyState(target,before,digest) {await this.catalogue(); return this.native.applyState(this.nativeImage(target),this.nativeImage(before),digest);}
  async restore(before,id) {await this.catalogue(); return this.native.restore(this.nativeImage(before),id);}
  async inspect(positions) {
    await this.catalogue(); const raw=await this.native.inspect(positions);
    return {...raw,occupiedCells:raw.occupiedCells.map(c=>({position:c.position,...this.material(c.nodeName,c.param2)}))};
  }
  async inspectRegion(value) {return this.native.inspectRegion({...value,
    walkable:Object.fromEntries([...this.vocabulary.byName].map(([name])=>[name,this.vocabulary.native.nodes[name].walkable]))});}
  async writePath() {
    const raw=await this.native.writePath(); this.vocabulary=new WorldVocabulary(raw.catalogue);
    const catalogue=this.vocabulary.catalogue;
    return {catalogue,evidence:{profileVersion:'write-path-evidence/v2',scope:'write-path-init/v1',writePath:'CALLBACK_FREE_WRITE',
      globalWriteCallbacks:raw.evidence.globalWriteCallbacks,materials:raw.evidence.nodes.map(n=>({
        materialRef:this.vocabulary.byName.get(n.nodeName).materialRef,definitionRevision:n.definitionRevision,definedCallbacks:n.definedCallbacks}))}};
  }
  async materialMetadata() {
    const raw=await this.native.materialMetadata(); this.vocabulary=new WorldVocabulary(raw.catalogue);
    return {...raw,catalogue:this.vocabulary.catalogue,appearance:Object.fromEntries(Object.entries(raw.appearance)
      .map(([name,value])=>[this.vocabulary.byName.get(name).materialRef,value]))};
  }
  writeBackend() {return this.native.writeBackend();}
  sourceDeclaration() {return this.native.sourceDeclaration();}
  worldEditRuntime() {return this.native.worldEditRuntime();}
  capacity(n) {return this.native.capacity(n);}
  regionLimits() {return this.native.regionLimits();}
  regionEmerge(...args) {return this.native.regionEmerge(...args);}
  regionRead(value) {return this.native.regionRead(value);}
  regionWrite(value) {return this.native.regionWrite(value);}
  close() {return this.native.close();}
}
