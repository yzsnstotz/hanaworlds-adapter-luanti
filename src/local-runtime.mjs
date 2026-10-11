import { engineGuardDeclaration, refusalDetail, GUARDED_OPERATIONS } from './safety-capabilities.mjs';
// Published guarded responses carry guardRefusal (null unless a guard refused).
const shaped = (name, v) => GUARDED_OPERATIONS.has(name) ? { guardRefusal: null, ...v } : v;
// Public engine-guard stage of a world-adapter/v8 operation that can be refused before writing.
const STAGE = { PrepareRecoverableTransaction: 'PREPARE_RECOVERABLE', ApplyCompiledTransaction: 'APPLY_COMPILED', ApplyHistoryTransaction: 'APPLY_HISTORY' };
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { validateRequest, validateResponse, validateRegionRead, validateRegionWrite, contractHandshake, validateBoundRequest, validateBoundResponse, admitRequest,
  validateCurrentRequest, validateType, schemaBundle, historicalReceiptResponse, digestValue, canonicalJSON, comparePosition, ContractError } from '#contracts';
import { readWorldSourceFact, checkWritePathFacts } from './world-source-facts.mjs';
import { createInspectionContext } from './inspection-context.mjs';
import { LocalCourier } from './local-courier.mjs';
import { NeutralEngine, WORLD_GEOMETRY, GEOMETRY_PROFILE } from './world-vocabulary.mjs';
import { LocalRecords } from './local-records.mjs';
import { LocalTransactions, cellDigest, readbackView } from './local-transactions.mjs';
import { nativeJournalDirectory, readJournalActivity } from './native-storage.mjs';
import { ADAPTER_ID, ADAPTER_VERSION } from './version.mjs';
import { resolveMaterialSources } from './material-sources.mjs';
import { createStage1Facts } from './stage1-facts.mjs';
import { readRegion, writeRegion, protocolHandshake, worldAdapterProtocolHandshake, RegionFault } from './region-io.mjs';
const WIRE = 'world-adapter/v8';
const mutators = new Set(['PrepareRecoverableTransaction','ApplyCompiledTransaction','RestoreTransaction',
  'PrepareHistoryTransaction','ApplyHistoryTransaction','AbortPreparedTransaction','AbortPreparedHistoryTransaction']);
const fail = code => { throw new Error(code); };
const D = (kind, value) => digestValue(kind, value).sha256;
const sameContext = (a,b) => canonicalJSON(a) === canonicalJSON(b);
const original = value => value?.[Symbol.for('cordis.original')] ?? value;
// Cordis overlays ctx on a Proxy of this service; it does not add an original
// own property or change the service's ctx descriptor. A JSON/plain receiver
// carrying a public original symbol is not a tracked service reference.
const trackedCaller = (receiver, port, ctx) => types.isProxy(receiver) &&
  !Object.hasOwn(receiver, Symbol.for('cordis.original')) && original(receiver) === port &&
  Object.getOwnPropertyDescriptor(receiver, 'ctx')?.value === ctx ? receiver.ctx : null;

/** All dependencies below are in-process ports, never caller JSON facts. */
export function createLocalRuntime({ ctx, homePath, resolveCanvas, resolveRegistry, resolveHistory, resolveOracle, resolveInspection, inspectConnection, log = message => console.warn(message) }) {
  const rows = new Map(); let serial = Promise.resolve(), closed = false;
  let activeCanvasCheck = () => {}, activeWriteRequest = null;
  let inventorySignature = null, inventoryRevision = `adapter:${ADAPTER_VERSION}:${randomUUID()}`;
  const stage1 = createStage1Facts();
  const runtime = {
    setLocalRoots() {},
    retireLocal(connectionRef) {
      const work = serial.then(async () => {
        if (closed) fail('ADAPTER_UNAVAILABLE');
        const row = rows.get(connectionRef);
        if (!row) fail('WORLD_NOT_BOUND');
        rows.delete(connectionRef);
        stage1.withdrawWorld(row.worldRef, 'CONNECTION_RETIRED');
        await row.engine.close();
      });
      serial = work.catch(() => {}); return work;
    },
    /** Whether this runtime still holds the world, and its journal's unsettled transactions. Read-only. */
    async localWorldActivity({ connectionRef, worldRef }) {
      const bound = [...rows.values()].some(row => row.connectionRef === connectionRef || row.worldRef === worldRef);
      return { bound, journal: await readJournalActivity(homePath, worldRef) };
    },
    async pairLocal(world) {
      if (closed || rows.has(world.connectionRef) || [...rows.values()].some(row =>
        row.worldRef === world.worldRef || row.worldPath === world.worldPath)) fail('CURRENT_WORLD_MISMATCH');
      const engine = await LocalCourier.open(world);
      try {
        await engine.handshake();
        const neutral = new NeutralEngine(engine);
        await neutral.catalogue();
        const profile = validateType('StateProfile', await neutral.profile());
        const limits = await neutral.regionLimits();
        if (limits.mapblockSize !== 16) fail('CAPABILITY_GAP');
        const bound = limits.mapgenLimit;
        const engineBounds = Number.isSafeInteger(bound) && bound > 0 ? {min:[-bound,-bound,-bound],max:[bound,bound,bound]} : null;
        const store = await LocalRecords.open(await nativeJournalDirectory(homePath, world.worldRef), world.worldRef);
        const row = { ...world, engine:neutral, profile, store, engineBounds, incarnation: engine.connectionIncarnationRef };
        neutral.beforeWrite = async () => {
          if (!activeWriteRequest) fail('CAPABILITY_UNAVAILABLE');
          await current(activeWriteRequest, row); activeCanvasCheck();
        };
        neutral.writeAuthorityCheck = () => {
          activeCanvasCheck();
          if (closed || row.engine.closed || rows.get(row.connectionRef) !== row) fail('CURRENT_WORLD_MISMATCH');
        };
        const revision = `${ADAPTER_ID}@${ADAPTER_VERSION}+${world.payloadDigest}`;
        row.backend = new LocalTransactions({ store, engine:neutral, stateProfile: profile,
          current: request => current(request, row), registry: resolveRegistry, historyFacts: resolveHistory, revision });
        rows.set(world.connectionRef, row);
        return { connectionRef: world.connectionRef, worldRef: world.worldRef,
          connectionIncarnationRef: row.incarnation, payloadVersion: world.payloadVersion, payloadDigest: world.payloadDigest };
      } catch (error) { await engine.close(); throw error; }
    },
    readCatalogue(worldRef) {
      // A read-only Host supplier. The requested world must be the actual paired
      // connection, before and after reading the loaded Luanti node registry.
      const work=serial.then(async()=>{
        if(closed) fail('ADAPTER_UNAVAILABLE');
        if(typeof worldRef!=='string' || !worldRef) fail('SCHEMA_INVALID');
        const matches=[...rows.values()].filter(row=>row.worldRef===worldRef);
        if(matches.length!==1) fail('WORLD_NOT_BOUND');
        const row=matches[0];
        await inspectConnection(row.connectionRef);
        if(row.engine.closed) fail('CURRENT_WORLD_MISMATCH');
        const catalogue=validateType('Catalogue',await row.engine.catalogue());
        await inspectConnection(row.connectionRef);
        if(closed || row.engine.closed || rows.get(row.connectionRef)!==row) fail('CURRENT_WORLD_MISMATCH');
        return catalogue;
      });
      serial=work.catch(()=>{});return work;
    },
    /** Catalogue and its write-path-init/v1 WritePathEvidence from one registry snapshot,
     * checked with the public validateCatalogueWritePathFacts before it is returned. */
    readWritePathEvidence(worldRef) {
      const work=serial.then(async()=>{
        if(closed) fail('ADAPTER_UNAVAILABLE');
        if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
        const matches=[...rows.values()].filter(row=>row.worldRef===worldRef);
        if(matches.length!==1) fail('WORLD_NOT_BOUND');
        const row=matches[0];
        await inspectConnection(row.connectionRef);
        if(row.engine.closed) fail('CURRENT_WORLD_MISMATCH');
        const raw=await row.engine.writePath();
        const catalogue=validateType('Catalogue',raw?.catalogue);
        const materials=[...(raw?.evidence?.materials??[])].sort((a,b)=>a.materialRef<b.materialRef?-1:a.materialRef>b.materialRef?1:0);
        const evidence=validateType('WritePathEvidence',{...raw?.evidence,materials,catalogueDigest:digestValue('catalogue',catalogue).sha256});
        const check=checkWritePathFacts(catalogue,evidence);
        await inspectConnection(row.connectionRef);
        if(closed||row.engine.closed||rows.get(row.connectionRef)!==row) fail('CURRENT_WORLD_MISMATCH');
        return {catalogue,evidence,check};
      });
      serial=work.catch(()=>{});return work;
    },
    /** Stage 1 facts of the exact currently paired world, checked current before and after. */
    readConfigEngineFacts(worldRef) { return stage1Read(worldRef, row => stage1.configEngineFacts(row, row.engine)); },
    async readWorldEditFacts(worldRef) {
      if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
      return Promise.reject(Object.assign(new ContractError('CAPABILITY_UNAVAILABLE','validate','REQUIRED_FACT_UNKNOWN'), {detail:'WORLDEDIT_FACTS_RETIRED_D15'}));
    },
    readStage1FactLedger(worldRef) {
      if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
      return stage1.ledger(worldRef);
    },
    readMaterialSources(worldRef) {
      const work=serial.then(async()=>{
        if(closed) fail('ADAPTER_UNAVAILABLE');
        if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
        const matches=[...rows.values()].filter(row=>row.worldRef===worldRef);
        if(matches.length!==1) fail('WORLD_NOT_BOUND');
        const row=matches[0];
        const check=async()=>{
          await inspectConnection(row.connectionRef);
          if(closed||row.engine.closed||rows.get(row.connectionRef)!==row) fail('CURRENT_WORLD_MISMATCH');
        };
        await check();
        const connection={worldRef:row.worldRef,connectionRef:row.connectionRef,connectionIncarnationRef:row.incarnation};
        const first=await row.engine.materialMetadata();
        const result=await resolveMaterialSources(first,connection);
        const last=await row.engine.materialMetadata();
        if(canonicalJSON(first)!==canonicalJSON(last)) fail('CURRENT_WORLD_MISMATCH');
        const confirmed=await resolveMaterialSources(last,connection);
        if(result.snapshot.sourceRevision!==confirmed.snapshot.sourceRevision) fail('CURRENT_WORLD_MISMATCH');
        await check();
        return confirmed;
      });
      serial=work.catch(()=>{});return work;
    },
    /** Read-only node state of a box in the exact currently paired world (no transaction,
     * no Canvas selection): the same emerge + VoxelManip chunk reads as ReadRegion, with
     * KNOWN/UNKNOWN per mapblock. Loading may generate never-visited map; nothing is written
     * by the Adapter. Host/dev suppliers use it for observation, never as a BEFORE_IMAGE. */
    readRegionState(worldRef, box) {
      const work=serial.then(async()=>{
        if(closed) fail('ADAPTER_UNAVAILABLE');
        if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
        const target=validateType('Box',box);
        const matches=[...rows.values()].filter(row=>row.worldRef===worldRef);
        if(matches.length!==1) fail('WORLD_NOT_BOUND');
        const row=matches[0];
        await inspectConnection(row.connectionRef);
        if(row.engine.closed) fail('CURRENT_WORLD_MISMATCH');
        const out=await readRegion(row.engine,{worldRef,box:target,partition:WORLD_GEOMETRY.partition,localContext:null});
        const chunks=out.result.chunks.map(c=>validateType('RegionChunkRead',c));
        for(const c of chunks) if(c.state && digestValue('region-state',c.state).sha256!==c.stateDigest) fail('CURRENT_WORLD_MISMATCH');
        await inspectConnection(row.connectionRef);
        if(closed||row.engine.closed||rows.get(row.connectionRef)!==row) fail('CURRENT_WORLD_MISMATCH');
        return {worldRef,connectionRef:row.connectionRef,connectionIncarnationRef:row.incarnation,
          payloadVersion:row.payloadVersion,payloadDigest:row.payloadDigest,box:target,chunks,facts:out.facts};
      });
      serial=work.catch(()=>{});return work;
    },
    readScopedState(connectionRef, positions) {
      const work = serial.then(async () => {
        if (closed) fail('ADAPTER_UNAVAILABLE');
        const row = rows.get(connectionRef); if (!row) fail('WORLD_NOT_BOUND');
        await inspectConnection(connectionRef);
        const image = await row.backend.snapshot(positions);
        await inspectConnection(connectionRef);
        if (row.engine.closed || rows.get(connectionRef) !== row) fail('CURRENT_WORLD_MISMATCH');
        return { worldRef: row.worldRef, stateProfile: row.profile, cells: image.records.map(record => ({
          position: record.position, availability: 'KNOWN', stateDigest: cellDigest(row.profile, record) })) };
      });
      serial = work.catch(() => {}); return work;
    },
    async close() { closed = true; await serial.catch(() => {}); stage1.withdrawAll('ADAPTER_CLOSED'); await Promise.all([...rows.values()].map(x => x.engine.close())); rows.clear(); },
  };
  function stage1Read(worldRef, read) {
    const work=serial.then(async()=>{
      if(closed) fail('ADAPTER_UNAVAILABLE');
      if(typeof worldRef!=='string'||!worldRef) fail('SCHEMA_INVALID');
      const matches=[...rows.values()].filter(row=>row.worldRef===worldRef);
      if(matches.length!==1) fail('WORLD_NOT_BOUND');
      const row=matches[0];
      const check=async()=>{
        await inspectConnection(row.connectionRef);
        if(closed||row.engine.closed||rows.get(row.connectionRef)!==row) fail('CURRENT_WORLD_MISMATCH');
      };
      await check();
      const out=await read(row);
      try { await check(); }
      catch(error) { stage1.withdrawWorld(worldRef,'CONNECTION_DOMAIN_CHANGED'); throw error; }
      return out;
    });
    serial=work.catch(()=>{});return work;
  }
  async function current(request, row) {
    if (closed) fail('ADAPTER_UNAVAILABLE');
    activeCanvasCheck();
    await inspectConnection(row.connectionRef);
    if (row.engine.closed || request.worldRef !== row.worldRef || request.localContext.connectionRef !== row.connectionRef ||
      request.localContext.connectionIncarnationRef !== row.incarnation || request.localContext.worldRef !== row.worldRef) fail('CURRENT_WORLD_MISMATCH');
    const canvas = resolveCanvas(); if (typeof canvas?.call !== 'function') fail('CAPABILITY_UNAVAILABLE');
    const input={contractVersion:'canvas/v7',requestId:`${request.requestId}:current-selection`,sessionRef:request.sessionRef,worldRef:request.worldRef};
    const reply=validateBoundResponse('canvas/v7','ReadWorldSelectionContext',input,await canvas.call('ReadWorldSelectionContext',input));
    if (closed) fail('ADAPTER_UNAVAILABLE');
    activeCanvasCheck();
    const selection=reply.result?.selection;
    if ((resolveCanvas()?.[Symbol.for('cordis.original')] ?? resolveCanvas()) !== (canvas[Symbol.for('cordis.original')] ?? canvas) ||
      reply.error || selection?.status !== 'BOUND' || selection.connectionRef !== row.connectionRef ||
      !sameContext(selection.context.localContext,request.localContext) || selection.context.currentSession !== request.sessionRef)
      fail('CURRENT_WORLD_MISMATCH');
    return selection.context.localContext;
  }
  function canvasCaller(caller, serviceName = 'hanaworldsCanvasV5') {
    // Cordis's shadow records this callee context; its fiber records the actual caller.
    // Registration ownership, never a plugin/package name or JSON role, grants authority.
    const key = ctx?.[Symbol.for('cordis.isolate')]?.[serviceName];
    const registered = key && ctx.reflect?.store?.[key];
    const value = registered?.value;
    const check = () => {
      const fiber = caller?.fiber;
      if (!registered || !value || typeof value.call !== 'function' ||
        caller?.[Symbol.for('cordis.shadow')] !== ctx || caller.root !== ctx.root ||
        !fiber || fiber.state !== 2 || fiber.ctx?.root !== ctx.root || fiber !== registered.fiber ||
        ctx.reflect.store[key] !== registered || registered.value !== value ||
        original(ctx.get?.(serviceName)) !== original(value) ||
        (serviceName === 'hanaworldsCanvasV5' && original(resolveCanvas()) !== original(value))) fail('CAPABILITY_UNAVAILABLE');
    };
    check(); return check;
  }
  function capabilities(row) {
    return { providerRef: ADAPTER_ID, capabilityRevision: `adapter:${ADAPTER_VERSION}:${row.payloadDigest}`,
      worldRef: row.worldRef, engineBounds: row.engineBounds, worldGeometry: WORLD_GEOMETRY, limits: [], recoveryGuarantee: 'RECOVERABLE_VERIFIED',
      // What this world's loaded payload actually checks, per guard and stage.
      engineGuards: engineGuardDeclaration(row.engine.engineGuards),
      stateProfile: row.profile, sessionDeleteSupported: true, imageMediaTypes: [], model: null };
  }
  async function perform(name, r, row) {
    const b = row?.backend;
    if(name==='ReadWorldSourceCapabilities') {
      const matches=[...rows.values()].filter(x=>x.worldRef===r.worldRef);
      if(matches.length!==1)fail('ADAPTER_UNAVAILABLE');
      const selected=matches[0];
      await inspectConnection(selected.connectionRef);
      const result=await readWorldSourceFact(name,selected);
      await inspectConnection(selected.connectionRef);
      if(closed||selected.engine.closed||rows.get(selected.connectionRef)!==selected)fail('CURRENT_WORLD_MISMATCH');
      return result;
    }
    if (name === 'ReadLocalConnection') {
      const result = validateType('LocalConnectionReadback', {
        connectionRef: row.connectionRef, connectionIncarnationRef: row.incarnation, worldRef: row.worldRef,
        payloadVersion: row.payloadVersion, payloadDigest: row.payloadDigest, capabilities: capabilities(row) });
      await inspectConnection(row.connectionRef);
      if (closed || row.engine.closed || rows.get(row.connectionRef) !== row) fail('CONNECTION_NOT_FOUND');
      return result;
    }
    if (name === 'DiscoverConnections' || name === 'ListWorlds') {
      const ready = [];
      for (const row of [...rows.values()]) {
        // A failed CURRENT check means unavailable, never proof of STOPPED.
        // Keep ownership/runtime records for explicit finite Host retirement.
        try { await inspectConnection(row.connectionRef); if (!closed && !row.engine.closed && rows.get(row.connectionRef) === row) ready.push(row); }
        catch { /* exclude invalid native readiness, preserve other connections */ }
      }
      const connections = ready.sort((a,b) => a.connectionRef < b.connectionRef ? -1 : a.connectionRef > b.connectionRef ? 1 : 0)
        .map(x => ({ adapterId: ADAPTER_ID, connectionRef: x.connectionRef,
          worldRef: x.worldRef, displayName: x.gameId, capabilityRevision: capabilities(x).capabilityRevision,
          payloadVersion: x.payloadVersion, readiness: 'READY', connectionIncarnationRef: x.incarnation }));
      const signature = canonicalJSON(connections);
      if (signature !== inventorySignature) { inventorySignature = signature; inventoryRevision = `adapter:${ADAPTER_VERSION}:${randomUUID()}`; }
      return { capabilityRevision: inventoryRevision, connections };
    }
    if (name === 'InspectWorld' || name === 'InspectRegion') return inspections(row, r, name);
    if (name === 'PrepareRecoverableTransaction') return b.prepare(r);
    if (name === 'ApplyCompiledTransaction') return b.apply(r);
    if (name === 'PrepareHistoryTransaction') return b.prepareHistory(r);
    if (name === 'ApplyHistoryTransaction') return b.applyHistory(r);
    if (name === 'Readback') {
      const saved=b.store.get(r.transactionId); if (!saved) fail('STALE_TRANSACTION');
      if(!sameContext(r.stateProfile,row.profile) || !sameContext(r.coveredPositions,saved.before.coveredPositions)) fail('REPLAY_MISMATCH');
      const image = await b.snapshot(r.coveredPositions);
      return { projection: readbackView(image), readbackDigest: D('readback', readbackView(image)), adapterExecutionRevision: b.revision };
    }
    const saved = b?.store.get(r.transactionId ?? r.originTransactionId);
    if (!saved) fail('STALE_TRANSACTION');
    if (name === 'QueryTransaction') { if (saved.transactionPayloadDigest !== r.transactionPayloadDigest) fail('REPLAY_MISMATCH'); return b.stored(saved); }
    if (name === 'QueryPreparedTransaction') { if (saved.request.scopeDigest !== r.scopeDigest || saved.operationDigest !== r.operationDigest) fail('REPLAY_MISMATCH'); return b.prepared(saved); }
    if (name === 'QueryPreparedHistoryTransaction') { if (saved.operationDigest !== r.historyOperationDigest || saved.request.originTransactionId !== r.originTransactionId) fail('REPLAY_MISMATCH'); return saved.prepared; }
    if (name === 'RestoreTransaction') {
      if (saved.operationDigest !== r.operationDigest || saved.beforeImageDigest !== r.beforeImageDigest) fail('REPLAY_MISMATCH');
      if (saved.status === 'ROLLED_BACK') return b.stored(saved).receipt;
      if (!['RECOVERY_PENDING','RESTORE_FAILED'].includes(saved.status)) fail('STALE_TRANSACTION');
      return b.rollback(saved);
    }
    if (name === 'AbortPreparedTransaction' || name === 'AbortPreparedHistoryTransaction') {
      if (saved.status !== 'PREPARED') fail('STALE_TRANSACTION');
      if (saved.operationDigest !== (r.operationDigest ?? r.historyOperationDigest)) fail('REPLAY_MISMATCH');
      saved.status = 'ABORTED_PREPARED'; await b.store.put(saved);
      return { transactionId: r.transactionId, status: 'ABORTED_PREPARED', mutationState: 'NONE' };
    }
    fail('UNSUPPORTED_OPERATION');
  }
  async function inspections(row, r, name) {
    const oracle = resolveOracle();
    if (typeof oracle?.read !== 'function') fail('CAPABILITY_UNAVAILABLE');
    const oracleIdentity = original(oracle);
    const checkOracle = () => { if (original(resolveOracle()) !== oracleIdentity) fail('CURRENT_WORLD_MISMATCH'); };
    const observed = await oracle.read(r.worldRef); checkOracle();
    if (observed !== r.expectedWorldRevision) fail('STALE_REVISION');
    const catalogue = validateType('Catalogue', await row.engine.catalogue());
    const frame = { profileVersion:'frame/v2', frameId:`luanti-world-grid:${r.worldRef}`,
      origin:[0,0,0], axes:['+X','+Y','+Z'], handedness:'left',
      gridUnit:{name:'cell',metersPerGridUnit:null},transformRevision:row.backend.revision };
    let raw, bounds, positions, source, selection, checkInspection = () => {};
    if (name === 'InspectRegion') {
      const fp=r.footprint, st=r.placementSettings;
      const count=BigInt(fp.widthCells)*BigInt(fp.depthCells)*BigInt(fp.heightCells+1);
      if(count>BigInt(Number.MAX_SAFE_INTEGER) || (await row.engine.capacity(Number(count)))?.allowed !== true) fail('LIMIT_EXCEEDED');
      raw=await row.engine.inspectRegion({sessionRef:r.sessionRef,anchor:r.anchor,footprint:fp,settings:st });
      checkOracle();
      if(raw.kind==='CHOICE') return {outcome:'PLACEMENT_CHOICE_REQUIRED',choice:{anchorKind:r.anchor.kind,
        reasons:[...new Set(raw.reasons)].sort(),options:['PICK_WORLD_POINT'],placementSettings:st,observedWorldRevision:observed}};
      // world-adapter/v8: no body geometry crosses; the engine refused body cells itself.
      if(raw.kind!=='REGION' || !Array.isArray(raw.cells) || !raw.cells.length || 'body' in raw) fail('INSPECTION_FAILED');
      positions=raw.cells.map(c=>c.position).sort(comparePosition);
      bounds={min:[0,1,2].map(i=>Math.min(...positions.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...positions.map(p=>p[i])))};
      source='REGION_INSPECTED';
      raw={...raw,occupiedCells:raw.cells.filter(c=>c.state==='OCCUPIED').map(c=>({position:c.position,...row.engine.material(c.nodeName,c.param2)})),
        knownEmptyCells:raw.cells.filter(c=>c.state==='AIR').map(c=>c.position),unknownCells:[]};
    } else {
      const provider=resolveInspection?.();
      if(typeof provider?.ReadInspectionContext!=='function') {
        log('WORLD_INSPECTION_CONTEXT_UNAVAILABLE: hanaworldsWorldInspectionContext.ReadInspectionContext');
        fail('CAPABILITY_UNAVAILABLE');
      }
      const identity = original(provider);
      checkInspection = () => { if (original(resolveInspection()) !== identity) fail('CURRENT_WORLD_MISMATCH'); };
      selection=await createInspectionContext({resolveInspection,resolveCanvas,resolveOracle}).read(r); checkInspection(); checkOracle();
      if(selection?.current!==true || selection.worldRef!==r.worldRef || selection.worldRevision!==observed ||
        typeof selection.objectRef!=='string' || typeof selection.objectRevision!=='string') fail('TARGET_FACTS_INCOMPLETE');
      bounds=r.sampledBounds;
      const count=bounds.max.reduce((n,v,i)=>n*BigInt(v-bounds.min[i]+1),1n);
      if(count>BigInt(Number.MAX_SAFE_INTEGER) || (await row.engine.capacity(Number(count)))?.allowed!==true) fail('LIMIT_EXCEEDED');
      positions=[];
      for(let x=bounds.min[0];x<=bounds.max[0];x++) for(let y=bounds.min[1];y<=bounds.max[1];y++) for(let z=bounds.min[2];z<=bounds.max[2];z++) positions.push([x,y,z]);
      raw=await row.engine.inspect(positions); source='INSPECTED';
    }
    const targetFacts=validateType('TargetFacts',{profileVersion:'target-facts/v5',geometryProfile:GEOMETRY_PROFILE,source,worldRef:r.worldRef,
      objectRef:selection?.objectRef??null,worldRevision:observed,objectRevision:selection?.objectRevision??null,buildDigest:null,planRevision:null,
      catalogueDigest:D('catalogue',catalogue),frameDigest:D('frame',frame),sampledBounds:bounds,
      coverageDigest:D('coverage',{profileVersion:'coverage/v2',sampledBounds:bounds,sampledPositions:positions}),
      occupiedCells:raw.occupiedCells.sort((a,b)=>comparePosition(a.position,b.position)),knownEmptyCells:raw.knownEmptyCells.sort(comparePosition),
      unknownCells:raw.unknownCells,portals:[],usableVolume:raw.unknownCells.length?null:{emptyCellCount:raw.knownEmptyCells.length,physicalVolume:null,standingArea:null,unit:'cell'}});
    checkOracle(); checkInspection();
    if(await oracle.read(r.worldRef)!==observed) fail('STALE_REVISION');
    checkOracle(); checkInspection();
    if(name==='InspectWorld') return targetFacts;
    return {outcome:'REGION_INSPECTED',inspection:{inspectionId:r.inspectionId,anchorKind:r.anchor.kind,targetFacts,
      targetFactsDigest:D('target-facts',targetFacts),frame,evidence:{providerRef:ADAPTER_ID,sourceRevision:row.backend.revision,worldRef:r.worldRef,worldRevision:observed},
      entranceFacing:raw.entranceFacing,placementSettings:r.placementSettings}};
  }
  // world-adapter-region/v3 for the Canvas transaction owner: current paired
  // world/selection only, serialized with every other courier use.
  const REGION_WIRE = 'world-adapter-region/v3';
  let regionFacts = null;
  const regionIO = {
    ctx,
    [Symbol.for('cordis.tracker')]: { property: 'ctx' },
    contractVersion: REGION_WIRE,
    protocolHandshake,
    /** Engine facts of the last region call (batches, emerge actions); evidence only. */
    lastFacts: () => regionFacts,
    get call() {
      // Capture Cordis's real getter receiver before returning a non-rebindable call.
      const caller = trackedCaller(this, regionIO, ctx);
      return (name, raw) => {
      // A different wire (e.g. world-adapter-region/v3) is UNSUPPORTED_VERSION
      // before any engine dispatch.
      const wire = typeof raw?.contractVersion === 'string' ? raw.contractVersion : REGION_WIRE;
      const r = validateRequest(wire, name, raw);
      const work = serial.then(async () => {
        regionFacts = null;
        const respond = result => validateResponse(REGION_WIRE, name, shaped(name, { contractVersion: REGION_WIRE, requestId: r.requestId, result, error: null }));
        try {
          if (closed) fail('ADAPTER_UNAVAILABLE');
          activeCanvasCheck = canvasCaller(caller, 'hanaworldsCanvasRegionV1');
          activeWriteRequest = r;
          const row = rows.get(r.localContext.connectionRef);
          if (!row) fail('WORLD_NOT_BOUND');
          await current(r, row);
          if (row.engine.closed) fail('CURRENT_WORLD_MISMATCH');
          const out = name === 'ReadRegion' ? await readRegion(row.engine, r) : await writeRegion(row.engine, r);
          regionFacts = out.facts;
          const response = respond(out.result);
          if (name === 'ReadRegion') { await current(r, row); validateRegionRead(r, response); }
          else validateRegionWrite(r, response);
          return response;
        } catch (error) {
          if (error instanceof RegionFault && error.refusal) return validateResponse(REGION_WIRE, name, { contractVersion: REGION_WIRE,
            requestId: r.requestId, result: null, ...error.refusal });
          const code = schemaBundle.definitions.ErrorCode.enum.includes(error.code ?? error.message) ? error.code ?? error.message : 'CAPABILITY_UNAVAILABLE';
          return validateResponse(REGION_WIRE, name, shaped(name, { contractVersion: REGION_WIRE, requestId: r.requestId, result: null,
            error: { code, phase: 'validate', retryability: 'AFTER_NEW_FACTS', mutationState: 'NONE',
              transactionRef: r.transactionId ?? null, causeCode: null,
              reason: error instanceof RegionFault ? error.reason : 'REQUIRED_FACT_UNKNOWN' } }));
        }
      });
      serial = work.finally(() => { activeCanvasCheck = () => {}; activeWriteRequest = null; }).catch(() => {}); return work;
      };
    },
  };
  const port = {
    ctx,
    [Symbol.for('cordis.tracker')]: { property: 'ctx' },
    contractHandshake,
    protocolHandshake: worldAdapterProtocolHandshake,
    contractVersion: WIRE,
    get call() {
      // Capture Cordis's real getter receiver before returning a non-rebindable call.
      const caller = trackedCaller(this, port, ctx);
      return (name, raw) => {
      const r = typeof raw === 'string' || raw instanceof Uint8Array ? admitRequest(WIRE, name, raw) : validateBoundRequest(WIRE, name, raw);
      // Inventory is a read-only native projection. Canvas/Inspection may read it
      // during this Adapter call; queuing it behind that caller deadlocks.
      const inventoryRead = name === 'DiscoverConnections' || name === 'ListWorlds';
      const execute = async () => {
        try {
          if (closed) fail('ADAPTER_UNAVAILABLE');
          if (mutators.has(name)) { activeCanvasCheck = canvasCaller(caller); activeWriteRequest = r; }
          const row = r.connectionRef ? rows.get(r.connectionRef) : r.localContext ? rows.get(r.localContext.connectionRef) : null;
          if (r.connectionRef && !row) fail('CONNECTION_NOT_FOUND');
          if (r.localContext) {
            if (!row) fail('WORLD_NOT_BOUND');
            const actual = await current(r, row);
            const key = `${r.sessionRef}\u0000${name}\u0000${r.requestId}`, prior = row.store.request(key);
            const admission = validateCurrentRequest(WIRE, name, r, { currentContext: actual, sessionRef: r.sessionRef,
              currentTurnRevision: null, currentBriefDigest: null, requestState: prior ? 'COMPLETED' : 'ACTIVE',
              replay: prior ? 'EXACT_REPLAY' : 'NEW', priorRequestDigest: prior?.digest ?? null });
            if (admission.disposition === 'RETURN_STORED') return prior.response;
            const result = await perform(name, r, row);
            // QueryTransaction answers with the durable receipt as written beside the current context.
            const response = name === 'QueryTransaction' ? historicalReceiptResponse(r, result.receipt, result.receiptDigest)
              : validateBoundResponse(WIRE, name, r, shaped(name, { contractVersion: WIRE, requestId: r.requestId, result, error: null }));
            await current(r, row); await row.store.finish(key, admission.requestDigest, response); return response;
          }
          if (row) await inspectConnection(row.connectionRef);
          return validateBoundResponse(WIRE, name, r, shaped(name, { contractVersion: WIRE, requestId: r.requestId, result: await perform(name, r, row), error: null }));
        } catch (error) {
          const saved = r.transactionId && rows.get(r.localContext?.connectionRef)?.store.get(r.transactionId);
          // A failed restore answers with the receipt's restore error and guard refusal; a guard
          // that refused before any write answers with its contract error and GuardRefusal.
          const backend = rows.get(r.localContext?.connectionRef)?.backend;
          const named = saved?.status === 'RESTORE_FAILED' && error.message === 'RESTORE_FAILED' && backend
            ? (({ error, guardRefusal }) => ({ error, guardRefusal }))(backend.receipt(saved))
            : STAGE[name] ? refusalDetail(STAGE[name], error.detail, { transactionRef: r.transactionId ?? null }) : null;
          if (named) return validateBoundResponse(WIRE, name, r, shaped(name, { contractVersion: WIRE, requestId: r.requestId, result: null, ...named }));
          const mutationState = saved && !['PREPARED','ABORTED_PREPARED'].includes(saved.status) ? 'UNKNOWN' : 'NONE';
          const code = name === 'ReadWorldSourceCapabilities' && !['CURRENT_WORLD_MISMATCH','CATALOGUE_MISMATCH','SCHEMA_INVALID','UNKNOWN_REQUIRED_FIELD','UNSUPPORTED_VERSION'].includes(error.code??error.message)
            ? 'ADAPTER_UNAVAILABLE' : name === 'ReadLocalConnection'
            ? ((error.code ?? error.message) === 'PAYLOAD_VERSION_MISMATCH' ? 'PAYLOAD_VERSION_MISMATCH' : 'CONNECTION_NOT_FOUND')
            : schemaBundle.definitions.ErrorCode.enum.includes(error.code ?? error.message) ? error.code ?? error.message : 'CAPABILITY_UNAVAILABLE';
          return validateBoundResponse(WIRE, name, r, shaped(name, { contractVersion: WIRE, requestId: r.requestId, result: null,
            error: { code, phase: mutationState==='UNKNOWN'?'apply':'validate', retryability: 'NEVER', mutationState,
              transactionRef: r.transactionId ?? null, causeCode: null, reason: 'REQUIRED_FACT_UNKNOWN' } }));
        }
      };
      const work = inventoryRead ? execute() : serial.then(execute);
      if (!inventoryRead) serial = work.finally(() => { activeCanvasCheck = () => {}; activeWriteRequest = null; }).catch(() => {});
      return work;
      };
    },
  };
  const worldFacts={contractVersion:'world-facts/v1',contractHandshake,
    protocolHandshake:validateType('ProtocolHandshake',{...worldAdapterProtocolHandshake,
      protocols:[{protocol:'world-facts',major:1,minor:0}],capabilities:['world-facts/v1:named-reads']}),
    async call(name,input) {
      const wire='world-facts/v1';
      const request=typeof input==='string'||input instanceof Uint8Array?admitRequest(wire,name,input):validateBoundRequest(wire,name,input);
      let result=null,error=null;
      try { result=await stage1Read(request.worldRef,row=>readWorldSourceFact(name,row)); }
      catch(failure) {
        const cause=failure.code??failure.message;
        const currency=['CURRENT_WORLD_MISMATCH','CATALOGUE_MISMATCH','SCHEMA_INVALID','UNKNOWN_REQUIRED_FIELD','UNSUPPORTED_VERSION'];
        const code=currency.includes(cause)?cause:name==='ReadCatalogue'&&cause==='WORLD_NOT_BOUND'?'WORLD_NOT_BOUND'
          :name==='ReadMaterialSources'?'CAPABILITY_UNAVAILABLE':'ADAPTER_UNAVAILABLE';
        error=new ContractError(code,'validate','REQUIRED_FACT_UNKNOWN').publicError;
      }
      return validateBoundResponse(wire,name,request,{contractVersion:wire,requestId:request.requestId,result,error});
    }};
  return { ...runtime, port, regionIO, worldFacts };
}
