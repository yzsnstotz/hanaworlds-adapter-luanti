import { refusalDetail } from './safety-capabilities.mjs';
import { validateType, digestValue, encodeRegionBlock, expandRegionBlock, regionBlockBox,
  regionChunksOfBox, comparePosition } from '#contracts';
import { blocksPerBatch, batches, groupBoxes, expandRead, writeRuns, BLOCK } from './region-batches.mjs';
import { ADAPTER_ID, ADAPTER_VERSION } from './version.mjs';

/*
 * world-adapter-region/v2 transport over the paired Luanti engine. The Adapter
 * reports per-chunk engine facts only: it never decides or claims a commit.
 * Canvas compares summaries and restores its own snapshot (purpose RESTORE).
 */
export const LIGHT_METHOD = 'luanti:VoxelManip.write_to_map(light=true)+core.fix_light';
const KNOWN_ACTIONS = new Set(['FROM_MEMORY', 'FROM_DISK', 'GENERATED', 'CANCELLED']);
const LOST = new Set(['RECOVERY_PENDING', 'ENGINE_RESPONSE_UNKNOWN', 'ADAPTER_UNAVAILABLE']);
const key = p => p.join(',');
const sha = (kind, v) => digestValue(kind, v).sha256;
const floorBlock = n => Math.floor(n / BLOCK);
const blockOf = box => box.min.map(floorBlock);
export class RegionFault extends Error {
  constructor(code, reason, refusal = null) { super(code); this.reason = reason; this.refusal = refusal; }
}

export const protocolHandshake = Object.freeze(validateType('ProtocolHandshake', {
  profileVersion: 'protocol-handshake/v1', component: ADAPTER_ID,
  protocols: [{ protocol: 'world-adapter-region', major: 2, minor: 0 }],
  // callback-free-write: region writes and restores are VoxelManip node data (voxel.lua).
  capabilities: ['world-adapter-region/v2:callback-free-write', 'world-adapter-region/v2:chunked-read',
    'world-adapter-region/v2:chunked-write', 'world-adapter-region/v2:lighting-complete',
    'world-adapter-region/v2:load-then-know', 'world-adapter-region/v2:restore-state'],
  // Provenance is a record only; an installed package cannot know its own tar digest.
  provenance: { packageName: ADAPTER_ID, packageVersion: ADAPTER_VERSION, sourceRevision: null, artifactDigest: null },
}));

/** world-adapter/v7 runtime protocol (minor 0; contracts 1.0 reset minors): per-cell writes and
 * restores are WorldEdit set/set_param2 (VoxelManip) plus swap_node, and the Catalogue
 * publishes hasCallbacks/hasPersistentState under that scope. */
export const worldAdapterProtocolHandshake = Object.freeze(validateType('ProtocolHandshake', {
  profileVersion: 'protocol-handshake/v1', component: ADAPTER_ID,
  protocols: [{ protocol: 'world-adapter', major: 7, minor: 0 }],
  capabilities: ['world-adapter/v7:callback-free-write', 'world-adapter/v7:write-path-state-facts'],
  provenance: { packageName: ADAPTER_ID, packageVersion: ADAPTER_VERSION, sourceRevision: null, artifactDigest: null },
}));

/** RegionState of one box from an expanded engine read (all cells specified). */
function stateOf(worldRef, read, box) {
  const size = box.max.map((v, i) => v - box.min[i] + 1);
  const palette = [], index = new Map();
  const indices = new Int32Array(size[0] * size[1] * size[2]);
  let i = 0;
  for (let z = box.min[2]; z <= box.max[2]; z++)
    for (let y = box.min[1]; y <= box.max[1]; y++)
      for (let x = box.min[0]; x <= box.max[0]; x++) {
        const j = read.at(x, y, z), nodeName = read.names[read.name[j]], param2 = read.param2[j];
        const k = `${nodeName}\t${param2}`;
        let p = index.get(k);
        if (p === undefined) { p = palette.length; palette.push({ nodeName, param2 }); index.set(k, p); }
        indices[i++] = p;
      }
  const inside = p => p.every((v, a) => v >= box.min[a] && v <= box.max[a]);
  const extras = read.extras.filter(e => inside(e.position))
    .map(e => ({ position: e.position, metadata: e.fields ?? {}, inventory: e.inventory ?? {}, timer: e.timer ?? null }))
    .filter(e => Object.keys(e.metadata).length > 0 || Object.keys(e.inventory).length > 0 || e.timer !== null)
    .sort((a, b) => comparePosition(a.position, b.position));
  return validateType('RegionState', { profileVersion: 'region-state/v1', worldRef,
    block: encodeRegionBlock({ origin: box.min, size, palette, indices }), extras, derivedLightMode: 'recompute-with-readback' });
}

function unknownReason(action, box, limits) {
  if (action === 'ERRORED') return 'LOAD_FAILED';
  const limit = limits.mapgenLimit;
  if (Number.isFinite(limit) && [...box.min, ...box.max].some(v => Math.abs(v) > limit)) return 'OUTSIDE_WORLD_LIMITS';
  if (action === 'NOT_REPORTED') return 'READ_FAILED';
  return 'LOAD_FAILED';
}

/** Load (emerge) then read boxes: per box a contract chunk read plus the engine
 * guard used for the later same-step write check. */
async function loadAndRead(engine, worldRef, groups, limits) {
  const out = new Map();
  for (const group of groups) {
    const emerged = await engine.regionEmerge(group.box.min, group.box.max);
    const actions = new Map((emerged?.blocks ?? []).map(b => [key(b.blockPos), b.action]));
    const preloaded = new Map((emerged?.blocks ?? []).map(b => [key(b.blockPos), b.loadedBefore === true]));
    let parts = [{ items: group.items }], replies;
    try {
      replies = [await engine.regionRead({ min: group.box.min, max: group.box.max, boxes: group.items.map(i => i.box) })];
    } catch (error) {
      if (error?.message !== 'LIMIT_EXCEEDED' || group.items.length === 1) throw error;
      // Metadata made this batch's reply exceed the courier body: read each box alone.
      parts = []; replies = [];
      for (const item of group.items) {
        parts.push({ items: [item] });
        replies.push(await engine.regionRead({ min: item.box.min, max: item.box.max, boxes: [item.box] }));
      }
    }
    replies.forEach((reply, r) => {
      const read = expandRead(reply);
      parts[r].items.forEach((item, i) => {
        const g = reply.boxes[i];
        const action = actions.get(key(blockOf(item.box))) ?? 'NOT_REPORTED';
        // The engine readback decides: KNOWN only when no cell reads as 'ignore'.
        // Luanti also reports CANCELLED for a queued block that another queued
        // block's mapchunk generated, so CANCELLED is a fact, not a verdict.
        const known = g.ignoreCells === 0 && KNOWN_ACTIONS.has(action);
        const state = known ? stateOf(worldRef, read, item.box) : null;
        out.set(key(item.box.min), { action, loadedBefore: preloaded.get(key(blockOf(item.box))), guard: g.guard, chunk: { chunkPos: blockOf(item.box), box: item.box,
          availability: known ? 'KNOWN' : 'UNKNOWN',
          loadMethod: known ? (preloaded.get(key(blockOf(item.box))) ? 'ALREADY_LOADED' : 'LOADED_BY_EMERGE') : null,
          unknownReason: known ? null : unknownReason(action, item.box, limits),
          state, stateDigest: state ? sha('region-state', state) : null } });
      });
    });
  }
  return out;
}

export async function readRegion(engine, request) {
  const limits = await engine.regionLimits();
  const perBatch = blocksPerBatch(limits);
  const chunks = regionChunksOfBox(request.box);
  const items = chunks.map(c => ({ box: { min: [...c.box.min], max: [...c.box.max] } }));
  const groups = batches(request.box.min, request.box.max, perBatch).map(b => ({ box: b,
    items: items.filter(i => i.box.min.every((v, a) => v >= b.min[a]) && i.box.max.every((v, a) => v <= b.max[a])) }));
  const read = await loadAndRead(engine, request.worldRef, groups, limits);
  return { result: { worldRef: request.worldRef, box: request.box,
    chunks: chunks.map(c => read.get(key(c.box.min)).chunk), localContext: request.localContext },
    facts: { batches: groups.length, emerge: [...read.values()].map(v => v.action),
      loadedBefore: [...read.values()].map(v => v.loadedBefore) } };
}

/**
 * Precheck every chunk (loaded, KNOWN, expectedCurrentDigest, engine-side
 * check-only of the write), then write batch by batch and read back. Failures
 * before the first write are errors with mutationState NONE; after it, every
 * chunk carries its own WRITTEN / NOT_WRITTEN / UNKNOWN fact.
 */
export async function writeRegion(engine, request) {
  const limits = await engine.regionLimits();
  const perBatch = blocksPerBatch(limits);
  const apply = request.purpose === 'APPLY';
  const items = request.writes.map(w => {
    const box = regionBlockBox(apply ? w.ops : w.state.block);
    return { write: w, box: { min: [...box.min], max: [...box.max] } };
  });
  const groups = groupBoxes(items, i => i.box, perBatch);
  const before = await loadAndRead(engine, request.worldRef, groups, limits);
  for (const item of items) {
    const seen = before.get(key(item.box.min));
    if (seen.chunk.availability !== 'KNOWN') throw new RegionFault('TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
    if (seen.chunk.stateDigest !== item.write.expectedCurrentDigest) throw new RegionFault('TRANSACTION_CONFLICT', 'EXTERNAL_EDIT_CONFLICT');
    const block = expandRegionBlock(apply ? item.write.ops : item.write.state.block);
    item.command = { ...writeRuns(item.box, block.indices, block.palette, -1), guard: seen.guard,
      ...(apply ? {} : { extras: item.write.state.extras }) };
  }
  // Compressed planned WORLD geometry only. The engine resolves passability and reads real
  // bodies at every check and write batch. The entire plan detects cross-chunk enclosure.
  const enclosure = { chunks: items.map(i => ({ min: i.command.min, max: i.command.max,
    palette: i.command.palette, contentRuns: i.command.contentRuns })) };
  const command = (group, checkOnly) => ({ purpose: request.purpose, min: group.box.min, max: group.box.max,
    chunks: group.items.map(i => i.command), checkOnly, enclosure });
  for (const group of groups) {
    try { await engine.regionWrite(command(group, true)); }
    catch (error) {
      // Engine guards refuse in this check-only pass, before any write of the request. A RESTORE
      // refusal is the engine form (no cause known here); Canvas adds the cause when it rolls back.
      const refusal = refusalDetail(apply ? 'REGION_APPLY' : 'REGION_RESTORE', error?.detail, { transactionRef: request.transactionId });
      throw new RegionFault(error?.message ?? 'CAPABILITY_UNAVAILABLE', 'APPLY_ERROR', refusal);
    }
  }
  const status = new Map(), facts = [];
  let lightComplete = true, failure = null;
  for (const [index, group] of groups.entries()) {
    if (failure) { group.items.forEach(i => status.set(key(i.box.min), 'NOT_WRITTEN')); continue; }
    try {
      const reply = await engine.regionWrite(command(group, false));
      if (reply?.written !== true) throw new Error('CAPABILITY_UNAVAILABLE');
      lightComplete &&= reply.lightComplete === true;
      facts.push({ batch: index, chunks: group.items.length, changedCells: reply.changedCells, extrasCleared: reply.extrasCleared,
        extrasSet: reply.extrasSet, lightComplete: reply.lightComplete, lightBox: reply.lightBox });
      group.items.forEach(i => status.set(key(i.box.min), 'WRITTEN'));
    } catch (error) {
      const refusal = refusalDetail(apply ? 'REGION_APPLY' : 'REGION_RESTORE', error?.detail, { transactionRef: request.transactionId });
      // A first-batch refusal is proven zero-write. Later refusals retain partial chunk status
      // for Canvas to restore; never label a partial request NONE.
      if (index === 0 && refusal) throw new RegionFault(error.message, 'APPLY_ERROR', refusal);
      const code = error?.message ?? 'CAPABILITY_UNAVAILABLE';
      failure = { batch: index, code, ...(refusal ? { guardRefusal: refusal.guardRefusal } : {}) };
      facts.push({ batch: index, chunks: group.items.length, error: code });
      group.items.forEach(i => status.set(key(i.box.min), LOST.has(code) ? 'UNKNOWN' : 'NOT_WRITTEN'));
    }
  }
  // Readback of every written chunk from the map.
  const readback = new Map();
  for (const group of groups) {
    const done = group.items.filter(i => status.get(key(i.box.min)) === 'WRITTEN');
    if (!done.length) continue;
    try {
      const reply = await engine.regionRead({ min: group.box.min, max: group.box.max, boxes: done.map(i => i.box) });
      const read = expandRead(reply);
      done.forEach((item, i) => {
        if (reply.boxes[i].ignoreCells === 0) readback.set(key(item.box.min), sha('region-state', stateOf(request.worldRef, read, item.box)));
      });
    } catch (error) { facts.push({ readbackError: error?.message ?? 'CAPABILITY_UNAVAILABLE' }); }
  }
  const chunks = items.map(i => {
    let s = status.get(key(i.box.min)); const digest = readback.get(key(i.box.min)) ?? null;
    if (s === 'WRITTEN' && digest === null) s = 'UNKNOWN'; // written but no readback: outcome not known
    return { chunkPos: i.write.chunkPos, status: s, readbackDigest: s === 'WRITTEN' ? digest : null };
  });
  const anyWritten = chunks.some(c => c.status === 'WRITTEN');
  const lightBox = items.reduce((b, i) => ({ min: b.min.map((v, a) => Math.min(v, i.box.min[a])),
    max: b.max.map((v, a) => Math.max(v, i.box.max[a])) }), { min: [...items[0].box.min], max: [...items[0].box.max] });
  return { result: { transactionId: request.transactionId, worldRef: request.worldRef, purpose: request.purpose, chunks,
    lighting: { status: anyWritten && lightComplete ? 'COMPLETE' : 'NOT_COMPLETE', box: lightBox, method: LIGHT_METHOD },
    localContext: request.localContext }, facts: { batches: facts, failure } };
}
