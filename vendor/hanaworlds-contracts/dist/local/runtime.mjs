import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { contractMetadata, schemaBundle } from './generated/contracts.mjs';
import { snapshotJSON, deepFreeze, decodeRawJSON } from '../strict-json.mjs';
import { validateShape } from './schema-validator.mjs';
import { validateDomain, validateEventDomain } from './domain.mjs';
import { requireFact, fail, ContractError } from '../errors.mjs';
import { inside, validateExactEffects, comparePosition, compareUTF16 } from '../geometry.mjs';
export { decodeRawJSON, snapshotJSON, deepFreeze, assertPureJSON } from '../strict-json.mjs';
export { ContractError, publicError } from '../errors.mjs';
export { normalizeName, validateNameSyntax, requireUnicode17, runtimeCompatibility } from '../names.mjs';
export { boxCellCount, unionCellCount, validateExactEffects, comparePosition, compareUTF16 } from '../geometry.mjs';
export const version = contractMetadata.version;
export const wireVersions = contractMetadata.wireVersions;
export const compiledOperationsVersion = contractMetadata.compiledOperationsVersion;
export const operationContracts = contractMetadata.operations;
export const canvasEventRules = contractMetadata.canvasEventRules;
export const ownership = contractMetadata.ownership;
export const placementSettingDescriptors = contractMetadata.placementSettings;
export const placementInvariants = contractMetadata.placementInvariants;
export const settingsSurface = contractMetadata.settingsSurface;
export const digestProfile = contractMetadata.digest;
export const schemaInventory = contractMetadata.typeNames;
export const contractHandshake = contractMetadata.contractHandshake;
export { schemaBundle };
export function validateType(typeName, value) {
  const snapshot = snapshotJSON(value);
  const visits = validateShape(typeName, snapshot);
  validateDomain(visits);
  if (Object.hasOwn(canvasEventRules, typeName)) validateEventDomain(typeName, snapshot);
  return deepFreeze(snapshot);
}
export function assertType(typeName, value) { validateType(typeName, value); }
export function admitType(typeName, bytes) { return validateType(typeName, decodeRawJSON(bytes)); }
export function validateCanvasEvent(typeName, value) {
  if (!Object.hasOwn(canvasEventRules, typeName)) throw new TypeError('Unknown Canvas event type');
  return validateType(typeName, value);
}
function operation(wire, operationName) {
  if (!Object.hasOwn(operationContracts, wire)) fail('UNSUPPORTED_VERSION', 'decode', 'VERSION_UNSUPPORTED');
  const result = operationContracts[wire].find(op => op.operation === operationName);
  if (!result) fail('UNSUPPORTED_OPERATION', 'validate', 'INVALID_SHAPE');
  return result;
}
export function validateRequest(wire, operationName, value) {
  const request = validateType(operation(wire, operationName).request, value);
  return request;
}
export function admitRequest(wire, operationName, bytes) {
  // Raw admission precedes any operation-level/provider access.
  const value = decodeRawJSON(bytes);
  return validateRequest(wire, operationName, value);
}
export function validateResponse(wire, operationName, value) {
  const op = operation(wire, operationName);
  value = snapshotJSON(value);
  // alternateResult is an explicit operation-level public type, not an invented
  // field in the frozen CreateBuildPlanResponse envelope.
  if (op.alternateResult && value !== null && typeof value === 'object' && Object.hasOwn(value, 'clarificationId')) return validateType(op.alternateResult, value);
  const response = validateType(op.response, value);
  return response;
}
function safeCanonicalize(value) {
  // Prevent inherited serialization hooks from entering the upstream library.
  for (const proto of [Object.prototype, Array.prototype]) {
    if (Object.getOwnPropertyDescriptor(proto, 'toJSON')) fail('SCHEMA_INVALID', 'decode', 'INVALID_SHAPE');
  }
  return canonicalize(value); // exactly the pinned, unmodified published implementation
}
/** JCS only, without a production digest domain. Useful for conformance. */
export function canonicalJSON(value) { return safeCanonicalize(snapshotJSON(value)); }
/** Exact projection input, not an arbitrary untyped envelope. All 19 projections
 * are reconstructed using their OWN declared top-level fields; nested digest,
 * metadata/inventory/timer/state-profile fields are retained unchanged. */
export function project(kind, payload) {
  const typeName = digestProfile.projectionTypes[kind];
  if (!typeName) throw new TypeError('Unknown production digest kind');
  const admitted = validateType(typeName, payload);
  const fields = schemaBundle.definitions[typeName].properties;
  const projection = Object.create(null);
  for (const field of Object.keys(fields)) projection[field] = admitted[field];
  return deepFreeze(projection);
}
export function digestValue(kind, payload) {
  const projection = project(kind, payload);
  const canonicalUtf8 = safeCanonicalize(projection);
  const domain = (digestProfile.domainPrefixByKind?.[kind] ?? digestProfile.domainPrefix) + kind + digestProfile.domainSuffix;
  const preimageUtf8 = domain + canonicalUtf8;
  const bytes = Buffer.from(preimageUtf8, 'utf8');
  return deepFreeze({ kind, projection, canonicalUtf8, preimageUtf8, preimageHex: bytes.toString('hex'), sha256: createHash('sha256').update(bytes).digest('hex') });
}
export function digestRaw(kind, bytes) { return digestValue(kind, decodeRawJSON(bytes)); }
/** Extract ONLY a publicly declared typed field. Validation is applied to the
 * entire source first; this is how wrapper digests/metadata stay out without
 * recursively deleting any field named digest. No arbitrary loose envelope. */
export function projectField(kind, sourceType, source, field) {
  const admitted = validateType(sourceType, source);
  const type = digestProfile.projectionTypes[kind];
  const prop = schemaBundle.definitions[sourceType]?.properties?.[field];
  const target = prop?.$ref ?? prop?.anyOf?.find(x => x.$ref)?.$ref;
  requireFact(target === '#/definitions/' + type, 'SCHEMA_INVALID', 'INVALID_SHAPE');
  return project(kind, admitted[field]);
}
// Approved rc.5/rc.8 oracles pin NON_CANONICAL_AMBIGUITY/validate/PAYLOAD_CHANGED to retryability NEVER:
// resending the same changed payload cannot succeed.
const ambiguity = ok => requireFact(ok, 'NON_CANONICAL_AMBIGUITY', 'PAYLOAD_CHANGED', 'validate', { retryability: 'NEVER' });
export function validateDigestBinding(kind, payload, providedDigest) {
  validateType('Digest', providedDigest);
  const actual = digestValue(kind, payload);
  if (kind === 'reference-brief') requireFact(actual.sha256 === providedDigest, 'MEDIA_DIGEST_MISMATCH', 'PAYLOAD_CHANGED');
  else ambiguity(actual.sha256 === providedDigest);
  return actual;
}
export function validateFactsCoverage(factsInput, coverageInput) {
  const facts = validateType('TargetFacts', factsInput); const coverage = validateType('Coverage', coverageInput);
  validateDigestBinding('coverage', coverage, facts.coverageDigest);
  requireFact(JSON.stringify(facts.sampledBounds) === JSON.stringify(coverage.sampledBounds), 'SCHEMA_INVALID', 'INVALID_GEOMETRY');
  const union = [...facts.occupiedCells.map(x => x.position), ...facts.knownEmptyCells, ...facts.unknownCells.map(x => x.position)].sort(comparePosition);
  requireFact(JSON.stringify(union) === JSON.stringify(coverage.sampledPositions), 'TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
  return facts;
}
export function validateStaticMaterials(materialsInput, catalogueInput) {
  const materials = validateType('MaterialMap', materialsInput); const catalogue = validateType('Catalogue', catalogueInput);
  for (const material of Object.values(materials)) {
    requireFact(Object.hasOwn(catalogue.nodes, material.nodeName), 'CATALOGUE_MISMATCH', 'CATALOGUE_UNRESOLVED');
    const capability = catalogue.nodes[material.nodeName];
    requireFact(capability.allowedParam2 !== null && capability.definitionRevision !== null && capability.hasCallbacks === false && capability.hasPersistentState === false,
      'UNSUPPORTED_MUTATION_SEMANTICS', 'REQUIRED_FACT_UNKNOWN');
    requireFact(capability.allowedParam2.includes(material.param2), 'UNSUPPORTED_MUTATION_SEMANTICS', 'REQUIRED_FACT_UNKNOWN');
  }
  return materials;
}
/** Coherence of complete supplied facts. The returned object is intentionally
 * a pure supplied-facts check; it does not read the world. */
export function validateWitnessCoherence({ build: buildInput, finalEffects: effectsInput, targetFacts: factsInput, safetyProfile: safetyInput, catalogue: catalogueInput }) {
  const build = validateType('BuildProjection', buildInput), effects = validateType('FinalEffects', effectsInput), facts = validateType('TargetFacts', factsInput), safety = validateType('SafetyProfile', safetyInput), catalogue = validateType('Catalogue', catalogueInput);
  validateStaticMaterials(build.materials, catalogue);
  validateExactEffects(build.operations, build.materials, effects.effects);
  const hashes = { finalEffectsDigest: digestValue('final-effects', effects).sha256, targetFactsDigest: digestValue('target-facts', facts).sha256, safetyProfileDigest: digestValue('safety-profile', safety).sha256 };
  ambiguity(build.catalogueDigest === digestValue('catalogue', catalogue).sha256 && build.targetFactsDigest === hashes.targetFactsDigest && build.safetyProfileDigest === hashes.safetyProfileDigest);
  requireFact(safety.requireBodyClearance, 'CAPABILITY_UNAVAILABLE', 'POLICY_UNAVAILABLE');
  const required = ['COVERAGE', 'BODY_CLEARANCE', 'HAZARD'];
  if (safety.requireEntranceConnectivity) required.push('ENTRANCE_CONNECTIVITY');
  for (const predicate of required) requireFact(build.witnesses.some(w => w.predicate === predicate), 'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
  const effectPositions = effects.effects.map(x => JSON.stringify(x.position));
  for (const w of build.witnesses) {
    for (const key of Object.keys(hashes)) ambiguity(w[key] === hashes[key]);
    if (w.facts.positions) {
      const positions = new Set(w.facts.positions.map(x => JSON.stringify(x)));
      if (['COVERAGE','BODY_CLEARANCE'].includes(w.predicate)) requireFact(effectPositions.every(p => positions.has(p)), 'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
    }
    if (w.predicate === 'BODY_CLEARANCE') {
      const occupied = new Set(w.facts.bodyOccupiedPositions.map(p => JSON.stringify(p)));
      requireFact(!effectPositions.some(p => occupied.has(p)), 'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
      ambiguity(JSON.stringify(w.facts.avatarDimensions) === JSON.stringify(safety.avatarDimensions));
    }
    if (w.predicate === 'HAZARD') {
      ambiguity(w.facts.forbidLiquid === safety.hazardPolicy.forbidLiquid && w.facts.maximumDamagePerSecond === safety.hazardPolicy.maximumDamagePerSecond);
      for (const p of w.facts.positions) {
        const written = effects.effects.find(e => JSON.stringify(e.position) === JSON.stringify(p));
        const occupied = facts.occupiedCells.find(e => JSON.stringify(e.position) === JSON.stringify(p));
        const empty = facts.knownEmptyCells.some(q => JSON.stringify(q) === JSON.stringify(p));
        const nodeName = written?.nodeName ?? occupied?.nodeName ?? (empty ? 'air' : null);
        requireFact(nodeName !== null && Object.hasOwn(catalogue.nodes, nodeName), 'TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
        const c = catalogue.nodes[nodeName];
        requireFact(c.liquidType !== null && c.damagePerSecond !== null, 'UNSUPPORTED_MUTATION_SEMANTICS', 'REQUIRED_FACT_UNKNOWN');
        requireFact((!w.facts.forbidLiquid || c.liquidType === 'none') && c.damagePerSecond <= w.facts.maximumDamagePerSecond, 'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
      }
    }
  }
  return deepFreeze({ coherent: true, authenticityVerified: false, worldWrites: 0 });
}

/** Adapter-produced RegionInspection self-coherence: the facts digest, the frame
 * digest and the coverage digest are recomputed from the carried values. */
export function validateRegionInspection(value) {
  const inspection = validateType('RegionInspection', value);
  const tf = inspection.targetFacts;
  validateDigestBinding('target-facts', tf, inspection.targetFactsDigest);
  validateDigestBinding('frame', inspection.frame, tf.frameDigest);
  const sampledPositions = [...tf.occupiedCells.map(x => x.position), ...tf.knownEmptyCells, ...tf.unknownCells.map(x => x.position)].sort(comparePosition);
  validateDigestBinding('coverage', { profileVersion: 'coverage/v2', sampledBounds: tf.sampledBounds, sampledPositions }, tf.coverageDigest);
  return inspection;
}

const same = (a,b) => canonicalJSON(a) === canonicalJSON(b);
const associated = ok => requireFact(ok, 'TRANSACTION_CONFLICT', 'PAYLOAD_CHANGED');
const current = ok => requireFact(ok, 'CURRENT_WORLD_MISMATCH', 'REVISION_CHANGED');
const pairs = [['build','buildDigest','build'],['operations','operationDigest','operations'],
 ['intent','intentDigest','intent'],['referenceBrief','referenceBriefDigest','reference-brief'],
 ['brief','briefDigest','reference-brief'],['catalogue','catalogueDigest','catalogue'],
 ['targetFacts','targetFactsDigest','target-facts'],['safetyProfile','safetyProfileDigest','safety-profile'],
 ['compilationConfig','compilationConfigDigest','compilation-config'],['surfaceAction','surfaceActionDigest','surface-action'],
 ['analysis','analysisDigest','affected-analysis'],['scope','scopeDigest','scoped-world']];
/** Pure relation checks. Live connection/selection and journal facts come from the
 * owning provider, never from JSON submitted by a model or external caller. */
export function validateBoundRequest(wire, name, input) {
 const request=validateRequest(wire,name,input);
 for(const [field,hash,kind] of pairs)if(Object.hasOwn(request,field)&&Object.hasOwn(request,hash))validateDigestBinding(kind,request[field],request[hash]);
 const context=request.localContext;
 if(context) {
  if(request.worldRef!==undefined)current(request.worldRef===context.worldRef);
  for(const child of [request.operations,request.expectedOperations,request.scope,request.targetFacts,request.analysis])
   if(child?.worldRef!==undefined&&child.worldRef!==null)current(child.worldRef===context.worldRef);
  if(request.scope)current(same(request.scope.localContext,context));
 }
 if(request.preparedTransaction){const p=request.preparedTransaction;validateDigestBinding('scoped-transaction-payload',p.payload,p.transactionPayloadDigest);
  associated(p.payload.transactionId===request.transactionId&&p.payload.operationDigest===request.operationDigest&&p.payload.scopeDigest===request.scopeDigest&&p.scopeDigest===request.scopeDigest);
  current(same(p.payload.localContext,context)&&p.payload.worldRef===request.worldRef);
 }
 if(request.scope){associated(request.scope.transactionId===request.transactionId&&request.scope.operationDigest===request.operationDigest);}
 if(request.regionInspection){const ri=validateRegionInspection(request.regionInspection);
  associated(same(ri.targetFacts,request.targetFacts)&&ri.targetFactsDigest===request.targetFactsDigest);
 }
 if(request.build){for(const k of ['catalogueDigest','targetFactsDigest','safetyProfileDigest'])if(request[k]!==undefined)associated(request.build[k]===request[k]);
  if(request.targetFacts)validateDigestBinding('frame',request.build.coordinateFrame,request.targetFacts.frameDigest);
 }
 if(request.regionInspectionBinding){const b=request.regionInspectionBinding.build;
  validateDigestBinding('build',b,request.operations.buildDigest);
  validateDigestBinding('frame',b.coordinateFrame,request.operations.frameDigest);
  associated(b.targetFactsDigest===request.operations.targetFactsDigest&&b.catalogueDigest===request.operations.catalogueDigest);
 }
 if(request.historyOperationDigest){const keys=Object.keys(schemaBundle.definitions.HistoryOperationProjection.properties);
  if(keys.every(k=>Object.hasOwn(request,k)))validateDigestBinding('history-operation',Object.fromEntries(keys.map(k=>[k,request[k]])),request.historyOperationDigest);
 }
 if(name==='PrepareHistoryTransaction'){
  associated(request.originTransactionId!==request.transactionId);
  associated(request.targetStateDigest===(request.direction==='UNDO'?request.originBeforeStateReadbackDigest:request.originAfterReadbackDigest));
  associated(request.expectedCurrentStateDigest===(request.direction==='UNDO'?request.originAfterReadbackDigest:request.originBeforeStateReadbackDigest));
 }
 if(request.preparedHistoryTransaction){for(const k of ['originTransactionId','transactionId','direction','historyOperationDigest'])associated(request.preparedHistoryTransaction[k]===request[k]);
  current(same(request.preparedHistoryTransaction.localContext,context));
 }
 return request;
}
export function requestDigest(wire,name,input) {
 const request=validateBoundRequest(wire,name,input);
 return createHash('sha256').update('HanaWorlds|contracts@0.4.0|request|'+wire+'|'+name+'|'+canonicalJSON(request)).digest('hex');
}
/** Provider admission instruction: RETURN_STORED never executes another write.
 * Reservation + stored outcome must be durable in that provider's own state. */
export function validateCurrentRequest(wire,name,input,factsInput) {
 const request=validateBoundRequest(wire,name,input),facts=validateType('LocalRequestFacts',factsInput);
 associated(request.sessionRef===facts.sessionRef);
 if(request.localContext)current(same(request.localContext,facts.currentContext));
 if(Object.hasOwn(request,'expectedContext'))current(same(request.expectedContext,facts.currentContext));
 const turn=request.expectedTurnRevision??request.turnRevision;
 if(turn!==undefined)requireFact(turn===facts.currentTurnRevision,'TURN_REVISION_MISMATCH','REVISION_CHANGED');
 if(request.referenceBriefDigest)associated(request.referenceBriefDigest===facts.currentBriefDigest);
 requireFact(facts.requestState!=='CANCELLED','REQUEST_CANCELLED','REVISION_CHANGED');
 requireFact(facts.requestState!=='UNKNOWN','REQUEST_NOT_ACTIVE','REQUIRED_FACT_UNKNOWN');
 const hash=requestDigest(wire,name,request);
 associated(facts.replay!=='CONFLICT');
 if(facts.replay==='NEW')associated(facts.priorRequestDigest===null&&facts.requestState==='ACTIVE');
 else associated(facts.priorRequestDigest===hash&&facts.requestState==='COMPLETED');
 return deepFreeze({request,requestDigest:hash,disposition:facts.replay==='NEW'?'EXECUTE':'RETURN_STORED'});
}
export function checkContractHandshake(advertisedInput,required={wires:wireVersions,factProfiles:['target-facts/v4']}) {
 const advertised=validateType('ContractHandshake',advertisedInput);
 requireFact(advertised.contracts===contractHandshake.contracts&&advertised.compiledOperationsVersion===compiledOperationsVersion&&required.wires.every(w=>wireVersions.includes(w)&&advertised.wireVersions.includes(w))&&required.factProfiles.every(f=>advertised.factProfiles.includes(f)), 'UNSUPPORTED_VERSION','VERSION_UNSUPPORTED','decode');
 return deepFreeze({result:'HANDSHAKE_VERSION_MATCH',advertised});
}
export function validateCurrentBuildSubmission(input,factsInput) {
 const submission=validateType('CurrentBuildSubmission',input),{parentRequest:parent,apply,intent,analysis}=submission;
 validateCurrentRequest('session/v3','AdvanceCurrentBuild',parent,factsInput);
 validateBoundRequest('canvas/v5','ApplyRecoverableCommit',apply);
 current(same(parent.localContext,apply.localContext));associated(parent.sessionRef===apply.sessionRef&&parent.worldRef===apply.worldRef);
 associated(intent.intendedWorldRef===parent.worldRef&&intent.confirmedIntent.confirmedTurnRevision===parent.expectedTurnRevision&&intent.referenceBriefDigest===factsInput.currentBriefDigest);
 associated(analysis.worldRef===parent.worldRef&&analysis.operationDigest===apply.operationDigest);
 validateDigestBinding('affected-analysis',analysis,apply.analysisDigest);
 // This entry builds a fresh object. Existing affected objects are a Canvas conflict.
 requireFact(analysis.affectedObjectRefs.length===0,'OTHER_OBJECTS_AFFECTED','SCOPE_DENIED');
 associated(apply.decisionRevision===null&&apply.guarantee==='RECOVERABLE_VERIFIED');
 return submission;
}
export function validateBoundResponse(wire,name,requestInput,responseInput) {
 const request=validateBoundRequest(wire,name,requestInput),response=validateResponse(wire,name,responseInput);
 associated(response.requestId===request.requestId);
 const result=response.result;
 if(result){
  if(result.connectionRef!==undefined&&request.connectionRef!==undefined)current(result.connectionRef===request.connectionRef);
  if(name==='SelectWorldConnection'){current(result.activeWorldRef===request.worldRef&&result.localContext?.connectionRef===request.connectionRef&&result.localContext?.connectionIncarnationRef===request.connectionIncarnationRef);associated(result.currentSession===request.sessionRef);}
  if(name==='BuildDocument'){validateDigestBinding('operations',result.projection,result.operationDigest);associated(result.projection.buildDigest===request.buildDigest&&result.projection.worldRef===request.worldRef&&result.projection.targetFactsDigest===request.targetFactsDigest&&result.projection.compilationConfigDigest===request.compilationConfigDigest);validateExactEffects(request.build.operations,request.build.materials,result.projection.effects);}
  if(result.localContext&&request.localContext)current(same(result.localContext,request.localContext));
  if(result.worldRef!==undefined&&request.worldRef!==undefined)current(result.worldRef===request.worldRef);
  if(result.sessionRef!==undefined)associated(result.sessionRef===request.sessionRef);
  if(result.transactionId!==undefined&&request.transactionId!==undefined)associated(result.transactionId===request.transactionId);
  if(result.operationDigest!==undefined&&request.operationDigest!==undefined)associated(result.operationDigest===request.operationDigest);
 }
 return response;
}
export function projectScopedPreparedTransaction(input) {
 const result=validateType('ScopedPreparedTransactionResult',input);
 validateDigestBinding('scoped-transaction-payload',result.payload,result.transactionPayloadDigest);
 return validateType('ScopedPreparedTransaction',Object.fromEntries(Object.keys(schemaBundle.definitions.ScopedPreparedTransaction.properties).map(k=>[k,result[k]])));
}
export function validateWorldSelection(input,factsInput,connectionInput) {
 const {request}=validateCurrentRequest('canvas/v5','SelectWorldConnection',input,factsInput);
 const connection=validateType('LocalConnectionReadback',connectionInput);
 current(request.connectionRef===connection.connectionRef&&request.worldRef===connection.worldRef&&request.connectionIncarnationRef===connection.connectionIncarnationRef);
 current(connection.capabilities.worldRef===connection.worldRef);
 return request;
}
/** Canvas supplies expected complete state (compiled result, or saved before
 * image for rollback), actual Adapter readback, and its durable history row.
 * This pure check neither performs readback nor makes a transaction decision. */
export function validateCommitReadback(receiptInput,expectedInput,actualInput,historyInput) {
 const receipt=validateType('ReceiptProjection',receiptInput),expected=validateType('ReadbackProjection',expectedInput),actual=validateType('ReadbackProjection',actualInput);
 current(expected.worldRef===receipt.localContext.worldRef&&actual.worldRef===expected.worldRef);
 requireFact(same(expected,actual),'READBACK_MISMATCH','PAYLOAD_CHANGED','readback',{mutationState:'UNKNOWN',transactionRef:receipt.transactionId});
 validateDigestBinding('readback',actual,receipt.readbackDigest);
 if(receipt.status==='VERIFIED'){
  const history=validateType('HistoryEntry',historyInput);
  associated(history.status==='VERIFIED'&&history.transactionId===receipt.transactionId&&history.operationDigest===receipt.operationDigest&&history.expectedAfterReadbackDigest===receipt.readbackDigest);
  validateDigestBinding('receipt',receipt,history.receiptDigest);
 }else associated(receipt.status==='ROLLED_BACK'&&receipt.restoreStatus==='VERIFIED_RESTORED'&&historyInput===null);
 return receipt;
}
