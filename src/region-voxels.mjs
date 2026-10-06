import { createHash } from 'node:crypto';

/*
 * Region voxels v1 and protocol negotiation as consumed by this Adapter.
 *
 * FIXTURE NOTICE: the public region-voxels v1 contract (S1-CONTRACT-REGION-V1-01)
 * has not been delivered. The shape below is this Adapter's narrowest explicit
 * fixture, kept in this one module so the delivered contract bytes can replace
 * it without touching transport code. It is not a published contract.
 *
 *   { format: 'hanaworlds.region-voxels', version: '1.x.y',
 *     origin: [x, y, z], size: [sx, sy, sz],
 *     axisOrder: 'X_FASTEST_THEN_Y_THEN_Z',
 *     palette: [{ nodeName, param2 }, ...],
 *     runs: [[paletteIndex | null, count], ...] }
 *
 * null is "unspecified": the cell keeps its current state. Digging is an
 * explicit palette entry { nodeName: 'air', param2: 0 }, never an absent cell.
 */
export const VOXELS_FORMAT = 'hanaworlds.region-voxels';
export const VOXELS_VERSION = '1.0.0';
export const AXIS_ORDER = 'X_FASTEST_THEN_Y_THEN_Z';
export const REGION_PROTOCOL = Object.freeze({
  name: 'hanaworlds-region-io',
  version: '1.0.0',
  capabilities: Object.freeze([
    'region-voxels-v1', 'air-dig', 'mapblock-batches', 'load-before-read',
    'light-complete-fact', 'block-digests', 'readback-verify', 'restore-transport',
  ]),
});
export const BLOCK = 16;
const DIGEST_FORMAT = 'hw-region-cells/1';
const REGION_DIGEST_FORMAT = 'hw-region/1';
const MAP_LIMIT = 31000;

const fail = code => { throw new Error(code); };
const sha256 = text => createHash('sha256').update(text).digest('hex');
const int = n => Number.isSafeInteger(n) && Math.abs(n) <= MAP_LIMIT;

function semver(text) {
  const m = typeof text === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text);
  return m ? m.slice(1, 4).map(Number) : null;
}
/** Breaking line of a version: major, or major.minor while major is 0. */
function line(v) { return v[0] === 0 ? `0.${v[1]}` : `${v[0]}`; }

/** Same breaking line and every required capability offered. Patch/minor
 * differences (or source hashes) never decide compatibility. */
export function negotiate(required, offered = REGION_PROTOCOL) {
  if (!required || typeof required !== 'object' || Array.isArray(required)) fail('SCHEMA_INVALID');
  const want = semver(required.version), have = semver(offered.version);
  if (required.name !== offered.name || !want || !have) fail('PROTOCOL_UNSUPPORTED');
  if (line(want) !== line(have)) fail('PROTOCOL_MAJOR_MISMATCH');
  const caps = required.requiredCapabilities ?? [];
  if (!Array.isArray(caps) || caps.some(c => typeof c !== 'string')) fail('SCHEMA_INVALID');
  const missing = caps.filter(c => !offered.capabilities.includes(c));
  if (missing.length) { const e = new Error('CAPABILITY_UNAVAILABLE'); e.missing = missing; throw e; }
  return { name: offered.name, version: offered.version, compatible: true,
    requestedVersion: required.version, capabilities: [...offered.capabilities] };
}

export function checkBox(min, max) {
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3 ||
      ![...min, ...max].every(int) || min.some((v, i) => v > max[i])) fail('SCHEMA_INVALID');
  return { min: [...min], max: [...max] };
}

/** Decode fixture voxels into a flat Int32Array (palette index, -1 unspecified). */
export function decodeVoxels(v) {
  if (!v || typeof v !== 'object' || v.format !== VOXELS_FORMAT || v.axisOrder !== AXIS_ORDER)
    fail('SCHEMA_INVALID');
  const ver = semver(v.version);
  if (!ver) fail('SCHEMA_INVALID');
  if (line(ver) !== line(semver(VOXELS_VERSION))) fail('PROTOCOL_MAJOR_MISMATCH');
  if (!Array.isArray(v.size) || v.size.length !== 3 || !v.size.every(n => Number.isSafeInteger(n) && n >= 1))
    fail('SCHEMA_INVALID');
  const { min } = checkBox(v.origin, v.origin);
  const max = min.map((o, i) => o + v.size[i] - 1);
  checkBox(min, max);
  const total = v.size[0] * v.size[1] * v.size[2];
  if (!Number.isSafeInteger(total)) fail('LIMIT_EXCEEDED');
  if (!Array.isArray(v.palette) || v.palette.length === 0) fail('SCHEMA_INVALID');
  const seen = new Set();
  const palette = v.palette.map(entry => {
    if (!entry || typeof entry.nodeName !== 'string' || !entry.nodeName || entry.nodeName === 'ignore' ||
        !Number.isInteger(entry.param2) || entry.param2 < 0 || entry.param2 > 255 ||
        Object.keys(entry).some(k => k !== 'nodeName' && k !== 'param2')) fail('SCHEMA_INVALID');
    const key = `${entry.nodeName}\t${entry.param2}`;
    if (seen.has(key)) fail('SCHEMA_INVALID');
    seen.add(key);
    return { nodeName: entry.nodeName, param2: entry.param2 };
  });
  if (!Array.isArray(v.runs)) fail('SCHEMA_INVALID');
  const cells = new Int32Array(total);
  let n = 0;
  for (const run of v.runs) {
    if (!Array.isArray(run) || run.length !== 2) fail('SCHEMA_INVALID');
    const [k, count] = run;
    if (!Number.isSafeInteger(count) || count < 1 || n + count > total) fail('SCHEMA_INVALID');
    if (k !== null && (!Number.isInteger(k) || k < 0 || k >= palette.length)) fail('SCHEMA_INVALID');
    cells.fill(k === null ? -1 : k, n, n + count);
    n += count;
  }
  if (n !== total) fail('SCHEMA_INVALID');
  return { min, max, size: [...v.size], palette, cells };
}

/** Encode a flat array of palette indices (no unspecified) as fixture voxels. */
export function encodeVoxels(min, size, palette, cells) {
  const runs = [];
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i] < 0 ? null : cells[i];
    const last = runs.at(-1);
    if (last && last[0] === k) last[1]++; else runs.push([k, 1]);
  }
  return { format: VOXELS_FORMAT, version: VOXELS_VERSION, origin: [...min], size: [...size],
    axisOrder: AXIS_ORDER, palette, runs };
}

const floorBlock = n => Math.floor(n / BLOCK);

/** Block sub-boxes of a node box, in block z, y, x order (same as voxel.lua). */
export function subBoxes(min, max) {
  const out = [];
  for (let bz = floorBlock(min[2]); bz <= floorBlock(max[2]); bz++)
    for (let by = floorBlock(min[1]); by <= floorBlock(max[1]); by++)
      for (let bx = floorBlock(min[0]); bx <= floorBlock(max[0]); bx++) {
        const b = [bx, by, bz];
        out.push({ block: b, min: min.map((v, i) => Math.max(v, b[i] * BLOCK)),
          max: max.map((v, i) => Math.min(v, b[i] * BLOCK + BLOCK - 1)) });
      }
  return out;
}

/**
 * Split a region into mapblock-aligned batch boxes of at most `perBatch`
 * blocks. The block count per batch is derived from the courier's actual body
 * limit by the caller; it is a transport bound, not a policy setting.
 */
export function batches(min, max, perBatch) {
  if (!Number.isSafeInteger(perBatch) || perBatch < 1) fail('LIMIT_EXCEEDED');
  const lo = min.map(floorBlock), hi = max.map(floorBlock);
  const n = lo.map((v, i) => hi[i] - v + 1);
  // Grow the batch along x, then y, then z as far as the bound allows.
  const sx = Math.min(n[0], perBatch);
  const sy = sx === n[0] ? Math.min(n[1], Math.floor(perBatch / sx)) : 1;
  const sz = sx === n[0] && sy === n[1] ? Math.min(n[2], Math.floor(perBatch / (sx * sy))) : 1;
  const out = [];
  for (let bz = lo[2]; bz <= hi[2]; bz += sz)
    for (let by = lo[1]; by <= hi[1]; by += sy)
      for (let bx = lo[0]; bx <= hi[0]; bx += sx) {
        const b0 = [bx, by, bz], b1 = [Math.min(bx + sx - 1, hi[0]), Math.min(by + sy - 1, hi[1]), Math.min(bz + sz - 1, hi[2])];
        out.push({ min: b0.map((b, i) => Math.max(min[i], b * BLOCK)),
          max: b1.map((b, i) => Math.min(max[i], b * BLOCK + BLOCK - 1)) });
      }
  return out;
}

/** Worst-case reply/command bytes per block and the resulting blocks per batch. */
export function blocksPerBatch(limits) {
  const { maxBodyBytes, registeredNodes, longestNodeName } = limits ?? {};
  if (![maxBodyBytes, registeredNodes, longestNodeName].every(n => Number.isSafeInteger(n) && n > 0))
    fail('CAPABILITY_UNAVAILABLE');
  const cells = BLOCK ** 3;
  // Every cell its own run: "index,count," (<= 7+1+5+1) and "param2,count," (<= 3+1+5+1)
  // plus one per-block fact entry (positions, digest).
  const perBlock = cells * 24 + 512;
  const envelope = 64 * 1024;
  const palette = (n) => Math.min(registeredNodes, n * cells) * (longestNodeName * 2 + 8);
  let k = 0;
  while (envelope + (k + 1) * perBlock + palette(k + 1) <= maxBodyBytes) k++;
  if (k < 1) fail('LIMIT_EXCEEDED');
  return k;
}

const boxIndex = (min, size) => (x, y, z) => ((z - min[2]) * size[1] + (y - min[1])) * size[0] + (x - min[0]);

/** Canonical digest of one block sub-box (identical text to voxel.lua). */
export function blockDigest(sb, cellAt) {
  const parts = [DIGEST_FORMAT, sb.min.join(','), sb.max.join(',')];
  for (let z = sb.min[2]; z <= sb.max[2]; z++)
    for (let y = sb.min[1]; y <= sb.max[1]; y++)
      for (let x = sb.min[0]; x <= sb.max[0]; x++) {
        const [name, param2] = cellAt(x, y, z);
        parts.push(`${name}\t${param2}`);
      }
  return sha256(parts.join('\n') + '\n');
}

export function regionDigest(blocks) {
  const lines = blocks.map(b => `${b.blockPos.join(',')}:${b.digest}`);
  return sha256(`${REGION_DIGEST_FORMAT}\n${lines.join('\n')}\n`);
}

/** Expand a courier read reply (names palette + runs) into the region arrays. */
export function absorbRead(reply, region, state) {
  const { min, max } = reply;
  const size = max.map((v, i) => v - min[i] + 1);
  const total = size[0] * size[1] * size[2];
  const names = reply.palette, content = reply.contentRuns, p2 = reply.param2Runs;
  if (!Array.isArray(names) || !Array.isArray(content) || !Array.isArray(p2)) fail('CAPABILITY_UNAVAILABLE');
  const nameCells = new Int32Array(total), p2Cells = new Uint8Array(total);
  let n = 0;
  for (let r = 0; r < content.length; r += 2) {
    const k = content[r], c = content[r + 1];
    if (!Number.isInteger(k) || k < 0 || k >= names.length || !Number.isSafeInteger(c) || c < 1 || n + c > total)
      fail('CAPABILITY_UNAVAILABLE');
    nameCells.fill(k, n, n + c); n += c;
  }
  if (n !== total) fail('CAPABILITY_UNAVAILABLE');
  n = 0;
  for (let r = 0; r < p2.length; r += 2) {
    const v = p2[r], c = p2[r + 1];
    if (!Number.isInteger(v) || v < 0 || v > 255 || !Number.isSafeInteger(c) || c < 1 || n + c > total)
      fail('CAPABILITY_UNAVAILABLE');
    p2Cells.fill(v, n, n + c); n += c;
  }
  if (n !== total) fail('CAPABILITY_UNAVAILABLE');
  const local = boxIndex(min, size), global = boxIndex(region.min, region.size);
  for (let z = min[2]; z <= max[2]; z++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let x = min[0]; x <= max[0]; x++) {
        const i = local(x, y, z), name = names[nameCells[i]], key = `${name}\t${p2Cells[i]}`;
        let k = state.index.get(key);
        if (k === undefined) { k = state.palette.length; state.palette.push({ nodeName: name, param2: p2Cells[i] }); state.index.set(key, k); }
        state.cells[global(x, y, z)] = k;
      }
  // Independent check: recompute each block digest from the returned cells.
  const at = (x, y, z) => { const e = state.palette[state.cells[global(x, y, z)]]; return [e.nodeName, e.param2]; };
  for (const b of reply.blocks) {
    if (typeof b.digest !== 'string' || blockDigest(b, at) !== b.digest) fail('READBACK_MISMATCH');
  }
}

/** Slice decoded voxels to one batch box as courier write runs. */
export function sliceForWrite(decoded, box) {
  const size = box.max.map((v, i) => v - box.min[i] + 1);
  const global = boxIndex(decoded.min, decoded.size);
  const names = [], nameIndex = new Map(), content = [], p2 = [];
  let lastC = null, countC = 0, lastP = null, countP = 0, specified = 0;
  const push = (arr, v, c) => { arr.push(v, c); };
  for (let z = box.min[2]; z <= box.max[2]; z++)
    for (let y = box.min[1]; y <= box.max[1]; y++)
      for (let x = box.min[0]; x <= box.max[0]; x++) {
        const k = decoded.cells[global(x, y, z)];
        let c = -1, p = 0;
        if (k >= 0) {
          const e = decoded.palette[k];
          c = nameIndex.get(e.nodeName);
          if (c === undefined) { c = names.length; names.push(e.nodeName); nameIndex.set(e.nodeName, c); }
          p = e.param2; specified++;
        }
        if (c === lastC) countC++; else { if (lastC !== null) push(content, lastC, countC); lastC = c; countC = 1; }
        if (p === lastP) countP++; else { if (lastP !== null) push(p2, lastP, countP); lastP = p; countP = 1; }
      }
  push(content, lastC, countC); push(p2, lastP, countP);
  return { min: box.min, max: box.max, size, palette: names.length ? names : ['air'],
    contentRuns: content, param2Runs: p2, specified };
}
