import { createHash } from 'node:crypto';

function publicStatus(record) {
  return {
    transactionId: record.transactionId,
    operationDigest: record.operationDigest,
    transactionPayloadDigest: record.transactionPayloadDigest,
    beforeImageDigest: record.beforeImageDigest,
    status: record.status,
    mutationState: record.mutationState,
    causeCode: record.causeCode ?? null,
    restoreAttemptIdentity: record.restoreAttemptIdentity ?? null,
  };
}

/**
 * Host-side recoverable transaction coordinator. The callbacks are trusted
 * dependencies, never inferred from request JSON. Without exact contract
 * admission, engine transport and current binding this module cannot write.
 */
export class EngineBridge {
  constructor({ journal, engine, admit, verifyBinding, verifyService, digestBeforeImage,
    digestReadback, restoredProof }) {
    this.journal = journal;
    this.engine = engine;
    this.admit = admit;
    this.verifyBinding = verifyBinding;
    this.verifyService = verifyService;
    this.digestBeforeImage = digestBeforeImage;
    this.digestReadback = digestReadback;
    this.restoredProof = restoredProof;
  }

  #admit(operation, request) {
    if (!this.admit) throw new Error('CAPABILITY_UNAVAILABLE');
    return this.admit(operation, request);
  }

  async #binding(request, action) {
    if (!this.verifyBinding) throw new Error('CONNECTION_UNAUTHORIZED');
    const binding = await this.verifyBinding(request, action);
    if (!binding?.current || binding.worldRef !== request.worldRef ||
        !binding.allowedActions?.includes(action)) throw new Error('AUTHORIZATION_REVOKED');
    return binding;
  }

  async prepare(raw) {
    const request = this.#admit('PrepareRecoverableTransaction', raw);
    const binding = await this.#binding(request, 'APPLY_RECOVERABLE');
    if (!this.engine?.snapshot || !this.digestBeforeImage) throw new Error('CAPABILITY_UNAVAILABLE');
    const beforeImage = await this.engine.snapshot(request, binding);
    if (beforeImage?.worldRef !== request.worldRef) throw new Error('TARGET_FACTS_INCOMPLETE');
    if (this.digestBeforeImage(beforeImage) !== request.beforeImageDigest)
      throw new Error('TARGET_FACTS_INCOMPLETE');
    const prepared = await this.journal.prepare({ transactionId: request.transactionId,
      operationDigest: request.operationDigest,
      transactionPayloadDigest: request.transactionPayloadDigest,
      beforeImageDigest: request.beforeImageDigest, beforeImage,
      ...(request.payload === undefined ? {} : { payload: request.payload }),
      ...(request.expectedWorldRevision === undefined ? {} :
        { expectedWorldRevision: request.expectedWorldRevision }),
      ...(request.stateProfile === undefined ? {} : { stateProfile: request.stateProfile }),
      ...(request.adapterExecutionRevision === undefined ? {} :
        { adapterExecutionRevision: request.adapterExecutionRevision }),
      ...(request.authorRef === undefined ? {} : { authorRef: request.authorRef }),
      ...(binding.nativeGrantRef === undefined ? {} : { nativeGrantRef: binding.nativeGrantRef }),
      ...(request.originKind === undefined ? {} : { originKind: request.originKind }),
      ...(request.affectedObjectRefs === undefined ? {} :
        { affectedObjectRefs: request.affectedObjectRefs }),
      ...(request.effects === undefined ? {} : { effects: request.effects }) });
    return publicStatus(prepared);
  }

  async apply(raw) {
    const request = this.#admit('ApplyCompiledTransaction', raw);
    const binding = await this.#binding(request, 'APPLY_RECOVERABLE');
    if (!this.engine?.apply) throw new Error('CAPABILITY_UNAVAILABLE');
    const prepared = this.journal.query(request.transactionId);
    if (!prepared || prepared.status !== 'PREPARED') throw new Error('STALE_TRANSACTION');
    if (prepared.operationDigest !== request.operationDigest ||
        prepared.transactionPayloadDigest !== request.transactionPayloadDigest ||
        prepared.beforeImageDigest !== request.beforeImageDigest) throw new Error('REPLAY_MISMATCH');
    await this.journal.transition(request.transactionId, 'APPLYING');
    try {
      const result = await this.engine.apply(request, prepared, binding);
      if (result?.status !== 'APPLIED_PENDING_READBACK') throw new Error('APPLY_FAILED');
      await this.journal.transition(request.transactionId, 'APPLIED_PENDING_READBACK');
      return result;
    } catch {
      return this.#recoverAfterFailure(request, prepared, 'APPLY_FAILED');
    }
  }

  async #recoverAfterFailure(request, prepared, causeCode) {
    const restoreAttemptIdentity = createHash('sha256')
      .update(`HanaWorlds|adapter-restore|${request.transactionId}|${request.operationDigest}`)
      .digest('hex');
    const recovery = { originTransactionId: request.transactionId,
      operationDigest: request.operationDigest, beforeImageDigest: prepared.beforeImageDigest,
      restoreAttemptIdentity, worldRef: request.worldRef };
    let authorized = false;
    try { authorized = Boolean(this.verifyService && await this.verifyService(recovery)); }
    catch { /* no trusted service proof: retain unknown state */ }
    if (!authorized || !this.engine?.restore) {
      await this.journal.transition(request.transactionId, 'RECOVERY_PENDING', { causeCode });
      throw new Error('RECOVERY_PENDING');
    }
    await this.journal.transition(request.transactionId, 'RESTORING', { causeCode, restoreAttemptIdentity });
    try {
      const result = await this.engine.restore({ ...recovery, status: 'RESTORING' }, prepared.beforeImage);
      if (result?.status !== 'ROLLED_BACK') throw new Error('RESTORE_FAILED');
      const proof = this.restoredProof ? await this.restoredProof(prepared.beforeImage) : {};
      await this.journal.transition(request.transactionId, 'ROLLED_BACK', { causeCode, ...proof });
      return { status: 'ROLLED_BACK', causeCode };
    } catch {
      await this.journal.transition(request.transactionId, 'RESTORE_FAILED', { causeCode });
      throw new Error('RESTORE_FAILED');
    }
  }

  async readback(raw) {
    const request = this.#admit('Readback', raw);
    const binding = await this.#binding(request, 'READBACK');
    if (!this.engine?.readback || !this.digestReadback) throw new Error('CAPABILITY_UNAVAILABLE');
    const state = this.journal.query(request.transactionId);
    if (!state || !['RECOVERY_PENDING', 'APPLIED_PENDING_READBACK'].includes(state.status))
      throw new Error('STALE_TRANSACTION');
    let projection, readbackDigest;
    let causeCode = 'READBACK_FAILED';
    try {
      projection = await this.engine.readback(request, binding);
      if (projection?.worldRef !== request.worldRef ||
          !Array.isArray(projection.coveredPositions) ||
          projection.coveredPositions.length !== state.beforeImage.coveredPositions.length ||
          !Array.isArray(projection.records) ||
          projection.records.length !== state.beforeImage.records.length ||
          projection.coveredPositions.some((position, i) =>
            JSON.stringify(position) !== JSON.stringify(state.beforeImage.coveredPositions[i]) ||
            JSON.stringify(projection.records[i]?.position) !== JSON.stringify(position))) {
        causeCode = 'READBACK_MISMATCH';
        throw new Error(causeCode);
      }
      readbackDigest = this.digestReadback(projection);
      if (!/^[0-9a-f]{64}$/.test(readbackDigest)) {
        causeCode = 'READBACK_MISMATCH';
        throw new Error(causeCode);
      }
    } catch {
      await this.#recoverAfterFailure(request, state, causeCode);
      throw new Error(causeCode);
    }
    return { projection, readbackDigest, status: 'APPLIED_PENDING_READBACK' };
  }

  async query(raw) {
    const request = this.#admit('QueryTransaction', raw);
    await this.#binding(request, 'HISTORY');
    const state = this.journal.query(request.transactionId);
    if (!state) throw new Error('STALE_TRANSACTION');
    if (state.transactionPayloadDigest !== request.transactionPayloadDigest)
      throw new Error('REPLAY_MISMATCH');
    return publicStatus(state);
  }

  async restore(raw) {
    const request = this.#admit('RestoreTransaction', raw);
    if (!this.verifyService || !await this.verifyService(request)) throw new Error('PERMISSION_DENIED');
    if (!this.engine?.restore) throw new Error('CAPABILITY_UNAVAILABLE');
    const state = this.journal.query(request.originTransactionId);
    if (!state || state.operationDigest !== request.operationDigest ||
        state.beforeImageDigest !== request.beforeImageDigest) throw new Error('REPLAY_MISMATCH');
    if (state.restoreAttemptIdentity !== undefined &&
      state.restoreAttemptIdentity !== request.restoreAttemptIdentity) throw new Error('REPLAY_MISMATCH');
    if (state.status === 'ROLLED_BACK') return { status: 'ROLLED_BACK', causeCode: state.causeCode ?? null };
    // PREPARED proves this Adapter has not crossed the APPLYING write barrier.
    // Restoring its old image could overwrite an unrelated engine/player edit.
    // Keep the prepared record and its declared-writer scope lock intact.
    if (state.status === 'PREPARED') throw new Error('STALE_TRANSACTION');
    await this.journal.transition(request.originTransactionId, 'RESTORING',
      { restoreAttemptIdentity: request.restoreAttemptIdentity });
    try {
      const result = await this.engine.restore({ ...request, status: 'RESTORING' }, state.beforeImage);
      if (result?.status !== 'ROLLED_BACK') throw new Error('RESTORE_FAILED');
      const proof = this.restoredProof ? await this.restoredProof(state.beforeImage) : {};
      await this.journal.transition(request.originTransactionId, 'ROLLED_BACK', proof);
      return result;
    } catch {
      await this.journal.transition(request.originTransactionId, 'RESTORE_FAILED');
      throw new Error('RESTORE_FAILED');
    }
  }
}
