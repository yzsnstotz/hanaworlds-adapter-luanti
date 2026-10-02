import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open as openFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const settled = new Set(['ROLLED_BACK', 'VERIFIED', 'VERIFIED_PENDING_HISTORY', 'ABORTED_PREPARED']);
const transitions = {
  PREPARED: new Set(['APPLYING', 'ABORTED_PREPARED']),
  APPLYING: new Set(['APPLIED_PENDING_READBACK', 'RESTORING', 'RECOVERY_PENDING']),
  APPLIED_PENDING_READBACK: new Set(['VERIFIED_PENDING_HISTORY', 'RESTORING', 'RECOVERY_PENDING']),
  VERIFIED_PENDING_HISTORY: new Set(['RECOVERY_PENDING']),
  RESTORING: new Set(['ROLLED_BACK', 'RESTORE_FAILED', 'RECOVERY_PENDING']),
  RESTORE_FAILED: new Set(['RESTORING']),
  RECOVERY_PENDING: new Set(['RESTORING']),
};

function fault(code) { return new Error(code); }
function fileName(transactionId) {
  return `${createHash('sha256').update(transactionId).digest('hex')}.json`;
}
function key(worldRef, pos) { return `${worldRef}\u0000${pos.join(',')}`; }
function copy(record) { return structuredClone(record); }
function pureJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) return false;
  if (Array.isArray(value)) return value.every(pureJson);
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) ||
      Object.hasOwn(value, 'toJSON')) return false;
  return Object.values(value).every(pureJson);
}
function samePosition(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 &&
    a.every((n, i) => Number.isSafeInteger(n) && n === b[i]);
}

async function syncDir(dir) {
  const handle = await openFile(dir, 'r');
  try { await handle.sync(); }
  finally { await handle.close(); }
}

/** Private host-side before-image journal; only a contract-admitted caller may use it. */
export class DurableJournal {
  #dir;
  #records;
  #serial = Promise.resolve();

  constructor(dir, records) { this.#dir = dir; this.#records = records; }

  static async open(dir) {
    const stat = await lstat(dir).catch(() => null);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw fault('RECOVERY_PENDING');
    if (!stat) { await mkdir(dir, { recursive: true, mode: 0o700 }); await syncDir(dir); }
    const records = new Map();
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith('.json')) continue;
      const path = join(dir, entry);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw fault('RECOVERY_PENDING');
      let record;
      try { record = JSON.parse(await readFile(path, 'utf8')); }
      catch { throw fault('RECOVERY_PENDING'); }
      if (!record || typeof record.transactionId !== 'string' || fileName(record.transactionId) !== entry)
        throw fault('RECOVERY_PENDING');
      records.set(record.transactionId, record);
    }
    return new DurableJournal(dir, records);
  }

  async #exclusive(fn) {
    const pending = this.#serial.then(fn);
    this.#serial = pending.catch(() => {});
    return pending;
  }

  async #save(record) {
    const final = join(this.#dir, fileName(record.transactionId));
    const temporary = join(this.#dir, `.pending-${randomUUID()}`);
    const handle = await openFile(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, final); await syncDir(this.#dir); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }

  query(transactionId) {
    const record = this.#records.get(transactionId);
    if (!record) return null;
    const result = copy(record);
    if (['APPLYING', 'APPLIED_PENDING_READBACK', 'RESTORING'].includes(result.status)) {
      result.status = 'RECOVERY_PENDING';
      result.mutationState = 'UNKNOWN';
    }
    return result;
  }

  async prepare(input) {
    return this.#exclusive(async () => {
      const { transactionId, operationDigest, transactionPayloadDigest, beforeImageDigest, beforeImage,
        payload, expectedWorldRevision, stateProfile, adapterExecutionRevision,
        authorRef, originKind, affectedObjectRefs, historySourceId, historyDirection,
        historyOperationDigest, targetImage, targetStateDigest, effects,
        originVerifiedReceiptDigest, expectedHistoryRevision, beforeStateReadbackDigest } = input;
      if (!pureJson(input)) throw fault('SCHEMA_INVALID');
      if (typeof transactionId !== 'string' || !transactionId ||
          !Array.isArray(beforeImage?.coveredPositions) ||
          beforeImage.coveredPositions.length !== beforeImage.records?.length ||
          beforeImage.coveredPositions.length === 0) throw fault('TARGET_FACTS_INCOMPLETE');
      if (beforeImage.records.some((record, i) => !samePosition(record.position, beforeImage.coveredPositions[i])))
        throw fault('TARGET_FACTS_INCOMPLETE');
      const old = this.#records.get(transactionId);
      if (old) {
        if (old.operationDigest !== operationDigest || old.transactionPayloadDigest !== transactionPayloadDigest ||
            old.beforeImageDigest !== beforeImageDigest) throw fault('REPLAY_MISMATCH');
        return this.query(transactionId);
      }
      const positions = new Set(beforeImage.coveredPositions.map(pos => key(beforeImage.worldRef, pos)));
      if (positions.size !== beforeImage.coveredPositions.length) throw fault('TARGET_FACTS_INCOMPLETE');
      for (const record of this.#records.values()) {
        if (settled.has(record.status)) continue;
        for (const pos of record.beforeImage.coveredPositions) {
          if (positions.has(key(record.beforeImage.worldRef, pos))) throw fault('TRANSACTION_CONFLICT');
        }
      }
      const record = { transactionId, operationDigest, transactionPayloadDigest, beforeImageDigest,
        beforeImage: copy(beforeImage),
        ...(authorRef === undefined ? {} : { authorRef }),
        ...(originKind === undefined ? {} : { originKind }),
        ...(affectedObjectRefs === undefined ? {} : { affectedObjectRefs: copy(affectedObjectRefs) }),
        ...(historySourceId === undefined ? {} : { historySourceId }),
        ...(historyDirection === undefined ? {} : { historyDirection }),
        ...(historyOperationDigest === undefined ? {} : { historyOperationDigest }),
        ...(originVerifiedReceiptDigest === undefined ? {} : { originVerifiedReceiptDigest }),
        ...(expectedHistoryRevision === undefined ? {} : { expectedHistoryRevision }),
        ...(targetImage === undefined ? {} : { targetImage: copy(targetImage) }),
        ...(targetStateDigest === undefined ? {} : { targetStateDigest }),
        ...(beforeStateReadbackDigest === undefined ? {} : { beforeStateReadbackDigest }),
        ...(effects === undefined ? {} : { effects: copy(effects) }),
        ...(payload === undefined ? {} : { payload: copy(payload) }),
        ...(expectedWorldRevision === undefined ? {} : { expectedWorldRevision }),
        ...(stateProfile === undefined ? {} : { stateProfile: copy(stateProfile) }),
        ...(adapterExecutionRevision === undefined ? {} : { adapterExecutionRevision }),
        status: 'PREPARED', mutationState: 'NONE' };
      await this.#save(record);
      this.#records.set(transactionId, record);
      return copy(record);
    });
  }

  async transition(transactionId, nextStatus, { causeCode, restoreAttemptIdentity,
    observedWorldRevision, restoredReadbackDigest } = {}) {
    return this.#exclusive(async () => {
      const current = this.#records.get(transactionId);
      if (restoreAttemptIdentity !== undefined && current?.restoreAttemptIdentity !== undefined
        && current.restoreAttemptIdentity !== restoreAttemptIdentity) throw fault('REPLAY_MISMATCH');
      if (current?.status === 'RESTORING' && nextStatus === 'RESTORING') {
        if (typeof current.restoreAttemptIdentity !== 'string' ||
            !current.restoreAttemptIdentity ||
            restoreAttemptIdentity !== current.restoreAttemptIdentity)
          throw fault('REPLAY_MISMATCH');
        // The durable barrier already exists. Reopening after a crash may
        // resume this exact restore attempt without a second state transition.
        return this.query(transactionId);
      }
      if (!current || !transitions[current.status]?.has(nextStatus)) throw fault('INVALID_TRANSITION');
      const record = { ...current, status: nextStatus,
        ...(causeCode === undefined ? {} : { causeCode }),
        ...(restoreAttemptIdentity === undefined ? {} : { restoreAttemptIdentity }),
        ...(observedWorldRevision === undefined ? {} : { observedWorldRevision }),
        ...(restoredReadbackDigest === undefined ? {} : { restoredReadbackDigest }),
        mutationState: nextStatus === 'ROLLED_BACK' ? 'ROLLED_BACK' :
          nextStatus === 'PREPARED' ? 'NONE' : 'UNKNOWN' };
      await this.#save(record);
      this.#records.set(transactionId, record);
      return this.query(transactionId);
    });
  }

  async abortPrepared(transactionId, expectedAuthorRef) {
    return this.#exclusive(async () => {
      const current = this.#records.get(transactionId);
      if (!current || current.authorRef !== expectedAuthorRef) throw fault('PERMISSION_DENIED');
      if (current.status === 'ABORTED_PREPARED') return copy(current);
      if (current.status !== 'PREPARED') throw fault('STALE_TRANSACTION');
      const record = { ...current, status: 'ABORTED_PREPARED', mutationState: 'NONE' };
      await this.#save(record);
      this.#records.set(transactionId, record);
      return copy(record);
    });
  }

  async recordAfterState(transactionId, afterImage, afterReadbackDigest, beforeStateReadbackDigest) {
    return this.#exclusive(async () => {
      const current = this.#records.get(transactionId);
      if (!current || current.status !== 'APPLIED_PENDING_READBACK' ||
          !pureJson(afterImage) || !samePositionSet(current.beforeImage, afterImage))
        throw fault('STALE_TRANSACTION');
      // A digest saved at Prepare is authoritative and never replaced.
      if (current.beforeStateReadbackDigest !== undefined &&
          current.beforeStateReadbackDigest !== beforeStateReadbackDigest)
        throw fault('SAVED_RESOURCE_UNAVAILABLE');
      const record = { ...current, afterImage: copy(afterImage), afterReadbackDigest,
        beforeStateReadbackDigest, status: 'VERIFIED_PENDING_HISTORY', mutationState: 'VERIFIED' };
      await this.#save(record);
      this.#records.set(transactionId, record);
      return copy(record);
    });
  }
}

function samePositionSet(before, after) {
  return before.worldRef === after.worldRef &&
    before.coveredPositions.length === after.coveredPositions?.length &&
    before.coveredPositions.every((pos, i) => samePosition(pos, after.coveredPositions[i]) &&
      samePosition(pos, after.records?.[i]?.position));
}
