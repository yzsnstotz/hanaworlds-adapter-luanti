/** PURE FIXTURE MODEL ONLY.
 * Synthetic auth/durability/world observations are test assumptions, not actual
 * verifier results. worldWrites in an oracle is the MODELLED count; this module
 * cannot perform a provider query, write, store, grant, transport or event emit.
 * No case IDs or expected-outcome objects are inputs to the evaluator. */
import { validateType, validateRequest, digestValue, validateDigestBinding, decodeRawJSON,
  canonicalJSON, ownership, wireVersions, boxCellCount, normalizeName, validateCanvasEvent,
  snapshotJSON, validateStaticMaterials } from './runtime.mjs';
import { ContractError, publicError, fail, requireFact } from './errors.mjs';
import { assertBox, comparePosition, inside } from './geometry.mjs';
const utf8 = text => new TextEncoder().encode(text);
const reject = (code, phase, reason, extras = {}) => ({ result: 'REJECT', code, phase, reason, mutationState: 'NONE', worldWrites: 0, ...extras });
const fromError = (error, extras = {}) => ({ result: 'REJECT', ...publicError(error), worldWrites: 0, ...extras });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fixtureContext(context) {
  if (context && context.evidence !== 'FIXTURE') throw new TypeError('This API only accepts explicit FIXTURE context');
}
function findAsset(list, ref) {
  const value = list.find(x => x.id === ref);
  if (!value) throw new TypeError('Required explicit fixture asset is missing');
  return value;
}
export function evaluateClosureFixture(wire, dimension, inputValue, assets) {
  const input = snapshotJSON(inputValue); fixtureContext(input.context);
  const writes = { worldWrites: 0 };
  switch (dimension) {
    case 'operation-fields': {
      const item = findAsset(assets.requests, input.requestRef);
      try { validateRequest(wire, item.operation, { ...item.request, ...input.requestPatch }); return { result: 'ACCEPT_SCHEMA', providerQueries: 0, ...writes }; }
      catch (error) { return fromError(error, { providerQueries: 0 }); }
    }
    case 'canonical-digest': {
      const golden = findAsset(assets.goldens, input.goldenRef);
      try {
        const actual = validateDigestBinding(golden.kind, { ...golden.payload, ...(input.projectionPatch ?? {}) }, input.providedDigest);
        return { result: 'DIGEST_MATCH', sha256: actual.sha256, ...writes };
      } catch (error) { return fromError(error); }
    }
    case 'limits-policy': {
      const cap = input.providerCapability;
      if (!input.requiredFactsKnown || !cap || cap.limit === null) return reject('CAPABILITY_UNAVAILABLE', 'validate', 'POLICY_UNAVAILABLE');
      if (input.actual > cap.limit) return reject(['session/v2','painter/v2','ReferenceBrief/v2'].includes(wire) && cap.limitKind === 'BYTES' ? 'MEDIA_TOO_LARGE' : 'LIMIT_EXCEEDED', 'validate', 'LIMIT_EXCEEDED', { actual: input.actual, limit: cap.limit, source: cap.source, truncated: false });
      return { result: 'CAPABILITY_WITHIN_LIMIT', source: cap.source, actual: input.actual, limit: cap.limit, ...writes };
    }
    case 'authorization-replay-revocation': {
      const context = input.context;
      if (context.revoked) return reject('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED', { objectQueries: 0, receiptReturned: false });
      if (!context.authVerified || !input.nativeVerifierBound) return reject('CONNECTION_UNAUTHORIZED', 'authorize', 'IDENTITY_UNVERIFIED', { objectQueries: 0, receiptReturned: false });
      const record = context.receiptRecord;
      if (record && record.payloadDigest !== input.payloadDigest) return reject('REPLAY_MISMATCH', 'replay', 'PAYLOAD_CHANGED');
      if (record?.terminal) return { result: 'RETURN_ORIGINAL_RECEIPT', receiptDigest: record.receiptDigest, reapplied: false, ...writes };
      return { result: 'SAME_TRANSACTION_QUERY', newTransaction: false, ...writes };
    }
    case 'effect-recovery': {
      if (input.restoreFailure) {
        return reject('RESTORE_FAILED', 'restore', 'RESTORE_ERROR', { causeCode: input.applyFailure,
          mutationState: input.observedChangedPositions?.length ? 'PARTIAL' : 'UNKNOWN', linkedHeadsMoved: false, rangeHeld: true, productSuccess: false, worldWrites: 1 });
      }
      if (input.sequence) {
        if (input.guarantee !== 'RECOVERABLE_VERIFIED') return reject('UNSUPPORTED_VERSION', 'decode', 'VERSION_UNSUPPORTED');
        if (!input.durableBeforeWrite || !input.allTouchedStateSupported) return reject('CAPABILITY_UNAVAILABLE', 'validate', 'UNSUPPORTED_STATE_COVERAGE');
        const stages = ['PREPARED','APPLYING','APPLIED_PENDING_READBACK','VERIFIED_PENDING_HISTORY','VERIFIED'];
        if (!equal(input.sequence, stages)) return reject('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
        if (!input.fullReadbackMatched || !input.linkedHistoryDurable) return { result: 'VERIFIED_PENDING_HISTORY', productSuccess: false, worldWrites: 1 };
        return { result: 'VERIFIED', guarantee: input.guarantee, receiptStatus: 'VERIFIED', mutationState: 'VERIFIED', historyDurable: true, productSuccess: true, worldWrites: 1 };
      }
      if (input.attemptWorldMutation || input.ownerRef !== ownership[wire].domainOwner) return reject('PERMISSION_DENIED', 'authorize', 'OWNERSHIP_VIOLATION');
      if (!input.domainResultValidated) return reject('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
      return { result: 'DOMAIN_RESULT_ONLY', productSuccess: 'owner-domain-only', ...writes };
    }
    case 'retention': {
      if (input.operation === 'DeleteSession' && !input.hostTrueDeleteSupported) return reject('SESSION_DELETE_UNSUPPORTED', 'validate', 'DELETE_SEAM_ABSENT', { deleted: false, archiveNotDeletion: true });
      if (!input.requiredResourceBytesPresent || !input.resourcesDurable || !input.manifestDurable || input.oldSessionReadRequired) return reject('SAVED_RESOURCE_UNAVAILABLE', 'validate', 'RESOURCE_MISSING', { saved: false });
      if (input.persistAllChat || input.stage2LibraryRequired) return reject('PERMISSION_DENIED', 'authorize', 'OWNERSHIP_VIOLATION');
      return { result: 'REOPEN_EXISTING_ARTIFACT', artifactRef: input.existingArtifactRef, oldSessionReadRequired: false, buildAndHistoryRetained: true, ...writes };
    }
    case 'errors-precedence': {
      try { decodeRawJSON(utf8(input.rawJson)); } catch (error) { return fromError(error, { authQueries: 0, objectQueries: 0 }); }
      // shapeValid here is an explicit fixture assumption, NOT raw admission.
      if (!input.shapeValid) return reject('SCHEMA_INVALID', 'decode', 'INVALID_SHAPE', { authQueries: 0, objectQueries: 0 });
      if (input.revoked) return reject('AUTHORIZATION_REVOKED', 'authorize', 'GRANT_REVOKED', { objectQueries: 0 });
      if (!input.authVerified) return reject('CONNECTION_UNAUTHORIZED', 'authorize', 'IDENTITY_UNVERIFIED', { objectQueries: 0 });
      if (input.existingTerminalTx && !input.payloadMatches) return reject('REPLAY_MISMATCH', 'replay', 'PAYLOAD_CHANGED');
      if (input.existingTerminalTx && input.payloadMatches) {
        const receipt = assets.goldens.find(x => x.kind === 'receipt');
        return { result: 'RETURN_ORIGINAL_RECEIPT', chosenPhase: 'replay', receiptDigest: digestValue('receipt', receipt.payload).sha256, ...writes };
      }
      if (input.currentWorldRevisionChanged) return reject('STALE_REVISION', 'validate', 'REVISION_CHANGED');
      return { result: 'DOMAIN_VALIDATION_REQUIRED', ...writes };
    }
    case 'privacy': {
      try { validateType('Error', input.publicError); return { result: 'PUBLIC_ERROR_VALID', secretProjected: false, ...writes }; }
      catch (error) { return fromError(error, { secretProjected: false }); }
    }
    case 'compatibility': {
      if (!wireVersions.includes(input.consumerWire) || input.consumerWire !== input.providerWire || input.compiledOperationsVersion !== 'operations/v2' || input.guarantee !== 'RECOVERABLE_VERIFIED') return reject('UNSUPPORTED_VERSION', 'decode', 'VERSION_UNSUPPORTED', { fallback: false });
      return { result: 'HANDSHAKE_VERSION_MATCH', ...writes };
    }
    case 'ownership': {
      const allowed = ownership[wire];
      if (!allowed || input.domainOwner !== allowed.domainOwner || input.mutationCaller !== allowed.mutationCaller || input.dependencyType !== 'public-versioned-contract' || input.stage2Dependency) return reject('PERMISSION_DENIED', 'authorize', 'OWNERSHIP_VIOLATION');
      return { result: 'OWNERSHIP_MATCH', ...writes };
    }
    default: throw new TypeError('Unknown frozen closure dimension');
  }
}
export function evaluateCanvasEventFixture(typeName, input) {
  try {
    validateCanvasEvent(typeName, input);
    return { result: 'EVENT_INPUT_VALID', worldWrites: 0,
      // Modelled oracle outcome only; a valid event object is NOT provider proof.
      productSuccess: ['TransactionVerified','HistoryPositionChanged'].includes(typeName),
      ...(typeName === 'TransactionAppliedPendingReadback' ? { stage: input.receipt.result.status, historyHeadsMoved: false } : {}),
      ...(typeName === 'ObjectInspectionInvalidated' ? { snapshotValid: false, snapshotRole: 'PRIOR_INSPECTED_SNAPSHOT_NOW_INVALID' } : {}) };
  } catch (error) { return { result: 'REJECT_EVENT_INPUT', ...publicError(error), worldWrites: 0, eventEmitted: false }; }
}
/** An observed-change predicate, never an event emitter. Queries alone fail it. */
export function eventTransitionEligible(typeName, input, facts) {
  fixtureContext(facts); validateCanvasEvent(typeName, input);
  const querySignals = ['WorldConnectionInventoryChanged','ObjectInventoryChanged','HistoryInventoryChanged'];
  if (querySignals.includes(typeName)) return facts.actualDurableChange === true;
  if (typeName === 'ObjectInspectionInvalidated') return facts.priorSnapshotWasValid === true && facts.observedWorldRevision === input.newWorldRevision;
  if (['WorldConnectionSelectionChanged','ActiveWorldChanged','ObjectNameChanged','ActiveObjectSelectionReplaced'].includes(typeName)) return facts.actualDurableChange === true;
  if (typeName === 'ObjectCreated') return facts.verifiedCreatingTransaction === true && facts.durableRegistration === true;
  if (typeName === 'TransactionVerified' || typeName === 'HistoryPositionChanged') return facts.fullReadbackMatched === true && facts.linkedHistoryDurable === true;
  if (typeName === 'TransactionAppliedPendingReadback') return facts.actualApplyReachedPendingReadback === true;
  if (typeName === 'AffectedObjectAnalysisReady') return facts.completeAtBoundRevisions === true;
  if (typeName === 'AffectedObjectNotificationRequired') return facts.completeAtBoundRevisions === true && facts.nonSelectedAffectedObjects === true;
  return false;
}
/** Pure fixture expansion only, not a production Brush/compiler/provider. */
export function compileFixtureEffects(operations, materials) {
  validateType('BuildOps', operations); validateType('MaterialMap', materials);
  const effects = new Map();
  for (const op of operations) {
    requireFact(Object.hasOwn(materials, op.materialRef), 'CATALOGUE_MISMATCH', 'CATALOGUE_UNRESOLVED');
    for (let x = BigInt(op.min[0]); x <= BigInt(op.max[0]); x++) for (let y = BigInt(op.min[1]); y <= BigInt(op.max[1]); y++) for (let z = BigInt(op.min[2]); z <= BigInt(op.max[2]); z++) {
      const position = [Number(x), Number(y), Number(z)];
      effects.set(JSON.stringify(position), { position, ...materials[op.materialRef] });
    }
  }
  return [...effects.values()].sort((a, b) => comparePosition(a.position, b.position));
}
/** Semantic fixture evaluators dispatch by the supplied fact shape rather than
 * a fixture id or its expected object. The test passes only input. */
export function evaluateSemanticFixture(value) {
  const i = snapshotJSON(value); const none = { worldWrites: 0 };
  if (Object.hasOwn(i, 'rawBytesHex') || Object.hasOwn(i, 'rawJson')) {
    try { return { decoded: decodeRawJSON(i.rawBytesHex ? Buffer.from(i.rawBytesHex, 'hex') : utf8(i.rawJson)), ...none }; }
    catch (error) { return { ...publicError(error), providerQueries: 0, ...none }; }
  }
  if (i.rawJsonA !== undefined) {
    const a = canonicalJSON(decodeRawJSON(utf8(i.rawJsonA))), b = canonicalJSON(decodeRawJSON(utf8(i.rawJsonB)));
    return { canonicalUtf8: a, equal: a === b };
  }
  if (i.a !== undefined && i.b !== undefined) {
    const out = { jcsEqual: canonicalJSON(i.a) === canonicalJSON(i.b) };
    if (typeof i.a === 'string') out.nameComparisonEqual = normalizeName(i.a).comparisonKey === normalizeName(i.b).comparisonKey;
    return out;
  }
  if (i.operations && i.materials) return { result: 'COMPILE', effects: compileFixtureEffects(i.operations, i.materials), ...none };
  if (i.operation && typeof i.operation === 'object') {
    try { validateType('SetBox', i.operation); return { result: 'GEOMETRY_VALID', ...none }; }
    catch (error) { return { ...publicError(error), rounded: false, ...none }; }
  }
  if (i.min && i.max) {
    const exactCellCountDecimal = boxCellCount({ min: i.min, max: i.max }).toString();
    return !i.actualEngineBoundsAllows ? { exactCellCountDecimal, code: 'LIMIT_EXCEEDED', reason: 'LIMIT_EXCEEDED', source: 'FIXTURE-engine-bounds', mutationState: 'NONE', ...none } : { exactCellCountDecimal, ...none };
  }
  if (i.catalogueNodes) return !i.catalogueNodes.includes(i.nodeName) ? { code: 'CATALOGUE_MISMATCH', phase: 'validate', reason: 'CATALOGUE_UNRESOLVED', mutationState: 'NONE', guessed: false, ...none } : { resolved: i.nodeName, ...none };
  if (i.allowedParam2) return i.param2 === null || !i.allowedParam2.includes(i.param2) ? { code: 'UNSUPPORTED_MUTATION_SEMANTICS', phase: 'validate', reason: 'REQUIRED_FACT_UNKNOWN', mutationState: 'NONE', ...none } : { resolved: true, ...none };
  if (Object.hasOwn(i, 'bindingFromNativeVerifier')) return !i.bindingFromNativeVerifier ? { code: 'CONNECTION_UNAUTHORIZED', phase: 'authorize', reason: 'IDENTITY_UNVERIFIED', mutationState: 'NONE', ...none } : { authorizedFixture: true, ...none };
  if (i.recordPayloadDigest) {
    if (i.revoked) return { code: 'AUTHORIZATION_REVOKED', phase: 'authorize', reason: 'GRANT_REVOKED', mutationState: 'NONE', ...none };
    if (!i.authVerified) return { code: 'CONNECTION_UNAUTHORIZED', phase: 'authorize', reason: 'IDENTITY_UNVERIFIED', mutationState: 'NONE', ...none };
    return i.recordPayloadDigest !== i.requestPayloadDigest ? { code: 'REPLAY_MISMATCH', phase: 'replay', reason: 'PAYLOAD_CHANGED', mutationState: 'NONE', ...none } : { returnOriginal: true, ...none };
  }
  if (i.effectPositions) {
    const protectedSet = new Set(i.protectedPositions.map(p => JSON.stringify(p)));
    return i.effectPositions.some(p => protectedSet.has(JSON.stringify(p))) ? { code: 'PERMISSION_DENIED', phase: 'authorize', reason: 'SCOPE_DENIED', mutationState: 'NONE', ...none } : { perCellClear: true, ...none };
  }
  if (Object.hasOwn(i, 'durableBarrierProven')) return !i.durableBarrierProven ? { code: 'CAPABILITY_UNAVAILABLE', phase: 'validate', reason: 'UNSUPPORTED_STATE_COVERAGE', mutationState: 'NONE', ...none } : { preparedFixture: true, ...none };
  if (i.beforeImageRecord) return !equal(i.beforeImageRecord.timer, i.actualTimer) ? { code: 'UNSUPPORTED_MUTATION_SEMANTICS', phase: 'validate', reason: 'UNSUPPORTED_STATE_COVERAGE', mutationState: 'NONE', ...none } : { stateCovered: true, ...none };
  if (i.transportTimedOut) return { code: 'RECOVERY_PENDING', phase: 'apply', reason: 'TRANSPORT_OUTCOME_UNKNOWN', mutationState: 'UNKNOWN', retryability: 'SAME_TRANSACTION_QUERY', newTransaction: false, rangeHeld: true, productSuccess: false };
  if (i.expectedAfterReadbackDigest || i.expectedBeforeReadbackDigest) {
    const undo = Object.hasOwn(i, 'expectedAfterReadbackDigest'); const direction = undo ? 'UNDO' : 'REDO';
    const expected = undo ? i.expectedAfterReadbackDigest : i.expectedBeforeReadbackDigest;
    if (expected === i.currentReadbackDigest) return { matchedFixture: true, ...none };
    return { code: direction + '_CONFLICT', phase: 'validate', mutationState: 'NONE', ...none, headsMoved: false,
      ...(undo ? { proposal: { sessionRef: i.sessionRef, direction, choices: ['CANCEL','CREATE_REVISED_INTENT'] } } : { proposalRequired: true }) };
  }
  if (Object.hasOwn(i, 'linkedHistoryDurable')) return i.fullReadbackMatched && !i.linkedHistoryDurable ? { status: 'VERIFIED_PENDING_HISTORY', phase: 'persist', mutationState: 'VERIFIED', productSuccess: false, restartAction: 'finish same tx history, no world reapply' } : { status: 'VERIFIED', productSuccess: !!i.linkedHistoryDurable };
  if (Object.hasOwn(i, 'sessionHasReference')) {
    if (!i.sessionHasReference) return { code: 'MEDIA_BINDING_INVALID', phase: 'authorize', reason: 'MEDIA_NOT_REFERENCED', corruptionDetailExposed: false, modelRequests: 0, ...none };
    if (i.storedDigestMatches === false) return { code: 'MEDIA_DIGEST_MISMATCH', phase: 'validate', reason: 'MEDIA_CORRUPT', textOnlyFallback: false, modelRequests: 0, ...none };
    return { authorizedFixture: true, ...none };
  }
  if (Object.hasOwn(i, 'projectionVariantId')) return (i.projectionVariantId === null) !== (i.projectionBytesDigest === null) ? { code: 'SCHEMA_INVALID', phase: 'validate', reason: 'INVALID_SHAPE', modelRequests: 0, ...none } : { bindingShapeValid: true, ...none };
  if (Object.hasOwn(i, 'requiredResourceBytesPresent')) return !i.requiredResourceBytesPresent || i.oldSessionReadRequired ? { code: 'SAVED_RESOURCE_UNAVAILABLE', phase: 'validate', reason: 'RESOURCE_MISSING', saved: false, ...none } : { retained: true, ...none };
  if (Object.hasOwn(i, 'publicTrueDeleteSupported')) return !i.publicTrueDeleteSupported ? { code: 'SESSION_DELETE_UNSUPPORTED', phase: 'validate', reason: 'DELETE_SEAM_ABSENT', deleted: false, ...none } : { hostSeamRequired: true, ...none };
  if (i.unknownCells) return i.operation === 'MODIFY_INTERIOR' && i.unknownCells.length ? { code: 'TARGET_FACTS_INCOMPLETE', phase: 'validate', reason: 'REQUIRED_FACT_UNKNOWN', usableVolume: null, ...none } : { factsCompleteFixture: true, ...none };
  if (i.readSucceeded !== undefined) {
    const empty = i.readSucceeded && i.nodeName === 'air';
    return { occupancy: !i.readSucceeded || i.nodeName === 'ignore' ? 'UNKNOWN' : empty ? 'KNOWN_EMPTY' : 'OCCUPIED', knownEmpty: empty };
  }
  if (i.source === 'PLANNED' && i.objectAlreadyInWorld && i.operation === 'MODIFY_INTERIOR') return { code: 'TARGET_FACTS_STALE', phase: 'validate', reason: 'REVISION_CHANGED', mutationState: 'NONE', ...none };
  if (i.restoreFailure) return { code: 'RESTORE_FAILED', causeCode: i.applyFailure, phase: 'restore', retryability: 'AFTER_MANUAL_RECOVERY', mutationState: i.knownChanges ? 'PARTIAL' : 'UNKNOWN', reason: 'RESTORE_ERROR', productSuccess: false };
  if (i.objectRefs) {
    if (!i.authorized) return { code: 'PERMISSION_DENIED', phase: 'authorize', mutationState: 'NONE', selectedObjectRefs: i.oldSelection, selectionRevisionChanged: false };
    if (new Set(i.objectRefs).size !== i.objectRefs.length) return { code: 'DUPLICATE_OBJECT_REF', phase: 'validate', mutationState: 'NONE', selectedObjectRefs: i.oldSelection, selectionRevisionChanged: false };
    if (i.existingRefs && i.objectRefs.some(ref => !i.existingRefs.includes(ref))) return { code: 'OBJECT_NOT_FOUND', phase: 'validate', mutationState: 'NONE', selectedObjectRefs: i.oldSelection, selectionRevisionChanged: false };
    return { selectedObjectRefs: i.objectRefs, implicitToggle: false };
  }
  if (i.refs) return { distinctCount: new Set(i.refs).size, normalizationApplied: false };
  if (i.names) {
    const keys = i.names.map(n => normalizeName(n).comparisonKey), successes = new Set(keys).size;
    return { successCount: successes, failureCount: keys.length - successes, failureCode: 'OBJECT_NAME_CONFLICT', stableIdentityPreserved: true };
  }
  if (Object.hasOwn(i, 'requiredAvatarDimensions')) return i.requiredAvatarDimensions === null || i.requiredDamagePolicy === null ? { code: 'CAPABILITY_UNAVAILABLE', phase: 'validate', reason: 'POLICY_UNAVAILABLE', mutationState: 'NONE', fallbackUsed: false, ...none } : { policyKnownFixture: true, ...none };
  throw new TypeError('No supported semantic fixture fact shape');
}
