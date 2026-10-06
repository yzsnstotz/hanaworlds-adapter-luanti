import { REGION_PROTOCOL, negotiate, checkBox, decodeVoxels, encodeVoxels, subBoxes, batches,
  blocksPerBatch, regionDigest, absorbRead, sliceForWrite } from './region-voxels.mjs';

/*
 * Region I/O transport. Adapter only moves data and reports engine facts:
 * it never decides a transaction. A multi-batch write is NOT atomic; on any
 * failure the reply says exactly which batches were written so the caller
 * (Canvas) can restore its own pre-write region snapshot with writeRegion.
 */
const fail = code => { throw new Error(code); };
const key = b => b.join(',');
const LIGHT_METHOD = 'VoxelManip.write_to_map(light=true)+core.fix_light';

export function describeRegionIO() {
  return { protocol: REGION_PROTOCOL.name, version: REGION_PROTOCOL.version,
    capabilities: [...REGION_PROTOCOL.capabilities], mapblockSize: 16,
    purpose: 'Bulk read/write of a box region of the current Luanti world in mapblock batches '
      + '(fill, explicit air dig, keep unspecified cells), with load-before-read, light '
      + 'completion and per-block digests. Typical scale: one or many 16^3 mapblocks per call; '
      + 'single cells remain on the per-cell transaction path.',
    preconditions: ['current paired world/connection/incarnation', 'Canvas caller',
      'region read before write (expected per-block digests)', 'every touched cell loaded and known',
      'changed cells are static stateless non-liquid nodes', 'no solid target inside a player body'],
    atomic: false, transactionOwner: 'hanaworlds-canvas', lightMethod: LIGHT_METHOD };
}

async function loadBatch(engine, box) {
  const emerged = await engine.regionEmerge(box.min, box.max);
  const actions = new Map((emerged?.blocks ?? []).map(b => [key(b.blockPos), b.action]));
  const read = await engine.regionRead(box.min, box.max);
  if (!read || !Array.isArray(read.blocks)) fail('CAPABILITY_UNAVAILABLE');
  const blocks = read.blocks.map(b => {
    const action = actions.get(key(b.blockPos)) ?? 'NOT_REPORTED';
    // The engine readback decides: a block is KNOWN only when none of its cells
    // reads as 'ignore'. CANCELLED is kept as a reported fact (the engine also
    // cancels a queued block that another queued block's mapchunk generated);
    // ERRORED or unreported emerges are never known.
    const known = b.ignoreCells === 0 && typeof b.digest === 'string' &&
      ['FROM_MEMORY', 'FROM_DISK', 'GENERATED', 'CANCELLED'].includes(action);
    return { blockPos: b.blockPos, min: b.min, max: b.max, emerge: action,
      availability: known ? 'KNOWN' : 'UNKNOWN', digest: known ? b.digest : null,
      ignoreCells: b.ignoreCells };
  });
  return { read, blocks };
}

/** Load (emerge) then read a region; any unknown block makes the whole read UNKNOWN. */
export async function readRegion(engine, input) {
  const protocol = negotiate(input.protocol);
  const { min, max } = checkBox(input.min, input.max);
  const size = max.map((v, i) => v - min[i] + 1);
  const total = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(total)) fail('LIMIT_EXCEEDED');
  const perBatch = blocksPerBatch(await engine.regionLimits());
  const state = { palette: [], index: new Map(), cells: new Int32Array(total) };
  const region = { min, size };
  const blocks = [], batchFacts = [];
  let unknown = null, metadataCells = 0;
  for (const box of batches(min, max, perBatch)) {
    const { read, blocks: facts } = await loadBatch(engine, box);
    blocks.push(...facts);
    batchFacts.push({ min: box.min, max: box.max, blocks: facts.length });
    metadataCells += Number.isSafeInteger(read.metadataCells) ? read.metadataCells : 0;
    if (facts.some(b => b.availability !== 'KNOWN')) { unknown ??= { code: 'TARGET_FACTS_INCOMPLETE', batch: box }; continue; }
    if (!unknown) absorbRead(read, region, state);
  }
  const base = { protocol: protocol.version, min, max, blocks, batches: batchFacts, metadataCells };
  if (unknown) return { ...base, status: 'UNKNOWN', voxels: null, regionDigest: null, failure: unknown };
  return { ...base, status: 'KNOWN', voxels: encodeVoxels(min, size, state.palette, state.cells),
    regionDigest: regionDigest(blocks), failure: null };
}

/**
 * Write region voxels in mapblock batches. Every block of the region must be
 * listed in expectedBlocks with the digest the caller read. All batches are
 * prechecked (loaded, known, matching) before the first write; each batch is
 * rechecked by the engine in the same server step as its write.
 */
export async function writeRegion(engine, input) {
  const protocol = negotiate(input.protocol);
  const decoded = decodeVoxels(input.voxels);
  const expected = new Map();
  if (!Array.isArray(input.expectedBlocks)) fail('SCHEMA_INVALID');
  for (const e of input.expectedBlocks) {
    if (!Array.isArray(e?.blockPos) || typeof e.digest !== 'string' || !/^[0-9a-f]{64}$/.test(e.digest)) fail('SCHEMA_INVALID');
    expected.set(key(e.blockPos), e.digest);
  }
  const all = subBoxes(decoded.min, decoded.max);
  if (all.length !== expected.size || all.some(b => !expected.has(key(b.block)))) fail('SCHEMA_INVALID');
  const perBatch = blocksPerBatch(await engine.regionLimits());
  const plan = batches(decoded.min, decoded.max, perBatch).map(box => ({ box, slice: sliceForWrite(decoded, box) }));
  const result = (status, extra) => ({ protocol: protocol.version, status, atomic: false,
    transactionOwner: 'hanaworlds-canvas', min: decoded.min, max: decoded.max, ...extra });
  const command = (box, slice, digestOf, checkOnly) => ({ min: slice.min, max: slice.max, palette: slice.palette,
    contentRuns: slice.contentRuns, param2Runs: slice.param2Runs, checkOnly,
    expected: subBoxes(box.min, box.max).map(sb => ({ min: sb.min, max: sb.max, digest: digestOf(sb.block) })) });
  // Precheck every batch before the first write (loaded, known, expected
  // digests, stateless static nodes, bodies): nothing is written on failure.
  const before = [];
  for (const [index, { box, slice }] of plan.entries()) {
    const { blocks } = await loadBatch(engine, box);
    before.push(...blocks);
    const bad = blocks.find(b => b.availability !== 'KNOWN');
    if (bad) return result('REJECTED', { batches: [], blocks: before,
      failure: { code: 'TARGET_FACTS_INCOMPLETE', blockPos: bad.blockPos, emerge: bad.emerge }, written: false });
    const stale = blocks.find(b => b.digest !== expected.get(key(b.blockPos)));
    if (stale) return result('REJECTED', { batches: [], blocks: before,
      failure: { code: 'TRANSACTION_CONFLICT', blockPos: stale.blockPos }, written: false });
    if (slice.specified === 0) continue;
    try { await engine.regionWrite(command(box, slice, b => expected.get(key(b)), true)); }
    catch (error) {
      return result('REJECTED', { batches: [], blocks: before, written: false,
        failure: { code: error?.message ?? 'CAPABILITY_UNAVAILABLE', batchIndex: index } });
    }
  }
  const facts = [], after = new Map(before.map(b => [key(b.blockPos), { ...b }]));
  let written = false;
  for (const [index, { box, slice }] of plan.entries()) {
    if (slice.specified === 0) { facts.push({ index, min: box.min, max: box.max, status: 'NOT_NEEDED' }); continue; }
    let reply;
    try {
      reply = await engine.regionWrite(command(box, slice, b => after.get(key(b)).digest, false));
    } catch (error) {
      const code = error?.message ?? 'CAPABILITY_UNAVAILABLE';
      // A lost reply leaves this batch's mutation unknown; precondition errors
      // are raised by the engine before set_data/write_to_map.
      const lost = code === 'RECOVERY_PENDING' || code === 'ENGINE_RESPONSE_UNKNOWN' || code === 'ADAPTER_UNAVAILABLE';
      facts.push({ index, min: box.min, max: box.max, status: lost ? 'UNKNOWN' : 'NOT_WRITTEN', code });
      const status = lost ? 'UNKNOWN' : written ? 'PARTIAL' : 'REJECTED';
      return result(status, { batches: facts, blocks: [...after.values()], written: lost ? 'UNKNOWN' : written,
        failure: { code, batchIndex: index } });
    }
    written = true;
    for (const b of reply.blocks ?? []) after.set(key(b.blockPos), { ...after.get(key(b.blockPos)), digest: b.digest });
    const ok = reply.written === true && reply.readbackMatches === true && reply.unspecifiedKept === true &&
      reply.lightComplete === true;
    facts.push({ index, min: box.min, max: box.max, status: ok ? 'WRITTEN_VERIFIED' : 'WRITTEN_UNVERIFIED',
      changedCells: reply.changedCells, readbackMatches: reply.readbackMatches,
      unspecifiedKept: reply.unspecifiedKept, light: { complete: reply.lightComplete === true,
        method: LIGHT_METHOD, digest: reply.lightDigest } });
    if (!ok) return result('PARTIAL', { batches: facts, blocks: [...after.values()], written: true,
      failure: { code: reply.lightComplete !== true ? 'LIGHT_INCOMPLETE' : 'READBACK_MISMATCH', batchIndex: index } });
  }
  const blocks = [...after.values()];
  return result('COMPLETE', { batches: facts, blocks, written, regionDigest: regionDigest(blocks),
    lightComplete: true, failure: null });
}
