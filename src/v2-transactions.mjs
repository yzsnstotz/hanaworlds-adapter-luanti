import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { EngineBridge } from './bridge.mjs';

const DOMAIN = 'HanaWorlds|contracts@0.1.0|';
function fault(code) { throw new Error(code); }
function same(a, b) { return canonicalize(a) === canonicalize(b); }
export function projectionDigest(kind, value) {
  return createHash('sha256').update(`${DOMAIN}${kind}\n${canonicalize(value)}`).digest('hex');
}
function requireEqual(actual, expected, code) {
  if (!same(actual, expected)) fault(code);
}
function coveredPositions(operations) {
  return operations.effects.map(effect => effect.position);
}
function receipt(record) {
  const status = record.status === 'ROLLED_BACK' ? 'ROLLED_BACK' :
    record.status === 'APPLIED_PENDING_READBACK' ? 'APPLIED_PENDING_READBACK' :
    record.status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' : 'RECOVERY_PENDING';
  const cause = record.causeCode ?? null;
  const phase = cause?.startsWith('READBACK') ? 'readback' : 'apply';
  const pending = status === 'RECOVERY_PENDING';
  return { contractVersion: 'canvas/v2', transactionId: record.transactionId,
    operationDigest: record.operationDigest,
    transactionPayloadDigest: record.transactionPayloadDigest, status,
    previousWorldRevision: record.expectedWorldRevision,
    observedWorldRevision: null, readbackDigest: null,
    restoreStatus: status === 'ROLLED_BACK' ? 'VERIFIED_RESTORED' :
      status === 'RESTORE_FAILED' ? 'FAILED' : status === 'RECOVERY_PENDING' ? 'UNKNOWN' :
      'NOT_REQUIRED',
    error: cause ? { code: status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' :
      pending ? 'RECOVERY_PENDING' : cause,
      phase: status === 'RESTORE_FAILED' ? 'restore' : phase,
      retryability: status === 'RESTORE_FAILED' ? 'AFTER_MANUAL_RECOVERY' :
        pending ? 'SAME_TRANSACTION_QUERY' : 'NEVER',
      mutationState: status === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'UNKNOWN',
      transactionRef: record.transactionId,
      causeCode: status === 'RESTORE_FAILED' || pending ? cause : null,
      reason: status === 'RESTORE_FAILED' ? 'RESTORE_ERROR' :
        pending ? 'TRANSPORT_OUTCOME_UNKNOWN' :
        phase === 'readback' ? 'READBACK_ERROR' : 'APPLY_ERROR' } : null };
}

/** Maps frozen v2 transaction projections to the Adapter's durable bridge.
 * The injected revision oracle and binding/service verifiers must be real host
 * capabilities; omission disables every write. Canvas still owns verification
 * against intended effects and linked-history product success. */
export class V2TransactionBackend {
  #journal; #engine; #revisionOracle; #stateProfile; #binding; #service; #bridge; #capacity;
  constructor({ journal, engine, revisionOracle, stateProfile, verifyBinding, verifyService,
    capacity }) {
    this.#journal = journal;
    this.#engine = engine;
    this.#revisionOracle = revisionOracle;
    this.#stateProfile = stateProfile;
    this.#binding = verifyBinding;
    this.#service = verifyService;
    this.#capacity = capacity;
    const decorated = {
      snapshot: async (request, binding) => ({
        ...await engine.snapshot(request, binding),
        worldRevision: request.expectedWorldRevision, stateProfile }),
      apply: (request, prepared, binding) => engine.apply(request, prepared, binding),
      readback: async (request, binding) => ({
        ...await engine.readback(request, binding), stateProfile }),
      restore: (request, beforeImage) => engine.restore(request, beforeImage),
    };
    this.#bridge = new EngineBridge({ journal, engine: decorated,
      admit: (_, request) => request, verifyBinding, verifyService,
      digestBeforeImage: value => projectionDigest('before-image', value),
      digestReadback: value => projectionDigest('readback', value) });
  }
  async #checkCapacity(request) {
    if (typeof this.#capacity?.check !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const outcome = await this.#capacity.check(request.operations.effects.length, request);
    if (outcome?.allowed !== true) fault(outcome?.allowed === false ?
      'LIMIT_EXCEEDED' : 'CAPABILITY_UNAVAILABLE');
  }

  async #current(request) {
    if (typeof this.#revisionOracle?.read !== 'function' ||
        typeof this.#revisionOracle?.readObjects !== 'function' ||
        typeof this.#binding !== 'function' || typeof this.#service !== 'function' ||
        !this.#stateProfile) fault('CAPABILITY_UNAVAILABLE');
    const current = await this.#revisionOracle.read(request.worldRef);
    if (typeof current !== 'string' || !current) fault('CAPABILITY_UNAVAILABLE');
    if (current !== request.expectedWorldRevision) fault('STALE_REVISION');
    const expectedObjects = request.expectedObjectRevisions ??
      request.preparedTransaction?.payload?.expectedObjectRevisions;
    if (!expectedObjects || typeof expectedObjects !== 'object') fault('CAPABILITY_UNAVAILABLE');
    const refs = Object.keys(expectedObjects).sort();
    const observed = await this.#revisionOracle.readObjects(request.worldRef, refs);
    if (!same(observed, expectedObjects)) fault('STALE_REVISION');
  }

  #recoveryError(transactionId, originalCode) {
    const record = this.#journal.query(transactionId);
    const status = record?.status;
    const code = status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' :
      status === 'ROLLED_BACK' ? originalCode : 'RECOVERY_PENDING';
    // A timed-out apply is still an uncertain apply. Entering the durable
    // RECOVERY_PENDING state does not turn its public phase into a restore
    // failure when no restore was authorized or attempted.
    const uncertainApply = code === 'RECOVERY_PENDING' && originalCode === 'APPLY_FAILED';
    const phase = uncertainApply ? 'apply' :
      code === 'RESTORE_FAILED' || code === 'RECOVERY_PENDING'
        ? 'restore' : originalCode.startsWith('READBACK') ? 'readback' : 'apply';
    const failure = new Error(code);
    failure.publicError = { code, phase,
      retryability: status === 'ROLLED_BACK' ? 'NEVER' :
        status === 'RESTORE_FAILED' ? 'AFTER_MANUAL_RECOVERY' : 'SAME_TRANSACTION_QUERY',
      mutationState: status === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'UNKNOWN',
      transactionRef: transactionId,
      causeCode: code === originalCode ? null : record?.causeCode ?? originalCode,
      reason: uncertainApply ? 'TRANSPORT_OUTCOME_UNKNOWN' :
        phase === 'readback' ? 'READBACK_ERROR' :
        phase === 'restore' ? 'RESTORE_ERROR' : 'APPLY_ERROR' };
    throw failure;
  }

  async prepare(request) {
    if (request.guarantee !== 'RECOVERABLE_VERIFIED' ||
        request.operations.worldRef !== request.worldRef)
      fault('UNSUPPORTED_MUTATION_SEMANTICS');
    if (projectionDigest('operations', request.operations) !== request.operationDigest)
      fault('NON_CANONICAL_AMBIGUITY');
    const auth = request.authorizationBinding;
    if (auth?.contractVersion !== 'world-adapter/v2' || auth.actorRef !== request.actorRef ||
        auth.sessionRef !== request.sessionRef || auth.worldRef !== request.worldRef ||
        auth.transactionId !== request.transactionId ||
        auth.operationDigest !== request.operationDigest ||
        auth.worldRevision !== request.expectedWorldRevision)
      fault('PERMISSION_DENIED');
    const existing = this.#journal.query(request.transactionId);
    if (existing) {
      if (existing.operationDigest !== request.operationDigest ||
          existing.expectedWorldRevision !== request.expectedWorldRevision ||
          !same(existing.payload?.expectedObjectRevisions, request.expectedObjectRevisions) ||
          existing.payload?.authorizationBindingDigest !==
            projectionDigest('authorization-binding', auth)) fault('REPLAY_MISMATCH');
      return { payload: existing.payload,
        transactionPayloadDigest: existing.transactionPayloadDigest,
        beforeImageDigest: existing.beforeImageDigest,
        guarantee: 'RECOVERABLE_VERIFIED', stateProfile: existing.stateProfile,
        protectedPositions: existing.beforeImage.coveredPositions,
        adapterExecutionRevision: existing.adapterExecutionRevision };
    }
    await this.#current(request);
    await this.#checkCapacity(request);
    const binding = await this.#binding(request, 'APPLY_RECOVERABLE');
    if (!binding?.current || binding.worldRef !== request.worldRef ||
        !binding.allowedActions?.includes('APPLY_RECOVERABLE')) fault('AUTHORIZATION_REVOKED');
    const positions = coveredPositions(request.operations);
    const snapshot = { ...await this.#engine.snapshot({ ...request,
      coveredPositions: positions }, binding),
      worldRevision: request.expectedWorldRevision, stateProfile: this.#stateProfile };
    const beforeImageDigest = projectionDigest('before-image', snapshot);
    const payload = { contractVersion: 'canvas/v2', transactionId: request.transactionId,
      operationDigest: request.operationDigest,
      authorizationBindingDigest: projectionDigest('authorization-binding', auth),
      expectedWorldRevision: request.expectedWorldRevision,
      expectedObjectRevisions: request.expectedObjectRevisions, beforeImageDigest };
    const transactionPayloadDigest = projectionDigest('transaction-payload', payload);
    const adapterExecutionRevision = projectionDigest('transaction-payload', payload);
    const privateRequest = { ...request, coveredPositions: positions, effects: request.operations.effects,
      beforeImageDigest, transactionPayloadDigest, payload, stateProfile: this.#stateProfile,
      adapterExecutionRevision };
    await this.#bridge.prepare(privateRequest);
    return { payload, transactionPayloadDigest, beforeImageDigest,
      guarantee: 'RECOVERABLE_VERIFIED', stateProfile: this.#stateProfile,
      protectedPositions: positions, adapterExecutionRevision };
  }

  async apply(request) {
    const prepared = request.preparedTransaction;
    const persisted = this.#journal.query(request.transactionId);
    if (!persisted?.payload || !prepared ||
        !same(prepared.payload, persisted.payload) ||
        prepared.transactionPayloadDigest !== persisted.transactionPayloadDigest ||
        prepared.beforeImageDigest !== persisted.beforeImageDigest ||
        request.operationDigest !== persisted.operationDigest ||
        projectionDigest('operations', request.operations) !== request.operationDigest)
      fault('REPLAY_MISMATCH');
    if (projectionDigest('authorization-binding', request.authorizationBinding) !==
        persisted.payload.authorizationBindingDigest) fault('REPLAY_MISMATCH');
    if (['ROLLED_BACK', 'VERIFIED'].includes(persisted.status)) return receipt(persisted);
    await this.#current(request);
    await this.#checkCapacity(request);
    let applied;
    try {
      applied = await this.#bridge.apply({ ...request,
        coveredPositions: coveredPositions(request.operations), effects: request.operations.effects,
        transactionPayloadDigest: persisted.transactionPayloadDigest,
        beforeImageDigest: persisted.beforeImageDigest });
    } catch (failure) {
      // Bridge admission, current binding, prepared identity and the durable
      // APPLYING barrier all precede the engine write. A still-PREPARED record
      // proves this invocation did not cross that barrier.
      if (this.#journal.query(request.transactionId)?.status === 'PREPARED') throw failure;
      this.#recoveryError(request.transactionId, 'APPLY_FAILED');
    }
    const current = this.#journal.query(request.transactionId);
    return receipt(applied.status === 'APPLIED_PENDING_READBACK'
      ? { ...current, status: 'APPLIED_PENDING_READBACK' } : current);
  }

  async readback(request) {
    const persisted = this.#journal.query(request.transactionId);
    if (!persisted?.payload || !same(request.coveredPositions,
      persisted.beforeImage.coveredPositions) ||
      !same(request.stateProfile, persisted.stateProfile)) fault('REPLAY_MISMATCH');
    let result;
    try { result = await this.#bridge.readback(request); }
    catch { this.#recoveryError(request.transactionId, 'READBACK_FAILED'); }
    return { projection: result.projection, readbackDigest: result.readbackDigest,
      adapterExecutionRevision: persisted.adapterExecutionRevision };
  }

  async query(request) {
    await this.#bridge.query(request);
    const record = this.#journal.query(request.transactionId);
    if (!record?.expectedWorldRevision || record.status === 'PREPARED')
      fault('RECOVERY_PENDING');
    return receipt(record);
  }

  async restore(request) {
    try { await this.#bridge.restore(request); }
    catch (failure) {
      // A rejected PREPARED restore is a prewrite fault, not uncertain recovery.
      if (this.#journal.query(request.originTransactionId)?.status === 'PREPARED')
        throw failure;
      this.#recoveryError(request.originTransactionId, 'RESTORE_FAILED');
    }
    const record = this.#journal.query(request.originTransactionId);
    if (!record?.expectedWorldRevision) fault('RECOVERY_PENDING');
    return receipt(record);
  }
}
