// region-voxels/v1 declarative domain rules. Pure: no digest, world, compression
// or transaction logic. Called from validateDomain after the closed shape check.
import { requireFact } from '../errors.mjs';
import { compareUTF16 } from '../geometry.mjs';
export const CHUNK_EDGE = 16; // Luanti MAP_BLOCKSIZE: engine unit, not a policy threshold
const shape = ok => requireFact(ok, 'SCHEMA_INVALID', 'INVALID_SHAPE');
const geometry = ok => requireFact(ok, 'SCHEMA_INVALID', 'INVALID_GEOMETRY');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const comparePalette = (a, b) => compareUTF16(a.nodeName, b.nodeName) || (a.param2 - b.param2);
/** Inclusive node box of a block; BigInt guards the max corner against overflow. */
export function blockBox(block) {
  const max = block.origin.map((o, a) => BigInt(o) + BigInt(block.size[a]) - 1n);
  geometry(max.every(v => v <= BigInt(Number.MAX_SAFE_INTEGER)));
  return { min: [...block.origin], max: max.map(Number) };
}
export function blockCellCount(block) {
  const n = block.size.reduce((acc, s) => acc * BigInt(s), 1n);
  geometry(n <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(n);
}
export const floorDiv = v => Math.floor(v / CHUNK_EDGE);
export const chunkBox = c => ({ min: c.map(v => v * CHUNK_EDGE), max: c.map(v => v * CHUNK_EDGE + CHUNK_EDGE - 1) });
export const boxWithin = (inner, outer) => inner.min.every((v, a) => v >= outer.min[a] && inner.max[a] <= outer.max[a]);
export function intersectBox(a, b) {
  const min = a.min.map((v, i) => Math.max(v, b.min[i])); const max = a.max.map((v, i) => Math.min(v, b.max[i]));
  return min.every((v, i) => v <= max[i]) ? { min, max } : null;
}
/** Every mapblock intersecting box, ascending x,y,z, with the clipped node box. */
export function chunksOfBox(box) {
  const lo = box.min.map(floorDiv), hi = box.max.map(floorDiv); const out = [];
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    const chunkPos = [x, y, z]; out.push({ chunkPos, box: intersectBox(chunkBox(chunkPos), box) });
  }
  return out;
}
function regionBlock(v) {
  const total = blockCellCount(v); blockBox(v);
  for (const entry of v.palette) {
    // The engine's own skip marker would make UNSPECIFIED ambiguous.
    shape(entry.nodeName !== 'ignore');
    if (entry.nodeName === 'air') shape(entry.param2 === 0);
  }
  let sum = 0, previous, specified = false; const used = new Set();
  for (const [count, index] of v.runs) {
    // Canonical run-length form: adjacent runs never repeat a value.
    shape(index !== previous); previous = index; sum += count;
    if (index !== null) { shape(index < v.palette.length); used.add(index); specified = true; }
  }
  shape(Number.isSafeInteger(sum) && sum === total);
  shape(specified && used.size === v.palette.length);
}
function regionState(v) {
  shape(v.block.runs.every(([, index]) => index !== null));
  const box = blockBox(v.block);
  for (const extra of v.extras) {
    geometry(extra.position.every((p, a) => p >= box.min[a] && p <= box.max[a]));
    shape(Object.keys(extra.metadata).length > 0 || Object.keys(extra.inventory).length > 0 || extra.timer !== null);
  }
}
const inChunk = (chunkPos, box) => geometry(boxWithin(box, chunkBox(chunkPos)));
const world = (v, ...refs) => requireFact(refs.every(r => r === v.worldRef) && v.localContext.worldRef === v.worldRef, 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
function summaryCoherent(worldRef, ...summaries) {
  requireFact(summaries.every(s => s.worldRef === worldRef), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  const layout = s => JSON.stringify(s.chunks.map(c => [c.chunkPos, c.box]));
  shape(summaries.every(s => layout(s) === layout(summaries[0])));
}
export function validateRegionDomain(name, v) {
  if (name === 'RegionVoxelBlock') regionBlock(v);
  else if (name === 'RegionState') regionState(v);
  else if (name === 'RegionChunk') inChunk(v.chunkPos, blockBox(v.block));
  else if (name === 'RegionBuildProjection') shape(same(blockBox(v.block), v.declaredBounds));
  else if (name === 'CompiledRegionSet') {
    const boxes = v.projection.chunks.map(c => blockBox(c.block));
    const min = [0, 1, 2].map(a => Math.min(...boxes.map(b => b.min[a]))), max = [0, 1, 2].map(a => Math.max(...boxes.map(b => b.max[a])));
    geometry(same({ min, max }, v.writeBounds));
  } else if (name === 'CompileRegionBuildRequest') {
    world(v, v.build.worldRef); shape(v.build.catalogueDigest === v.catalogueDigest);
  } else if (name === 'ValidateRegionProposalRequest') {
    world(v, v.intent.intendedWorldRef);
    shape(v.referenceBrief.sessionRef === v.sessionRef && v.referenceBrief.turnRevision === v.turnRevision && v.intent.referenceBriefDigest === v.referenceBriefDigest);
  } else if (name === 'ReadRegionRequest') world(v);
  else if (name === 'RegionChunkRead') {
    inChunk(v.chunkPos, v.box);
    if (v.availability === 'KNOWN') {
      shape(v.state !== null && v.stateDigest !== null && v.loadMethod !== null && v.unknownReason === null);
      shape(same(blockBox(v.state.block), v.box));
    } else shape(v.state === null && v.stateDigest === null && v.unknownReason !== null);
  } else if (name === 'RegionReadResult') {
    world(v, ...v.chunks.filter(c => c.state).map(c => c.state.worldRef));
    shape(same(chunksOfBox(v.box), v.chunks.map(c => ({ chunkPos: c.chunkPos, box: c.box }))));
  } else if (name === 'RegionChunkWrite') {
    shape((v.ops === null) !== (v.state === null));
    inChunk(v.chunkPos, blockBox(v.ops ?? v.state.block));
  } else if (name === 'WriteRegionRequest') {
    shape(v.writes.every(w => (v.purpose === 'APPLY') === (w.ops !== null)));
    world(v, ...v.writes.filter(w => w.state).map(w => w.state.worldRef));
  } else if (name === 'RegionChunkWriteResult') shape((v.status === 'WRITTEN') === (v.readbackDigest !== null));
  else if (name === 'RegionWriteResult') world(v);
  else if (name === 'RegionSummary') for (const c of v.chunks) inChunk(c.chunkPos, c.box);
  else if (name === 'RegionSnapshotChunk') { inChunk(v.chunkPos, blockBox(v.state.block)); }
  else if (name === 'RegionSnapshotContent') requireFact(v.chunks.every(c => c.state.worldRef === v.worldRef), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  else if (name === 'ApplyRegionCommitRequest') world(v, v.operations.worldRef);
  else if (name === 'RegionCommitResult') {
    world(v); summaryCoherent(v.worldRef, v.beforeSummary, v.expectedAfterSummary, v.actualSummary);
    if (v.status === 'VERIFIED') shape(same(v.actualSummary, v.expectedAfterSummary) && v.lighting.status === 'COMPLETE');
    else shape(same(v.actualSummary, v.beforeSummary));
  } else if (name === 'UndoRegionCommitRequest') { world(v); shape(v.originTransactionId !== v.undoTransactionId); }
  else if (name === 'RegionUndoResult') {
    world(v); summaryCoherent(v.worldRef, v.preUndoSummary, v.actualSummary);
    shape(v.originTransactionId !== v.undoTransactionId);
    if (v.status === 'VERIFIED') shape(v.lighting.status === 'COMPLETE');
    else shape(same(v.actualSummary, v.preUndoSummary));
  }
}
