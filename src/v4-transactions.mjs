import { createHash } from 'node:crypto';
import {
  canonicalJSON, digestValue, validateType, validateRegionInspection, compareUTF16,
  comparePosition, ContractError,
} from 'hanaworlds-contracts/v4';
import { V2TransactionBackend } from './v2-transactions.mjs';
import { ADAPTER_ID } from './version.mjs';

const hash = (kind, value) => digestValue(kind, value).sha256;
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
function fault(code) { throw new Error(code); }
function typed(code, phase, reason, details) { throw new ContractError(code, phase, reason, details); }
function readbackView(image) {
  return { worldRef: image.worldRef, coveredPositions: image.coveredPositions,
    records: image.records, stateProfile: image.stateProfile };
}
// world-adapter/v4 PreparedTransactionResult: the original seven fields plus
// the readback digest saved with the same durable before image.
function prepared(record) {
  return { payload: record.payload,
    transactionPayloadDigest: record.transactionPayloadDigest,
    beforeImageDigest: record.beforeImageDigest,
    guarantee: 'RECOVERABLE_VERIFIED', stateProfile: record.stateProfile,
    protectedPositions: record.beforeImage.coveredPositions,
    adapterExecutionRevision: record.adapterExecutionRevision,
    beforeStateReadbackDigest: record.beforeStateReadbackDigest };
}
// Returns null when the saved image and digest are intact, else the reason.
function savedReadbackProblem(record) {
  try {
    validateType('BeforeImage', record.beforeImage);
    if (typeof record.beforeStateReadbackDigest !== 'string') return 'saved readback digest missing';
    if (hash('before-image', record.beforeImage) !== record.beforeImageDigest)
      return 'saved before image does not match its digest';
    if (hash('readback', readbackView(record.beforeImage)) !== record.beforeStateReadbackDigest)
      return 'saved readback digest does not match the saved before image';
    return null;
  } catch (error) { return `saved before image invalid: ${error?.message ?? error}`; }
}
// Host log line for a fail-closed path; carries no pose, position or owner data.
function causeOf(error) { return String(error?.message ?? error); }
const AXIS = ['+X', '+Y', '+Z'];
function luantiFrame(worldRef, executionRevision) {
  return { profileVersion: 'frame/v2', frameId: `luanti-world-grid:${worldRef}`,
    origin: [0, 0, 0], axes: [...AXIS], handedness: 'left',
    gridUnit: { name: 'node', metersPerGridUnit: null }, transformRevision: executionRevision };
}
const sortPositions = list => [...list].sort(comparePosition);
function placementOptions(reasons) {
  return reasons.includes('MULTIPLE_ONLINE_PLAYERS') ? ['NAME_PLAYER', 'PICK_WORLD_POINT']
    : ['PICK_WORLD_POINT'];
}
function preparedHistory(record) {
  return { originTransactionId: record.historySourceId,
    transactionId: record.transactionId, direction: record.historyDirection,
    historyOperationDigest: record.historyOperationDigest,
    transactionPayloadDigest: record.transactionPayloadDigest,
    beforeImageDigest: record.beforeImageDigest,
    targetStateDigest: record.targetStateDigest,
    protectedPositions: record.beforeImage.coveredPositions,
    stateProfile: record.stateProfile,
    adapterExecutionRevision: record.adapterExecutionRevision,
    guarantee: 'RECOVERABLE_VERIFIED', status: 'PREPARED' };
}
function receipt(record) {
  const status = record.status === 'ROLLED_BACK' ? 'ROLLED_BACK' :
    record.status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' :
    record.status === 'RECOVERY_PENDING' ? 'RECOVERY_PENDING' :
    'APPLIED_PENDING_READBACK';
  if (status === 'ROLLED_BACK' && (!record.restoredReadbackDigest ||
      !record.observedWorldRevision)) fault('RECOVERY_PENDING');
  const cause = record.causeCode ?? null;
  const phase = cause?.startsWith('READBACK') ? 'readback' : 'apply';
  const error = status === 'APPLIED_PENDING_READBACK' ? null : {
    code: status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' :
      status === 'RECOVERY_PENDING' ? 'RECOVERY_PENDING' : cause ?? 'RECOVERY_PENDING',
    phase: status === 'RESTORE_FAILED' ? 'restore' : phase,
    retryability: status === 'ROLLED_BACK' ? 'NEVER' :
      status === 'RESTORE_FAILED' ? 'AFTER_MANUAL_RECOVERY' : 'SAME_TRANSACTION_QUERY',
    mutationState: status === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'UNKNOWN',
    transactionRef: record.transactionId,
    causeCode: status === 'ROLLED_BACK' ? null : cause,
    reason: status === 'RESTORE_FAILED' ? 'RESTORE_ERROR' :
      status === 'RECOVERY_PENDING' ? 'TRANSPORT_OUTCOME_UNKNOWN' :
      phase === 'readback' ? 'READBACK_ERROR' : 'APPLY_ERROR',
  };
  return { contractVersion: 'canvas/v2', transactionId: record.transactionId,
    operationDigest: record.operationDigest,
    transactionPayloadDigest: record.transactionPayloadDigest,
    status,
    previousWorldRevision: record.expectedWorldRevision,
    observedWorldRevision: status === 'ROLLED_BACK' ? record.observedWorldRevision : null,
    readbackDigest: status === 'ROLLED_BACK' ? record.restoredReadbackDigest : null,
    restoreStatus: status === 'ROLLED_BACK' ? 'VERIFIED_RESTORED' :
      status === 'RESTORE_FAILED' ? 'FAILED' :
      status === 'RECOVERY_PENDING' ? 'UNKNOWN' : 'NOT_REQUIRED', error };
}
function stateImage(raw, worldRef, revision, profile) {
  const image = { ...raw, worldRef, worldRevision: revision, stateProfile: profile };
  validateType('BeforeImage', image);
  return image;
}
function savedStateReady(record) {
  try {
    validateType('BeforeImage', record.beforeImage);
    validateType('BeforeImage', record.targetImage);
    return record.beforeImage.worldRef === record.targetImage.worldRef &&
      same(record.beforeImage.coveredPositions, record.targetImage.coveredPositions) &&
      same(record.beforeImage.stateProfile, record.targetImage.stateProfile) &&
      hash('before-image', record.beforeImage) === record.beforeImageDigest &&
      hash('readback', readbackView(record.targetImage)) === record.targetStateDigest;
  } catch { return false; }
}

/**
 * Adapter private world-adapter/v4 transport, history, recovery and read-only
 * region inspection. Canvas remains the registry/head owner and sole caller.
 * Authorization is the current grant (authorizationRef) plus the request's
 * authorizationBinding; the request actorRef (Canvas service principal) is
 * never compared or trusted (contracts@0.3.0 CONTRACT_GAP-V4-05).
 */
export class V4TransactionBackend {
  #journal; #engine; #oracle; #profile; #binding; #service; #capacity; #history;
  #v2; #catalogue; #executionRevision; #log;
  constructor({ journal, engine, revisionOracle, stateProfile, verifyBinding,
    verifyService, capacity, historyAuthority, catalogue, executionRevision, log }) {
    this.#journal = journal; this.#engine = engine; this.#oracle = revisionOracle;
    this.#profile = stateProfile; this.#binding = verifyBinding;
    this.#service = verifyService; this.#capacity = capacity;
    this.#history = historyAuthority; this.#catalogue = catalogue;
    this.#executionRevision = executionRevision;
    this.#log = typeof log === 'function' ? log :
      (level, message) => console.error(`[hanaworlds-adapter-luanti] ${level}: ${message}`);
    this.#v2 = new V2TransactionBackend({ journal, engine, revisionOracle,
      stateProfile, verifyBinding, verifyService, capacity,
      restoredProof: async before => {
        const observedWorldRevision = await revisionOracle.read(before.worldRef);
        if (typeof observedWorldRevision !== 'string' || !observedWorldRevision)
          fault('RESTORE_FAILED');
        return { observedWorldRevision,
          restoredReadbackDigest: hash('readback', readbackView(before)) };
      } });
  }
  /** The exact recoverable state profile this backend was built with (copy). */
  get stateProfile() { return structuredClone(this.#profile); }
  /** True while the journal holds a record that may still need recovery. */
  get hasUnsettledRecords() { return this.#journal.unsettledCount > 0; }
  #requireSaved(record, operation) {
    const problem = savedReadbackProblem(record);
    if (problem === null) return;
    this.#log('error', `${operation} ${record.transactionId}: ${problem}`);
    fault('CAPABILITY_UNAVAILABLE');
  }
  async #currentBinding(request, action, options) {
    if (typeof this.#binding !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const proof = await this.#binding(request, action, options);
    if (!proof?.current || proof.worldRef !== request.worldRef ||
        proof.sessionRef !== request.sessionRef ||
        proof.authorizationRef !== request.authorizationRef ||
        (request.authorizationBinding !== undefined &&
          proof.actorRef !== request.authorizationBinding.actorRef) ||
        typeof proof.engineActorName !== 'string' || !proof.engineActorName ||
        typeof proof.authorRef !== 'string' || !proof.authorRef ||
        !proof.allowedActions?.includes(action)) fault('AUTHORIZATION_REVOKED');
    return proof;
  }
  async #currentRevisions(request) {
    if (typeof this.#oracle?.read !== 'function' ||
        typeof this.#oracle?.readObjects !== 'function') fault('CAPABILITY_UNAVAILABLE');
    if (await this.#oracle.read(request.worldRef) !== request.expectedWorldRevision)
      fault('STALE_REVISION');
    const refs = Object.keys(request.expectedObjectRevisions ?? {}).sort();
    if (!same(await this.#oracle.readObjects(request.worldRef, refs),
      request.expectedObjectRevisions)) fault('STALE_REVISION');
  }
  async #checkCapacity(count, request) {
    if (typeof this.#capacity?.check !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const check = await this.#capacity.check(count, request);
    if (check?.allowed !== true) fault(check?.allowed === false ? 'LIMIT_EXCEEDED' :
      'CAPABILITY_UNAVAILABLE');
  }
  async prepare(request) {
    const auth = request.authorizationBinding;
    if (request.operations.worldRef !== request.worldRef)
      fault('UNSUPPORTED_MUTATION_SEMANTICS');
    if (hash('operations', request.operations) !== request.operationDigest)
      fault('NON_CANONICAL_AMBIGUITY');
    const binding = await this.#currentBinding(request, 'APPLY_RECOVERABLE');
    if (auth.sessionRef !== request.sessionRef || auth.worldRef !== request.worldRef ||
        auth.transactionId !== request.transactionId ||
        auth.operationDigest !== request.operationDigest ||
        auth.worldRevision !== request.expectedWorldRevision ||
        auth.allowedAction !== 'APPLY_RECOVERABLE') fault('PERMISSION_DENIED');
    const authorizationBindingDigest = hash('authorization-binding', auth);
    const existing = this.#journal.query(request.transactionId);
    if (existing) {
      if (existing.authorRef !== binding.authorRef ||
          existing.operationDigest !== request.operationDigest ||
          existing.expectedWorldRevision !== request.expectedWorldRevision ||
          !same(existing.payload?.expectedObjectRevisions, request.expectedObjectRevisions) ||
          existing.payload?.authorizationBindingDigest !== authorizationBindingDigest)
        fault('REPLAY_MISMATCH');
      this.#requireSaved(existing, 'PrepareRecoverableTransaction');
      return prepared(existing);
    }
    await this.#currentRevisions(request);
    const positions = request.operations.effects.map(effect => effect.position);
    await this.#checkCapacity(positions.length, request);
    if (typeof this.#engine?.prepareCheck !== 'function' ||
        typeof this.#engine?.snapshot !== 'function') fault('CAPABILITY_UNAVAILABLE');
    // Recheck before the durable barrier: chained per-cell is_protected for
    // the acting principal, then every connected player's actual body.
    try { await this.#engine.prepareCheck(positions, binding); }
    catch (error) {
      if (error?.message === 'PERMISSION_DENIED')
        typed('PERMISSION_DENIED', 'authorize', 'SCOPE_DENIED', { retryability: 'AFTER_NEW_FACTS' });
      if (error?.message === 'SAFETY_INVARIANT_FAILED')
        typed('SAFETY_INVARIANT_FAILED', 'validate', 'SCOPE_DENIED');
      if (error?.message === 'TARGET_FACTS_INCOMPLETE')
        typed('TARGET_FACTS_INCOMPLETE', 'validate', 'REQUIRED_FACT_UNKNOWN');
      throw error;
    }
    const beforeImage = stateImage(await this.#engine.snapshot({ ...request,
      coveredPositions: positions }, binding), request.worldRef,
    request.expectedWorldRevision, this.#profile);
    const beforeImageDigest = hash('before-image', beforeImage);
    const payload = { contractVersion: 'canvas/v2', transactionId: request.transactionId,
      operationDigest: request.operationDigest, authorizationBindingDigest,
      expectedWorldRevision: request.expectedWorldRevision,
      expectedObjectRevisions: request.expectedObjectRevisions, beforeImageDigest };
    const transactionPayloadDigest = hash('transaction-payload', payload);
    // Computed from the same complete before image and saved with it before
    // PREPARED is returned; QueryPrepared returns this saved value.
    const beforeStateReadbackDigest = hash('readback', readbackView(beforeImage));
    await this.#journal.prepare({ transactionId: request.transactionId,
      operationDigest: request.operationDigest, transactionPayloadDigest,
      beforeImageDigest, beforeImage, payload,
      expectedWorldRevision: request.expectedWorldRevision, stateProfile: this.#profile,
      adapterExecutionRevision: transactionPayloadDigest, authorRef: binding.authorRef,
      originKind: 'HANAWORLDS', effects: request.operations.effects,
      beforeStateReadbackDigest });
    const saved = this.#journal.query(request.transactionId);
    if (!saved) {
      this.#log('error', `PrepareRecoverableTransaction ${request.transactionId}: journal record absent after prepare`);
      fault('CAPABILITY_UNAVAILABLE');
    }
    this.#requireSaved(saved, 'PrepareRecoverableTransaction');
    return prepared(saved);
  }
  async queryPrepared(request) {
    const binding = await this.#currentBinding(request, 'APPLY_RECOVERABLE');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.status !== 'PREPARED') fault('STALE_TRANSACTION');
    if (record.authorRef !== binding.authorRef ||
        record.operationDigest !== request.operationDigest ||
        record.payload?.authorizationBindingDigest !== request.authorizationBindingDigest)
      fault('REPLAY_MISMATCH');
    // The saved digest is returned as saved; it is never recomputed from the
    // live world. A record without an intact saved digest fails closed.
    this.#requireSaved(record, 'QueryPreparedTransaction');
    return prepared(record);
  }
  async inspectRegion(request) {
    const binding = await this.#currentBinding(request, 'INSPECT', { requireOnline: false });
    if (typeof this.#oracle?.read !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const observedWorldRevision = await this.#oracle.read(request.worldRef);
    if (typeof observedWorldRevision !== 'string' || !observedWorldRevision)
      fault('CAPABILITY_UNAVAILABLE');
    if (observedWorldRevision !== request.expectedWorldRevision) fault('STALE_REVISION');
    if (typeof this.#catalogue?.read !== 'function' ||
        typeof this.#executionRevision !== 'string' || !this.#executionRevision ||
        typeof this.#engine?.inspectRegion !== 'function' ||
        typeof this.#capacity?.check !== 'function') fault('CAPABILITY_UNAVAILABLE');
    let catalogue;
    try { catalogue = validateType('Catalogue', await this.#catalogue.read(request.worldRef, binding)); }
    catch (error) {
      this.#log('warn', `InspectRegion ${request.inspectionId}: catalogue unavailable: ${causeOf(error)}`);
      fault('CAPABILITY_UNAVAILABLE');
    }
    const walkable = {};
    for (const [name, node] of Object.entries(catalogue.nodes)) walkable[name] = node.walkable;
    const { footprint: fp, placementSettings: st } = request;
    const window = BigInt(st.forwardSearchCells + 1) * BigInt(2 * st.lateralSearchCells + 1) *
      BigInt(2 * st.verticalSearchCells + 1) * BigInt(fp.widthCells) * BigInt(fp.depthCells) *
      BigInt(fp.heightCells + 1);
    const capacity = window > BigInt(Number.MAX_SAFE_INTEGER) ? { allowed: false } :
      await this.#capacity.check(Number(window), request);
    if (capacity?.allowed !== true && capacity?.allowed !== false) fault('CAPABILITY_UNAVAILABLE');
    let raw;
    try {
      raw = await this.#engine.inspectRegion({ worldRef: request.worldRef,
        sessionRef: request.sessionRef, anchor: request.anchor, footprint: fp,
        settings: { frontGapCells: st.frontGapCells, forwardSearchCells: st.forwardSearchCells,
          lateralSearchCells: st.lateralSearchCells, verticalSearchCells: st.verticalSearchCells },
        walkable, limitExceeded: capacity.allowed === false }, binding);
    } catch (error) {
      if (error?.message === 'PICK_NOT_ISSUED' || error?.message === 'PRINCIPAL_UNKNOWN')
        typed('PERMISSION_DENIED', 'authorize', 'IDENTITY_UNVERIFIED');
      if (error?.message === 'LIMIT_EXCEEDED') fault('LIMIT_EXCEEDED');
      if (error?.message === 'INSPECTION_FAILED') fault('INSPECTION_FAILED');
      throw error;
    }
    let outcome;
    if (raw?.kind === 'CHOICE') {
      const reasons = [...new Set(raw.reasons)].sort(compareUTF16);
      const multiple = reasons.includes('MULTIPLE_ONLINE_PLAYERS');
      if (!reasons.length || multiple !== Array.isArray(raw.names)) fault('INSPECTION_FAILED');
      outcome = { outcome: 'PLACEMENT_CHOICE_REQUIRED', choice: {
        anchorKind: request.anchor.kind, reasons, options: placementOptions(reasons),
        candidatePlayerNames: multiple ? [...raw.names].sort(compareUTF16) : null,
        placementSettings: st, observedWorldRevision } };
    } else if (raw?.kind === 'REGION' && Array.isArray(raw.cells) && raw.cells.length) {
      const occupied = [], empty = [], positions = [];
      for (const cell of raw.cells) {
        positions.push(cell.position);
        if (cell.state === 'AIR') empty.push(cell.position);
        else if (cell.state === 'OCCUPIED') occupied.push({ position: cell.position,
          nodeName: cell.nodeName, param2: cell.param2 });
        else fault('INSPECTION_FAILED');
      }
      const sampledBounds = { min: [0, 1, 2].map(i => Math.min(...positions.map(p => p[i]))),
        max: [0, 1, 2].map(i => Math.max(...positions.map(p => p[i]))) };
      const sampledPositions = sortPositions(positions);
      const frame = luantiFrame(request.worldRef, this.#executionRevision);
      const targetFacts = { profileVersion: 'target-facts/v3', source: 'REGION_INSPECTED',
        worldRef: request.worldRef, objectRef: null, worldRevision: observedWorldRevision,
        objectRevision: null, buildDigest: null, planRevision: null,
        catalogueDigest: hash('catalogue', catalogue), frameDigest: hash('frame', frame),
        sampledBounds,
        coverageDigest: hash('coverage', { profileVersion: 'coverage/v2', sampledBounds,
          sampledPositions }),
        occupiedCells: occupied.sort((a, b) => comparePosition(a.position, b.position)),
        knownEmptyCells: sortPositions(empty), unknownCells: [], portals: [],
        usableVolume: { emptyCellCount: empty.length, physicalVolume: null,
          standingArea: null, unit: 'node' } };
      outcome = { outcome: 'REGION_INSPECTED', inspection: validateRegionInspection({
        inspectionId: request.inspectionId, anchorKind: request.anchor.kind, targetFacts,
        targetFactsDigest: hash('target-facts', targetFacts), frame,
        evidence: { providerRef: ADAPTER_ID, sourceRevision: this.#executionRevision,
          worldRef: request.worldRef, worldRevision: observedWorldRevision },
        protectedPositions: sortPositions(raw.protected ?? []),
        bodyOccupiedPositions: sortPositions(raw.body ?? []),
        entranceFacing: raw.entranceFacing, placementSettings: st }) };
    } else fault('INSPECTION_FAILED');
    // Names and facts are released only after a fresh authorization check.
    await this.#currentBinding(request, 'INSPECT', { requireOnline: false });
    return outcome;
  }
  async apply(request) {
    const binding = await this.#currentBinding(request, 'APPLY_RECOVERABLE');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.authorRef !== binding.authorRef) fault('PERMISSION_DENIED');
    try {
      const result = await this.#v2.apply(request);
      if (result.status === 'APPLIED_PENDING_READBACK')
        return receipt({ ...this.#journal.query(request.transactionId),
          status: 'APPLIED_PENDING_READBACK' });
      return receipt(this.#journal.query(request.transactionId));
    } catch (error) {
      if (this.#journal.query(request.transactionId)?.status === 'ROLLED_BACK')
        return receipt(this.#journal.query(request.transactionId));
      throw error;
    }
  }
  async readback(request) {
    const binding = await this.#currentBinding(request, 'READBACK');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.authorRef !== binding.authorRef ||
        !same(record.beforeImage.coveredPositions, request.coveredPositions) ||
        !same(record.stateProfile, request.stateProfile)) fault('REPLAY_MISMATCH');
    if (record.afterImage) return { projection: readbackView(record.afterImage),
      readbackDigest: record.afterReadbackDigest,
      adapterExecutionRevision: record.adapterExecutionRevision };
    const result = await this.#v2.readback(request);
    if (record.targetImage) {
      if (result.readbackDigest !== record.targetStateDigest)
        return this.#recoverMismatch(record, 'READBACK_MISMATCH');
    } else {
      const effects = record.effects;
      if (!effects || effects.length !== result.projection.records.length ||
          effects.some((effect, i) => effect.nodeName !== result.projection.records[i].nodeName ||
            effect.param2 !== result.projection.records[i].param2))
        return this.#recoverMismatch(record, 'READBACK_MISMATCH');
    }
    const after = stateImage(result.projection, request.worldRef,
      record.expectedWorldRevision, this.#profile);
    await this.#journal.recordAfterState(record.transactionId, after,
      result.readbackDigest, hash('readback', readbackView(record.beforeImage)));
    return result;
  }
  async #recoverMismatch(record, causeCode, { alreadyPending = false,
    returnReceipt = false } = {}) {
    const attempt = createHash('sha256').update(`${record.transactionId}|${causeCode}`).digest('hex');
    const recovery = { worldRef: record.beforeImage.worldRef,
      originTransactionId: record.transactionId, operationDigest: record.operationDigest,
      beforeImageDigest: record.beforeImageDigest, restoreAttemptIdentity: attempt };
    if (typeof this.#service !== 'function' || !await this.#service(recovery)) {
      if (!alreadyPending)
        await this.#journal.transition(record.transactionId, 'RECOVERY_PENDING', { causeCode });
      fault('RECOVERY_PENDING');
    }
    await this.#journal.transition(record.transactionId, 'RESTORING', {
      causeCode, restoreAttemptIdentity: attempt });
    try {
      const restored = await this.#engine.restore({ ...recovery, status: 'RESTORING' },
        record.beforeImage);
      if (restored?.status !== 'ROLLED_BACK') fault('RESTORE_FAILED');
      const observedWorldRevision = await this.#oracle.read(record.beforeImage.worldRef);
      if (typeof observedWorldRevision !== 'string' || !observedWorldRevision)
        fault('RESTORE_FAILED');
      await this.#journal.transition(record.transactionId, 'ROLLED_BACK', {
        causeCode, observedWorldRevision,
        restoredReadbackDigest: hash('readback', readbackView(record.beforeImage)) });
      if (returnReceipt) return receipt(this.#journal.query(record.transactionId));
      fault(causeCode);
    } catch (error) {
      if (error.message === causeCode) throw error;
      await this.#journal.transition(record.transactionId, 'RESTORE_FAILED', { causeCode });
      fault('RESTORE_FAILED');
    }
  }
  async query(request) {
    const binding = await this.#currentBinding(request, 'HISTORY');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.authorRef !== binding.authorRef) fault('PERMISSION_DENIED');
    await this.#v2.query(request);
    return receipt(this.#journal.query(request.transactionId));
  }
  async restore(request) {
    const record = this.#journal.query(request.originTransactionId);
    if (!record || record.originKind !== 'HANAWORLDS') fault('PERMISSION_DENIED');
    await this.#v2.restore(request);
    return receipt(this.#journal.query(request.originTransactionId));
  }
  async abortPrepared(request) {
    if (typeof this.#service !== 'function' ||
        !await this.#service(request, 'AbortPreparedTransaction')) fault('PERMISSION_DENIED');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.operationDigest !== request.operationDigest ||
        record.payload?.authorizationBindingDigest !== request.authorizationBindingDigest ||
        record.beforeImage.worldRef !== request.worldRef || record.originKind !== 'HANAWORLDS')
      fault('REPLAY_MISMATCH');
    await this.#journal.abortPrepared(request.transactionId, record.authorRef);
    return { transactionId: request.transactionId, status: 'ABORTED_PREPARED', mutationState: 'NONE' };
  }
  async prepareHistory(request) {
    if (typeof this.#history?.verifyOrigin !== 'function' || !this.#engine?.snapshot ||
        !this.#engine?.applyState) fault('CAPABILITY_UNAVAILABLE');
    const binding = await this.#currentBinding(request, request.direction);
    await this.#currentRevisions(request);
    const source = this.#journal.query(request.originTransactionId);
    if (!source) fault('SAVED_RESOURCE_UNAVAILABLE');
    if (source.authorRef !== binding.authorRef ||
        source.beforeImage?.worldRef !== request.worldRef ||
        source.originKind !== 'HANAWORLDS') fault('PERMISSION_DENIED');
    if (!source.afterImage)
      fault('SAVED_RESOURCE_UNAVAILABLE');
    try {
      validateType('BeforeImage', source.beforeImage);
      validateType('BeforeImage', source.afterImage);
      if (hash('before-image', source.beforeImage) !== source.beforeImageDigest ||
          hash('readback', readbackView(source.afterImage)) !== source.afterReadbackDigest)
        fault('SAVED_RESOURCE_UNAVAILABLE');
    } catch { fault('SAVED_RESOURCE_UNAVAILABLE'); }
    const origin = await this.#history.verifyOrigin(request, source);
    if (origin?.current !== true || origin.authorRef !== binding.authorRef ||
        origin.worldRef !== request.worldRef ||
        origin.originTransactionId !== request.originTransactionId ||
        origin.receiptDigest !== request.originVerifiedReceiptDigest ||
        origin.historyRevision !== request.expectedHistoryRevision ||
        !same(origin.affectedObjectRefs, request.affectedObjectRefs)) fault('PERMISSION_DENIED');
    if (source.beforeImageDigest !== request.originBeforeImageDigest ||
        source.beforeStateReadbackDigest !== request.originBeforeStateReadbackDigest ||
        source.afterReadbackDigest !== request.originAfterReadbackDigest)
      typed('REPLAY_MISMATCH', 'validate', 'PAYLOAD_CHANGED');
    const target = request.direction === 'UNDO' ? source.beforeImage : source.afterImage;
    if (hash('readback', readbackView(target)) !== request.targetStateDigest)
      fault('REPLAY_MISMATCH');
    const projectionFields = ['contractVersion', 'worldRef', 'originTransactionId',
      'transactionId', 'direction', 'affectedObjectRefs', 'originVerifiedReceiptDigest',
      'originBeforeImageDigest', 'originBeforeStateReadbackDigest',
      'originAfterReadbackDigest', 'expectedCurrentStateDigest', 'targetStateDigest',
      'expectedHistoryRevision', 'expectedWorldRevision', 'expectedObjectRevisions', 'guarantee'];
    if (hash('history-operation', Object.fromEntries(projectionFields.map(key =>
      [key, request[key]]))) !== request.historyOperationDigest ||
        request.authorizationBinding?.operationDigest !== request.historyOperationDigest ||
        request.authorizationBinding?.allowedAction !== request.direction)
      fault('REPLAY_MISMATCH');
    const old = this.#journal.query(request.transactionId);
    if (old) {
      if (old.authorRef !== binding.authorRef ||
          old.historyOperationDigest !== request.historyOperationDigest ||
          old.status !== 'PREPARED') fault('REPLAY_MISMATCH');
      return preparedHistory(old);
    }
    await this.#checkCapacity(target.coveredPositions.length, request);
    const current = stateImage(await this.#engine.snapshot({ coveredPositions:
      target.coveredPositions }, binding), request.worldRef,
    request.expectedWorldRevision, this.#profile);
    if (hash('readback', readbackView(current)) !== request.expectedCurrentStateDigest)
      fault(request.direction === 'UNDO' ? 'UNDO_CONFLICT' : 'REDO_CONFLICT');
    const beforeImageDigest = hash('before-image', current);
    const payload = { contractVersion: 'canvas/v2', transactionId: request.transactionId,
      operationDigest: request.historyOperationDigest,
      authorizationBindingDigest: hash('authorization-binding', request.authorizationBinding),
      expectedWorldRevision: request.expectedWorldRevision,
      expectedObjectRevisions: request.expectedObjectRevisions, beforeImageDigest };
    const transactionPayloadDigest = hash('transaction-payload', payload);
    await this.#journal.prepare({ transactionId: request.transactionId,
      operationDigest: request.historyOperationDigest, transactionPayloadDigest,
      beforeImageDigest, beforeImage: current, payload,
      expectedWorldRevision: request.expectedWorldRevision, stateProfile: this.#profile,
      adapterExecutionRevision: transactionPayloadDigest, authorRef: binding.authorRef,
      originKind: 'HANAWORLDS', affectedObjectRefs: request.affectedObjectRefs,
      historySourceId: request.originTransactionId, historyDirection: request.direction,
      historyOperationDigest: request.historyOperationDigest,
      originVerifiedReceiptDigest: request.originVerifiedReceiptDigest,
      expectedHistoryRevision: request.expectedHistoryRevision,
      targetImage: target, targetStateDigest: request.targetStateDigest });
    return preparedHistory(this.#journal.query(request.transactionId));
  }
  async queryPreparedHistory(request) {
    const binding = await this.#currentBinding(request, request.direction);
    const record = this.#journal.query(request.transactionId);
    if (!record || record.status !== 'PREPARED' || record.authorRef !== binding.authorRef ||
        record.historySourceId !== request.originTransactionId ||
        record.historyDirection !== request.direction ||
        record.historyOperationDigest !== request.historyOperationDigest ||
        record.payload?.authorizationBindingDigest !== request.authorizationBindingDigest)
      fault('REPLAY_MISMATCH');
    return preparedHistory(record);
  }
  async applyHistory(request) {
    const binding = await this.#currentBinding(request, request.direction);
    const record = this.#journal.query(request.transactionId);
    if (!record || record.authorRef !== binding.authorRef ||
        record.historySourceId !== request.originTransactionId ||
        record.historyDirection !== request.direction ||
        record.beforeImage.worldRef !== request.worldRef ||
        record.historyOperationDigest !== request.historyOperationDigest ||
        !same(request.preparedHistoryTransaction, preparedHistory(record)))
      fault('REPLAY_MISMATCH');
    if (record.status === 'ABORTED_PREPARED') fault('STALE_TRANSACTION');
    if (record.status !== 'PREPARED') return receipt(record);
    if (!savedStateReady(record)) fault('SAVED_RESOURCE_UNAVAILABLE');
    if (typeof this.#history?.verifyOrigin !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const source = this.#journal.query(record.historySourceId);
    if (!source) fault('SAVED_RESOURCE_UNAVAILABLE');
    if (source.authorRef !== binding.authorRef ||
        source.beforeImage?.worldRef !== request.worldRef ||
        source.originKind !== 'HANAWORLDS') fault('PERMISSION_DENIED');
    if (!source.afterImage)
      fault('SAVED_RESOURCE_UNAVAILABLE');
    const origin = await this.#history.verifyOrigin({ ...request,
      originVerifiedReceiptDigest: record.originVerifiedReceiptDigest,
      expectedHistoryRevision: record.expectedHistoryRevision,
      affectedObjectRefs: record.affectedObjectRefs }, source);
    if (origin?.current !== true || origin.authorRef !== binding.authorRef ||
        origin.worldRef !== request.worldRef ||
        origin.originTransactionId !== record.historySourceId ||
        origin.receiptDigest !== record.originVerifiedReceiptDigest ||
        origin.historyRevision !== record.expectedHistoryRevision ||
        !same(origin.affectedObjectRefs, record.affectedObjectRefs))
      fault('PERMISSION_DENIED');
    await this.#currentRevisions(request);
    const current = stateImage(await this.#engine.snapshot({ coveredPositions:
      record.beforeImage.coveredPositions }, binding), request.worldRef,
    request.expectedWorldRevision, this.#profile);
    if (hash('readback', readbackView(current)) !==
      hash('readback', readbackView(record.beforeImage)))
      fault(request.direction === 'UNDO' ? 'UNDO_CONFLICT' : 'REDO_CONFLICT');
    await this.#journal.transition(record.transactionId, 'APPLYING');
    try {
      const result = await this.#engine.applyState({ transactionId: request.transactionId,
        actorRef: request.actorRef, direction: request.direction,
        operationDigest: request.historyOperationDigest },
      record.targetImage, record.beforeImage, binding);
      if (result?.status !== 'APPLIED_PENDING_READBACK') fault('APPLY_FAILED');
      await this.#journal.transition(record.transactionId, 'APPLIED_PENDING_READBACK');
      return receipt({ ...record, status: 'APPLIED_PENDING_READBACK' });
    } catch {
      await this.#journal.transition(record.transactionId, 'RECOVERY_PENDING',
        { causeCode: 'APPLY_FAILED' });
      return this.#recoverMismatch(record, 'APPLY_FAILED', {
        alreadyPending: true, returnReceipt: true });
    }
  }
  async abortPreparedHistory(request) {
    if (typeof this.#service !== 'function' ||
        !await this.#service(request, 'AbortPreparedHistoryTransaction'))
      fault('PERMISSION_DENIED');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.beforeImage.worldRef !== request.worldRef ||
        record.historySourceId !== request.originTransactionId ||
        record.historyOperationDigest !== request.historyOperationDigest ||
        record.payload?.authorizationBindingDigest !== request.authorizationBindingDigest)
      fault('REPLAY_MISMATCH');
    await this.#journal.abortPrepared(request.transactionId, record.authorRef);
    return { transactionId: request.transactionId, status: 'ABORTED_PREPARED', mutationState: 'NONE' };
  }
}
