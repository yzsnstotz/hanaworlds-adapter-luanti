// Pure batch planning for region I/O. The number of mapblocks per engine
// command is derived from the courier's actual reply body limit and the loaded
// registry; it is a transport bound, not a policy setting.
export const BLOCK = 16;
const floorBlock = n => Math.floor(n / BLOCK);
const fail = code => { throw new Error(code); };

/** Worst-case reply bytes per mapblock and the resulting blocks per command. */
export function blocksPerBatch(limits) {
  const { maxBodyBytes, registeredNodes, longestNodeName } = limits ?? {};
  if (![maxBodyBytes, registeredNodes, longestNodeName].every(n => Number.isSafeInteger(n) && n > 0))
    fail('CAPABILITY_UNAVAILABLE');
  const cells = BLOCK ** 3;
  // Every cell its own run: "index,count," (<= 7+1+5+1) and "param2,count,"
  // (<= 3+1+5+1), plus one guard entry per block. Extras are not bounded by
  // cells; an oversized reply is refused by the engine (LIMIT_EXCEEDED) and the
  // host then reads that batch one mapblock at a time.
  const perBlock = cells * 24 + 512;
  const envelope = 64 * 1024;
  const palette = n => Math.min(registeredNodes, n * cells) * (longestNodeName * 2 + 8);
  let k = 0;
  while (envelope + (k + 1) * perBlock + palette(k + 1) <= maxBodyBytes) k++;
  if (k < 1) fail('LIMIT_EXCEEDED');
  return k;
}

/** Split a node box into mapblock-aligned batch boxes of at most perBatch blocks. */
export function batches(min, max, perBatch) {
  const lo = min.map(floorBlock), hi = max.map(floorBlock);
  const n = lo.map((v, i) => hi[i] - v + 1);
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

const blocksOf = box => box.max.reduce((n, v, i) => n * (floorBlock(v) - floorBlock(box.min[i]) + 1), 1);
const union = (a, b) => ({ min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])) });

/** Group boxes (in the given order) so each group's bounding box spans at most
 * perBatch mapblocks: one VoxelManip working set per group. */
export function groupBoxes(items, boxOf, perBatch) {
  const groups = [];
  for (const item of items) {
    const box = boxOf(item), last = groups.at(-1);
    if (last && blocksOf(union(last.box, box)) <= perBatch) { last.items.push(item); last.box = union(last.box, box); }
    else groups.push({ box, items: [item] });
  }
  return groups;
}

/** Expand an engine read reply into flat arrays over its box. */
export function expandRead(reply) {
  const { min, max } = reply;
  const size = max.map((v, i) => v - min[i] + 1);
  const total = size[0] * size[1] * size[2];
  const names = reply.palette, content = reply.contentRuns, p2 = reply.param2Runs;
  if (!Array.isArray(names) || !Array.isArray(content) || !Array.isArray(p2)) fail('CAPABILITY_UNAVAILABLE');
  const name = new Int32Array(total), param2 = new Uint8Array(total);
  const fill = (runs, out, ok) => {
    let n = 0;
    for (let r = 0; r < runs.length; r += 2) {
      const v = runs[r], c = runs[r + 1];
      if (!ok(v) || !Number.isSafeInteger(c) || c < 1 || n + c > total) fail('CAPABILITY_UNAVAILABLE');
      out.fill(v, n, n + c); n += c;
    }
    if (n !== total) fail('CAPABILITY_UNAVAILABLE');
  };
  fill(content, name, v => Number.isInteger(v) && v >= 0 && v < names.length);
  fill(p2, param2, v => Number.isInteger(v) && v >= 0 && v <= 255);
  const at = (x, y, z) => ((z - min[2]) * size[1] + (y - min[1])) * size[0] + (x - min[0]);
  return { min, max, names, name, param2, at, extras: reply.extras ?? [] };
}

/** Run-length encode one box of an expanded block for the engine write command. */
export function writeRuns(box, indices, palette, unspecified) {
  const names = [], index = new Map(), content = [], p2 = [];
  let lastC = null, countC = 0, lastP = null, countP = 0;
  for (let i = 0; i < indices.length; i++) {
    let c = -1, p = 0;
    if (indices[i] !== unspecified) {
      const e = palette[indices[i]];
      c = index.get(e.nodeName);
      if (c === undefined) { c = names.length; names.push(e.nodeName); index.set(e.nodeName, c); }
      p = e.param2;
    }
    if (c === lastC) countC++; else { if (lastC !== null) content.push(lastC, countC); lastC = c; countC = 1; }
    if (p === lastP) countP++; else { if (lastP !== null) p2.push(lastP, countP); lastP = p; countP = 1; }
  }
  content.push(lastC, countC); p2.push(lastP, countP);
  return { min: box.min, max: box.max, palette: names, contentRuns: content, param2Runs: p2 };
}
