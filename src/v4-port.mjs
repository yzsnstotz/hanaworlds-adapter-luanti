import {
  admitRequest, validateRequest, validateBoundRequest, validateResponse,
  canonicalJSON, ContractError, operationContracts, contractHandshake, snapshotJSON,
} from 'hanaworlds-contracts/v4';

const VERSION = 'world-adapter/v4';
const canvasOnly = new Set(['PrepareRecoverableTransaction', 'ApplyCompiledTransaction',
  'Readback', 'QueryTransaction', 'RestoreTransaction', 'QueryPreparedTransaction',
  'PrepareHistoryTransaction', 'QueryPreparedHistoryTransaction',
  'ApplyHistoryTransaction', 'AbortPreparedTransaction', 'AbortPreparedHistoryTransaction',
  'InspectRegion']);
const uncertain = new Set(['ApplyCompiledTransaction', 'Readback', 'RestoreTransaction',
  'ApplyHistoryTransaction']);
const allowed = new Map(operationContracts[VERSION].map(entry =>
  [entry.operation, new Set(entry.failureCodes)]));

function fault(code, phase, reason, details) {
  throw new ContractError(code, phase, reason, details);
}

function publicFailure(thrown, operation, request, postwriteValidation = false,
  handlerEntered = false) {
  if (postwriteValidation && uncertain.has(operation)) {
    const phase = operation === 'Readback' ? 'readback' :
      operation === 'RestoreTransaction' ? 'restore' : 'apply';
    return new ContractError('RECOVERY_PENDING', phase, 'TRANSPORT_OUTCOME_UNKNOWN', {
      retryability: 'SAME_TRANSACTION_QUERY', mutationState: 'UNKNOWN',
      transactionRef: request?.transactionId ?? request?.originTransactionId ?? null,
      causeCode: 'SCHEMA_INVALID',
    }).publicError;
  }
  const code = thrown?.publicError?.code ?? thrown?.message;
  const permitted = allowed.get(operation);
  if (permitted?.has(code) && thrown?.publicError) return thrown.publicError;
  if (permitted?.has(code)) {
    const phase = ['PERMISSION_DENIED', 'AUTHORIZATION_REVOKED',
      'CONNECTION_UNAUTHORIZED', 'WORLD_NOT_BOUND'].includes(code) ? 'authorize' :
      code === 'REPLAY_MISMATCH' ? 'replay' :
      code === 'RECOVERY_PENDING' ? 'apply' : 'validate';
    const reason = ['UNDO_CONFLICT', 'REDO_CONFLICT'].includes(code)
      ? 'EXTERNAL_EDIT_CONFLICT' :
      code === 'SAVED_RESOURCE_UNAVAILABLE' ? 'RESOURCE_MISSING' :
      code === 'STALE_REVISION' ? 'REVISION_CHANGED' :
      code === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' :
      code === 'UNSUPPORTED_MUTATION_SEMANTICS' ? 'UNSUPPORTED_STATE_COVERAGE' :
      ['INSPECTION_FAILED', 'TARGET_FACTS_INCOMPLETE'].includes(code) ? 'REQUIRED_FACT_UNKNOWN' :
      phase === 'authorize' ? 'SCOPE_DENIED' :
      phase === 'replay' ? 'PAYLOAD_CHANGED' :
      code === 'RECOVERY_PENDING' ? 'TRANSPORT_OUTCOME_UNKNOWN' : 'POLICY_UNAVAILABLE';
    return new ContractError(code, phase, reason, phase === 'apply' ? {
      retryability: 'SAME_TRANSACTION_QUERY', mutationState: 'UNKNOWN',
      transactionRef: request?.transactionId ?? request?.originTransactionId ?? null,
    } : {}).publicError;
  }
  const unavailable = permitted?.has('CAPABILITY_UNAVAILABLE') ?
    'CAPABILITY_UNAVAILABLE' : 'ADAPTER_UNAVAILABLE';
  return new ContractError(uncertain.has(operation) && handlerEntered ?
    'RECOVERY_PENDING' : unavailable,
    uncertain.has(operation) && handlerEntered ? 'apply' : 'validate',
    uncertain.has(operation) && handlerEntered ? 'TRANSPORT_OUTCOME_UNKNOWN' : 'POLICY_UNAVAILABLE',
    uncertain.has(operation) && handlerEntered ? {
      retryability: 'SAME_TRANSACTION_QUERY', mutationState: 'UNKNOWN',
      transactionRef: request.transactionId ?? request.originTransactionId ?? null,
    } : {}).publicError;
}

/**
 * Strict public world-adapter/v4 provider. The host's current proof is never
 * a wire field. The request actorRef is the Canvas service principal
 * (contracts@0.3.0 CONTRACT_GAP-V4-05): authority comes from the current
 * grant named by authorizationRef plus, where present, authorizationBinding;
 * the request actorRef is never used to authorize.
 */
export class WorldAdapterV4 {
  #authority;
  #resolveAuthority;
  #currentAccess;
  #operations;
  #replay = new Map();
  /**
   * `resolveAuthority`, when given, is called on every request so a host
   * authority registered after the Adapter is used and a withdrawn one denies;
   * there is no fallback to `authority` in that case.
   */
  constructor({ authority, resolveAuthority, currentAccess, operations } = {}) {
    // Optional host-side current-access check (remote operator/tunnel), run
    // after the grant and before the replay cache.
    this.#currentAccess = typeof currentAccess === 'function' ? currentAccess : null;
    this.#authority = authority;
    this.#resolveAuthority = typeof resolveAuthority === 'function' ? resolveAuthority : null;
    this.#operations = operations;
  }
  /** ContractHandshake advertised before any request (contracts@0.3.0 set). */
  get contractHandshake() { return snapshotJSON(contractHandshake); }
  async call(operation, raw) {
    // A rejected wire has no legal requestId. Preserve the Contracts typed
    // pre-admission error instead of inventing an operation response.
    const request = raw instanceof Uint8Array || typeof raw === 'string'
      ? admitRequest(VERSION, operation, Buffer.from(raw))
      : validateRequest(VERSION, operation, raw);
    let resultProduced = false;
    let handlerEntered = false;
    try {
      const authority = this.#resolveAuthority ? this.#resolveAuthority() : this.#authority;
      const verifier = ['RestoreTransaction', 'AbortPreparedTransaction',
        'AbortPreparedHistoryTransaction'].includes(operation)
        ? authority?.verifyService : authority?.verify;
      if (typeof verifier !== 'function') fault('PERMISSION_DENIED', 'authorize', 'IDENTITY_UNVERIFIED');
      const proof = await verifier.call(authority, request, operation);
      if (proof?.current !== true || proof.sessionRef !== request.sessionRef ||
          proof.authorizationRef !== request.authorizationRef ||
          (request.worldRef !== undefined && proof.worldRef !== request.worldRef))
        fault('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED');
      if (canvasOnly.has(operation) && proof.domainOwner !== 'hanaworlds-canvas')
        fault('PERMISSION_DENIED', 'authorize', 'OWNERSHIP_VIOLATION');
      // Revocation precedes replay (CONTRACT_RULES §5).
      if (this.#currentAccess) await this.#currentAccess(operation, request);
      const key = `${request.sessionRef}\0${operation}\0${request.requestId}`;
      const identity = canonicalJSON(request);
      const old = this.#replay.get(key);
      if (old) {
        if (old.identity !== identity) fault('REPLAY_MISMATCH', 'replay', 'PAYLOAD_CHANGED');
        return structuredClone(old.response);
      }
      validateBoundRequest(VERSION, operation, request);
      const handler = this.#operations?.[operation];
      if (typeof handler !== 'function') fault('CAPABILITY_UNAVAILABLE', 'validate', 'POLICY_UNAVAILABLE');
      handlerEntered = true;
      const result = await handler(request, proof);
      resultProduced = true;
      const response = validateResponse(VERSION, operation, {
        contractVersion: VERSION, requestId: request.requestId, result, error: null,
      });
      this.#replay.set(key, { identity, response });
      return structuredClone(response);
    } catch (thrown) {
      return { contractVersion: VERSION, requestId: request.requestId,
        result: null, error: publicFailure(thrown, operation, request, resultProduced,
          handlerEntered) };
    }
  }
}

export const worldAdapterV4Operations = Object.freeze([...allowed.keys()]);
