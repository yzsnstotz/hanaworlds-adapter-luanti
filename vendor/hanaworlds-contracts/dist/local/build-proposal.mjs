// Public route-A proposal contract. Pure shape/coherence checks only: no model,
// world read, provider authentication, BUILD assembly or transaction decision.
import { validateType, validateRequest, validateResponse, validateDigestBinding,
  digestValue, canonicalJSON, contractHandshake, checkContractHandshake,
  schemaBundle, validateBoundRequest, validateCurrentRequest, validateRegionInspection, validateStaticMaterials,
  validateWitnessCoherence } from './runtime.mjs';
import { requireFact } from '../errors.mjs';
import { inside, unionCellCount, comparePosition } from '../geometry.mjs';
const WIRE = 'painter/v4', OPERATION = 'ValidateBuildProposal';
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
const identity = ok => requireFact(ok, 'TRANSACTION_CONFLICT', 'PAYLOAD_CHANGED');
const stale = ok => requireFact(ok, 'TARGET_FACTS_STALE', 'REVISION_CHANGED');
const geometry = ok => requireFact(ok, 'BUILD_INVALID', 'INVALID_GEOMETRY');

/** Check this new Painter producer only; not a request to update default peers. */
export function checkBuildProposalHandshake(input) {
  const { advertised } = checkContractHandshake(input,
    { wires: [WIRE], factProfiles: ['target-facts/v4'] });
  requireFact(advertised.contracts === contractHandshake.contracts,
    'UNSUPPORTED_VERSION', 'VERSION_UNSUPPORTED', 'decode');
  return Object.freeze({ result: 'HANDSHAKE_OPERATION_MATCH', advertised });
}

function proposalGeometry(request) {
  const { proposal, targetFacts: facts, regionInspection: region, safetyProfile: safety } = request;
  validateStaticMaterials(proposal.materials, request.catalogue);
  const bounds = facts.sampledBounds;
  // BigInt before conversion: no overflowing additions, clipping or guessed caps.
  const translate = position => position.map((x, axis) => {
    const translated = BigInt(x) + BigInt(bounds.min[axis]);
    geometry(translated >= BigInt(bounds.min[axis]) && translated <= BigInt(bounds.max[axis]) &&
      translated >= BigInt(Number.MIN_SAFE_INTEGER) && translated <= BigInt(Number.MAX_SAFE_INTEGER));
    return Number(translated);
  });
  const operations = proposal.boxes.map(box => {
    requireFact(Object.hasOwn(proposal.materials, box.materialRef),
      'UNSUPPORTED_MATERIAL', 'CATALOGUE_UNRESOLVED');
    return { op: 'set_box', min: translate(box.min), max: translate(box.max), materialRef: box.materialRef };
  });
  const touched = p => operations.some(op => inside(p, op));
  geometry(!facts.occupiedCells.some(cell => touched(cell.position)));
  const written = facts.knownEmptyCells.filter(touched).sort(comparePosition);
  // Exact union volume proves there are no unknown/unsampled holes without
  // iterating an attacker-supplied huge box; overlap is counted only once.
  requireFact(unionCellCount(operations) === BigInt(written.length),
    'TARGET_FACTS_INCOMPLETE', 'REQUIRED_FACT_UNKNOWN');
  geometry(!region.bodyOccupiedPositions.some(touched));
  const effects = written.map(position => {
    const op = operations.findLast(op => inside(position, op));
    return { position, ...proposal.materials[op.materialRef] };
  });
  for (const effect of effects) {
    const node = request.catalogue.nodes[effect.nodeName];
    requireFact(node.liquidType !== null && node.damagePerSecond !== null,
      'UNSUPPORTED_MATERIAL', 'REQUIRED_FACT_UNKNOWN');
    requireFact((!safety.hazardPolicy.forbidLiquid || node.liquidType === 'none') &&
      node.damagePerSecond <= safety.hazardPolicy.maximumDamagePerSecond,
      'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
  }
  return { operations, effects };
}

/** Payload coherence only. Current connection state is a provider duty. */
export function validateBuildProposalRequest(input) {
  const request = validateBoundRequest(WIRE, OPERATION, input);
  const { intent, referenceBrief: brief, targetFacts: facts, safetyProfile: safety } = request;
  for (const [field, hash, kind] of [
    ['intent', 'intentDigest', 'intent'], ['referenceBrief', 'referenceBriefDigest', 'reference-brief'],
    ['targetFacts', 'targetFactsDigest', 'target-facts'], ['safetyProfile', 'safetyProfileDigest', 'safety-profile'],
  ]) validateDigestBinding(kind, request[field], request[hash]);
  requireFact(intent.confirmedIntent.kind === 'BUILD_STRUCTURE' &&
    intent.confirmedIntent.confirmedTurnRevision === request.turnRevision &&
    intent.intendedWorldRef === request.worldRef && intent.orderedTargetRefs.length === 0 &&
    intent.referenceBriefDigest === request.referenceBriefDigest &&
    brief.sessionRef === request.sessionRef && brief.turnRevision === request.turnRevision &&
    brief.text.trim().length > 0 && intent.confirmedIntent.text.trim().length > 0,
    'INTENT_UNCONFIRMED', 'REQUIRED_FACT_UNKNOWN');
  requireFact(facts.source === 'REGION_INSPECTED', 'TARGET_REQUIRED', 'REQUIRED_FACT_UNKNOWN');
  const region = validateRegionInspection(request.regionInspection);
  stale(facts.worldRef === request.worldRef && same(region.targetFacts, facts) &&
    region.targetFactsDigest === request.targetFactsDigest &&
    facts.catalogueDigest === digestValue('catalogue', request.catalogue).sha256 &&
    region.evidence.worldRef === request.worldRef && region.evidence.worldRevision === facts.worldRevision);
  requireFact(safety.requireBodyClearance,
    'CAPABILITY_UNAVAILABLE', 'POLICY_UNAVAILABLE');
  if (safety.requireEntranceConnectivity)
    requireFact(intent.confirmedIntent.entrancePortalRefs.length > 0,
      'INTENT_UNCONFIRMED', 'REQUIRED_FACT_UNKNOWN');
  proposalGeometry(request);
  return request;
}

/** Inputs read by Workshop from current local state and public fact providers.
 * This checks their correlation, never their authenticity or temporal atomicity. */
export function validateBuildProposalContext(input, factsInput) {
  const request = validateBoundRequest(WIRE, OPERATION, input);
  const facts = validateType('BuildProposalProviderFacts', factsInput);
  validateCurrentRequest(WIRE, OPERATION, request, facts.requestFacts);
  validateBuildProposalRequest(request);
  const keys = Object.keys(schemaBundle.definitions.BuildProposalContext.properties);
  const context = Object.fromEntries(keys.map(key => [key, request[key]]));
  stale(same(context, facts.sourceContext) && same(context, facts.currentContext));
  return request;
}

/** Request/result coherence only; caller rechecks validateBuildProposalContext
 * with fresh local facts before releasing this response, including replay. */
export function validateBuildProposalResponse(input, responseInput) {
  const request = validateBoundRequest(WIRE, OPERATION, input);
  const response = validateResponse(WIRE, OPERATION, responseInput);
  identity(response.requestId === request.requestId);
  if (response.error !== null) return response;
  validateBuildProposalRequest(request);
  const { build, buildDigest, invocationId } = response.result;
  identity(invocationId === request.invocationId);
  validateDigestBinding('build', build, buildDigest);
  const { operations, effects } = proposalGeometry(request);
  stale(same(build.coordinateFrame, request.regionInspection.frame) &&
    build.catalogueDigest === digestValue('catalogue', request.catalogue).sha256 &&
    build.targetFactsDigest === request.targetFactsDigest && build.safetyProfileDigest === request.safetyProfileDigest);
  geometry(same(build.materials, request.proposal.materials) && same(build.operations, operations));
  const positions = effects.map(effect => effect.position);
  for (const witness of build.witnesses) {
    if (witness.facts.evidence) identity(same(witness.facts.evidence, request.regionInspection.evidence));
    if (['COVERAGE', 'BODY_CLEARANCE'].includes(witness.predicate))
      geometry(same(witness.facts.positions, positions));
    if (witness.predicate === 'HAZARD')
      requireFact(positions.every(p => witness.facts.positions.some(q => same(p, q))),
        'SAFETY_INVARIANT_FAILED', 'REQUIRED_FACT_UNKNOWN');
  }
  validateWitnessCoherence({ build, finalEffects: { profileVersion: 'final-effects/v2',
    frameDigest: request.targetFacts.frameDigest, catalogueDigest: build.catalogueDigest, effects },
    targetFacts: request.targetFacts, safetyProfile: request.safetyProfile, catalogue: request.catalogue });
  return response;
}
