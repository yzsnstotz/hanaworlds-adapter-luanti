import { createHash } from 'node:crypto';
import { canonicalJSON, digestValue, validateType, schemaBundle, comparePosition } from '#contracts';
const D = (kind, value) => digestValue(kind, value).sha256;
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
const fail = code => { throw new Error(code); };
export const cellDigest = (profile, record) => createHash('sha256')
  .update('HanaWorlds|contracts@0.4.0|adapter-scoped-cell/v1\n').update(canonicalJSON({ profile, record })).digest('hex');
const view = image => ({ worldRef: image.worldRef, coveredPositions: image.coveredPositions,
  records: image.records, stateProfile: image.stateProfile });
export const readbackView = view;

/** Durable transport records. Canvas owns transaction/history decisions. */
export class LocalTransactions {
  constructor({ store, engine, stateProfile, current, registry, historyFacts, revision }) {
    Object.assign(this, { store, engine, stateProfile, current, registry, historyFacts, revision });
  }
  async snapshot(positions) {
    const raw = await this.engine.snapshot(positions);
    const projection = validateType('ReadbackProjection', { ...raw, stateProfile: this.stateProfile });
    if (!same(positions, projection.coveredPositions)) fail('READBACK_MISMATCH');
    return validateType('BeforeImage', { ...projection, worldRevision: 'scope-state:' + D('readback', projection) });
  }
  async scopeNow(r) {
    if (!same(r.scope.localContext, r.localContext) || r.scope.transactionId !== r.transactionId ||
      r.scope.worldRef !== r.worldRef || r.operations.worldRef !== r.worldRef ||
      r.scope.operationDigest !== r.operationDigest || D('operations', r.operations) !== r.operationDigest ||
      D('scoped-world', r.scope) !== r.scopeDigest || !same(r.scope.stateProfile, this.stateProfile)) fail('REPLAY_MISMATCH');
    const cells=r.scope.cells.map(x=>x.position);
    const covered=new Map([...r.scope.checkedPositions,...r.scope.objects.flatMap(x=>x.positions)].map(p=>[canonicalJSON(p),p]));
    if(!same(cells,[...covered.values()].sort(comparePosition)) ||
      r.operations.effects.some(x=>!covered.has(canonicalJSON(x.position)))) fail('TARGET_FACTS_INCOMPLETE');
    if (r.scope.objects.length) {
      const registry = this.registry(); if (typeof registry?.readFootprints !== 'function') fail('CAPABILITY_UNAVAILABLE');
      const actual = await registry.readFootprints(r.worldRef, r.scope.objects.map(x => x.objectRef), r);
      if (actual?.current !== true || actual.durable !== true || actual.worldRef !== r.worldRef || !same(actual.objects, r.scope.objects)) fail('TRANSACTION_CONFLICT');
    }
    const capacity = await this.engine.capacity(cells.length);
    if (capacity?.allowed !== true) fail('LIMIT_EXCEEDED');
    await this.engine.prepareCheck(r.operations.effects.map(x => x.position),
      r.operations.effects.map(x => ({ position: x.position, nodeName: x.nodeName })));
    const before = await this.snapshot(cells);
    if (before.worldRef !== r.worldRef || before.records.some((x, i) => cellDigest(this.stateProfile, x) !== r.scope.cells[i].stateDigest)) fail('TRANSACTION_CONFLICT');
    return before;
  }
  prepared(record) {
    return validateType('ScopedPreparedTransactionResult', {
      payload: record.payload, transactionPayloadDigest: record.transactionPayloadDigest,
      beforeImageDigest: record.beforeImageDigest, scopeDigest: record.request.scopeDigest,
      guarantee: 'RECOVERABLE_VERIFIED', stateProfile: this.stateProfile,
      adapterExecutionRevision: this.revision, beforeStateReadbackDigest: D('readback', view(record.before)) });
  }
  async prepare(r) {
    await this.current(r);
    const saved = this.store.get(r.transactionId);
    if (saved) { if (!same(saved.request, r)) fail('REPLAY_MISMATCH'); return this.prepared(saved); }
    const before = await this.scopeNow(r);
    for (const other of Object.values(this.store.data.transactions)) {
      // A RESTORE_FAILED record is still pending recovery: its cells stay reserved.
      if (['PREPARED','APPLYING','RECOVERY_PENDING','RESTORE_FAILED'].includes(other.status) &&
        other.before.coveredPositions.some(p => before.coveredPositions.some(q => same(p, q)))) fail('TRANSACTION_CONFLICT');
    }
    const beforeImageDigest = D('before-image', before);
    const payload = { contractVersion: 'world-adapter/v6', transactionId: r.transactionId,
      worldRef: r.worldRef, operationDigest: r.operationDigest, scopeDigest: r.scopeDigest,
      beforeImageDigest, localContext: r.localContext };
    const record = { transactionId: r.transactionId, request: r, before, beforeImageDigest,
      operationDigest: r.operationDigest, payload, transactionPayloadDigest: D('scoped-transaction-payload', payload), status: 'PREPARED' };
    await this.store.put(record); return this.prepared(record);
  }
  receipt(record) {
    return validateType('ReceiptProjection', { contractVersion: 'canvas/v5', transactionId: record.transactionId,
      operationDigest: record.operationDigest, transactionPayloadDigest: record.transactionPayloadDigest,
      status: record.status === 'APPLYING' ? 'RECOVERY_PENDING' : ['PREPARED','ABORTED_PREPARED'].includes(record.status) ? 'REJECTED' : record.status, previousWorldRevision: record.before.worldRevision,
      observedWorldRevision: record.after?.worldRevision ?? null,
      readbackDigest: record.after ? D('readback', view(record.after)) : null,
      restoreStatus: record.status === 'ROLLED_BACK' ? 'VERIFIED_RESTORED' : record.status === 'VERIFIED' ? 'NOT_REQUIRED' : 'UNKNOWN',
      error: ['RECOVERY_PENDING','APPLYING','RESTORE_FAILED'].includes(record.status) ? {
        code:record.status==='RESTORE_FAILED'?'RESTORE_FAILED':'RECOVERY_PENDING',
        phase:record.status==='RESTORE_FAILED'?'restore':'apply',retryability:'NEVER',mutationState:'UNKNOWN',
        transactionRef:record.transactionId,causeCode:record.failureCode??'APPLY_FAILED',reason:'REQUIRED_FACT_UNKNOWN'} : null,
      localContext: record.request.localContext });
  }
  async apply(r) {
    await this.current(r); let saved = this.store.get(r.transactionId); if (!saved) fail('STALE_TRANSACTION');
    if (r.operationDigest !== saved.operationDigest || r.scopeDigest !== saved.request.scopeDigest ||
      !same(r.operations, saved.request.operations) || !same(r.scope, saved.request.scope) ||
      !same(r.preparedTransaction, Object.fromEntries(Object.entries(this.prepared(saved)).filter(([k]) => k !== 'beforeStateReadbackDigest')))) fail('REPLAY_MISMATCH');
    if (['VERIFIED','ROLLED_BACK'].includes(saved.status)) return this.receipt(saved);
    if (saved.status !== 'PREPARED') fail('RECOVERY_PENDING');
    const before = await this.scopeNow(r); if (!same(before, saved.before)) fail('TRANSACTION_CONFLICT');
    const selected = new Set(r.operations.effects.map(x => canonicalJSON(x.position)));
    const writeBefore = { ...saved.before, records: saved.before.records.filter(x => selected.has(canonicalJSON(x.position))),
      coveredPositions: saved.before.coveredPositions.filter(x => selected.has(canonicalJSON(x))) };
    await this.current(r); saved.status = 'APPLYING'; await this.store.put(saved);
    try {
      const changed = await this.engine.apply(r.operations.effects, writeBefore, saved.before, r.operationDigest);
      if (changed?.status !== 'APPLIED_PENDING_READBACK') fail('APPLY_FAILED');
      const after = await this.snapshot(saved.before.coveredPositions);
      const expected = saved.before.records.map(x => {
        const e = r.operations.effects.find(e => same(e.position, x.position));
        // param1 is derived lighting: the native engine repaired it and this exact
        // observed byte is persisted with the after image for same-origin Undo.
        return e ? { ...x, nodeName: e.nodeName, param2: e.param2, param1: after.records.find(a=>same(a.position,x.position)).param1 } : x;
      });
      if (!same(after.records, expected)) fail('READBACK_MISMATCH');
      saved = { ...saved, after, status: 'VERIFIED' }; await this.store.put(saved); return this.receipt(saved);
    } catch (error) {
      saved.failureCode=schemaBundle.definitions.ErrorCode.enum.includes(error.message)?error.message:'APPLY_FAILED';
      return this.rollback(saved);
    }
  }
  async rollback(saved) {
    saved.status = 'RECOVERY_PENDING'; await this.store.put(saved);
    try {
      const restored = await this.engine.restore(saved.before, saved.transactionId);
      if (restored?.status !== 'ROLLED_BACK') fail('RESTORE_FAILED');
      const actual = await this.snapshot(saved.before.coveredPositions);
      if (!same(view(actual), view(saved.before))) fail('RESTORE_FAILED');
      saved.status = 'ROLLED_BACK'; saved.after = actual; await this.store.put(saved); return this.receipt(saved);
    } catch (error) {
      // Recovery stays pending; keep which engine guard or step refused the restore.
      saved.status = 'RESTORE_FAILED'; saved.restoreFailure = { code: error?.message ?? null, detail: error?.detail ?? null };
      await this.store.put(saved); fail('RESTORE_FAILED');
    }
  }
  async historyNow(r) {
    const facts = this.historyFacts();
    if (typeof facts?.read !== 'function') fail('CAPABILITY_UNAVAILABLE');
    const actual = await facts.read(r);
    if (actual?.current !== true || actual.durable !== true || actual.worldRef !== r.worldRef ||
      actual.originTransactionId !== r.originTransactionId || actual.historyRevision !== r.expectedHistoryRevision ||
      actual.worldRevision !== r.expectedWorldRevision || !same(actual.objectRevisions, r.expectedObjectRevisions) ||
      !same(actual.affectedObjectRefs, r.affectedObjectRefs) ||
      actual.originVerifiedReceiptDigest !== r.originVerifiedReceiptDigest) fail('UNDO_CONFLICT');
  }
  async prepareHistory(r) {
    await this.current(r); await this.historyNow(r); const origin = this.store.get(r.originTransactionId);
    if (!origin || origin.status !== 'VERIFIED' || origin.request.worldRef !== r.worldRef ||
      D('receipt', this.receipt(origin)) !== r.originVerifiedReceiptDigest || origin.beforeImageDigest !== r.originBeforeImageDigest ||
      D('readback', view(origin.before)) !== r.originBeforeStateReadbackDigest ||
      D('readback', view(origin.after)) !== r.originAfterReadbackDigest) fail('SAVED_RESOURCE_UNAVAILABLE');
    const projection = Object.fromEntries(Object.keys(schemaBundle.definitions.HistoryOperationProjection.properties).map(k => [k, r[k]]));
    if (D('history-operation', projection) !== r.historyOperationDigest) fail('REPLAY_MISMATCH');
    const target = r.direction === 'UNDO' ? origin.before : origin.after;
    const before = await this.snapshot(origin.before.coveredPositions);
    if (D('readback', view(before)) !== r.expectedCurrentStateDigest || D('readback', view(target)) !== r.targetStateDigest) fail('UNDO_CONFLICT');
    const existing = this.store.get(r.transactionId);
    if (existing) { if (!same(existing.request, r)) fail('REPLAY_MISMATCH'); return existing.prepared; }
    const beforeImageDigest = D('before-image', before);
    const transactionPayloadDigest = createHash('sha256').update('HanaWorlds|contracts@0.4.0|history-transport\n').update(canonicalJSON({ projection, beforeImageDigest })).digest('hex');
    const prepared = validateType('PreparedHistoryTransaction', { originTransactionId: r.originTransactionId,
      transactionId: r.transactionId, direction: r.direction, historyOperationDigest: r.historyOperationDigest,
      transactionPayloadDigest, beforeImageDigest, targetStateDigest: r.targetStateDigest,
      stateProfile: this.stateProfile, adapterExecutionRevision: this.revision,
      guarantee: 'RECOVERABLE_VERIFIED', status: 'PREPARED', localContext: r.localContext });
    await this.store.put({ transactionId: r.transactionId, operationDigest: r.historyOperationDigest,
      request: r, before, target, beforeImageDigest, transactionPayloadDigest, prepared, status: 'PREPARED' }); return prepared;
  }
  async applyHistory(r) {
    await this.current(r); let saved = this.store.get(r.transactionId);
    if (!saved || !same(saved.prepared, r.preparedHistoryTransaction) || saved.request.originTransactionId !== r.originTransactionId ||
      saved.request.direction !== r.direction || saved.operationDigest !== r.historyOperationDigest) fail('REPLAY_MISMATCH');
    if (['VERIFIED','ROLLED_BACK'].includes(saved.status)) return this.receipt(saved);
    if (saved.status !== 'PREPARED') fail('RECOVERY_PENDING');
    await this.historyNow({ ...saved.request, requestId: r.requestId, localContext: r.localContext });
    if (r.expectedWorldRevision !== saved.request.expectedWorldRevision || !same(r.expectedObjectRevisions, saved.request.expectedObjectRevisions)) fail('UNDO_CONFLICT');
    await this.engine.prepareCheck(saved.target.coveredPositions,
      saved.target.records.map(x => ({ position: x.position, nodeName: x.nodeName })));
    const before = await this.snapshot(saved.before.coveredPositions);
    if (!same(view(before), view(saved.before))) fail('UNDO_CONFLICT');
    await this.current(r); saved.status = 'APPLYING'; await this.store.put(saved);
    try {
      const result = await this.engine.applyState(saved.target, saved.before, saved.operationDigest);
      if (result?.status !== 'APPLIED_PENDING_READBACK') fail('APPLY_FAILED');
      const after = await this.snapshot(saved.target.coveredPositions);
      if (!same(view(after), view(saved.target))) fail('READBACK_MISMATCH');
      saved.status = 'VERIFIED'; saved.after = after; await this.store.put(saved); return this.receipt(saved);
    } catch { return this.rollback(saved); }
  }
}
