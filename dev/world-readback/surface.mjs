// Top-down surface projection of one public NativeFacts.readRegionState result.
// Pure over the read: every column's material and height come from the same chunks
// whose stateDigests are listed in readDigest. Nothing here reads or writes a world.
import { createHash } from 'node:crypto';

const AIR = 'air';
const key = (x, z) => `${x},${z}`;

/** Per (x,z) column: the highest non-air node in the read window, or why it is not known. */
export function projectSurface(read, expandRegionBlock) {
  const { box } = read;
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  const columns = new Map();
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) columns.set(key(x, z), { x, z, y: null, nodeName: null, param2: null, status: 'BELOW_WINDOW' });
  const blocks = read.chunks.map(c => ({ c, b: c.state ? expandRegionBlock(c.state.block) : null }));
  // Scan each chunk's cells; keep the highest non-air per column, and remember unknown chunks.
  const unknown = new Map();
  for (const { c, b } of blocks) {
    const { min, max } = c.box;
    if (!b) {
      for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
        const u = unknown.get(key(x, z)); if (!u || max[1] > u.top) unknown.set(key(x, z), { top: max[1], reason: c.unknownReason });
      }
      continue;
    }
    const [sx, sy] = b.size, o = c.state.block.origin;
    for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
      const col = columns.get(key(x, z));
      for (let y = max[1]; y >= min[1]; y--) {
        if (col.y !== null && y <= col.y) break;
        const p = b.palette[b.indices[(x - o[0]) + (y - o[1]) * sx + (z - o[2]) * sx * sy]];
        if (p.nodeName === AIR) continue;
        Object.assign(col, { y, nodeName: p.nodeName, param2: p.param2, status: p.nodeName === 'ignore' ? 'UNKNOWN' : 'KNOWN' });
        break;
      }
    }
  }
  for (const col of columns.values()) {
    const u = unknown.get(key(col.x, col.z));
    // An unknown chunk above the found node (or with nothing found) leaves the surface unknown.
    if (u && (col.y === null || u.top > col.y)) Object.assign(col, { status: 'UNKNOWN', unknownReason: u.reason });
    else if (col.status === 'KNOWN' && col.y === y1) col.status = 'ABOVE_WINDOW';
  }
  const list = [...columns.values()];
  const materials = {};
  for (const c of list) if (c.status === 'KNOWN') {
    const m = materials[c.nodeName] ??= { count: 0, minY: c.y, maxY: c.y };
    m.count++; m.minY = Math.min(m.minY, c.y); m.maxY = Math.max(m.maxY, c.y);
  }
  const counts = list.reduce((n, c) => (n[c.status] = (n[c.status] ?? 0) + 1, n), {});
  return { box, columns: list, materials, counts, readDigest: readDigest(read) };
}

/** SHA256 over the ordered chunk positions and their stateDigests of this one read. */
export function readDigest(read) {
  const h = createHash('sha256');
  h.update(JSON.stringify({ worldRef: read.worldRef, box: read.box,
    chunks: read.chunks.map(c => [c.chunkPos, c.availability, c.stateDigest]) }));
  return h.digest('hex');
}

/**
 * Grow the vertical window until every column's top is bracketed (the window top is air
 * and something non-air is below), then return the single final read covering it. The
 * world's mapgen limit is the only bound; columns still open there are reported as such.
 */
export async function readSurface(readRegionState, worldRef, { cx, cz, radius, yMin = -16, yMax = 47, limit = 31000, step = 64 }, expandRegionBlock) {
  const reads = [];
  for (;;) {
    const box = { min: [cx - radius, yMin, cz - radius], max: [cx + radius, yMax, cz + radius] };
    const read = await readRegionState(worldRef, box);
    const surface = projectSurface(read, expandRegionBlock);
    reads.push({ box, readDigest: surface.readDigest, counts: surface.counts });
    const up = (surface.counts.ABOVE_WINDOW ?? 0) > 0 && yMax < limit;
    const down = (surface.counts.BELOW_WINDOW ?? 0) > 0 && yMin > -limit;
    if (!up && !down) return { read, surface, windows: reads };
    if (up) yMax = Math.min(limit, yMax + step);
    if (down) yMin = Math.max(-limit, yMin - step);
  }
}
