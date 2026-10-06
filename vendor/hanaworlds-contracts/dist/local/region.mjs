// Public region-voxels/v1 helpers. Pure functions over supplied facts only: no
// world access, compression, transaction decision or provider authentication.
import { contractMetadata } from './generated/contracts.mjs';
import { validateType, validateRequest, validateResponse, validateDigestBinding, digestValue,
  validateStaticMaterials, deepFreeze, canonicalJSON } from './runtime.mjs';
import { requireFact, fail } from '../errors.mjs';
import { blockBox, blockCellCount, chunksOfBox, floorDiv, comparePalette } from './region-domain.mjs';
export const protocolPolicy = contractMetadata.protocolPolicy;
export const contractProtocols = contractMetadata.contractProtocols;
export const regionCapabilities = contractMetadata.regionCapabilities;
export const regionInvariants = contractMetadata.regionInvariants;
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
const changed = ok => requireFact(ok, 'TRANSACTION_CONFLICT', 'PAYLOAD_CHANGED');
const sha = (kind, v) => digestValue(kind, v).sha256;
const noMutation = error => requireFact(error.mutationState === 'NONE' && error.transactionRef === null);

export function regionBlockBox(block) { return deepFreeze(blockBox(validateType('RegionVoxelBlock', block))); }
export function mapblockOf(position) { validateType('Position', position); return Object.freeze(position.map(floorDiv)); }
/** Mapblocks intersecting box (ascending x,y,z) with the node box clipped to each. */
export function regionChunksOfBox(box) { return deepFreeze(chunksOfBox(validateType('Box', box))); }

/** Expand canonical runs into VoxelArea order indices; -1 means UNSPECIFIED. */
export function expandRegionBlock(input) {
  const block = validateType('RegionVoxelBlock', input);
  const indices = new Int32Array(blockCellCount(block)); let at = 0;
  for (const [count, index] of block.runs) { indices.fill(index ?? -1, at, at + count); at += count; }
  return Object.freeze({ box: blockBox(block), size: block.size, palette: block.palette, indices });
}
/** Canonical encoder: sorts/deduplicates the palette, drops unused entries and
 * run-length encodes. indices[i] is -1 (UNSPECIFIED) or an index into palette. */
export function encodeRegionBlock({ origin, size, palette, indices }) {
  validateType('Position', origin); validateType('RegionSize', size);
  const total = blockCellCount({ size });
  requireFact(indices && typeof indices.length === 'number' && indices.length === total);
  const entries = palette.map(p => validateType('NodeSpec', p));
  const used = [...new Set(Array.from(indices).filter(i => i !== -1))];
  requireFact(used.every(i => Number.isInteger(i) && i >= 0 && i < entries.length));
  const sorted = [...new Map(used.map(i => [canonicalJSON(entries[i]), entries[i]])).values()].sort(comparePalette);
  const position = new Map(sorted.map((e, i) => [canonicalJSON(e), i]));
  const remap = new Map(used.map(i => [i, position.get(canonicalJSON(entries[i]))]));
  const runs = [];
  for (let i = 0; i < total; i++) {
    requireFact(indices[i] === -1 || remap.has(indices[i]));
    const value = indices[i] === -1 ? null : remap.get(indices[i]);
    if (runs.length && runs.at(-1)[1] === value) runs.at(-1)[0]++; else runs.push([1, value]);
  }
  return validateType('RegionVoxelBlock', { profileVersion: 'region-voxels/v1', origin: [...origin], size: [...size],
    indexOrder: 'X_FASTEST_THEN_Y_THEN_Z', palette: sorted.map(e => ({ nodeName: e.nodeName, param2: e.param2 })), runs });
}
/** Every palette entry (air included) must be a known static node with legal
 * param2 in the current Catalogue; the same rule as per-cell BUILD materials. */
export function validateRegionPalette(blockInput, catalogue) {
  const block = validateType('RegionVoxelBlock', blockInput);
  validateStaticMaterials(Object.fromEntries(block.palette.map((e, i) => ['p' + i, e])), catalogue);
  return block;
}
/** After-state of a successful write: specified cells take the palette node and
 * lose extras; UNSPECIFIED cells keep node, param2 and extras unchanged. */
export function expectedRegionState(beforeInput, opsInput) {
  const before = validateType('RegionState', beforeInput); const ops = expandRegionBlock(opsInput);
  requireFact(same(blockBox(before.block), ops.box), 'SCHEMA_INVALID', 'INVALID_GEOMETRY');
  const prior = expandRegionBlock(before.block);
  const palette = [...prior.palette, ...ops.palette]; const offset = prior.palette.length;
  const indices = Int32Array.from(prior.indices, (v, i) => ops.indices[i] === -1 ? v : ops.indices[i] + offset);
  const { min, max } = ops.box; const sx = max[0] - min[0] + 1, sy = max[1] - min[1] + 1;
  const extras = before.extras.filter(e => {
    const [x, y, z] = e.position.map((v, a) => v - min[a]);
    return ops.indices[x + sx * (y + sy * z)] === -1;
  });
  return validateType('RegionState', { profileVersion: 'region-state/v1', worldRef: before.worldRef,
    block: encodeRegionBlock({ origin: before.block.origin, size: before.block.size, palette, indices }), extras, derivedLightMode: 'recompute-with-readback' });
}
export function summarizeRegionStates(worldRef, chunks) {
  return validateType('RegionSummary', { profileVersion: 'region-summary/v1', worldRef,
    chunks: chunks.map(({ chunkPos, state }) => ({ chunkPos, box: blockBox(validateType('RegionState', state).block), stateDigest: sha('region-state', state) })) });
}
/** Expected after summary from the durable pre-write snapshot and the operations. */
export function expectedRegionSummary(contentInput, operationsInput) {
  const content = validateType('RegionSnapshotContent', contentInput); const ops = validateType('RegionOperationsProjection', operationsInput);
  requireFact(content.worldRef === ops.worldRef, 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  requireFact(same(content.chunks.map(c => c.chunkPos), ops.chunks.map(c => c.chunkPos)), 'TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
  return summarizeRegionStates(content.worldRef, content.chunks.map((c, i) => ({ chunkPos: c.chunkPos, state: expectedRegionState(c.state, ops.chunks[i].block) })));
}

// --- painter-region/v1 -------------------------------------------------------
export function validateRegionProposalRequest(input) {
  const request = validateRequest('painter-region/v1', 'ValidateRegionProposal', input);
  validateDigestBinding('intent', request.intent, request.intentDigest);
  validateDigestBinding('reference-brief', request.referenceBrief, request.referenceBriefDigest);
  validateDigestBinding('catalogue', request.catalogue, request.catalogueDigest);
  validateRegionPalette(request.proposal.block, request.catalogue);
  return request;
}
/** Painter returns the proposal block unchanged as a RegionBuildProjection. */
export function validateRegionProposalResponse(requestInput, responseInput) {
  const request = validateRegionProposalRequest(requestInput);
  const response = validateResponse('painter-region/v1', 'ValidateRegionProposal', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) { noMutation(response.error); return response; }
  const { build } = response.result;
  changed(response.result.invocationId === request.invocationId && build.worldRef === request.worldRef &&
    build.catalogueDigest === request.catalogueDigest && same(build.block, request.proposal.block));
  validateDigestBinding('region-build', build, response.result.buildDigest);
  return response;
}

// --- region-build/v1 (Brush) -------------------------------------------------
export function validateCompileRegionBuildRequest(input) {
  const request = validateRequest('region-build/v1', 'CompileRegionBuild', input);
  validateDigestBinding('region-build', request.build, request.buildDigest);
  validateDigestBinding('catalogue', request.catalogue, request.catalogueDigest);
  validateRegionPalette(request.build.block, request.catalogue);
  return request;
}
/** Exact equivalence: chunks specify exactly the build's specified cells with the
 * same node/param2; UNSPECIFIED never becomes air; nothing outside the build box. */
export function validateCompiledRegionSet(requestInput, responseInput) {
  const request = validateCompileRegionBuildRequest(requestInput);
  const response = validateResponse('region-build/v1', 'CompileRegionBuild', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) { noMutation(response.error); return response; }
  const { projection } = response.result;
  changed(projection.buildDigest === request.buildDigest && projection.worldRef === request.worldRef &&
    projection.catalogueDigest === request.catalogueDigest && projection.compilerRevision === request.compilerRevision);
  validateDigestBinding('region-operations', projection, response.result.operationDigest);
  const build = expandRegionBlock(request.build.block);
  const [bx, by] = [0, 1].map(a => build.box.max[a] - build.box.min[a] + 1);
  const exact = ok => requireFact(ok, 'BUILD_INVALID', 'INVALID_GEOMETRY');
  let specified = 0;
  for (const chunk of projection.chunks) {
    const c = expandRegionBlock(chunk.block); const [cx, cy] = [0, 1].map(a => c.box.max[a] - c.box.min[a] + 1);
    exact(c.box.min.every((v, a) => v >= build.box.min[a]) && c.box.max.every((v, a) => v <= build.box.max[a]));
    for (let i = 0; i < c.indices.length; i++) {
      if (c.indices[i] === -1) continue;
      const x = c.box.min[0] + i % cx, y = c.box.min[1] + Math.floor(i / cx) % cy, z = c.box.min[2] + Math.floor(i / (cx * cy));
      const j = (x - build.box.min[0]) + bx * ((y - build.box.min[1]) + by * (z - build.box.min[2]));
      exact(build.indices[j] !== -1 && same(build.palette[build.indices[j]], c.palette[c.indices[i]]));
      specified++;
    }
  }
  exact(specified === build.indices.reduce((n, v) => n + (v !== -1), 0));
  return response;
}

// --- world-adapter-region/v1 (Adapter transport facts) -----------------------
export function validateRegionRead(requestInput, responseInput) {
  const request = validateRequest('world-adapter-region/v1', 'ReadRegion', requestInput);
  const response = validateResponse('world-adapter-region/v1', 'ReadRegion', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return response;
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same(r.localContext, request.localContext), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  changed(same(r.box, request.box));
  for (const c of r.chunks) if (c.state) validateDigestBinding('region-state', c.state, c.stateDigest);
  return response;
}
/** Still-unknown chunks reject the write; loading is the Adapter's job first. */
export function requireKnownRegion(resultInput) {
  const result = validateType('RegionReadResult', resultInput);
  requireFact(result.chunks.every(c => c.availability === 'KNOWN'), 'TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
  return result;
}
/** Per-chunk transport facts only. allWritten is not a commit: Canvas decides. */
export function validateRegionWrite(requestInput, responseInput) {
  const request = validateRequest('world-adapter-region/v1', 'WriteRegion', requestInput);
  const response = validateResponse('world-adapter-region/v1', 'WriteRegion', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return deepFreeze({ response, allWritten: false, committed: false });
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same(r.localContext, request.localContext), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  changed(r.transactionId === request.transactionId && r.purpose === request.purpose &&
    same(r.chunks.map(c => c.chunkPos), request.writes.map(w => w.chunkPos)));
  const allWritten = r.chunks.every(c => c.status === 'WRITTEN') && r.lighting.status === 'COMPLETE';
  return deepFreeze({ response, allWritten, committed: false });
}

// --- canvas-region/v1 (Canvas transaction facts) -----------------------------
export function validateRegionSnapshotContent(contentInput, refInput, beforeSummaryInput) {
  const content = validateType('RegionSnapshotContent', contentInput); const ref = validateType('RegionSnapshotRef', refInput);
  const before = validateType('RegionSummary', beforeSummaryInput);
  validateDigestBinding('region-snapshot-content', content, ref.contentDigest);
  validateDigestBinding('region-summary', before, ref.beforeSummaryDigest);
  for (const c of content.chunks) validateDigestBinding('region-state', c.state, c.stateDigest);
  changed(same(summarizeRegionStates(content.worldRef, content.chunks), before));
  return content;
}
export function validateRegionCommit(requestInput, responseInput) {
  const request = validateRequest('canvas-region/v1', 'ApplyRegionCommit', requestInput);
  validateDigestBinding('region-operations', request.operations, request.operationDigest);
  const response = validateResponse('canvas-region/v1', 'ApplyRegionCommit', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return response;
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same(r.localContext, request.localContext), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  changed(r.transactionId === request.transactionId && r.operationDigest === request.operationDigest);
  changed(same(r.beforeSummary.chunks.map(c => [c.chunkPos, c.box]), request.operations.chunks.map(c => [c.chunkPos, blockBox(c.block)])));
  validateDigestBinding('region-summary', r.beforeSummary, r.snapshot.beforeSummaryDigest);
  return response;
}
export function validateRegionUndo(requestInput, responseInput, originResultInput) {
  const request = validateRequest('canvas-region/v1', 'UndoRegionCommit', requestInput);
  const origin = validateType('RegionCommitResult', originResultInput);
  requireFact(origin.status === 'VERIFIED' && origin.transactionId === request.originTransactionId, 'UNDO_CONFLICT', 'PAYLOAD_CHANGED');
  requireFact(origin.worldRef === request.worldRef, 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  const response = validateResponse('canvas-region/v1', 'UndoRegionCommit', responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return response;
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same(r.localContext, request.localContext), 'CURRENT_WORLD_MISMATCH', 'SCOPE_DENIED');
  changed(r.originTransactionId === request.originTransactionId && r.undoTransactionId === request.undoTransactionId);
  changed(r.originBeforeSummaryDigest === sha('region-summary', origin.beforeSummary) && r.originAfterSummaryDigest === sha('region-summary', origin.actualSummary));
  // Canvas attempts Undo only while the region still equals the verified after state.
  requireFact(sha('region-summary', r.preUndoSummary) === r.originAfterSummaryDigest, 'UNDO_CONFLICT', 'EXTERNAL_EDIT_CONFLICT');
  if (r.status === 'VERIFIED') requireFact(sha('region-summary', r.actualSummary) === r.originBeforeSummaryDigest, 'READBACK_MISMATCH', 'READBACK_ERROR', 'readback');
  return response;
}

// --- protocol major + capability compatibility -------------------------------
/** ProtocolRequirement for a wire such as 'canvas-region/v1' or 'BUILD/V3'. */
export function protocolRequirement(wire, capabilities = [], minMinor = 0) {
  const m = /^(.+)\/[vV]([1-9][0-9]*)$/u.exec(wire);
  requireFact(m !== null, 'UNSUPPORTED_VERSION', 'VERSION_UNSUPPORTED', 'decode');
  return validateType('ProtocolRequirement', { protocol: m[1], major: Number(m[2]), minMinor, capabilities: [...capabilities].sort() });
}
/** Same major, minor >= required and every required capability. Provenance
 * (package version, source, artifact digest) is returned for the record only. */
export function checkProtocolCompatibility(advertisedInput, requirementsInput) {
  if (advertisedInput === null || typeof advertisedInput !== 'object' || advertisedInput.profileVersion !== 'protocol-handshake/v1')
    fail('UNSUPPORTED_VERSION', 'decode', 'VERSION_UNSUPPORTED');
  const advertised = validateType('ProtocolHandshake', advertisedInput);
  const requirements = validateType('ProtocolRequirements', requirementsInput);
  const matched = requirements.map(req => {
    const p = advertised.protocols.find(x => x.protocol === req.protocol);
    requireFact(p !== undefined && p.major === req.major && p.minor >= req.minMinor, 'UNSUPPORTED_VERSION', 'VERSION_UNSUPPORTED', 'decode');
    requireFact(req.capabilities.every(c => advertised.capabilities.includes(c)), 'CAPABILITY_UNAVAILABLE', 'VERSION_UNSUPPORTED', 'decode');
    return { protocol: p.protocol, major: p.major, minor: p.minor, capabilities: req.capabilities };
  });
  return deepFreeze({ result: 'PROTOCOL_COMPATIBLE', component: advertised.component, matched, provenance: advertised.provenance });
}
