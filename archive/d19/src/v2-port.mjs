// Independent implementation of the approved public wire profile. No source
// or runtime dependency on the unpublished contracts checkout.
import canonicalize from 'canonicalize';
const VERSION = 'world-adapter/v2';
const common = ['contractVersion', 'actorRef', 'sessionRef', 'requestId', 'authorizationRef'];
const fields = {
  DiscoverConnections: [...common, 'adapterId'],
  ListWorlds: [...common, 'connectionRef'],
  AuthorizeBinding: [...common, 'worldRef', 'connectionRef', 'expectedCapabilityRevision'],
  InspectWorld: [...common, 'worldRef', 'expectedWorldRevision', 'sampledBounds'],
  PrepareRecoverableTransaction: [...common, 'worldRef', 'transactionId', 'operationDigest',
    'operations', 'authorizationBinding', 'expectedWorldRevision', 'expectedObjectRevisions', 'guarantee'],
  ApplyCompiledTransaction: [...common, 'worldRef', 'transactionId', 'expectedWorldRevision',
    'preparedTransaction', 'operations', 'operationDigest', 'authorizationBinding', 'guarantee'],
  Readback: [...common, 'worldRef', 'transactionId', 'coveredPositions', 'stateProfile'],
  QueryTransaction: [...common, 'worldRef', 'transactionId', 'transactionPayloadDigest'],
  RestoreTransaction: [...common, 'worldRef', 'originTransactionId', 'operationDigest',
    'beforeImageDigest', 'restoreAttemptIdentity', 'guarantee'],
};
const digestFields = new Set(['operationDigest', 'transactionPayloadDigest', 'beforeImageDigest']);
const objectFields = new Set(['sampledBounds', 'operations', 'authorizationBinding',
  'expectedObjectRevisions', 'preparedTransaction', 'coveredPositions', 'stateProfile']);
const authCodes = new Set(['PERMISSION_DENIED', 'AUTHORIZATION_REVOKED',
  'CONNECTION_UNAUTHORIZED', 'WORLD_NOT_BOUND', 'ACTION_NOT_AUTHORIZED']);
const validationCodes = new Set(['ADAPTER_UNAVAILABLE', 'CONNECTION_NOT_FOUND',
  'WORLD_NOT_FOUND', 'PAYLOAD_VERSION_MISMATCH', 'CAPABILITY_UNAVAILABLE',
  'STALE_REVISION', 'TARGET_FACTS_INCOMPLETE', 'LIMIT_EXCEEDED',
  'UNSUPPORTED_MUTATION_SEMANTICS', 'TRANSACTION_CONFLICT', 'STALE_TRANSACTION',
  'NON_CANONICAL_AMBIGUITY']);
const canvasOperations = new Set(['PrepareRecoverableTransaction',
  'ApplyCompiledTransaction', 'Readback', 'QueryTransaction']);
const postwriteCodes = new Map([
  ['APPLY_FAILED', 'apply'], ['READBACK_FAILED', 'readback'],
  ['READBACK_MISMATCH', 'readback'], ['RESTORE_FAILED', 'restore'],
  ['ROLLBACK_FAILED', 'restore'], ['RECOVERY_PENDING', 'restore'],
]);

function error(code, reason, phase = 'decode', transactionRef = null, causeCode = null) {
  const authorization = phase === 'authorize';
  const uncertain = ['apply', 'readback', 'restore'].includes(phase);
  return { code, phase, retryability: phase === 'restore' ? 'AFTER_MANUAL_RECOVERY' :
    uncertain ? 'SAME_TRANSACTION_QUERY' : authorization ? 'AFTER_NEW_AUTH' :
    phase === 'validate' ? 'AFTER_NEW_FACTS' : 'NEVER',
    mutationState: uncertain ? 'UNKNOWN' : 'NONE', transactionRef, causeCode, reason };
}
function pendingError(operation, request, causeCode = null) {
  const phase = operation === 'ApplyCompiledTransaction' ? 'apply' :
    operation === 'Readback' ? 'readback' :
    operation === 'RestoreTransaction' ? 'restore' : 'validate';
  return { code: 'RECOVERY_PENDING', phase,
    retryability: 'SAME_TRANSACTION_QUERY', mutationState: 'UNKNOWN',
    transactionRef: request?.transactionId ?? request?.originTransactionId ?? null,
    causeCode,
    reason: phase === 'restore' ? 'RESTORE_ERROR' : 'TRANSPORT_OUTCOME_UNKNOWN' };
}
function fault(code, reason, phase = 'decode') {
  const thrown = new Error(code);
  thrown.publicError = error(code, reason, phase);
  throw thrown;
}
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length)
    return false;
  return true;
}
function validTree(value) {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return [...value].every(character => {
    const cp = character.codePointAt(0);
    return cp < 0xd800 || cp > 0xdfff;
  });
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(validTree);
  return plain(value) && !Object.hasOwn(value, 'toJSON') && Object.values(value).every(validTree);
}
function exactShape(value, expected) {
  if (!plain(value)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  if (Object.keys(value).some(key => !expected.includes(key)))
    fault('UNKNOWN_REQUIRED_FIELD', 'UNKNOWN_FIELD');
  if (expected.some(key => !Object.hasOwn(value, key))) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}
function position(value) {
  if (!Array.isArray(value) || value.length !== 3 ||
      !value.every(Number.isSafeInteger)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}
function comparePosition(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}
function positions(value) {
  if (!Array.isArray(value)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  for (let index = 0; index < value.length; index++) {
    position(value[index]);
    if (index && comparePosition(value[index - 1], value[index]) >= 0)
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
}
function box(value) {
  exactShape(value, ['min', 'max']);
  position(value.min); position(value.max);
  if (value.min.some((n, i) => n > value.max[i])) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}
function operationProjection(value) {
  exactShape(value, ['contractVersion', 'buildDigest', 'compilerRevision',
    'compilationConfigDigest', 'worldRef', 'frameDigest', 'catalogueDigest',
    'targetFactsDigest', 'effects']);
  if (value.contractVersion !== 'operations/v2' ||
      !Array.isArray(value.effects) || !value.effects.length)
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  for (const key of ['buildDigest', 'compilationConfigDigest', 'frameDigest',
    'catalogueDigest', 'targetFactsDigest']) {
    if (typeof value[key] !== 'string' || !/^[0-9a-f]{64}$/.test(value[key]))
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  for (let index = 0; index < value.effects.length; index++) {
    const effect = value.effects[index];
    exactShape(effect, ['position', 'nodeName', 'param2']);
    position(effect.position);
    if (typeof effect.nodeName !== 'string' || !effect.nodeName ||
        !Number.isInteger(effect.param2) || effect.param2 < 0 || effect.param2 > 255)
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
    if (index && comparePosition(value.effects[index - 1].position, effect.position) >= 0)
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
}
function stateProfile(value) {
  exactShape(value, ['profileVersion', 'nodeFields', 'metadataMode',
    'inventoryMode', 'timerMode', 'derivedLightMode']);
  if (value.profileVersion !== 'state-profile/v2' ||
      JSON.stringify(value.nodeFields) !== '["nodeName","param1","param2"]' ||
      value.metadataMode !== 'exact' || value.inventoryMode !== 'exact' ||
      value.timerMode !== 'exact' || value.derivedLightMode !== 'recompute-with-readback')
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}
function authorizationBinding(value) {
  const expected = ['contractVersion', 'authorizerRef', 'actorRef', 'grantEpoch',
    'bindingRef', 'worldRef', 'sessionRef', 'turnRevision', 'intentDigest',
    'surfaceActionDigest', 'allowedAction', 'transactionId', 'operationDigest',
    'worldRevision', 'selectionRevision', 'analysisDigest', 'decisionRevision'];
  exactShape(value, expected);
  if (value.contractVersion !== VERSION) fault('UNSUPPORTED_VERSION', 'VERSION_UNSUPPORTED');
  for (const key of expected) {
    if (['analysisDigest', 'decisionRevision'].includes(key) && value[key] === null) continue;
    if (typeof value[key] !== 'string' || !value[key]) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  for (const key of ['intentDigest', 'surfaceActionDigest', 'operationDigest']) {
    if (!/^[0-9a-f]{64}$/.test(value[key])) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  if (value.analysisDigest !== null && !/^[0-9a-f]{64}$/.test(value.analysisDigest))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  if (!['READ', 'SELECT', 'NAME', 'RENAME', 'INSPECT', 'ANALYZE', 'DECIDE',
    'APPLY_RECOVERABLE', 'READBACK', 'UNDO', 'REDO', 'HISTORY'].includes(value.allowedAction))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}
function objectRevisions(value) {
  if (!plain(value)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  for (const [key, revision] of Object.entries(value)) {
    if (!key || typeof revision !== 'string' || !revision)
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
}
function preparedTransaction(value) {
  exactShape(value, ['payload', 'transactionPayloadDigest', 'beforeImageDigest',
    'guarantee', 'stateProfile', 'protectedPositions', 'adapterExecutionRevision']);
  exactShape(value.payload, ['contractVersion', 'transactionId', 'operationDigest',
    'authorizationBindingDigest', 'expectedWorldRevision',
    'expectedObjectRevisions', 'beforeImageDigest']);
  if (value.payload.contractVersion !== 'canvas/v2' ||
      value.guarantee !== 'RECOVERABLE_VERIFIED') fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  for (const digest of [value.transactionPayloadDigest, value.beforeImageDigest,
    value.payload.operationDigest, value.payload.authorizationBindingDigest,
    value.payload.beforeImageDigest]) {
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  for (const ref of [value.payload.transactionId, value.payload.expectedWorldRevision,
    value.adapterExecutionRevision]) {
    if (typeof ref !== 'string' || !ref) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  objectRevisions(value.payload.expectedObjectRevisions);
  stateProfile(value.stateProfile);
  positions(value.protectedPositions);
}

// Scan JSON strings before JSON.parse so decoded duplicate names cannot be
// silently collapsed. The scanner tracks each object scope, including nested
// values, and therefore rejects escaped-key aliases such as "a" and "\\u0061".
function rejectDuplicateKeys(raw) {
  let index = 0;
  const skip = () => { while (/\s/.test(raw[index] ?? '')) index++; };
  const string = () => {
    const begin = index++;
    while (index < raw.length) {
      if (raw[index] === '\\') { index += 2; continue; }
      if (raw[index++] === '"') return JSON.parse(raw.slice(begin, index));
    }
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  };
  const value = () => {
    skip();
    if (raw[index] === '{') {
      index++; skip(); const keys = new Set();
      if (raw[index] === '}') { index++; return; }
      while (index < raw.length) {
        if (raw[index] !== '"') fault('SCHEMA_INVALID', 'INVALID_SHAPE');
        const key = string();
        if (keys.has(key)) fault('NON_CANONICAL_AMBIGUITY', 'DUPLICATE_DECODED_KEY');
        keys.add(key); skip();
        if (raw[index++] !== ':') fault('SCHEMA_INVALID', 'INVALID_SHAPE');
        value(); skip();
        if (raw[index] === '}') { index++; return; }
        if (raw[index++] !== ',') fault('SCHEMA_INVALID', 'INVALID_SHAPE');
        skip();
      }
    } else if (raw[index] === '[') {
      index++; skip(); if (raw[index] === ']') { index++; return; }
      while (index < raw.length) {
        value(); skip();
        if (raw[index] === ']') { index++; return; }
        if (raw[index++] !== ',') fault('SCHEMA_INVALID', 'INVALID_SHAPE');
      }
    } else if (raw[index] === '"') string();
    else {
      const found = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(index));
      if (!found) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
      index += found[0].length;
    }
  };
  value(); skip();
  if (index !== raw.length) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
}

function decode(operation, raw) {
  if (!fields[operation]) fault('UNKNOWN_ACTION', 'INVALID_SHAPE');
  if (raw instanceof Uint8Array) {
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
    catch { fault('SCHEMA_INVALID', 'INVALID_UTF8'); }
  }
  let request = raw;
  if (typeof raw === 'string') {
    try { rejectDuplicateKeys(raw); request = JSON.parse(raw); }
    catch (thrown) { if (thrown.publicError) throw thrown; fault('SCHEMA_INVALID', 'INVALID_SHAPE'); }
  }
  if (!plain(request) || !validTree(request)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  if (request.contractVersion !== VERSION) fault('UNSUPPORTED_VERSION', 'VERSION_UNSUPPORTED');
  const declared = fields[operation];
  if (Object.keys(request).some(key => !declared.includes(key)))
    fault('UNKNOWN_REQUIRED_FIELD', 'UNKNOWN_FIELD');
  for (const key of declared) {
    const value = request[key];
    if (value === undefined || value === null) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
    if (objectFields.has(key)) {
      if (!plain(value) && !Array.isArray(value)) fault('SCHEMA_INVALID', 'INVALID_SHAPE');
    } else if (typeof value !== 'string' || !value ||
      (digestFields.has(key) && !/^[0-9a-f]{64}$/.test(value)))
      fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  }
  if (Object.hasOwn(request, 'guarantee') && request.guarantee !== 'RECOVERABLE_VERIFIED')
    fault('SCHEMA_INVALID', 'INVALID_SHAPE');
  if (request.sampledBounds) box(request.sampledBounds);
  if (request.coveredPositions) positions(request.coveredPositions);
  if (request.operations) operationProjection(request.operations);
  if (request.authorizationBinding) authorizationBinding(request.authorizationBinding);
  if (request.expectedObjectRevisions) objectRevisions(request.expectedObjectRevisions);
  if (request.preparedTransaction) preparedTransaction(request.preparedTransaction);
  if (request.stateProfile) stateProfile(request.stateProfile);
  return request;
}

function ref(value) {
  if (typeof value !== 'string' || !value) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
}
function digest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
}
function optional(value, check) { if (value !== null) check(value); }
function array(value, check) {
  if (!Array.isArray(value)) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  for (const item of value) check(item);
}
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
}
function inventory(value) {
  exact(value, ['capabilityRevision', 'connections']); ref(value.capabilityRevision);
  if (!Array.isArray(value.connections)) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  for (const row of value.connections) {
    exact(row, ['adapterId', 'connectionRef', 'worldRef', 'displayName',
      'capabilityRevision', 'payloadVersion', 'readiness']);
    for (const key of ['adapterId', 'connectionRef', 'worldRef', 'displayName',
      'capabilityRevision', 'payloadVersion']) ref(row[key]);
    if (!['READY', 'ADAPTER_UNAVAILABLE', 'CONNECTION_UNAUTHORIZED',
      'PAYLOAD_VERSION_MISMATCH', 'CAPABILITY_UNAVAILABLE'].includes(row.readiness))
      fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  }
}
function receipt(value) {
  exact(value, ['contractVersion', 'transactionId', 'operationDigest',
    'transactionPayloadDigest', 'status', 'previousWorldRevision',
    'observedWorldRevision', 'readbackDigest', 'restoreStatus', 'error']);
  if (value.contractVersion !== 'canvas/v2') fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  ref(value.transactionId); digest(value.operationDigest); digest(value.transactionPayloadDigest);
  ref(value.previousWorldRevision); optional(value.observedWorldRevision, ref);
  optional(value.readbackDigest, digest);
  if (!['APPLIED_PENDING_READBACK', 'VERIFIED_PENDING_HISTORY', 'VERIFIED',
    'ROLLED_BACK', 'RESTORE_FAILED', 'RECOVERY_PENDING', 'REJECTED'].includes(value.status) ||
    !['NOT_REQUIRED', 'RESTORING', 'VERIFIED_RESTORED', 'FAILED', 'UNKNOWN'].includes(value.restoreStatus))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  optional(value.error, publicErrorShape);
}
function publicErrorShape(value) {
  exact(value, ['code', 'phase', 'retryability', 'mutationState', 'transactionRef',
    'causeCode', 'reason']);
  for (const key of ['code', 'phase', 'retryability', 'mutationState', 'reason']) ref(value[key]);
  optional(value.transactionRef, ref); optional(value.causeCode, ref);
  if (!['decode', 'authorize', 'replay', 'validate', 'apply', 'readback',
    'restore', 'persist'].includes(value.phase) ||
    !['NEVER', 'AFTER_NEW_AUTH', 'AFTER_NEW_FACTS', 'SAME_TRANSACTION_QUERY',
      'AFTER_MANUAL_RECOVERY'].includes(value.retryability) ||
    !['NONE', 'VERIFIED', 'ROLLED_BACK', 'PARTIAL', 'UNKNOWN'].includes(value.mutationState))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
}
function targetFacts(value) {
  exact(value, ['profileVersion', 'source', 'worldRef', 'objectRef', 'worldRevision',
    'objectRevision', 'buildDigest', 'planRevision', 'catalogueDigest', 'frameDigest',
    'sampledBounds', 'coverageDigest', 'occupiedCells', 'knownEmptyCells',
    'unknownCells', 'portals', 'usableVolume']);
  if (value.profileVersion !== 'target-facts/v2' || value.source !== 'INSPECTED' ||
      value.buildDigest !== null || value.planRevision !== null)
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  for (const key of ['worldRef', 'objectRef', 'worldRevision', 'objectRevision']) ref(value[key]);
  for (const key of ['catalogueDigest', 'frameDigest', 'coverageDigest']) digest(value[key]);
  box(value.sampledBounds); positions(value.knownEmptyCells);
  if (!Array.isArray(value.occupiedCells) || !Array.isArray(value.unknownCells) ||
      !Array.isArray(value.portals)) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  for (const cell of value.occupiedCells) {
    exact(cell, ['position', 'nodeName', 'param2']); position(cell.position); ref(cell.nodeName);
    if (cell.nodeName === 'air' || !Number.isInteger(cell.param2) || cell.param2 < 0 ||
        cell.param2 > 255) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  }
  for (const cell of value.unknownCells) {
    exact(cell, ['position', 'reason']); position(cell.position);
    if (!['UNLOADED', 'IGNORE', 'READ_FAILED'].includes(cell.reason))
      fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  }
  const keys = [...value.occupiedCells.map(cell => cell.position),
    ...value.knownEmptyCells, ...value.unknownCells.map(cell => cell.position)]
    .map(cell => cell.join(','));
  const volume = value.sampledBounds.max.reduce((count, max, i) =>
    count * (BigInt(max) - BigInt(value.sampledBounds.min[i]) + 1n), 1n);
  if (BigInt(keys.length) !== volume || new Set(keys).size !== keys.length ||
      [...value.occupiedCells.map(cell => cell.position), ...value.knownEmptyCells,
        ...value.unknownCells.map(cell => cell.position)].some(cell => cell.some((n, i) =>
        n < value.sampledBounds.min[i] || n > value.sampledBounds.max[i])))
    fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  for (const portal of value.portals) {
    exact(portal, ['portalRef', 'positions']); ref(portal.portalRef); positions(portal.positions);
    if (!portal.positions.length) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
  }
  if (value.usableVolume !== null) {
    exact(value.usableVolume, ['emptyCellCount', 'physicalVolume', 'standingArea', 'unit']);
    if (!Number.isSafeInteger(value.usableVolume.emptyCellCount) ||
        value.usableVolume.emptyCellCount < 0) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    for (const key of ['physicalVolume', 'standingArea'])
      optional(value.usableVolume[key], x => {
        if (!Number.isFinite(x) || x < 0) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      });
    ref(value.usableVolume.unit);
  }
}
function validateResult(operation, value) {
  if (operation === 'DiscoverConnections' || operation === 'ListWorlds') return inventory(value);
  if (operation === 'AuthorizeBinding') {
    exact(value, ['connectionRef', 'worldRef', 'payloadVersion', 'payloadDigest',
      'binding', 'capabilities']);
    for (const key of ['connectionRef', 'worldRef', 'payloadVersion']) ref(value[key]);
    digest(value.payloadDigest);
    if (value.binding !== null) {
      exact(value.binding, ['authorizerRef', 'actorRef', 'bindingRef', 'worldRef',
        'grantEpoch', 'allowedActions']);
      for (const key of ['authorizerRef', 'actorRef', 'bindingRef', 'worldRef', 'grantEpoch'])
        ref(value.binding[key]);
      if (!Array.isArray(value.binding.allowedActions) ||
          !value.binding.allowedActions.every(x => typeof x === 'string' && x) ||
          value.binding.allowedActions.some((x, i) => i && value.binding.allowedActions[i - 1] >= x))
        fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    }
    exact(value.capabilities, ['providerRef', 'capabilityRevision', 'worldRef',
      'engineBounds', 'limits', 'recoveryGuarantee', 'stateProfile',
      'regionProtectionWriters', 'sessionDeleteSupported', 'imageMediaTypes', 'model']);
    const c = value.capabilities;
    ref(c.providerRef); ref(c.capabilityRevision); optional(c.worldRef, ref);
    optional(c.engineBounds, box); optional(c.stateProfile, stateProfile);
    optional(c.recoveryGuarantee, guarantee => {
      if (guarantee !== 'RECOVERABLE_VERIFIED')
        fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    });
    optional(c.model, ref);
    if (typeof c.sessionDeleteSupported !== 'boolean')
      fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    array(c.regionProtectionWriters, ref);
    array(c.imageMediaTypes, ref);
    array(c.limits, item => {
      exact(item, ['limitKind', 'actual', 'limit', 'source', 'sourceRevision']);
      ref(item.limitKind); ref(item.source); ref(item.sourceRevision);
      if (!Number.isSafeInteger(item.actual) || item.actual < 0 ||
          !Number.isSafeInteger(item.limit) || item.limit < 0)
        fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    });
    return;
  }
  if (operation === 'InspectWorld') return targetFacts(value);
  if (operation === 'PrepareRecoverableTransaction') return preparedTransaction(value);
  if (operation === 'Readback') {
    exact(value, ['projection', 'readbackDigest', 'adapterExecutionRevision']);
    digest(value.readbackDigest); ref(value.adapterExecutionRevision);
    exact(value.projection, ['worldRef', 'coveredPositions', 'records', 'stateProfile']);
    ref(value.projection.worldRef); positions(value.projection.coveredPositions);
    stateProfile(value.projection.stateProfile);
    if (!Array.isArray(value.projection.records) ||
        value.projection.records.length !== value.projection.coveredPositions.length)
      fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
    value.projection.records.forEach((record, index) => {
      exact(record, ['position', 'nodeName', 'param1', 'param2',
        'metadata', 'inventory', 'timer']);
      position(record.position);
      if (comparePosition(record.position, value.projection.coveredPositions[index]) !== 0)
        fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      ref(record.nodeName);
      for (const key of ['param1', 'param2'])
        if (!Number.isInteger(record[key]) || record[key] < 0 || record[key] > 255)
          fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      if (!plain(record.metadata) || !plain(record.inventory) ||
          Object.values(record.metadata).some(x => typeof x !== 'string') ||
          Object.values(record.inventory).some(slots => !Array.isArray(slots) ||
            slots.some(item => typeof item !== 'string')))
        fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      optional(record.timer, timer => {
        exact(timer, ['timeout', 'elapsed']);
        if (!Number.isFinite(timer.timeout) || timer.timeout < 0 ||
            !Number.isFinite(timer.elapsed) || timer.elapsed < 0)
          fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      });
    });
    return;
  }
  return receipt(value);
}

/** A DSH provider surface; all authority and engine operations are host services. */
export class WorldAdapterV2 {
  #authority;
  #operations;
  #replay = new Map();
  constructor({ authority, operations } = {}) {
    this.#authority = authority;
    this.#operations = operations;
  }
  async call(operation, raw) {
    let request;
    let validatingResult = false;
    try {
      request = decode(operation, raw); // P0: before any host query.
      const verify = operation === 'RestoreTransaction'
        ? this.#authority?.verifyService : this.#authority?.verify;
      if (typeof verify !== 'function')
        fault('PERMISSION_DENIED', 'IDENTITY_UNVERIFIED', 'authorize');
      const proof = await verify.call(this.#authority, request, operation); // P1: current every time.
      if (!proof?.current || proof.actorRef !== request.actorRef ||
          proof.sessionRef !== request.sessionRef ||
          proof.authorizationRef !== request.authorizationRef)
        fault('AUTHORIZATION_REVOKED', 'GRANT_REVOKED', 'authorize');
      if (canvasOperations.has(operation) && proof.domainOwner !== 'hanaworlds-canvas')
        fault('PERMISSION_DENIED', 'OWNERSHIP_VIOLATION', 'authorize');
      const key = `${request.sessionRef}\u0000${operation}\u0000${request.requestId}`;
      const identity = canonicalize(request);
      const previous = this.#replay.get(key);
      if (previous) {
        if (previous.identity !== identity) fault('REPLAY_MISMATCH', 'PAYLOAD_CHANGED', 'replay');
        return structuredClone(previous.response);
      }
      if (typeof this.#operations?.[operation] !== 'function')
        fault('ADAPTER_UNAVAILABLE', 'POLICY_UNAVAILABLE', 'validate');
      const result = await this.#operations[operation](request, proof);
      validatingResult = true;
      if (!plain(result) || !validTree(result)) fault('SCHEMA_INVALID', 'INVALID_SHAPE', 'validate');
      validateResult(operation, result);
      validatingResult = false;
      const response = { contractVersion: VERSION, requestId: request.requestId, result, error: null };
      this.#replay.set(key, { identity, response: structuredClone(response) });
      return response;
    } catch (thrown) {
      const known = thrown.publicError;
      const code = typeof thrown.message === 'string' ? thrown.message : '';
      const mayHaveMutated = ['ApplyCompiledTransaction', 'Readback',
        'RestoreTransaction'].includes(operation);
      const publicError = validatingResult && mayHaveMutated
        ? pendingError(operation, request, 'SCHEMA_INVALID') : known ?? (
        code === 'RECOVERY_PENDING' ? pendingError(operation, request) :
        postwriteCodes.has(code) ? {
        ...error(code, postwriteCodes.get(code) === 'readback' ? 'READBACK_ERROR' :
          postwriteCodes.get(code) === 'restore' ? 'RESTORE_ERROR' : 'APPLY_ERROR',
        postwriteCodes.get(code), request?.transactionId ?? request?.originTransactionId ?? null),
        mutationState: 'UNKNOWN',
      } : authCodes.has(code) ? error(code,
        code === 'AUTHORIZATION_REVOKED' ? 'GRANT_REVOKED' : 'SCOPE_DENIED', 'authorize') :
        validationCodes.has(code) ? error(code,
          code === 'PAYLOAD_VERSION_MISMATCH' || code === 'NON_CANONICAL_AMBIGUITY' ?
            'PAYLOAD_CHANGED' :
          code === 'STALE_REVISION' ? 'REVISION_CHANGED' :
          code === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' : 'POLICY_UNAVAILABLE', 'validate') :
        error('ADAPTER_UNAVAILABLE', 'POLICY_UNAVAILABLE', 'validate'));
      return { contractVersion: VERSION, requestId: request?.requestId ?? null,
        result: null, error: publicError };
    }
  }
}

export const worldAdapterOperations = Object.freeze(Object.keys(fields));
