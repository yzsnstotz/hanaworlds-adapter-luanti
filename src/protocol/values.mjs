// Adapter-owned protocol helpers. Historical MIT adaptation; see NOTICE and
// docs/protocol-provenance.md. No external SDK load or build input.
import schemaBundle from './schema.json' with {type:'json'};
import contractMetadata from './metadata.json' with {type:'json'};
// historical protocol helper: local/runtime.mjs
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

// historical protocol helper: local/generated/contracts.mjs


// historical protocol helper: errors.mjs
var retryFor = (phase, code) => phase === "decode" || phase === "replay" ? "NEVER" : phase === "restore" ? "AFTER_MANUAL_RECOVERY" : code === "RECOVERY_PENDING" ? "SAME_TRANSACTION_QUERY" : "AFTER_NEW_FACTS";
var worldContext = (details) => {
  if (!Object.hasOwn(details, "worldRef") || details.worldRef === void 0) return {};
  if (typeof details.worldRef !== "string" || details.worldRef.length === 0) throw new TypeError("worldRef must be a non-empty Ref");
  return { worldRef: details.worldRef };
};
var ContractError = class extends Error {
  constructor(code = "SCHEMA_INVALID", phase = "decode", reason = "INVALID_SHAPE", details = {}) {
    super(`${code}/${phase}/${reason}`);
    this.name = "ContractError";
    this.publicError = Object.freeze({
      code,
      phase,
      retryability: details.retryability ?? retryFor(phase, code),
      mutationState: details.mutationState ?? "NONE",
      transactionRef: details.transactionRef ?? null,
      causeCode: details.causeCode ?? null,
      reason,
      ...worldContext(details),
      ...(details.source === undefined ? {} : {source:validateType("FailureSource",details.source)})
    });
  }
  get code() {
    return this.publicError.code;
  }
  get phase() {
    return this.publicError.phase;
  }
  get reason() {
    return this.publicError.reason;
  }
  get mutationState() {
    return this.publicError.mutationState;
  }
  get retryability() {
    return this.publicError.retryability;
  }
  get worldRef() {
    return this.publicError.worldRef;
  }
};
function fail(code, phase, reason, details) {
  throw new ContractError(code, phase, reason, details);
}
function publicError(error) {
  if (error?.publicError !== undefined) return validateType("Error", error.publicError);
  return new ContractError("SCHEMA_INVALID", "decode", "INVALID_SHAPE").publicError;
}
function requireFact(condition, code = "SCHEMA_INVALID", reason = "INVALID_SHAPE", phase = "validate", details) {
  if (!condition) fail(code, phase, reason, details);
}

// historical protocol helper: local/world-lifecycle.mjs
var worldLifecycle = contractMetadata.worldLifecycle;
var responses = new Map(worldLifecycle.operations.map((o) => [o.response, o]));
var inventories = /* @__PURE__ */ new Set(["WorldLifecycleInventory", "LocalWorldsInventory"]);
var shape = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_SHAPE");
var current = (ok) => requireFact(ok, "CURRENT_WORLD_MISMATCH", "REVISION_CHANGED");
var associated = (ok) => requireFact(ok, "TRANSACTION_CONFLICT", "PAYLOAD_CHANGED");
function validateLifecycleDomain(visits) {
  for (const { name, value: v } of visits) {
    const declaration = responses.get(name);
    if (declaration && v.error !== null) shape(declaration.errors.includes(v.error.code));
    if (name === "WorldLifecycleDescription") {
      shape(new Set(v.templates.map((t) => t.templateId)).size === v.templates.length);
      shape(new Set(v.prerequisites.map((p) => p.prerequisiteId)).size === v.prerequisites.length);
    }
    if (inventories.has(name)) {
      shape(new Set(v.worlds.map((w) => w.worldId)).size === v.worlds.length);
      shape(new Set(v.worlds.map((w) => w.worldRef)).size === v.worlds.length);
    }
    if (name === "LocalWorldsPairResponse" && v.result !== null)
      current(v.result.worldRef === v.result.capabilities.worldRef);
  }
}
function validateLifecycleBinding(wire4, name, request, response) {
  if (!worldLifecycle.operations.some((o) => o.wire === wire4 && o.operation === name)) return;
  const result = response.result;
  if (result === null) return;
  for (const field of ["worldId", "worldRef", "connectionRef"])
    if (Object.hasOwn(request, field) && Object.hasOwn(result, field)) current(request[field] === result[field]);
  for (const field of ["templateId", "displayName", "confirmationName"])
    if (Object.hasOwn(request, field) && Object.hasOwn(result, field)) associated(request[field] === result[field]);
}

// historical protocol helper: local/skill-tools.mjs
var toolManifest = contractMetadata.toolManifest;
var buildingSkill = contractMetadata.buildingSkill;
var directBuild = contractMetadata.directBuild;

// historical protocol helper: strict-json.mjs
import { types as nodeTypes } from "node:util";
var invalid = (reason = "INVALID_SHAPE") => fail("SCHEMA_INVALID", "decode", reason);
var scalar = (s) => {
  if (!s.isWellFormed()) invalid("LONE_SURROGATE");
  return s;
};
function decodeRawJSON(bytes) {
  if (nodeTypes.isProxy(bytes) || !(bytes instanceof Uint8Array)) invalid();
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    invalid("INVALID_UTF8");
  }
  let p = 0;
  const whitespace = () => {
    while (p < text.length && /[\x20\x09\x0a\x0d]/.test(text[p])) p++;
  };
  function token() {
    whitespace();
    if (p === text.length) return { kind: "EOF" };
    const c = text[p];
    if ("{}[]:,".includes(c)) {
      p++;
      return { kind: c };
    }
    if (c === '"') {
      const start = p++;
      let ended = false;
      while (p < text.length) {
        const ch = text[p++];
        if (ch === '"') {
          ended = true;
          break;
        }
        if (ch === "\\") {
          if (p >= text.length) invalid();
          const esc = text[p++];
          if (esc === "u") {
            if (!/^[0-9a-fA-F]{4}$/.test(text.slice(p, p + 4))) invalid();
            p += 4;
          } else if (!'"\\/bfnrt'.includes(esc)) invalid();
        } else if (ch.charCodeAt(0) < 32) invalid();
      }
      if (!ended) invalid();
      let value;
      try {
        value = JSON.parse(text.slice(start, p));
      } catch {
        invalid();
      }
      return { kind: "scalar", value: scalar(value), string: true };
    }
    for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(word, p)) {
        p += word.length;
        return { kind: "scalar", value };
      }
    }
    if (c === "-" || /[0-9]/.test(c)) {
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(p));
      if (!match) invalid("INVALID_NUMBER");
      p += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) invalid("INVALID_NUMBER");
      return { kind: "scalar", value };
    }
    if (text.startsWith("NaN", p) || text.startsWith("Infinity", p)) invalid("INVALID_NUMBER");
    invalid();
  }
  const stack = [];
  let root;
  let hasRoot = false;
  const attach = (value) => {
    if (!stack.length) {
      if (hasRoot) invalid();
      root = value;
      hasRoot = true;
      return;
    }
    const parent = stack[stack.length - 1];
    if (parent.kind === "object") {
      if (parent.state !== "value") invalid();
      Object.defineProperty(parent.value, parent.key, { value, enumerable: true, writable: true, configurable: true });
    } else parent.value.push(value);
    parent.state = "commaOrEnd";
  };
  function valueToken(t) {
    if (t.kind === "scalar") attach(t.value);
    else if (t.kind === "{" || t.kind === "[") {
      const value = t.kind === "{" ? /* @__PURE__ */ Object.create(null) : [];
      attach(value);
      stack.push({
        kind: t.kind === "{" ? "object" : "array",
        value,
        state: t.kind === "{" ? "keyOrEnd" : "valueOrEnd",
        keys: /* @__PURE__ */ new Set(),
        key: null
      });
    } else invalid();
  }
  valueToken(token());
  while (stack.length) {
    const f = stack[stack.length - 1];
    const t = token();
    if (f.kind === "object") {
      if (f.state === "keyOrEnd" || f.state === "key") {
        if (t.kind === "}" && f.state === "keyOrEnd") {
          stack.pop();
          continue;
        }
        if (t.kind !== "scalar" || !t.string) invalid();
        if (f.keys.has(t.value)) fail("NON_CANONICAL_AMBIGUITY", "decode", "DUPLICATE_DECODED_KEY");
        f.keys.add(t.value);
        f.key = t.value;
        f.state = "colon";
      } else if (f.state === "colon") {
        if (t.kind !== ":") invalid();
        f.state = "value";
      } else if (f.state === "value") valueToken(t);
      else if (t.kind === "}") stack.pop();
      else if (t.kind === ",") f.state = "key";
      else invalid();
    } else {
      if (f.state === "valueOrEnd" && t.kind === "]") {
        stack.pop();
        continue;
      }
      if (f.state === "valueOrEnd" || f.state === "value") valueToken(t);
      else if (t.kind === "]") stack.pop();
      else if (t.kind === ",") f.state = "value";
      else invalid();
    }
  }
  if (token().kind !== "EOF") invalid();
  return root;
}
function snapshotJSON(input) {
  const holder = { value: void 0 };
  const ancestors = /* @__PURE__ */ new Set();
  const work = [{ input, target: holder, key: "value", exit: false }];
  while (work.length) {
    const item = work.pop();
    if (item.exit) {
      ancestors.delete(item.input);
      continue;
    }
    const value = item.input;
    if (value === null || typeof value === "boolean") {
      item.target[item.key] = value;
      continue;
    }
    if (typeof value === "string") {
      item.target[item.key] = scalar(value);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid("INVALID_NUMBER");
      item.target[item.key] = value;
      continue;
    }
    if (typeof value !== "object" || nodeTypes.isProxy(value)) invalid();
    if (ancestors.has(value)) invalid();
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) invalid();
    const target = array ? [] : /* @__PURE__ */ Object.create(null);
    item.target[item.key] = target;
    const keys = Object.keys(descriptors);
    if (array && (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length"))) invalid();
    ancestors.add(value);
    work.push({ input: value, exit: true });
    for (let i = keys.length - 1; i >= 0; i--) {
      const key2 = keys[i];
      const d = descriptors[key2];
      if (array && key2 === "length") continue;
      if (!Object.hasOwn(d, "value") || !d.enumerable) invalid();
      if (array && (!/^(?:0|[1-9][0-9]*)$/.test(key2) || Number(key2) >= value.length)) invalid();
      scalar(key2);
      work.push({ input: d.value, target, key: key2, exit: false });
    }
  }
  return holder.value;
}
function deepFreeze(value) {
  const stack = [value];
  const seen = /* @__PURE__ */ new Set();
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    for (const x of Object.values(v)) stack.push(x);
    Object.freeze(v);
  }
  return value;
}

// historical protocol helper: geometry.mjs
var compareUTF16 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var comparePosition = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};
function assertPosition(p) {
  requireFact(Array.isArray(p) && p.length === 3 && p.every(Number.isSafeInteger), "SCHEMA_INVALID", "INVALID_GEOMETRY");
}
function assertBox(box) {
  assertPosition(box.min);
  assertPosition(box.max);
  requireFact(box.min.every((v, i) => v <= box.max[i]), "SCHEMA_INVALID", "INVALID_GEOMETRY");
}
function unionCellCount(boxes) {
  snapshotJSON(boxes);
  for (const b of boxes) assertBox(b);
  const ranges = boxes.map((b) => ({ min: b.min.map(BigInt), max: b.max.map((v) => BigInt(v) + 1n) }));
  function measure(items, axis) {
    if (!items.length) return 0n;
    if (axis === 3) return 1n;
    const cuts = [...new Set(items.flatMap((b) => [b.min[axis], b.max[axis]]))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    let count = 0n;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      count += (b - a) * measure(items.filter((r) => r.min[axis] <= a && r.max[axis] >= b), axis + 1);
    }
    return count;
  }
  return measure(ranges, 0);
}
var inside = (p, box) => p.every((v, i) => v >= box.min[i] && v <= box.max[i]);
function unionBounds(boxes) {
  requireFact(boxes.length > 0, "SCHEMA_INVALID", "INVALID_GEOMETRY");
  for (const b of boxes) assertBox(b);
  const result = { min: [...boxes[0].min], max: [...boxes[0].max] };
  for (const b of boxes) for (let a = 0; a < 3; a++) {
    result.min[a] = Math.min(result.min[a], b.min[a]);
    result.max[a] = Math.max(result.max[a], b.max[a]);
  }
  return result;
}
function validateExactEffects(operations, materials, effects) {
  for (const op of operations) assertBox(op);
  requireFact(unionCellCount(operations) === BigInt(effects.length), "SCHEMA_INVALID", "INVALID_GEOMETRY");
  for (const effect of effects) {
    const op = operations.findLast((item) => inside(effect.position, item));
    requireFact(op && Object.hasOwn(materials, op.materialRef), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
    const material = materials[op.materialRef];
    requireFact(effect.materialRef === material.materialRef && effect.orientation === material.orientation, "SCHEMA_INVALID", "INVALID_GEOMETRY");
  }
  return true;
}

// historical protocol helper: local/plugin-roles-binding.mjs
var meta = contractMetadata.pluginRoles;

// historical protocol helper: local/placement.mjs
var confirmedPlacement = contractMetadata.confirmedPlacement;
var named = new Map(confirmedPlacement.namedFailures.map((f) => [f.failure, f]));
var key = (p) => p.join(",");
var none = (v) => v === void 0 ? null : v;
function need(ok, failure) {
  if (ok) return;
  const f = named.get(failure);
  const error = new ContractError(f.code, f.phase, f.reason);
  error.placementFailure = failure;
  throw error;
}
function matchTarget(target, positions) {
  if (target.kind === "ANCHORED_EXTENT") {
    for (const p of positions) need(inside(p, target.bounds), "PLACEMENT_TARGET_MISMATCH");
    return;
  }
  const cells = new Set(target.cells.map(key)), seen = /* @__PURE__ */ new Set();
  for (const p of positions) {
    const k = key(p);
    need(cells.has(k) && !seen.has(k), "PLACEMENT_TARGET_MISMATCH");
    seen.add(k);
  }
  need(seen.size === cells.size, "PLACEMENT_TARGET_MISMATCH");
}
function placementApplyCoherence(request) {
  const binding = request.regionInspectionBinding, confirmed = none(binding?.confirmedPlacement);
  if (confirmed === null) return;
  const { placement } = confirmed, source = placement.source;
  need(digestValue("placement-proposal", placement).sha256 === confirmed.placementDigest, "PLACEMENT_BINDING_CHANGED");
  need(placement.worldRef === request.worldRef, "PLACEMENT_WORLD_CHANGED");
  need(source.frameDigest === request.operations.frameDigest, "PLACEMENT_FRAME_CHANGED");
  need(source.worldRevision === request.expectedWorldRevision, "PLACEMENT_REVISION_STALE");
  need(
    source.inspectionId === binding.inspectionId && source.targetFactsDigest === request.operations.targetFactsDigest,
    "PLACEMENT_INSPECTION_CHANGED"
  );
  matchTarget(placement.target, request.operations.effects.map((e) => e.position));
}

// historical protocol helper: local/region-domain.mjs
var shape2 = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_SHAPE");
var geometry = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_GEOMETRY");
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var comparePalette = (a, b) => compareUTF16(a.materialRef, b.materialRef) || a.orientation - b.orientation;
function blockBox(block) {
  const max = block.origin.map((o, a) => BigInt(o) + BigInt(block.size[a]) - 1n);
  geometry(max.every((v) => v <= BigInt(Number.MAX_SAFE_INTEGER)));
  return { min: [...block.origin], max: max.map(Number) };
}
function blockCellCount(block) {
  const n = block.size.reduce((acc, s) => acc * BigInt(s), 1n);
  geometry(n <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(n);
}
var floorDiv = (v, edge) => Math.floor(v / edge);
var chunkOfPosition = (p, partition) => p.map((v, a) => floorDiv(v, partition.edge[a]));
var chunkBox = (c, partition) => ({ min: c.map((v, a) => v * partition.edge[a]), max: c.map((v, a) => v * partition.edge[a] + partition.edge[a] - 1) });
var boxWithin = (inner, outer) => inner.min.every((v, a) => v >= outer.min[a] && inner.max[a] <= outer.max[a]);
function intersectBox(a, b) {
  const min = a.min.map((v, i) => Math.max(v, b.min[i]));
  const max = a.max.map((v, i) => Math.min(v, b.max[i]));
  return min.every((v, i) => v <= max[i]) ? { min, max } : null;
}
function chunksOfBox(box, partition) {
  const lo = chunkOfPosition(box.min, partition), hi = chunkOfPosition(box.max, partition);
  const out = [];
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    const chunkPos = [x, y, z];
    out.push({ chunkPos, box: intersectBox(chunkBox(chunkPos, partition), box) });
  }
  return out;
}
function regionBlock(v) {
  const total = blockCellCount(v);
  blockBox(v);
  let sum = 0, previous, specified = false;
  const used = /* @__PURE__ */ new Set();
  for (const [count, index] of v.runs) {
    shape2(index !== previous);
    previous = index;
    sum += count;
    if (index !== null) {
      shape2(index < v.palette.length);
      used.add(index);
      specified = true;
    }
  }
  shape2(Number.isSafeInteger(sum) && sum === total);
  shape2(specified && used.size === v.palette.length);
}
function regionState(v) {
  shape2(v.block.runs.every(([, index]) => index !== null));
  const box = blockBox(v.block);
  const derived = new Set(v.stateProfile.derivedFields);
  for (const extra of v.extras) {
    shape2(Object.keys(extra.state).every((k) => !derived.has(k)));
    geometry(extra.position.every((p, a) => p >= box.min[a] && p <= box.max[a]));
    shape2(Object.keys(extra.state).length > 0);
  }
}
var inChunk = (partition, chunkPos, box) => geometry(boxWithin(box, chunkBox(chunkPos, partition)));
var lightingDeclared = (v) => shape2(v.postWriteLighting === "NONE" === (v.lighting === null));
var lit = (v) => v.postWriteLighting === "NONE" || v.lighting.status === "COMPLETE";
var world = (v, ...refs) => requireFact(refs.every((r) => r === v.worldRef) && v.localContext.worldRef === v.worldRef, "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
function summaryCoherent(worldRef, ...summaries) {
  requireFact(summaries.every((s) => s.worldRef === worldRef), "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
  const layout = (s) => JSON.stringify([s.partition, s.chunks.map((c) => [c.chunkPos, c.box])]);
  shape2(summaries.every((s) => layout(s) === layout(summaries[0])));
}
function validateRegionDomain(name, v) {
  if (name === "RegionVoxelBlock") regionBlock(v);
  else if (name === "WorldGeometry") shape2(v.partition !== null === v.geometryProfiles.includes("voxel-grid/v1"));
  else if (name === "RegionState") regionState(v);
  else if (name === "RegionOperationsProjection") for (const c of v.chunks) inChunk(v.partition, c.chunkPos, blockBox(c.block));
  else if (name === "RegionBuildProjection") shape2(same(blockBox(v.block), v.declaredBounds));
  else if (name === "CompiledRegionSet") {
    const boxes = v.projection.chunks.map((c) => blockBox(c.block));
    const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a]))), max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
    geometry(same({ min, max }, v.writeBounds));
  } else if (name === "CompileRegionBuildRequest") {
    world(v, v.build.worldRef);
    shape2(v.build.catalogueDigest === v.catalogueDigest);
  } else if (name === "ValidateRegionProposalRequest") {
    world(v, v.intent.intendedWorldRef);
    shape2(v.referenceBrief.sessionRef === v.sessionRef && v.referenceBrief.turnRevision === v.turnRevision && v.intent.referenceBriefDigest === v.referenceBriefDigest);
  } else if (name === "ReadRegionRequest") world(v);
  else if (name === "RegionChunkRead") {
    if (v.availability === "KNOWN") {
      shape2(v.state !== null && v.stateDigest !== null && v.loadMethod !== null && v.unknownReason === null);
      shape2(same(blockBox(v.state.block), v.box));
    } else shape2(v.state === null && v.stateDigest === null && v.unknownReason !== null);
  } else if (name === "RegionReadResult") {
    world(v, ...v.chunks.filter((c) => c.state).map((c) => c.state.worldRef));
    shape2(same(chunksOfBox(v.box, v.partition), v.chunks.map((c) => ({ chunkPos: c.chunkPos, box: c.box }))));
  } else if (name === "RegionChunkWrite") shape2(v.ops === null !== (v.state === null));
  else if (name === "WriteRegionRequest") {
    shape2(v.writes.every((w) => v.purpose === "APPLY" === (w.ops !== null)));
    for (const w of v.writes) inChunk(v.partition, w.chunkPos, blockBox(w.ops ?? w.state.block));
    world(v, ...v.writes.filter((w) => w.state).map((w) => w.state.worldRef));
  } else if (name === "RegionChunkWriteResult") shape2(v.status === "WRITTEN" === (v.readbackDigest !== null));
  else if (name === "RegionWriteResult") {
    world(v);
    lightingDeclared(v);
  } else if (name === "RegionSummary") for (const c of v.chunks) inChunk(v.partition, c.chunkPos, c.box);
  else if (name === "RegionSnapshotContent") {
    requireFact(v.chunks.every((c) => c.state.worldRef === v.worldRef), "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
    for (const c of v.chunks) inChunk(v.partition, c.chunkPos, blockBox(c.state.block));
  } else if (name === "ApplyRegionCommitRequest") world(v, v.operations.worldRef);
  else if (name === "RegionCommitResult") {
    world(v);
    summaryCoherent(v.worldRef, v.beforeSummary, v.expectedAfterSummary, v.actualSummary);
    lightingDeclared(v);
    if (v.status === "VERIFIED") shape2(same(v.actualSummary, v.expectedAfterSummary) && lit(v));
    else shape2(same(v.actualSummary, v.beforeSummary));
    if (Object.hasOwn(v, "rollbackCause")) {
      const e = v.rollbackCause.error;
      shape2(v.status === "ROLLED_BACK" && e.phase !== "restore" && ["NONE", "PARTIAL", "UNKNOWN"].includes(e.mutationState) && (e.transactionRef === null || e.transactionRef === v.transactionId));
    }
  } else if (name === "UndoRegionCommitRequest" || name === "UndoScopedRegionCommitRequest") {
    world(v);
    shape2(v.originTransactionId !== v.undoTransactionId);
  } else if (name === "RegionUndoResult" || name === "ScopedRegionUndoOutcome") {
    world(v);
    summaryCoherent(v.worldRef, v.preUndoSummary, v.actualSummary);
    lightingDeclared(v);
    shape2(v.originTransactionId !== v.undoTransactionId);
    if (v.status === "VERIFIED") shape2(lit(v));
    else if (name === "RegionUndoResult") shape2(same(v.actualSummary, v.preUndoSummary));
  }
  if (name === "UndoScopedRegionCommitResponse" && v.result) shape2(v.result.outcome.status === "VERIFIED" === (v.undoFailure === null));
}

// historical protocol helper: local/region.mjs
var protocolPolicy = contractMetadata.protocolPolicy;
var contractProtocols = contractMetadata.contractProtocols;
var regionCapabilities = contractMetadata.regionCapabilities;
var regionInvariants = contractMetadata.regionInvariants;
var same2 = (a, b) => canonicalJSON(a) === canonicalJSON(b);
var changed = (ok) => requireFact(ok, "TRANSACTION_CONFLICT", "PAYLOAD_CHANGED");
function regionBlockBox(block) {
  return deepFreeze(blockBox(validateType("RegionVoxelBlock", block)));
}
function chunkOf(position, partition) {
  validateType("Position", position);
  return Object.freeze(chunkOfPosition(position, validateType("Partition", partition)));
}
function regionChunksOfBox(box, partition) {
  return deepFreeze(chunksOfBox(validateType("Box", box), validateType("Partition", partition)));
}
function expandRegionBlock(input) {
  const block = validateType("RegionVoxelBlock", input);
  const indices = new Int32Array(blockCellCount(block));
  let at = 0;
  for (const [count, index] of block.runs) {
    indices.fill(index ?? -1, at, at + count);
    at += count;
  }
  return Object.freeze({ box: blockBox(block), size: block.size, palette: block.palette, indices });
}
function encodeRegionBlock({ origin, size, palette, indices }) {
  validateType("Position", origin);
  validateType("RegionSize", size);
  const total = blockCellCount({ size });
  requireFact(indices && typeof indices.length === "number" && indices.length === total);
  const entries = palette.map((p) => validateType("MaterialSpec", p));
  const used = [...new Set(Array.from(indices).filter((i) => i !== -1))];
  requireFact(used.every((i) => Number.isInteger(i) && i >= 0 && i < entries.length));
  const sorted = [...new Map(used.map((i) => [canonicalJSON(entries[i]), entries[i]])).values()].sort(comparePalette);
  const position = new Map(sorted.map((e, i) => [canonicalJSON(e), i]));
  const remap = new Map(used.map((i) => [i, position.get(canonicalJSON(entries[i]))]));
  const runs = [];
  for (let i = 0; i < total; i++) {
    requireFact(indices[i] === -1 || remap.has(indices[i]));
    const value = indices[i] === -1 ? null : remap.get(indices[i]);
    if (runs.length && runs.at(-1)[1] === value) runs.at(-1)[0]++;
    else runs.push([1, value]);
  }
  return validateType("RegionVoxelBlock", {
    profileVersion: "region-voxels/v2",
    geometryProfile: "voxel-grid/v1",
    origin: [...origin],
    size: [...size],
    indexOrder: "X_FASTEST_THEN_Y_THEN_Z",
    palette: sorted.map((e) => ({ materialRef: e.materialRef, orientation: e.orientation })),
    runs
  });
}
function validateRegionPalette(blockInput, catalogue) {
  const block = validateType("RegionVoxelBlock", blockInput);
  validateStaticMaterials(Object.fromEntries(block.palette.map((e, i) => ["p" + i, e])), catalogue);
  return block;
}
function expectedRegionState(beforeInput, opsInput) {
  const before = validateType("RegionState", beforeInput);
  const ops = expandRegionBlock(opsInput);
  requireFact(same2(blockBox(before.block), ops.box), "SCHEMA_INVALID", "INVALID_GEOMETRY");
  const prior = expandRegionBlock(before.block);
  const palette = [...prior.palette, ...ops.palette];
  const offset = prior.palette.length;
  const indices = Int32Array.from(prior.indices, (v, i) => ops.indices[i] === -1 ? v : ops.indices[i] + offset);
  const { min, max } = ops.box;
  const sx = max[0] - min[0] + 1, sy = max[1] - min[1] + 1;
  const preserved = before.stateProfile.preservedFields;
  const extras = before.extras.flatMap((e) => {
    const [x, y, z] = e.position.map((v, a) => v - min[a]);
    if (ops.indices[x + sx * (y + sy * z)] === -1) return [e];
    const state = Object.fromEntries(preserved.filter((k) => Object.hasOwn(e.state, k)).map((k) => [k, e.state[k]]));
    return Object.keys(state).length ? [{ position: e.position, state }] : [];
  });
  return validateType("RegionState", {
    profileVersion: "region-state/v2",
    worldRef: before.worldRef,
    block: encodeRegionBlock({ origin: before.block.origin, size: before.block.size, palette, indices }),
    extras,
    stateProfile: before.stateProfile
  });
}
function validateRegionRead(requestInput, responseInput) {
  const request = validateRequest("world-adapter-region/v3", "ReadRegion", requestInput);
  const response = validateResponse("world-adapter-region/v3", "ReadRegion", responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return response;
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same2(r.localContext, request.localContext), "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
  changed(same2(r.box, request.box) && same2(r.partition, request.partition));
  for (const c of r.chunks) if (c.state) validateDigestBinding("region-state", c.state, c.stateDigest);
  return response;
}
function requireKnownRegion(resultInput) {
  const result = validateType("RegionReadResult", resultInput);
  requireFact(result.chunks.every((c) => c.availability === "KNOWN"), "TARGET_FACTS_INCOMPLETE", "REQUIRED_FACT_UNKNOWN");
  return result;
}
function validateRegionWrite(requestInput, responseInput) {
  const request = validateRequest("world-adapter-region/v3", "WriteRegion", requestInput);
  const response = validateResponse("world-adapter-region/v3", "WriteRegion", responseInput);
  changed(response.requestId === request.requestId);
  if (response.error) return deepFreeze({ response, allWritten: false, committed: false });
  const r = response.result;
  requireFact(r.worldRef === request.worldRef && same2(r.localContext, request.localContext), "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
  changed(r.transactionId === request.transactionId && r.purpose === request.purpose && same2(r.chunks.map((c) => c.chunkPos), request.writes.map((w) => w.chunkPos)));
  const allWritten = r.chunks.every((c) => c.status === "WRITTEN") && (r.postWriteLighting === "NONE" || r.lighting.status === "COMPLETE");
  return deepFreeze({ response, allWritten, committed: false });
}
var regionRollbackCause = contractMetadata.regionRollbackCause;
function protocolRequirement(wire4, capabilities = [], minMinor = 0) {
  const m = /^(.+)\/[vV]([1-9][0-9]*)$/u.exec(wire4);
  requireFact(m !== null, "UNSUPPORTED_VERSION", "VERSION_UNSUPPORTED", "decode");
  return validateType("ProtocolRequirement", { protocol: m[1], major: Number(m[2]), minMinor, capabilities: [...capabilities].sort() });
}
function checkProtocolCompatibility(advertisedInput, requirementsInput) {
  if (advertisedInput === null || typeof advertisedInput !== "object" || advertisedInput.profileVersion !== "protocol-handshake/v1")
    fail("UNSUPPORTED_VERSION", "decode", "VERSION_UNSUPPORTED");
  const advertised = validateType("ProtocolHandshake", advertisedInput);
  const requirements = validateType("ProtocolRequirements", requirementsInput);
  const matched = requirements.map((req) => {
    const p = advertised.protocols.find((x) => x.protocol === req.protocol);
    requireFact(p !== void 0 && p.major === req.major && p.minor >= req.minMinor, "UNSUPPORTED_VERSION", "VERSION_UNSUPPORTED", "decode");
    requireFact(req.capabilities.every((c) => advertised.capabilities.includes(c)), "CAPABILITY_UNAVAILABLE", "VERSION_UNSUPPORTED", "decode");
    return { protocol: p.protocol, major: p.major, minor: p.minor, capabilities: req.capabilities };
  });
  return deepFreeze({ result: "PROTOCOL_COMPATIBLE", component: advertised.component, matched, provenance: advertised.provenance });
}

// historical protocol helper: local/scoped-region-undo.mjs
var scopedRegionUndo = contractMetadata.scopedRegionUndo;
var same3 = (a, b) => canonicalJSON(a) === canonicalJSON(b);
var D = (k, v) => digestValue(k, v).sha256;
var conflict = (ok) => requireFact(ok, "UNDO_CONFLICT", "PAYLOAD_CHANGED");
var world2 = (ok) => requireFact(ok, "CURRENT_WORLD_MISMATCH", "SCOPE_DENIED");
function validateScopedRegionUndoBinding(wire4, operation5, q, response) {
  if (wire4 !== scopedRegionUndo.wire || operation5 !== scopedRegionUndo.operation) return;
  conflict(response.requestId === q.requestId);
  if (response.undoFailure) conflict(response.undoFailure.error.transactionRef === null || response.undoFailure.error.transactionRef === q.undoTransactionId);
  if (response.error) return;
  const { scope, outcome } = response.result;
  world2(scope.worldRef === q.worldRef && scope.sessionRef === q.sessionRef && same3(scope.localContext, q.localContext) && outcome.worldRef === q.worldRef && same3(outcome.localContext, q.localContext));
  conflict(scope.originTransactionId === q.originTransactionId && outcome.originTransactionId === q.originTransactionId && outcome.undoTransactionId === q.undoTransactionId && D("confirmed-region-undo-scope", scope) === q.expectedScopeDigest);
}

// historical protocol helper: local/placement-settings.mjs
var placementSettingsRead = contractMetadata.placementSettingsRead;

// historical protocol helper: local/schema-validator.mjs
var invalid2 = () => fail("SCHEMA_INVALID", "decode", "INVALID_SHAPE");
function validateShape(typeName, value) {
  if (!Object.hasOwn(schemaBundle.definitions, typeName)) throw new TypeError("Unknown public contract type");
  const work = [{ s: schemaBundle.definitions[typeName], value, field: "", parent: "" }];
  const visits = [];
  const numericDomains = [];
  while (work.length) {
    const entry = work.pop();
    let s = entry.s;
    const v = entry.value;
    if (s.$ref) {
      const key2 = s.$ref.slice("#/definitions/".length);
      s = schemaBundle.definitions[key2];
      if (!s) throw new TypeError("Broken generated schema reference");
    }
    if (s["x-opaque"]) {
      visits.push({ name: s["x-typeName"], value: v, parent: entry.parent, field: entry.field });
      continue;
    }
    if (s.anyOf) {
      const choices = s.anyOf.filter((x) => x.type !== "null");
      const selected = v === null ? s.anyOf.find((x) => x.type === "null") : choices.length > 1 && choices.every((x) => Object.hasOwn(x, "const")) ? choices.find((x) => x.const === v) ?? choices[0] : choices[0];
      if (!selected) invalid2();
      work.push({ ...entry, s: selected });
      continue;
    }
    const name = s["x-typeName"] ?? entry.parent;
    if (s["x-typeName"]) visits.push({ name: s["x-typeName"], value: v, parent: entry.parent, field: entry.field });
    if (s.oneOf) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) invalid2();
      const index = s["x-variantKeys"].indexOf(v[s["x-discriminator"]]);
      if (index < 0) invalid2();
      work.push({ ...entry, s: s.oneOf[index], parent: name });
      continue;
    }
    if (Object.hasOwn(s, "const")) {
      if (v !== s.const) {
        if (entry.field === "contractVersion" || entry.field === "profileVersion") fail("UNSUPPORTED_VERSION", "decode", "VERSION_UNSUPPORTED");
        invalid2();
      }
      continue;
    }
    if (s.enum) {
      if (!s.enum.includes(v)) {
        if (name === "Guarantee") fail("UNSUPPORTED_VERSION", "decode", "VERSION_UNSUPPORTED");
        invalid2();
      }
      continue;
    }
    if (s.type === "null") {
      if (v !== null) invalid2();
      continue;
    }
    if (s.type === "object") {
      if (v === null || typeof v !== "object" || Array.isArray(v)) invalid2();
      const keys = Object.keys(v);
      if (s.properties) {
        if (keys.some((k) => !Object.hasOwn(s.properties, k))) fail("UNKNOWN_REQUIRED_FIELD", "decode", "UNKNOWN_FIELD");
        if (s.required.some((k) => !Object.hasOwn(v, k))) invalid2();
        const fields = Object.keys(s.properties);
        for (let i = fields.length - 1; i >= 0; i--) {
          const field = fields[i];
          if (!Object.hasOwn(v, field)) continue;
          work.push({ s: s.properties[field], value: v[field], field, parent: name });
        }
      } else {
        if (s.minProperties !== void 0 && keys.length < s.minProperties) invalid2();
        for (let i = keys.length - 1; i >= 0; i--) {
          const key2 = keys[i];
          work.push({ s: s.additionalProperties, value: v[key2], field: "", parent: name });
          work.push({ s: s.propertyNames, value: key2, field: "", parent: name });
        }
      }
      continue;
    }
    if (s.type === "array") {
      if (!Array.isArray(v)) invalid2();
      if (s.minItems !== void 0 && v.length < s.minItems || s.maxItems !== void 0 && v.length > s.maxItems) invalid2();
      for (let i = v.length - 1; i >= 0; i--) work.push({ s: Array.isArray(s.items) ? s.items[i] : s.items, value: v[i], field: entry.field, parent: name });
      continue;
    }
    if (s.type === "integer" || s.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) invalid2();
      if (s.type === "integer" && !Number.isInteger(v) || s.minimum !== void 0 && v < s.minimum || s.maximum !== void 0 && v > s.maximum || s.exclusiveMinimum !== void 0 && v <= s.exclusiveMinimum) numericDomains.push({ name, parent: entry.parent });
      continue;
    }
    if (typeof v !== s.type) invalid2();
    if (s.type === "string") {
      if (s.minLength !== void 0 && [...v].length < s.minLength) invalid2();
      if (s.pattern && !new RegExp(s.pattern, "u").test(v)) invalid2();
    }
  }
  if (numericDomains.length) {
    const d = numericDomains[0];
    fail("SCHEMA_INVALID", "validate", d.parent === "Position" ? "INVALID_GEOMETRY" : "INVALID_SHAPE");
  }
  return visits;
}

// historical protocol helper: names.mjs
var forbidden = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]/u;
var edges = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;
var invisible = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u200c\u200d\ufe00-\ufe0f\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]*$/u;
function validateNameSyntax(name) {
  snapshotJSON(name);
  if (typeof name !== "string") fail("INVALID_NAME", "validate", "INVALID_SHAPE");
  if (forbidden.test(name)) fail("INVALID_NAME", "validate", "NAME_FORBIDDEN_CHARACTER");
  const displayName = name.replace(edges, "");
  if (invisible.test(displayName)) fail("INVALID_NAME", "validate", "NAME_INVISIBLE_OR_EMPTY");
  return displayName;
}

// historical protocol helper: local/domain.mjs
var same4 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var geometry2 = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_GEOMETRY");
var shape3 = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_SHAPE");
var positionKey = (p) => JSON.stringify(p);
var decodeShape = (ok) => requireFact(ok, "SCHEMA_INVALID", "INVALID_SHAPE", "decode");
var PLACEMENT_OPTION_ORDER = ["PICK_WORLD_POINT"];
var enumOrder = (type, key2) => {
  const values = schemaBundle.definitions[type].enum;
  return (a, b) => values.indexOf(key2(a)) - values.indexOf(key2(b));
};
var GUARD_VIOLATION = { BODY_CLEARANCE: "BODY_OCCUPIED", CELL_PROTECTION: "PROTECTED_CELL", PLAYER_ENCLOSURE: "PLAYER_ENCLOSED" };
function guardRefusalError(refusal, { transactionRef = null, preflight = false, cause = null } = {}) {
  const stage = contractMetadata.engineGuards.stages.find((s) => s.stage === refusal.stage);
  const violated = refusal.finding !== "GUARD_UNAVAILABLE";
  if (preflight) {
    if (violated) throw new Error("a guard violation is never pre-flight");
    return {
      code: "CAPABILITY_UNAVAILABLE",
      phase: "validate",
      retryability: "AFTER_NEW_FACTS",
      mutationState: "NONE",
      transactionRef,
      causeCode: null,
      reason: "REQUIRED_FACT_UNKNOWN"
    };
  }
  if (stage.phase === "restore" && cause !== null) return {
    code: "RESTORE_FAILED",
    phase: "restore",
    retryability: "AFTER_MANUAL_RECOVERY",
    mutationState: "PARTIAL",
    transactionRef,
    causeCode: cause,
    reason: "RESTORE_ERROR"
  };
  return {
    code: violated ? "SAFETY_INVARIANT_FAILED" : "CAPABILITY_UNAVAILABLE",
    phase: stage.phase,
    retryability: stage.phase === "decode" ? "NEVER" : "AFTER_NEW_FACTS",
    mutationState: "NONE",
    transactionRef,
    causeCode: null,
    reason: violated ? refusal.finding === "PROTECTED_CELL" ? "SCOPE_DENIED" : "INVALID_GEOMETRY" : "REQUIRED_FACT_UNKNOWN"
  };
}
var sameError = (e, refusal) => [false, ...refusal.finding === "GUARD_UNAVAILABLE" ? [true] : []].some((preflight) => {
  const x = guardRefusalError(refusal, { transactionRef: e.transactionRef, preflight, cause: e.causeCode });
  return ["code", "phase", "retryability", "mutationState", "causeCode", "reason"].every((k) => e[k] === x[k]);
});
function guarded(v) {
  if (v.guardRefusal !== null) shape3(v.error !== null && sameError(v.error, v.guardRefusal));
}
function applyFailure(v) {
  if (v.applyFailure === null) return;
  shape3(v.error !== null && v.error.phase === "restore" && v.error.retryability === "AFTER_MANUAL_RECOVERY" && ["PARTIAL", "UNKNOWN"].includes(v.error.mutationState) && v.applyFailure.error.phase !== "restore" && v.error.causeCode === v.applyFailure.error.code);
  if (v.applyFailure.guardRefusal !== null) shape3(sameError(v.applyFailure.error, v.applyFailure.guardRefusal));
}
var GUARDED_RESPONSES = /* @__PURE__ */ new Set([
  "ScopedPrepareResponse",
  "ScopedApplyResponse",
  "PrepareHistoryTransactionResponse",
  "ApplyHistoryTransactionResponse",
  "RestoreTransactionResponse",
  "WriteRegionResponse",
  "InspectRegionResponse",
  "ApplyRegionCommitResponse",
  "UndoRegionCommitResponse",
  "UndoScopedRegionCommitResponse",
  // Relays up to the skill: Canvas per-cell and placement responses, Workshop build/undo responses.
  "RecoverableCommitAppliedReceipt",
  "UndoReceipt",
  "RedoReceipt",
  "CanvasUndoRecoveryResponse",
  "PlacementRegionInspection",
  "AdvanceCurrentBuildResponse",
  "UndoCurrentBuildResponse",
  "SessionRecoverPendingUndoResponse",
  "RedoCurrentBuildResponse",
  "ToolBuildResponse"
]);
function arrayCompare(name, order) {
  if (order === "numeric ascending") return (a, b) => a - b;
  if (order === "UTF16 ascending") return compareUTF16;
  if (order === "numeric x,y,z" || order === "numeric lexicographic six coordinates") return comparePosition;
  if (order === "position numeric x,y,z") return (a, b) => comparePosition(a.position, b.position);
  if (order === "materialRef UTF16 then orientation numeric") return comparePalette;
  if (order === "materialRef UTF16 ascending") return (a, b) => compareUTF16(a.materialRef, b.materialRef);
  if (order === "chunkPos numeric x,y,z") return (a, b) => comparePosition(a.chunkPos, b.chunkPos);
  if (order === "EngineGuardStage enum order") return enumOrder("EngineGuardStage", (x) => x);
  if (order === "WriteMethod enum order") return enumOrder("WriteMethod", (x) => x);
  if (order === "orientation numeric ascending") return (a, b) => a.orientation - b.orientation;
  if (order === "guard EngineGuard enum order") return enumOrder("EngineGuard", (x) => x.guard);
  if (order === "protocol UTF16 ascending") return (a, b) => compareUTF16(a.protocol, b.protocol);
  if (order === "objectRef UTF16 ascending") return (a, b) => compareUTF16(a.objectRef, b.objectRef);
  if (order === "sessionRef UTF16 ascending") return (a, b) => compareUTF16(a.sessionRef, b.sessionRef);
  if (order === "portalRef UTF16 ascending") return (a, b) => compareUTF16(a.portalRef, b.portalRef);
  if (order === "witnessId UTF16 ascending") return (a, b) => compareUTF16(a.witnessId, b.witnessId);
  if (order === "resourceId UTF16 ascending") return (a, b) => compareUTF16(a.resourceId, b.resourceId);
  if (order === "fixed NAME_PLAYER then PICK_WORLD_POINT") return (a, b) => PLACEMENT_OPTION_ORDER.indexOf(a) - PLACEMENT_OPTION_ORDER.indexOf(b);
  if (order === "creationSequence numeric then objectRef UTF16") return (a, b) => a.creationSequence - b.creationSequence || compareUTF16(a.objectRef, b.objectRef);
  if (order === "limitKind,source UTF16" || order === "adapterId,connectionRef,worldRef UTF16") {
    const keys = order.split(" ")[0].split(",");
    return (a, b) => {
      for (const k of keys) {
        const n = compareUTF16(a[k], b[k]);
        if (n) return n;
      }
      return 0;
    };
  }
  return null;
}
function validateArrayOrder(name, v, parent) {
  const schema = schemaBundle.definitions[name];
  const uniqueBy = schema["x-uniqueBy"];
  const unique = schema.uniqueItems;
  if (uniqueBy || unique) {
    const keys = uniqueBy?.split(",");
    const seen = /* @__PURE__ */ new Set();
    for (const item of v) {
      const key2 = JSON.stringify(keys ? keys.map((k) => item[k]) : item);
      if (seen.has(key2)) fail(name === "OrderedRefs" && parent === "SetObjectSelectionRequest" ? "DUPLICATE_OBJECT_REF" : "SCHEMA_INVALID", "validate", "INVALID_SHAPE");
      seen.add(key2);
    }
  }
  const compare = arrayCompare(name, schema["x-order"]);
  if (compare) for (let i = 1; i < v.length; i++) shape3(compare(v[i - 1], v[i]) <= 0);
}
function targetFacts(v) {
  const actual = ["worldRef", "objectRef", "worldRevision", "objectRevision"];
  const planned = ["buildDigest", "planRevision"];
  decodeShape(v.profileVersion === "target-facts/v5");
  if (v.source === "REGION_INSPECTED") {
    decodeShape(v.worldRef !== null && v.worldRevision !== null);
    decodeShape(["objectRef", "objectRevision", ...planned].every((k) => v[k] === null));
  } else {
    shape3(actual.every((k) => v[k] !== null === (v.source === "INSPECTED")));
    shape3(planned.every((k) => v[k] !== null === (v.source === "PLANNED")));
  }
  const positions = [...v.occupiedCells.map((x) => x.position), ...v.knownEmptyCells, ...v.unknownCells.map((x) => x.position)];
  shape3(new Set(positions.map(positionKey)).size === positions.length);
  geometry2(positions.every((p) => inside(p, v.sampledBounds)));
  if (v.unknownCells.length) requireFact(v.usableVolume === null, "TARGET_FACTS_INCOMPLETE", "REQUIRED_FACT_UNKNOWN");
}
function receipt(v) {
  guarded(v);
  shape3(v.status === "RESTORE_FAILED" === (v.applyFailure !== null));
  applyFailure(v);
  if (v.status === "VERIFIED") {
    shape3(v.readbackDigest !== null && v.observedWorldRevision !== null && v.error === null && v.restoreStatus === "NOT_REQUIRED");
  }
  if (v.status === "RESTORE_FAILED") shape3(["FAILED", "UNKNOWN"].includes(v.restoreStatus));
  if (v.status === "RECOVERY_PENDING") shape3(v.error !== null && v.error.mutationState === "UNKNOWN");
  if (v.status === "ROLLED_BACK") shape3(v.restoreStatus === "VERIFIED_RESTORED" && v.readbackDigest !== null && v.observedWorldRevision !== null);
}
function scopedWorld(v) {
  const known = (ok) => requireFact(ok, "TARGET_FACTS_INCOMPLETE", "REQUIRED_FACT_UNKNOWN");
  known(v.cells.every((cell) => cell.availability === "KNOWN" && cell.stateDigest !== null));
  known(v.objects.every((object) => object.provenance === "CANVAS_REGISTERED" && object.positions.length > 0));
  requireFact(v.objects.every((object) => object.worldRef === v.worldRef), "OBJECT_SCOPE_MISMATCH", "SCOPE_DENIED");
  const covered = /* @__PURE__ */ new Map();
  for (const position of v.checkedPositions) covered.set(positionKey(position), position);
  for (const object of v.objects) for (const position of object.positions) covered.set(positionKey(position), position);
  known(covered.size > 0 && covered.size === v.cells.length && v.cells.every((cell) => covered.has(positionKey(cell.position))));
}
function scopedRequest(v) {
  const scope = v.scope;
  shape3(scope.worldRef === v.worldRef && scope.transactionId === v.transactionId && scope.operationDigest === v.operationDigest && v.operations.worldRef === v.worldRef);
  const covered = new Set(scope.cells.map((cell) => positionKey(cell.position)));
  requireFact(
    v.operations.effects.every((effect) => covered.has(positionKey(effect.position))),
    "TARGET_FACTS_INCOMPLETE",
    "REQUIRED_FACT_UNKNOWN"
  );
}
function validateDomain(visits) {
  for (let i = visits.length - 1; i >= 0; i--) {
    const { name, value: v, parent } = visits[i];
    const schema = schemaBundle.definitions[name];
    if (Array.isArray(v) && schema.type === "array" && !Array.isArray(schema.items)) validateArrayOrder(name, v, parent);
    validateRegionDomain(name, v);
    if (GUARDED_RESPONSES.has(name)) {
      guarded(v);
      if (Object.hasOwn(v, "applyFailure")) applyFailure(v);
    }
    if (name === "GuardRefusal") shape3(v.finding === "GUARD_UNAVAILABLE" || GUARD_VIOLATION[v.guard] === v.finding);
    if (name === "FailureDetail" && v.guardRefusal !== null) shape3(sameError(v.error, v.guardRefusal));
    if (name === "EngineGuardDeclaration") shape3(v.coverage.map((c) => c.guard).join() === schemaBundle.definitions.EngineGuard.enum.join());
    if (name === "EngineGuardCoverage") shape3(v.protectionPrincipal !== null === (v.guard === "CELL_PROTECTION" && v.stages.length > 0));
    if (name === "Box" || name === "SetBox") assertBox(v);
    else if (name === "CanvasWorldSelection" && v.status === "BOUND")
      shape3(v.context.activeWorldRef !== null);
    else if (name === "WorldSelectionContext") {
      shape3(v.inventory.connections.every((row) => row.worldRef === v.worldRef));
      shape3((v.selection.status === "BOUND" ? v.selection.context.currentSession : v.selection.sessionRef) === v.sessionRef);
    } else if (name === "CurrentContext") shape3(v.activeWorldRef === (v.localContext?.worldRef ?? null));
    else if (name === "UnselectWorldConnectionRequest") shape3(v.expectedContext.worldRef === v.worldRef);
    else if (name === "SelectionConnectionState") shape3(v.status === "UNBOUND" === (v.worldRef === null) && v.worldRef === null === (v.connectionRef === null));
    else if (name === "Axes") geometry2(new Set(v.map((x) => x[1])).size === 3);
    else if (name === "MaterialTags") {
      const nulls = Object.keys(v).filter((k) => k !== "unknownFields" && v[k] === null).sort(compareUTF16);
      shape3(same4(nulls, v.unknownFields));
    } else if (name === "Catalogue") {
      shape3(Object.hasOwn(v.materials, v.emptyMaterialRef));
    } else if (name === "StateProfile") {
      const all = [...v.derivedFields, ...v.preservedFields, ...v.clearedFields];
      shape3(new Set(all).size === all.length);
    } else if (name === "WriteProfile" || name === "WorldSourceCapabilities") {
      shape3(v.compilationConfig !== null === (v.writeBackend.availability === "KNOWN"));
      if (v.compilationConfig !== null) {
        const a = v.compilationConfig.writeBackend, b = v.writeBackend.writeBackend;
        shape3(a.profileId === b.profileId && a.revision === b.revision);
      }
      if (name === "WorldSourceCapabilities") shape3(v.writePath.catalogueDigest === v.catalogueDigest);
    } else if (name === "CatalogueFacts") {
      shape3(same4(Object.keys(v.presentation).sort(compareUTF16), Object.keys(v.catalogue.materials).sort(compareUTF16)));
      const described = new Set(v.orientationIndex.map((o) => o.orientation));
      shape3(Object.values(v.catalogue.materials).every((m) => (m.orientations ?? []).every((o) => described.has(o))));
    } else if (name === "MaterialSourceFacts") {
      shape3(same4(Object.keys(v.presentation).sort(compareUTF16), [...new Set(v.snapshot.materials.map((m) => m.materialRef))].sort(compareUTF16)));
    } else if (name === "InspectionContext") {
      shape3(v.localContext.worldRef === v.worldRef);
    } else if (name === "Coverage") geometry2(v.sampledPositions.every((p) => inside(p, v.sampledBounds)));
    else if (name === "Portal") {
      geometry2(v.positions.length > 0);
      geometry2([0, 1, 2].some((axis) => v.positions.every((p) => p[axis] === v.positions[0][axis])));
    } else if (name === "TargetFacts") targetFacts(v);
    else if (name === "EntranceWitness") {
      const usable = new Set(v.usablePositions.map(positionKey));
      geometry2(v.path.every((p) => usable.has(positionKey(p))));
      for (let j = 1; j < v.path.length; j++) geometry2(v.path[j].reduce((n, x, a) => n + Math.abs(x - v.path[j - 1][a]), 0) === 1);
    } else if (name === "BodyWitness") {
      shape3(v.evidence.worldRef !== null && v.evidence.worldRevision !== null);
    } else if (name === "BuildProjection") {
      shape3(same4(unionBounds(v.operations), v.declaredBounds));
      for (const op of v.operations) requireFact(Object.hasOwn(v.materials, op.materialRef), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
    } else if (name === "MediaBinding") shape3(v.projectionVariantId === null === (v.projectionBytesDigest === null));
    else if (name === "ReceiptProjection") receipt(v);
    else if (name === "BeforeImage" || name === "ReadbackProjection") shape3(same4(v.coveredPositions, v.records.map((x) => x.position)));
    else if (name === "PreparedTransaction" || name === "PreparedTransactionResult") shape3(v.beforeImageDigest === v.payload.beforeImageDigest);
    else if (name === "ScopedWorldBinding") scopedWorld(v);
    else if (name === "ScopedPrepareRequest" || name === "ScopedApplyRequest") scopedRequest(v);
    else if (name === "ScopedPreparedTransaction" || name === "ScopedPreparedTransactionResult")
      shape3(v.beforeImageDigest === v.payload.beforeImageDigest && v.scopeDigest === v.payload.scopeDigest && v.guarantee === "RECOVERABLE_VERIFIED");
    else if (name === "ActionDescriptor") decodeShape(v.choices !== null === v.inputKinds.includes("SELECT_CHOICE"));
    else if (name === "RegionInspection") {
      decodeShape(v.targetFacts.source === "REGION_INSPECTED");
      shape3(v.evidence.worldRef === v.targetFacts.worldRef && v.evidence.worldRevision === v.targetFacts.worldRevision);
      shape3(v.evidence.sourceRevision === v.frame.transformRevision);
    } else if (name === "PlacementRegionInspection") {
      shape3(v.unavailableSettings !== null === (v.error !== null && v.error.code === "CAPABILITY_UNAVAILABLE" && v.error.reason === "POLICY_UNAVAILABLE"));
    } else if (name === "SessionTurnDetails") {
      shape3(v.turns.every((turn) => turn.confirmedBrief === null || turn.confirmedBrief.sessionRef === v.sessionRef && turn.confirmedBrief.turnRevision === turn.turnRevision));
    } else if (name === "CurrentUndoStatus") {
      if (v.availability === "NO_VERIFIED_BUILD") shape3(v.turnRef === null && v.turnRevision === null && v.head === null);
      else shape3(v.turnRef !== null && v.turnRevision !== null && v.head !== null && (v.availability !== "AVAILABLE" || v.head.headTransactionId !== null));
    } else if (name === "CurrentBuildUndoResult") {
      shape3(v.beforeHead.headTransactionId !== null && v.beforeHead.historyRevision !== v.afterHead.historyRevision && v.beforeHead.headTransactionId !== v.afterHead.headTransactionId);
    } else if (name === "UndoRecoveryResult") {
      shape3(v.status === "VERIFIED" === (v.receipt !== null));
      if (v.receipt !== null) shape3(v.receipt.status === "VERIFIED");
    } else if (name === "BuildEntryChoiceRequired" || name === "BuildEntryOutcome" && v.outcome === "CHOICE_REQUIRED") {
      shape3(v.frame.sessionRef === v.sessionRef && v.frame.turnRevision === v.turnRevision);
    } else if (name === "BuildEntryVerified" || name === "BuildEntryOutcome" && v.outcome === "VERIFIED") {
      shape3(v.receipt.status === "VERIFIED");
    } else if (name === "BuildProposalBox") {
      assertBox(v);
      geometry2(v.min.every((x) => x >= 0));
    } else if (name === "ValidateBuildProposalResponse" && v.error !== null) {
      shape3(v.error.mutationState === "NONE" && v.error.transactionRef === null);
    } else if (name === "CreateBuildPlanRequest") {
      if (v.targetFacts.source === "REGION_INSPECTED") {
        requireFact(v.painterId === "building-exterior", "TARGET_REQUIRED", "SCOPE_DENIED");
        requireFact(v.regionInspection !== null, "TARGET_FACTS_INCOMPLETE", "REQUIRED_FACT_UNKNOWN");
      } else decodeShape(v.regionInspection === null);
    } else if (name === "NameObjectRequest" || name === "RenameObjectRequest") validateNameSyntax(v.name);
    else if (name === "ObjectNameReceipt") shape3(validateNameSyntax(v.displayName) === v.displayName);
    else if (name === "SavedResourceReceipt") requireFact(v.durable === true, "SAVED_RESOURCE_UNAVAILABLE", "RESOURCE_MISSING");
    else if (name === "CompiledOperationSet") {
      shape3(same4(unionBounds(v.projection.effects.map((e) => ({ min: e.position, max: e.position }))), v.writeBounds));
    }
    if (schema.type === "object" && schema.properties && Object.hasOwn(schema.properties, "result") && Object.hasOwn(schema.properties, "error")) {
      shape3(v.result === null !== (v.error === null));
    }
  }
}
function validateEventDomain(typeName, event) {
  const rule = contractMetadata.canvasEventRules[typeName];
  if (!rule) throw new TypeError("Unknown Canvas event type");
  shape3(rule.operations.includes(event.operation));
  shape3(event.receipt.error === null && event.receipt.result !== null);
  const result = event.receipt.result;
  if (rule.requiredReceiptStatus) shape3(result.status === rule.requiredReceiptStatus);
  if (rule.requiredDecisionKind) shape3(result.decisionKind === rule.requiredDecisionKind);
  if (rule.observedWorldRevisionMustDiffer) shape3(result.source === "INSPECTED" && event.newWorldRevision !== result.worldRevision);
  return event;
}

// historical protocol helper: local/runtime.mjs
var version = contractMetadata.version;
var wireVersions = contractMetadata.wireVersions;
var compiledOperationsVersion = contractMetadata.compiledOperationsVersion;
var operationContracts = contractMetadata.operations;
var canvasEventRules = contractMetadata.canvasEventRules;
var ownership = contractMetadata.ownership;
var placementSettingDescriptors = contractMetadata.placementSettings;
var placementInvariants = contractMetadata.placementInvariants;
var settingsSurface = contractMetadata.settingsSurface;
var digestProfile = contractMetadata.digest;
var schemaInventory = contractMetadata.typeNames;
var contractHandshake = contractMetadata.contractHandshake;
var contractsCompatibility = contractMetadata.contractsCompatibility;
var sessionWorldSeam = contractMetadata.sessionWorldSeam;
function validateType(typeName, value) {
  const snapshot = snapshotJSON(value);
  const visits = validateShape(typeName, snapshot);
  validateDomain(visits);
  for (const {name,value} of visits) {
    if(name==='WorldSourceTransportPolicy') {
      const names=value.settings.map(s=>s.name);
      requireFact(new Set(names).size===names.length,'SCHEMA_INVALID','INVALID_SHAPE');
    }
    if(name==='WorldSourceTransportSetting')requireFact(value.min<=value.defaultValue&&value.defaultValue<=value.max&&value.min<=value.value&&value.value<=value.max,'SCHEMA_INVALID','INVALID_SHAPE');
  }
  validateLifecycleDomain(visits);
  for (const { name, value: value2 } of visits) if (name === "RegionChunk" && Object.hasOwn(value2, "blockDigest"))
    validateDigestBinding("region-block", value2.block, value2.blockDigest);
  if (Object.hasOwn(canvasEventRules, typeName)) validateEventDomain(typeName, snapshot);
  return deepFreeze(snapshot);
}
function operation(wire4, operationName) {
  if (!Object.hasOwn(operationContracts, wire4)) fail("UNSUPPORTED_VERSION", "decode", "VERSION_UNSUPPORTED");
  const result = operationContracts[wire4].find((op) => op.operation === operationName);
  if (!result) fail("UNSUPPORTED_OPERATION", "validate", "INVALID_SHAPE");
  return result;
}
function validateRequest(wire4, operationName, value) {
  const request = validateType(operation(wire4, operationName).request, value);
  return request;
}
function admitRequest(wire4, operationName, bytes) {
  const value = decodeRawJSON(bytes);
  return validateRequest(wire4, operationName, value);
}
function validateResponse(wire4, operationName, value) {
  const op = operation(wire4, operationName);
  value = snapshotJSON(value);
  if (op.alternateResult && value !== null && typeof value === "object" && Object.hasOwn(value, "clarificationId")) return validateType(op.alternateResult, value);
  const response = validateType(op.response, value);
  return response;
}
function safeCanonicalize(value) {
  for (const proto of [Object.prototype, Array.prototype]) {
    if (Object.getOwnPropertyDescriptor(proto, "toJSON")) fail("SCHEMA_INVALID", "decode", "INVALID_SHAPE");
  }
  return canonicalize(value);
}
function canonicalJSON(value) {
  return safeCanonicalize(snapshotJSON(value));
}
function project(kind, payload) {
  const typeName = digestProfile.projectionTypes[kind];
  if (!typeName) throw new TypeError("Unknown production digest kind");
  const admitted = validateType(typeName, payload);
  const fields = schemaBundle.definitions[typeName].properties;
  const projection = /* @__PURE__ */ Object.create(null);
  for (const field of Object.keys(fields)) if (Object.hasOwn(admitted, field)) projection[field] = admitted[field];
  return deepFreeze(projection);
}
function digestValue(kind, payload) {
  const projection = project(kind, payload);
  const canonicalUtf8 = safeCanonicalize(projection);
  const domain = (digestProfile.domainPrefixByKind?.[kind] ?? digestProfile.domainPrefix) + kind + digestProfile.domainSuffix;
  const preimageUtf8 = domain + canonicalUtf8;
  const bytes = Buffer.from(preimageUtf8, "utf8");
  return deepFreeze({ kind, projection, canonicalUtf8, preimageUtf8, preimageHex: bytes.toString("hex"), sha256: createHash("sha256").update(bytes).digest("hex") });
}
var ambiguity = (ok) => requireFact(ok, "NON_CANONICAL_AMBIGUITY", "PAYLOAD_CHANGED", "validate", { retryability: "NEVER" });
function validateDigestBinding(kind, payload, providedDigest) {
  validateType("Digest", providedDigest);
  const actual = digestValue(kind, payload);
  if (kind === "reference-brief") requireFact(actual.sha256 === providedDigest, "MEDIA_DIGEST_MISMATCH", "PAYLOAD_CHANGED");
  else ambiguity(actual.sha256 === providedDigest);
  return actual;
}
function validateStaticMaterials(materialsInput, catalogueInput) {
  const materials = validateType("MaterialMap", materialsInput);
  const catalogue = validateType("Catalogue", catalogueInput);
  for (const material of Object.values(materials)) {
    requireFact(Object.hasOwn(catalogue.materials, material.materialRef), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
    const tags = catalogue.materials[material.materialRef];
    requireFact(
      tags.orientations !== null && tags.definitionRevision !== null && tags.placeable === true,
      "UNSUPPORTED_MUTATION_SEMANTICS",
      "REQUIRED_FACT_UNKNOWN"
    );
    requireFact(tags.orientations.includes(material.orientation), "UNSUPPORTED_MUTATION_SEMANTICS", "REQUIRED_FACT_UNKNOWN");
  }
  return materials;
}
var safetyCapabilities = contractMetadata.safetyCapabilities;
var engineGuards = contractMetadata.engineGuards;
function guardRefusalError2(refusalInput, options = {}) {
  const refusal = validateType("GuardRefusal", refusalInput);
  return deepFreeze(validateType("Error", guardRefusalError(refusal, options)));
}
function unmetEngineGuards(declarationInput, requirements) {
  const declaration = declarationInput === null ? null : validateType("EngineGuardDeclaration", declarationInput);
  return deepFreeze(requirements.map((r) => {
    validateType("EngineGuard", r.guard);
    validateType("EngineGuardStage", r.stage);
    const c = declaration?.coverage.find((x) => x.guard === r.guard);
    const covered = !!c && c.stages.includes(r.stage) && (r.protectionPrincipal === void 0 || r.protectionPrincipal === null || r.protectionPrincipal === c.protectionPrincipal);
    return covered ? null : { guard: r.guard, stage: r.stage, finding: "GUARD_UNAVAILABLE" };
  }).filter((x) => x !== null));
}
function requireEngineGuards(declarationInput, requirements) {
  const [unmet] = unmetEngineGuards(declarationInput, requirements);
  if (unmet) {
    const e = guardRefusalError2(unmet, { preflight: true });
    fail(e.code, e.phase, e.reason);
  }
  return deepFreeze(requirements.map((r) => ({ ...r })));
}
function validateRegionInspection(value) {
  const inspection = validateType("RegionInspection", value);
  const tf = inspection.targetFacts;
  validateDigestBinding("target-facts", tf, inspection.targetFactsDigest);
  validateDigestBinding("frame", inspection.frame, tf.frameDigest);
  const sampledPositions = [...tf.occupiedCells.map((x) => x.position), ...tf.knownEmptyCells, ...tf.unknownCells.map((x) => x.position)].sort(comparePosition);
  validateDigestBinding("coverage", { profileVersion: "coverage/v2", sampledBounds: tf.sampledBounds, sampledPositions }, tf.coverageDigest);
  return inspection;
}
var same5 = (a, b) => canonicalJSON(a) === canonicalJSON(b);
var associated2 = (ok) => requireFact(ok, "TRANSACTION_CONFLICT", "PAYLOAD_CHANGED");
var current2 = (ok) => requireFact(ok, "CURRENT_WORLD_MISMATCH", "REVISION_CHANGED");
var pairs = [
  ["build", "buildDigest", "build"],
  ["operations", "operationDigest", "operations"],
  ["intent", "intentDigest", "intent"],
  ["referenceBrief", "referenceBriefDigest", "reference-brief"],
  ["brief", "briefDigest", "reference-brief"],
  ["catalogue", "catalogueDigest", "catalogue"],
  ["targetFacts", "targetFactsDigest", "target-facts"],
  ["safetyProfile", "safetyProfileDigest", "safety-profile"],
  ["compilationConfig", "compilationConfigDigest", "compilation-config"],
  ["surfaceAction", "surfaceActionDigest", "surface-action"],
  ["analysis", "analysisDigest", "affected-analysis"],
  ["scope", "scopeDigest", "scoped-world"]
];
function validateBoundRequest(wire4, name, input) {
  const request = validateRequest(wire4, name, input);
  for (const [field, hash, kind] of pairs) if (Object.hasOwn(request, field) && Object.hasOwn(request, hash)) validateDigestBinding(kind, request[field], request[hash]);
  const context = request.localContext;
  if (context) {
    if (request.worldRef !== void 0) current2(request.worldRef === context.worldRef);
    for (const child of [request.operations, request.expectedOperations, request.scope, request.targetFacts, request.analysis])
      if (child?.worldRef !== void 0 && child.worldRef !== null) current2(child.worldRef === context.worldRef);
    if (request.scope) current2(same5(request.scope.localContext, context));
  }
  if (request.preparedTransaction) {
    const p = request.preparedTransaction;
    validateDigestBinding("scoped-transaction-payload", p.payload, p.transactionPayloadDigest);
    associated2(p.payload.transactionId === request.transactionId && p.payload.operationDigest === request.operationDigest && p.payload.scopeDigest === request.scopeDigest && p.scopeDigest === request.scopeDigest);
    current2(same5(p.payload.localContext, context) && p.payload.worldRef === request.worldRef);
  }
  if (request.scope) {
    associated2(request.scope.transactionId === request.transactionId && request.scope.operationDigest === request.operationDigest);
  }
  if (request.regionInspection) {
    const ri = validateRegionInspection(request.regionInspection);
    associated2(same5(ri.targetFacts, request.targetFacts) && ri.targetFactsDigest === request.targetFactsDigest);
  }
  if (request.build) {
    for (const k of ["catalogueDigest", "targetFactsDigest", "safetyProfileDigest"]) if (request[k] !== void 0) associated2(request.build[k] === request[k]);
    if (request.targetFacts) validateDigestBinding("frame", request.build.coordinateFrame, request.targetFacts.frameDigest);
  }
  if (request.regionInspectionBinding) {
    const b = request.regionInspectionBinding.build;
    validateDigestBinding("build", b, request.operations.buildDigest);
    validateDigestBinding("frame", b.coordinateFrame, request.operations.frameDigest);
    associated2(b.targetFactsDigest === request.operations.targetFactsDigest && b.catalogueDigest === request.operations.catalogueDigest);
    placementApplyCoherence(request);
  }
  if (request.historyOperationDigest) {
    const keys = Object.keys(schemaBundle.definitions.HistoryOperationProjection.properties);
    if (keys.every((k) => Object.hasOwn(request, k))) validateDigestBinding("history-operation", Object.fromEntries(keys.map((k) => [k, request[k]])), request.historyOperationDigest);
  }
  if (name === "PrepareHistoryTransaction") {
    associated2(request.originTransactionId !== request.transactionId);
    associated2(request.targetStateDigest === (request.direction === "UNDO" ? request.originBeforeStateReadbackDigest : request.originAfterReadbackDigest));
    associated2(request.expectedCurrentStateDigest === (request.direction === "UNDO" ? request.originAfterReadbackDigest : request.originBeforeStateReadbackDigest));
  }
  if (request.preparedHistoryTransaction) {
    for (const k of ["originTransactionId", "transactionId", "direction", "historyOperationDigest"]) associated2(request.preparedHistoryTransaction[k] === request[k]);
    current2(same5(request.preparedHistoryTransaction.localContext, context));
  }
  return request;
}
function requestDigest(wire4, name, input) {
  const request = validateBoundRequest(wire4, name, input);
  return createHash("sha256").update("HanaWorlds|contracts@0.4.0|request|" + wire4 + "|" + name + "|" + canonicalJSON(request)).digest("hex");
}
function validateCurrentRequest(wire4, name, input, factsInput) {
  const request = validateBoundRequest(wire4, name, input), facts = validateType("LocalRequestFacts", factsInput);
  associated2(request.sessionRef === facts.sessionRef);
  if (request.localContext) current2(same5(request.localContext, facts.currentContext));
  if (Object.hasOwn(request, "expectedContext")) current2(same5(request.expectedContext, facts.currentContext));
  const turn = request.expectedTurnRevision ?? request.turnRevision;
  if (turn !== void 0) requireFact(turn === facts.currentTurnRevision, "TURN_REVISION_MISMATCH", "REVISION_CHANGED");
  if (request.referenceBriefDigest) associated2(request.referenceBriefDigest === facts.currentBriefDigest);
  requireFact(facts.requestState !== "CANCELLED", "REQUEST_CANCELLED", "REVISION_CHANGED");
  requireFact(facts.requestState !== "UNKNOWN", "REQUEST_NOT_ACTIVE", "REQUIRED_FACT_UNKNOWN");
  const hash = requestDigest(wire4, name, request);
  associated2(facts.replay !== "CONFLICT");
  if (facts.replay === "NEW") associated2(facts.priorRequestDigest === null && facts.requestState === "ACTIVE");
  else associated2(facts.priorRequestDigest === hash && facts.requestState === "COMPLETED");
  return deepFreeze({ request, requestDigest: hash, disposition: facts.replay === "NEW" ? "EXECUTE" : "RETURN_STORED" });
}
var contractsRef = new RegExp("^" + contractsCompatibility.package + "@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$", "u");
function checkContractsVersion(ref) {
  const m = typeof ref === "string" ? contractsRef.exec(ref) : null;
  requireFact(m !== null && Number(m[1]) === contractsCompatibility.major, "UNSUPPORTED_VERSION", "VERSION_UNSUPPORTED", "decode");
  return deepFreeze({ result: "CONTRACTS_MAJOR_MATCH", major: contractsCompatibility.major, advertised: ref });
}
var minorWires = contractMetadata.minorWires;
var defaultRequiredWires = wireVersions.filter((w) => !Object.hasOwn(minorWires, w));
function checkContractHandshake(advertisedInput, required = { wires: defaultRequiredWires, factProfiles: ["target-facts/v5"] }) {
  const advertised = validateType("ContractHandshake", advertisedInput);
  checkContractsVersion(advertised.contracts);
  requireFact(advertised.compiledOperationsVersion === compiledOperationsVersion && required.wires.every((w) => wireVersions.includes(w) && advertised.wireVersions.includes(w)) && required.factProfiles.every((f) => advertised.factProfiles.includes(f)), "UNSUPPORTED_VERSION", "VERSION_UNSUPPORTED", "decode");
  return deepFreeze({ result: "HANDSHAKE_VERSION_MATCH", advertised });
}
function requestWorldSelectors(request) {
  return [request.worldRef, request.localContext?.worldRef, request.hostContext?.localContext?.worldRef].filter((w) => typeof w === "string");
}
function historicalReceiptBinding(wire4, name, request, response) {
  const pair = contractMetadata.historicalReceipt.fields.filter((k) => Object.hasOwn(response, k));
  if (pair.length === 0) return false;
  requireFact(wire4 === contractMetadata.historicalReceipt.wire && name === contractMetadata.historicalReceipt.operation && pair.length === 2 && response.result !== null && response.error === null, "SCHEMA_INVALID", "INVALID_SHAPE", "decode");
  const receipt2 = response.result;
  current2(same5(response.currentLocalContext, request.localContext));
  validateDigestBinding("receipt", receipt2, response.receiptDigest);
  current2(receipt2.localContext.worldRef === request.worldRef);
  associated2(receipt2.transactionId === request.transactionId && receipt2.transactionPayloadDigest === request.transactionPayloadDigest);
  return true;
}
function validateBoundResponse(wire4, name, requestInput, responseInput) {
  const request = validateBoundRequest(wire4, name, requestInput), response = validateResponse(wire4, name, responseInput);
  associated2(response.requestId === request.requestId);
  validateLifecycleBinding(wire4, name, request, response);
  validateScopedRegionUndoBinding(wire4, name, request, response);
  if (response.error?.worldRef !== void 0) for (const selected of requestWorldSelectors(request)) current2(response.error.worldRef === selected);
  const history = historicalReceiptBinding(wire4, name, request, response);
  const result = response.result;
  if (result) {
    if (result.connectionRef !== void 0 && request.connectionRef !== void 0) current2(result.connectionRef === request.connectionRef);
    if (name === "SelectWorldConnection") {
      current2(result.activeWorldRef === request.worldRef && result.localContext?.connectionRef === request.connectionRef && result.localContext?.connectionIncarnationRef === request.connectionIncarnationRef);
      associated2(result.currentSession === request.sessionRef);
    }
    if (name === "UnselectWorldConnection") {
      associated2(result.currentSession === request.sessionRef);
      current2(result.activeWorldRef === null && result.localContext === null && result.orderedSelectedObjectRefs.length === 0);
    }
    if (name === "ReserveWorldRetirement") current2(result.inventoryRevision === request.expectedInventoryRevision);
    if (name === "ReleaseWorldRetirement") associated2(result.reservationRef === request.reservationRef && result.outcome === request.outcome);
    if (name === "BuildDocument") {
      validateDigestBinding("operations", result.projection, result.operationDigest);
      associated2(result.projection.buildDigest === request.buildDigest && result.projection.worldRef === request.worldRef && result.projection.targetFactsDigest === request.targetFactsDigest && result.projection.compilationConfigDigest === request.compilationConfigDigest);
      validateExactEffects(request.build.operations, request.build.materials, result.projection.effects);
    }
    if ((name === "InspectPlacementRegion" || name === "InspectRegion") && request.footprint?.geometryProfile !== void 0 && result.outcome === "REGION_INSPECTED") {
      const inspection = validateRegionInspection(result.inspection);
      current2(inspection.targetFacts.worldRef === request.worldRef);
      associated2(inspection.anchorKind === request.anchor.kind);
      requireFact(inspection.targetFacts.geometryProfile === request.footprint.geometryProfile, "CAPABILITY_GAP", "GEOMETRY_PROFILE_UNSUPPORTED");
    }
    if (result.localContext && request.localContext && !history) current2(same5(result.localContext, request.localContext));
    if (result.worldRef !== void 0 && request.worldRef !== void 0) current2(result.worldRef === request.worldRef);
    if (contractMetadata.worldSourceFacts.operations.some((o) => o.wire === wire4 && o.operation === name)) {
      const connection = result.connection ?? result.snapshot?.connection;
      if (connection) current2(connection.worldRef === request.worldRef);
    }
    if (result.sessionRef !== void 0) associated2(result.sessionRef === request.sessionRef);
    if (result.transactionId !== void 0 && request.transactionId !== void 0) associated2(result.transactionId === request.transactionId);
    if (result.operationDigest !== void 0 && request.operationDigest !== void 0) associated2(result.operationDigest === request.operationDigest);
  }
  return response;
}
function projectScopedPreparedTransaction(input) {
  const result = validateType("ScopedPreparedTransactionResult", input);
  validateDigestBinding("scoped-transaction-payload", result.payload, result.transactionPayloadDigest);
  return validateType("ScopedPreparedTransaction", Object.fromEntries(Object.keys(schemaBundle.definitions.ScopedPreparedTransaction.properties).map((k) => [k, result[k]])));
}
function requireWorldRetirable(inventoryInput) {
  const inventory = validateType("WorldSelectionInventory", inventoryInput);
  requireFact(inventory.sessionRefs.length === 0 && inventory.retirementReservationRef === null, "TRANSACTION_CONFLICT", "SCOPE_DENIED");
  return inventory;
}
function describeSelectionConnection(selectionInput, inventoryInput) {
  const selection = validateType("CanvasWorldSelection", selectionInput), inventory = validateType("ConnectionInventory", inventoryInput);
  if (selection.status === "UNBOUND") return validateType("SelectionConnectionState", { sessionRef: selection.sessionRef, status: "UNBOUND", worldRef: null, connectionRef: null });
  const ctx = selection.context.localContext;
  const live = inventory.connections.some((row) => row.readiness === "READY" && row.connectionRef === ctx.connectionRef && row.worldRef === ctx.worldRef && row.connectionIncarnationRef === ctx.connectionIncarnationRef);
  return validateType("SelectionConnectionState", { sessionRef: selection.context.currentSession, status: live ? "CONNECTED" : "SELECTED_NOT_CONNECTED", worldRef: ctx.worldRef, connectionRef: ctx.connectionRef });
}
function requireSessionDeleteSupported(capabilitiesInput) {
  const capabilities = validateType("PublicCapabilities", capabilitiesInput);
  requireFact(capabilities.sessionDeleteSupported === true, "SESSION_DELETE_UNSUPPORTED", "DELETE_SEAM_ABSENT");
  return capabilities;
}

// historical protocol helper: local/material-sources.mjs
import { createHash as createHash2 } from "node:crypto";
import { types } from "node:util";
function record(value, keys) {
  requireFact(value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value));
  const proto = Object.getPrototypeOf(value);
  requireFact(proto === null || proto === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireFact(Reflect.ownKeys(descriptors).length === keys.length && keys.every((k) => Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k], "value") && descriptors[k].enumerable));
  return Object.fromEntries(keys.map((k) => [k, descriptors[k].value]));
}
function blobs(value) {
  requireFact(value !== null && typeof value === "object" && !types.isProxy(value) && Array.isArray(value));
  const d = Object.getOwnPropertyDescriptors(value);
  const length = d.length.value;
  requireFact(Reflect.ownKeys(d).length === length + 1);
  return Array.from({ length }, (_, i) => {
    requireFact(Object.hasOwn(d, String(i)) && Object.hasOwn(d[i], "value") && d[i].enumerable);
    return record(d[i].value, ["bytesDigest", "bytes"]);
  });
}
function validateMaterialSources(input, catalogue, currentConnection2) {
  const envelope = record(input, ["snapshot", "textures"]);
  const snapshot = validateType("MaterialSourcesSnapshot", envelope.snapshot);
  const cat = validateType("Catalogue", catalogue);
  const current3 = validateType("MaterialSourceConnection", currentConnection2);
  requireFact(canonicalJSON(snapshot.connection) === canonicalJSON(current3), "CURRENT_WORLD_MISMATCH");
  requireFact(snapshot.catalogueDigest === digestValue("catalogue", cat).sha256 && canonicalJSON(snapshot.engineRevisions) === canonicalJSON(cat.engineRevisions), "CATALOGUE_MISMATCH");
  const { sourceRevision, ...projection } = snapshot;
  requireFact(sourceRevision === digestValue("material-sources", projection).sha256, "NON_CANONICAL_AMBIGUITY");
  const needed = /* @__PURE__ */ new Map();
  let previous = null;
  for (const row of snapshot.materials) {
    if (previous) requireFact(compareUTF16(previous.materialRef, row.materialRef) < 0 || previous.materialRef === row.materialRef && (previous.orientation ?? -1) < (row.orientation ?? -1));
    previous = row;
    requireFact(Object.hasOwn(cat.materials, row.materialRef), "CATALOGUE_MISMATCH");
    const tags = cat.materials[row.materialRef];
    requireFact(row.definitionRevision === tags.definitionRevision, "CATALOGUE_MISMATCH");
    if (row.orientation !== null) requireFact(tags.orientations !== null && tags.orientations.includes(row.orientation), "UNSUPPORTED_MUTATION_SEMANTICS");
    else requireFact(tags.orientations === null, "UNSUPPORTED_MUTATION_SEMANTICS");
    if (row.availability === "UNKNOWN") {
      if (row.reason === "UNKNOWN_ORIENTATION") requireFact(tags.orientations === null);
      if (row.reason === "UNKNOWN_DEFINITION") requireFact(tags.definitionRevision === null);
      continue;
    }
    const texture = row.texture;
    if (needed.has(texture.bytesDigest)) requireFact(needed.get(texture.bytesDigest).byteLength === texture.byteLength && needed.get(texture.bytesDigest).mediaType === texture.mediaType);
    needed.set(texture.bytesDigest, texture);
  }
  const seen = /* @__PURE__ */ new Set();
  const textures = [];
  for (const item of blobs(envelope.textures)) {
    const digest = validateType("Digest", item.bytesDigest);
    requireFact(needed.has(digest) && !seen.has(digest));
    seen.add(digest);
    requireFact(types.isUint8Array(item.bytes) && !types.isProxy(item.bytes));
    let bytes;
    try {
      bytes = new Uint8Array(item.bytes);
    } catch {
      requireFact(false);
    }
    requireFact(bytes.byteLength === needed.get(digest).byteLength && createHash2("sha256").update(bytes).digest("hex") === digest, "NON_CANONICAL_AMBIGUITY");
    textures.push(Object.freeze({ bytesDigest: digest, bytes }));
  }
  requireFact(seen.size === needed.size);
  return Object.freeze({ snapshot, textures: Object.freeze(textures) });
}

// historical protocol helper: local/write-path.mjs
var writePathStateScope = contractMetadata.writePathStateScope;
var INIT = new Set(writePathStateScope.initializationCallbacks);
var STATE = new Set(writePathStateScope.stateIndicatorCallbacks);

// historical protocol helper: local/config-engine-facts.mjs
var configEngineFacts = contractMetadata.configEngineFacts;
function validateConfigEngineFacts(input, catalogue, currentConnection2) {
  const facts = validateType("ConfigEngineFacts", input);
  const cat = validateType("Catalogue", catalogue);
  const current3 = validateType("MaterialSourceConnection", currentConnection2);
  requireFact(canonicalJSON(facts.connection) === canonicalJSON(current3), "CURRENT_WORLD_MISMATCH");
  requireFact(facts.catalogueDigest === digestValue("catalogue", cat).sha256, "CATALOGUE_MISMATCH");
  const { sourceRevision, ...projection } = facts;
  requireFact(sourceRevision === digestValue("config-engine-facts", projection).sha256, "NON_CANONICAL_AMBIGUITY");
  return facts;
}
function requireKnownWriteBackend(facts) {
  const f = validateType("ConfigEngineFacts", facts);
  requireFact(f.writeBackend.availability === "KNOWN", "CAPABILITY_UNAVAILABLE", "REQUIRED_FACT_UNKNOWN");
  return f.writeBackend.writeBackend;
}
function requireKnownAvatarEnvelope(facts) {
  validateType("ConfigEngineFacts", facts);
  const r = configEngineFacts.avatarDimensions.refusal;
  requireFact(false, r.code, r.reason, r.phase);
}

// historical protocol helper: local/world-source-facts.mjs
var worldSourceFacts = contractMetadata.worldSourceFacts;
var currentConnection = (fact, current3) => requireFact(canonicalJSON(fact) === canonicalJSON(validateType("MaterialSourceConnection", current3)), "CURRENT_WORLD_MISMATCH");
var catalogueBound = (digest, catalogue) => requireFact(digest === digestValue("catalogue", validateType("Catalogue", catalogue)).sha256, "CATALOGUE_MISMATCH");
function validateCatalogueFacts(input, current3) {
  const facts = validateType("CatalogueFacts", input);
  currentConnection(facts.connection, current3);
  catalogueBound(facts.catalogueDigest, facts.catalogue);
  return facts;
}
function validateMaterialSourceFacts(input, catalogue, current3) {
  const facts = validateType("MaterialSourceFacts", input), snapshot = facts.snapshot, cat = validateType("Catalogue", catalogue);
  currentConnection(snapshot.connection, current3);
  catalogueBound(snapshot.catalogueDigest, cat);
  requireFact(canonicalJSON(snapshot.engineRevisions) === canonicalJSON(cat.engineRevisions), "CATALOGUE_MISMATCH");
  const { sourceRevision, ...projection } = snapshot;
  requireFact(sourceRevision === digestValue("material-sources", projection).sha256, "NON_CANONICAL_AMBIGUITY");
  let previous = null;
  for (const row of snapshot.materials) {
    if (previous) requireFact(compareUTF16(previous.materialRef, row.materialRef) < 0 || previous.materialRef === row.materialRef && (previous.orientation ?? -1) < (row.orientation ?? -1));
    previous = row;
    requireFact(Object.hasOwn(cat.materials, row.materialRef), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
    const tags = cat.materials[row.materialRef];
    requireFact(row.definitionRevision === tags.definitionRevision, "CATALOGUE_MISMATCH");
    if (row.orientation !== null) requireFact(tags.orientations !== null && tags.orientations.includes(row.orientation), "UNSUPPORTED_MUTATION_SEMANTICS");
    else requireFact(tags.orientations === null, "UNSUPPORTED_MUTATION_SEMANTICS");
    if (row.availability === "UNKNOWN") {
      if (row.reason === "UNKNOWN_ORIENTATION") requireFact(tags.orientations === null);
      if (row.reason === "UNKNOWN_DEFINITION") requireFact(tags.definitionRevision === null);
    }
  }
  return facts;
}
function validateEngineFacts(input, current3) {
  const facts = validateType("EngineFacts", input);
  currentConnection(facts.connection, current3);
  return facts;
}
function validateWriteProfile(input, catalogue, current3) {
  const profile = validateType("WriteProfile", input);
  currentConnection(profile.connection, current3);
  catalogueBound(profile.catalogueDigest, catalogue);
  return profile;
}
function validateWorldSourceCapabilities(input, catalogue, current3) {
  const caps = validateType("WorldSourceCapabilities", input), cat = validateType("Catalogue", catalogue);
  currentConnection(caps.connection, current3);
  catalogueBound(caps.catalogueDigest, cat);
  const { path, materials } = caps.writePath, clean = (c) => c.hasSideEffects === false && c.hasPersistentState === false;
  requireFact(Object.keys(materials).every((m) => Object.hasOwn(cat.materials, m)), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
  for (const [ref, tags] of Object.entries(cat.materials))
    if (tags.placeable === true) requireFact(clean(path) && Object.hasOwn(materials, ref) && clean(materials[ref]), "CATALOGUE_MISMATCH", "CATALOGUE_UNRESOLVED");
  return caps;
}
var unknownFact = () => requireFact(false, "CAPABILITY_UNAVAILABLE", "REQUIRED_FACT_UNKNOWN");
function requireWriteProfileConfig(profile) {
  const p = validateType("WriteProfile", profile);
  if (p.compilationConfig === null) unknownFact();
  return p.compilationConfig;
}
function requireDeclaredAvatarEnvelope(fact) {
  const input = snapshotJSON(fact);
  const f = validateType(input?.profileVersion === "world-source-capabilities/v1" ? "WorldSourceCapabilities" : "WriteProfile", input);
  if (f.avatarEnvelope.availability !== "KNOWN") unknownFact();
  return f.avatarEnvelope.size;
}

// historical protocol helper: local/world-lifecycle-mock.mjs
function createWorldLifecycleMock(fixture, refusals = {}) {
  const exchanges = structuredClone(fixture.exchanges);
  for (const x of exchanges) validateBoundResponse(x.wire, x.operation, x.request, x.response);
  const configured = structuredClone(refusals);
  for (const [key2, code] of Object.entries(configured)) {
    const d = worldLifecycle.operations.find((o) => `${o.wire}:${o.operation}` === key2);
    if (!d?.errors.includes(code)) throw new TypeError("Undeclared lifecycle fixture error");
  }
  return (wire4, operation5, input) => {
    const request = validateRequest(wire4, operation5, input);
    const declaration = worldLifecycle.operations.find((o) => o.wire === wire4 && o.operation === operation5);
    const example = exchanges.find((x) => x.wire === wire4 && x.operation === operation5 && x.response.result !== null);
    if (!declaration || !example) throw new TypeError("Not a lifecycle fixture operation");
    let code = configured[`${wire4}:${operation5}`];
    const different = (key2) => Object.hasOwn(request, key2) && request[key2] !== example.request[key2];
    if (!code) {
      if (different("worldId") || different("worldRef")) code = declaration.errors.includes("WORLD_NOT_FOUND") ? "WORLD_NOT_FOUND" : declaration.errors.includes("CONNECTION_NOT_FOUND") ? "CONNECTION_NOT_FOUND" : "ADAPTER_UNAVAILABLE";
      else if (different("connectionRef")) code = "CONNECTION_NOT_FOUND";
      else if (different("confirmationName")) code = "TRANSACTION_CONFLICT";
      else if (different("templateId") || different("worldRoot")) code = "ADAPTER_UNAVAILABLE";
      else if (different("displayName")) code = "INVALID_NAME";
    }
    const refusal = code ? exchanges.find((x) => x.wire === wire4 && x.operation === operation5 && x.response.error?.code === code) : null;
    if (code && !refusal) throw new TypeError("Missing declared lifecycle refusal fixture");
    const response = { ...(refusal ?? example).response, requestId: request.requestId };
    return deepFreeze(validateBoundResponse(wire4, operation5, request, response));
  };
}

// historical protocol helper: local/local-world-source.mjs
var wire = "local-worlds/v2";
var operation2 = "describeSourceWorld";
async function describeSourceWorld(port, input) {
  const request = validateRequest(wire, operation2, input);
  requireFact(typeof port?.describeSourceWorld === "function", "CAPABILITY_UNAVAILABLE", "REQUIRED_FACT_UNKNOWN");
  return validateBoundResponse(wire, operation2, request, await port.describeSourceWorld(request));
}
function createLocalWorldSourceMock(fixture, refusalCode = null) {
  const exchanges = structuredClone(fixture.exchanges);
  const declaration = worldLifecycle.operations.find((o) => o.wire === wire && o.operation === operation2);
  if (refusalCode !== null && !declaration.errors.includes(refusalCode)) throw new TypeError("Undeclared source refusal");
  for (const x of exchanges) {
    if (x.wire !== wire || x.operation !== operation2) throw new TypeError("Not a source description fixture");
    validateBoundResponse(wire, operation2, x.request, x.response);
  }
  const successes = exchanges.filter((x) => x.response.result !== null);
  if (new Set(successes.map((x) => x.request.worldRef)).size !== successes.length) throw new TypeError("Duplicate source fixture worldRef");
  for (const code of declaration.errors) if (!exchanges.some((x) => x.response.error?.code === code)) throw new TypeError("Missing source refusal fixture");
  return (input) => {
    const request = validateRequest(wire, operation2, input);
    const success = successes.find((x) => x.request.worldRef === request.worldRef);
    const code = refusalCode ?? (success ? null : "WORLD_NOT_FOUND");
    const example = code ? exchanges.find((x) => x.response.error?.code === code) : success;
    const response = { ...example.response, requestId: request.requestId };
    return deepFreeze(validateBoundResponse(wire, operation2, request, response));
  };
}

// historical protocol helper: local/world-error.mjs
var worldErrorContext = contractMetadata.worldErrorContext;

// historical protocol helper: local/history-receipt.mjs
var historicalReceipt = contractMetadata.historicalReceipt;
var { wire: wire2, operation: operation3 } = historicalReceipt;
function historicalReceiptResponse(requestInput, storedReceipt, storedReceiptDigest) {
  const request = validateRequest(wire2, operation3, requestInput);
  const receipt2 = validateType("ReceiptProjection", storedReceipt);
  return validateBoundResponse(wire2, operation3, request, { contractVersion: request.contractVersion, requestId: request.requestId, result: receipt2, error: null, currentLocalContext: request.localContext, receiptDigest: storedReceiptDigest });
}
function readHistoricalReceipt(requestInput, responseInput) {
  const response = validateBoundResponse(wire2, operation3, requestInput, responseInput);
  if (response.result === null) throw new TypeError("QueryTransaction response carries no receipt");
  const receipt2 = response.result, written = receipt2.localContext, historical = Object.hasOwn(response, "currentLocalContext");
  const current3 = historical ? response.currentLocalContext : written;
  return deepFreeze({
    receipt: receipt2,
    receiptDigest: historical ? response.receiptDigest : digestValue("receipt", receipt2).sha256,
    historical,
    writtenContext: written,
    currentContext: current3,
    sameConnection: written.connectionRef === current3.connectionRef,
    sameIncarnation: written.connectionIncarnationRef === current3.connectionIncarnationRef,
    sameSelectionRevision: written.selectionRevision === current3.selectionRevision
  });
}

// historical protocol helper: local/plugin-roles.mjs
var pluginRoles = contractMetadata.pluginRoles;
var { wire: wire3, operation: operation4 } = pluginRoles;

// historical protocol helper: local/session-read-guard.mjs
var sessionReadGuard = Object.freeze({
  protocol: "session-read-guard/v1",
  contract: "C-session",
  introducedIn: "2.11.0",
  service: "hanaworldsWorkshop",
  capture: "captureSessionReadGuard",
  check: "isSessionReadGuardCurrent",
  boundary: "Capture before asynchronous preparation; after the final await check every provider and local state in one synchronous execution segment before returning.",
  validity: "Monotonic: any intervening change, disposal, replacement or ABA permanently invalidates the exact guard. Never reset, retry or renew a failed read.",
  transport: "Same Cordis runtime only; opaque local guard is not JSON, HTTP, a lease or persistent state.",
  unavailable: "CAPABILITY_UNAVAILABLE",
  fixture: "fixtures/session-read-guard"
});
export {
  ContractError,
  admitRequest,
  canonicalJSON,
  checkContractHandshake,
  checkContractsVersion,
  checkProtocolCompatibility,
  chunkOf,
  comparePosition,
  contractHandshake,
  createLocalWorldSourceMock,
  createWorldLifecycleMock,
  describeSelectionConnection,
  describeSourceWorld,
  digestProfile,
  digestValue,
  encodeRegionBlock,
  engineGuards,
  expandRegionBlock,
  expectedRegionState,
  guardRefusalError2 as guardRefusalError,
  historicalReceiptResponse,
  operationContracts,
  placementInvariants,
  projectScopedPreparedTransaction,
  protocolRequirement,
  publicError,
  readHistoricalReceipt,
  regionBlockBox,
  regionCapabilities,
  regionChunksOfBox,
  requireDeclaredAvatarEnvelope,
  requireEngineGuards,
  requireKnownAvatarEnvelope,
  requireKnownRegion,
  requireKnownWriteBackend,
  requireSessionDeleteSupported,
  requireWorldRetirable,
  requireWriteProfileConfig,
  schemaBundle,
  unmetEngineGuards,
  validateBoundRequest,
  validateBoundResponse,
  validateCatalogueFacts,
  validateConfigEngineFacts,
  validateCurrentRequest,
  validateEngineFacts,
  validateMaterialSourceFacts,
  validateMaterialSources,
  validateRegionPalette,
  validateRegionRead,
  validateRegionWrite,
  validateRequest,
  validateResponse,
  validateStaticMaterials,
  validateType,
  validateWorldSourceCapabilities,
  validateWriteProfile,
  version,
  wireVersions
};
