import { createHash } from 'node:crypto';
import { canonicalJSON, comparePosition, digestValue, validateType } from '#contracts/v4';

const hash = (kind, value) => digestValue(kind, value).sha256;
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
const key = position => position.join(',');
const fault = code => { throw new Error(code); };
const cellDigest = (profile, record) => createHash('sha256')
  .update('HanaWorlds|adapter-scoped-cell/v1\n').update(canonicalJSON({ profile, record }))
  .digest('hex');
const scopeStateRevision = (worldRef, profile, records) => 'scope-state:' +
  createHash('sha256').update('HanaWorlds|adapter-scoped-state/v1\n')
    .update(canonicalJSON({ worldRef, profile,
      cells: records.map(record => ({ position: record.position,
        stateDigest: cellDigest(profile, record) })) })).digest('hex');
const readbackView = image => ({ worldRef: image.worldRef,
  coveredPositions: image.coveredPositions, records: image.records,
  stateProfile: image.stateProfile });

function prepared(record) {
  return { payload: record.payload, transactionPayloadDigest: record.transactionPayloadDigest,
    beforeImageDigest: record.beforeImageDigest, scopeDigest: record.scopeDigest,
    guarantee: 'RECOVERABLE_VERIFIED', stateProfile: record.stateProfile,
    protectedPositions: record.effects.map(effect => effect.position),
    adapterExecutionRevision: record.adapterExecutionRevision,
    beforeStateReadbackDigest: record.beforeStateReadbackDigest };
}

function receipt(record) {
  const verified = record.status === 'VERIFIED_PENDING_HISTORY';
  const rolledBack = record.status === 'ROLLED_BACK';
  const status = verified ? 'VERIFIED' : rolledBack ? 'ROLLED_BACK' :
    record.status === 'RESTORE_FAILED' ? 'RESTORE_FAILED' : 'RECOVERY_PENDING';
  const error = verified ? null : {
    code: rolledBack ? record.causeCode ?? 'APPLY_FAILED' : status,
    phase: status === 'RESTORE_FAILED' ? 'restore' : 'apply',
    retryability: rolledBack ? 'NEVER' : status === 'RESTORE_FAILED'
      ? 'AFTER_MANUAL_RECOVERY' : 'SAME_TRANSACTION_QUERY',
    mutationState: rolledBack ? 'ROLLED_BACK' : 'UNKNOWN',
    transactionRef: record.transactionId,
    causeCode: rolledBack ? null : record.causeCode ?? 'APPLY_FAILED',
    reason: status === 'RESTORE_FAILED' ? 'RESTORE_ERROR' :
      rolledBack ? 'APPLY_ERROR' : 'TRANSPORT_OUTCOME_UNKNOWN' };
  return { contractVersion: 'canvas/v2', transactionId: record.transactionId,
    operationDigest: record.operationDigest,
    transactionPayloadDigest: record.transactionPayloadDigest, status,
    previousWorldRevision: record.expectedWorldRevision,
    observedWorldRevision: verified ? record.observedWorldRevision :
      rolledBack ? record.observedWorldRevision : null,
    readbackDigest: verified ? record.afterReadbackDigest :
      rolledBack ? record.restoredReadbackDigest : null,
    restoreStatus: rolledBack ? 'VERIFIED_RESTORED' :
      status === 'RESTORE_FAILED' ? 'FAILED' : status === 'RECOVERY_PENDING'
        ? 'UNKNOWN' : 'NOT_REQUIRED', error };
}

/** The v5 writer uses only paired-world snapshots and a trusted public Canvas
 * registry projection. A caller's object footprint is never its own proof. */
export class V5TransactionBackend {
  #journal; #engine; #profile; #binding; #service; #capacity; #registry;
  constructor({ journal, engine, stateProfile, verifyBinding,
    verifyService, capacity, registry }) {
    this.#journal = journal; this.#engine = engine;
    this.#profile = stateProfile; this.#binding = verifyBinding;
    this.#service = verifyService; this.#capacity = capacity; this.#registry = registry;
  }

  async #bindingNow(request) {
    if (typeof this.#binding !== 'function') fault('PERMISSION_DENIED');
    const proof = await this.#binding(request, 'APPLY_RECOVERABLE');
    if (!proof?.current || proof.worldRef !== request.worldRef ||
        proof.sessionRef !== request.sessionRef ||
        proof.authorizationRef !== request.authorizationRef ||
        (request.authorizationBinding &&
          proof.actorRef !== request.authorizationBinding.actorRef) ||
        !proof.allowedActions?.includes('APPLY_RECOVERABLE') ||
        !proof.nativeGrantRef || !proof.authorRef) fault('AUTHORIZATION_REVOKED');
    const saved = this.#journal.query(request.transactionId);
    if (saved && saved.nativeGrantRef !== proof.nativeGrantRef) fault('AUTHORIZATION_REVOKED');
    return proof;
  }

  async #registryNow(scope, request) {
    if (!scope.objects.length) return;
    const registry = typeof this.#registry === 'function'
      ? this.#registry() : this.#registry;
    if (typeof registry?.readFootprints !== 'function') fault('CAPABILITY_UNAVAILABLE');
    let current;
    try { current = await registry.readFootprints(scope.worldRef,
      scope.objects.map(object => object.objectRef), request); }
    catch { fault('CAPABILITY_UNAVAILABLE'); }
    if (current?.current !== true || current.durable !== true ||
        current.worldRef !== scope.worldRef ||
        !same(current.objects, scope.objects)) fault('STALE_REVISION');
  }

  async #snapshot(scope, binding) {
    if (!same(scope.stateProfile, this.#profile) ||
        typeof this.#engine?.snapshot !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const positions = scope.cells.map(cell => cell.position);
    const raw = await this.#engine.snapshot({ coveredPositions: positions }, binding);
    const image = { ...raw, worldRef: scope.worldRef,
      worldRevision: scopeStateRevision(scope.worldRef, this.#profile, raw.records),
      stateProfile: this.#profile };
    try { validateType('BeforeImage', image); }
    catch { fault('TARGET_FACTS_INCOMPLETE'); }
    if (raw?.worldRef !== scope.worldRef ||
        !same(raw.coveredPositions, positions)) fault('WORLD_NOT_BOUND');
    if (image.records.some((record, i) =>
      cellDigest(this.#profile, record) !== scope.cells[i].stateDigest)) fault('STALE_REVISION');
    return image;
  }

  async #check(request, binding) {
    const scope = request.scope;
    if (scope.worldRef !== request.worldRef ||
        scope.authorizationBindingDigest !== hash('authorization-binding', request.authorizationBinding) ||
        scope.operationDigest !== request.operationDigest ||
        scope.transactionId !== request.transactionId ||
        hash('scoped-world', scope) !== request.scopeDigest ||
        hash('operations', request.operations) !== request.operationDigest)
      fault('REPLAY_MISMATCH');
    if (request.authorizationBinding.allowedAction !== 'APPLY_RECOVERABLE' ||
        request.authorizationBinding.sessionRef !== request.sessionRef ||
        request.authorizationBinding.worldRef !== request.worldRef)
      fault('PERMISSION_DENIED');
    const checked = new Set(scope.checkedPositions.map(key));
    if (request.operations.effects.some(effect => !checked.has(key(effect.position))))
      fault('TARGET_FACTS_INCOMPLETE');
    await this.#registryNow(scope, request);
    const positions = scope.cells.map(cell => cell.position);
    if (typeof this.#capacity?.check !== 'function' ||
        typeof this.#engine?.prepareCheck !== 'function') fault('CAPABILITY_UNAVAILABLE');
    const capacity = await this.#capacity.check(positions.length, request);
    if (capacity?.allowed !== true) fault(capacity?.allowed === false ? 'LIMIT_EXCEEDED' :
      'CAPABILITY_UNAVAILABLE');
    // The paired game endpoint checks online privilege, grant and protection
    // for every cell; prepareCheck also evaluates actual player body clearance.
    await this.#engine.prepareCheck(positions, binding);
    return this.#snapshot(scope, binding);
  }

  #saved(record, request, binding) {
    if (record.originKind !== 'HANAWORLDS' ||
        record.payload?.contractVersion !== 'world-adapter/v5' ||
        record.authorRef !== binding.authorRef ||
        record.nativeGrantRef !== binding.nativeGrantRef ||
        record.beforeImage?.worldRef !== request.worldRef ||
        record.operationDigest !== request.operationDigest ||
        record.scopeDigest !== request.scopeDigest ||
        !same(record.scope, request.scope) ||
        !same(record.operations, request.operations) ||
        !same(record.effects, request.operations.effects) ||
        hash('before-image', record.beforeImage) !== record.beforeImageDigest ||
        hash('readback', readbackView(record.beforeImage)) !== record.beforeStateReadbackDigest ||
        hash('scoped-transaction-payload', record.payload) !== record.transactionPayloadDigest)
      fault('REPLAY_MISMATCH');
    this.#savedIntegrity(record);
  }

  #savedIntegrity(record) {
    try {
      validateType('BeforeImage', record.beforeImage);
      validateType('BeforeImage', record.writeBeforeImage);
      if (hash('operations', record.operations) !== record.operationDigest ||
          hash('scoped-world', record.scope) !== record.scopeDigest ||
          hash('before-image', record.beforeImage) !== record.beforeImageDigest ||
          hash('readback', readbackView(record.beforeImage)) !==
            record.beforeStateReadbackDigest ||
          hash('scoped-transaction-payload', record.payload) !==
            record.transactionPayloadDigest ||
          !same(record.stateProfile, record.scope.stateProfile) ||
          !same(record.beforeImage.coveredPositions,
            record.scope.cells.map(cell => cell.position)) ||
          record.beforeImage.records.some((item, index) =>
            cellDigest(record.stateProfile, item) !== record.scope.cells[index].stateDigest))
        fault('SAVED_RESOURCE_UNAVAILABLE');
      const byPosition = new Map(record.beforeImage.records.map(item => [key(item.position), item]));
      if (!same(record.writeBeforeImage.coveredPositions,
        record.operations.effects.map(effect => effect.position)) ||
          !same(record.writeBeforeImage.records,
            record.operations.effects.map(effect => byPosition.get(key(effect.position)))) ||
          !same(record.effects, record.operations.effects))
        fault('SAVED_RESOURCE_UNAVAILABLE');
      if (record.status === 'VERIFIED_PENDING_HISTORY' &&
          (!record.afterImage || !record.observedWorldRevision ||
            hash('readback', readbackView(record.afterImage)) !==
              record.afterReadbackDigest)) fault('SAVED_RESOURCE_UNAVAILABLE');
    } catch { fault('SAVED_RESOURCE_UNAVAILABLE'); }
  }

  async prepare(request) {
    const binding = await this.#bindingNow(request);
    const existing = this.#journal.query(request.transactionId);
    if (existing) { this.#saved(existing, request, binding); return prepared(existing); }
    const beforeImage = await this.#check(request, binding);
    const byPosition = new Map(beforeImage.records.map(record => [key(record.position), record]));
    const effectPositions = request.operations.effects.map(effect => effect.position);
    const writeBeforeImage = { ...beforeImage, coveredPositions: effectPositions,
      records: effectPositions.map(position => byPosition.get(key(position))) };
    validateType('BeforeImage', writeBeforeImage);
    const beforeImageDigest = hash('before-image', beforeImage);
    const payload = { contractVersion: 'world-adapter/v5',
      transactionId: request.transactionId, worldRef: request.worldRef,
      operationDigest: request.operationDigest,
      authorizationBindingDigest: request.scope.authorizationBindingDigest,
      scopeDigest: request.scopeDigest, beforeImageDigest };
    const transactionPayloadDigest = hash('scoped-transaction-payload', payload);
    await this.#journal.prepare({ transactionId: request.transactionId,
      operationDigest: request.operationDigest, transactionPayloadDigest,
      beforeImageDigest, beforeImage, writeBeforeImage,
      beforeStateReadbackDigest: hash('readback', readbackView(beforeImage)),
      scope: request.scope, scopeDigest: request.scopeDigest, payload,
      operations: request.operations,
      expectedWorldRevision: beforeImage.worldRevision,
      stateProfile: this.#profile, adapterExecutionRevision: transactionPayloadDigest,
      authorRef: binding.authorRef, nativeGrantRef: binding.nativeGrantRef,
      originKind: 'HANAWORLDS', effects: request.operations.effects });
    const saved = this.#journal.query(request.transactionId);
    if (!saved) fault('CAPABILITY_UNAVAILABLE');
    this.#saved(saved, request, binding);
    return prepared(saved);
  }

  async queryPrepared(request) {
    const binding = await this.#bindingNow(request);
    const saved = this.#journal.query(request.transactionId);
    if (!saved || saved.status !== 'PREPARED') fault('STALE_TRANSACTION');
    if (saved.scopeDigest !== request.scopeDigest ||
        saved.payload.authorizationBindingDigest !== request.authorizationBindingDigest ||
        saved.operationDigest !== request.operationDigest ||
        saved.authorRef !== binding.authorRef ||
        saved.nativeGrantRef !== binding.nativeGrantRef) fault('REPLAY_MISMATCH');
    if (hash('before-image', saved.beforeImage) !== saved.beforeImageDigest ||
        hash('readback', readbackView(saved.beforeImage)) !==
          saved.beforeStateReadbackDigest ||
        hash('scoped-world', saved.scope) !== saved.scopeDigest ||
        hash('scoped-transaction-payload', saved.payload) !== saved.transactionPayloadDigest)
      fault('CAPABILITY_UNAVAILABLE');
    this.#savedIntegrity(saved);
    return prepared(saved);
  }

  async #recover(record, causeCode) {
    const attempt = createHash('sha256').update(
      `HanaWorlds|adapter-v5-restore|${record.transactionId}|${record.operationDigest}`).digest('hex');
    const recovery = { worldRef: record.beforeImage.worldRef,
      originTransactionId: record.transactionId,
      operationDigest: record.operationDigest,
      beforeImageDigest: record.beforeImageDigest, restoreAttemptIdentity: attempt };
    if (typeof this.#service !== 'function' || !await this.#service(recovery)) {
      await this.#journal.transition(record.transactionId, 'RECOVERY_PENDING', { causeCode });
      fault('RECOVERY_PENDING');
    }
    await this.#journal.transition(record.transactionId, 'RESTORING',
      { causeCode, restoreAttemptIdentity: attempt });
    try {
      const restored = await this.#engine.restore({ ...recovery, status: 'RESTORING' },
        record.writeBeforeImage);
      if (restored?.status !== 'ROLLED_BACK') fault('RESTORE_FAILED');
      await this.#journal.transition(record.transactionId, 'ROLLED_BACK', {
        causeCode, observedWorldRevision: scopeStateRevision(record.beforeImage.worldRef,
          this.#profile, record.writeBeforeImage.records),
        restoredReadbackDigest: hash('readback', readbackView(record.writeBeforeImage)) });
      return receipt(this.#journal.query(record.transactionId));
    } catch {
      await this.#journal.transition(record.transactionId, 'RESTORE_FAILED', { causeCode });
      fault('RESTORE_FAILED');
    }
  }

  async restoreTrusted(request) {
    const record = this.#journal.query(request.originTransactionId);
    if (!record || record.payload?.contractVersion !== 'world-adapter/v5' ||
        record.beforeImage?.worldRef !== request.worldRef ||
        record.operationDigest !== request.operationDigest ||
        record.beforeImageDigest !== request.beforeImageDigest ||
        !record.writeBeforeImage || !record.scopeDigest)
      fault('REPLAY_MISMATCH');
    const attempt = createHash('sha256').update(
      `HanaWorlds|adapter-v5-restore|${record.transactionId}|${record.operationDigest}`).digest('hex');
    if (request.restoreAttemptIdentity !== attempt) fault('REPLAY_MISMATCH');
    if (record.status === 'ROLLED_BACK') return receipt(record);
    if (!['RECOVERY_PENDING', 'RESTORE_FAILED'].includes(record.status))
      fault('STALE_TRANSACTION');
    if (hash('before-image', record.beforeImage) !== record.beforeImageDigest ||
        hash('readback', readbackView(record.beforeImage)) !==
          record.beforeStateReadbackDigest ||
        hash('scoped-world', record.scope) !== record.scopeDigest ||
        hash('scoped-transaction-payload', record.payload) !== record.transactionPayloadDigest)
      fault('SAVED_RESOURCE_UNAVAILABLE');
    this.#savedIntegrity(record);
    return this.#recover(record, record.causeCode ?? 'APPLY_FAILED');
  }

  async abortPreparedTrusted(request) {
    if (typeof this.#service !== 'function' ||
        !await this.#service(request, 'AbortPreparedTransaction'))
      fault('PERMISSION_DENIED');
    const record = this.#journal.query(request.transactionId);
    if (!record || record.payload?.contractVersion !== 'world-adapter/v5' ||
        record.beforeImage?.worldRef !== request.worldRef ||
        record.operationDigest !== request.operationDigest ||
        record.payload.authorizationBindingDigest !== request.authorizationBindingDigest)
      fault('REPLAY_MISMATCH');
    await this.#journal.abortPrepared(request.transactionId, record.authorRef);
    return { transactionId: request.transactionId, status: 'ABORTED_PREPARED',
      mutationState: 'NONE' };
  }

  async apply(request) {
    const binding = await this.#bindingNow(request);
    const record = this.#journal.query(request.transactionId);
    if (!record) fault('STALE_TRANSACTION');
    this.#saved(record, request, binding);
    const { beforeStateReadbackDigest: ignored, ...projected } = prepared(record);
    if (!same(projected, request.preparedTransaction)) fault('REPLAY_MISMATCH');
    if (record.status === 'VERIFIED_PENDING_HISTORY' || record.status === 'ROLLED_BACK')
      return receipt(record);
    if (record.status !== 'PREPARED') fault('RECOVERY_PENDING');
    // The second paired-world snapshot and registry read are immediately before
    // the durable APPLYING barrier. The Lua endpoint repeats the full-image
    // comparison before the first actual cell write.
    try { await this.#check(request, binding); }
    catch (error) {
      const code = error?.publicError?.code ?? error?.message;
      if (['PERMISSION_DENIED', 'AUTHORIZATION_REVOKED', 'REPLAY_MISMATCH',
        'TARGET_FACTS_INCOMPLETE', 'OBJECT_SCOPE_MISMATCH', 'STALE_REVISION',
        'UNSUPPORTED_MUTATION_SEMANTICS'].includes(code)) throw error;
      if (['SAFETY_INVARIANT_FAILED', 'TRANSACTION_CONFLICT'].includes(code))
        fault('STALE_REVISION');
      fault('TARGET_FACTS_INCOMPLETE');
    }
    await this.#journal.transition(request.transactionId, 'APPLYING');
    try {
      const result = await this.#engine.apply({ ...request,
        effects: record.effects, scopeBeforeImage: record.beforeImage },
      { ...record, beforeImage: record.writeBeforeImage }, binding);
      if (result?.status !== 'APPLIED_PENDING_READBACK') fault('APPLY_FAILED');
      await this.#journal.transition(request.transactionId, 'APPLIED_PENDING_READBACK');
      const current = await this.#engine.readback({ coveredPositions:
        record.beforeImage.coveredPositions }, binding);
      const after = { ...current, worldRef: request.worldRef,
        worldRevision: scopeStateRevision(request.worldRef, this.#profile,
          current.records), stateProfile: this.#profile };
      validateType('BeforeImage', after);
      const affected = new Map(record.effects.map(effect => [key(effect.position), effect]));
      if (after.records.some((item, i) => {
        const effect = affected.get(key(item.position));
        return effect ? item.nodeName !== effect.nodeName || item.param2 !== effect.param2 :
          !same(item, record.beforeImage.records[i]);
      })) fault('READBACK_MISMATCH');
      const observedWorldRevision = after.worldRevision;
      await this.#journal.recordAfterState(record.transactionId, after,
        hash('readback', readbackView(after)), record.beforeStateReadbackDigest,
        observedWorldRevision);
      return receipt(this.#journal.query(record.transactionId));
    } catch (error) {
      const saved = this.#journal.query(record.transactionId);
      if (saved?.status === 'VERIFIED_PENDING_HISTORY') fault('RECOVERY_PENDING');
      return this.#recover(record, error?.message === 'READBACK_MISMATCH' ?
        'READBACK_MISMATCH' : 'APPLY_FAILED');
    }
  }
}
