// write-path-init/v1: the fact scope of Catalogue hasCallbacks/hasPersistentState.
// Pure derivation from a supplied callback-name inventory; no registry access.
import { contractMetadata } from './generated/contracts.mjs';
import { validateType, validateDigestBinding, deepFreeze } from './runtime.mjs';
import { requireFact } from '../errors.mjs';
export const writePathStateScope = contractMetadata.writePathStateScope;
const INIT = new Set(writePathStateScope.initializationCallbacks);
const STATE = new Set(writePathStateScope.stateIndicatorCallbacks);

function derive(node, pathKnownClean) {
  if (!pathKnownClean || node.definedCallbacks === null || node.definitionRevision === null)
    return { hasCallbacks: null, hasPersistentState: null, initialization: [], stateIndicators: [] };
  const initialization = node.definedCallbacks.filter(c => INIT.has(c));
  const stateIndicators = node.definedCallbacks.filter(c => STATE.has(c));
  return { hasCallbacks: initialization.length > 0,
    // Never false while any initialization or state-bearing callback exists, never true from opaque code.
    hasPersistentState: initialization.length === 0 && stateIndicators.length === 0 ? false : null,
    initialization, stateIndicators };
}
/** Facts each node gets under write-path-init/v1 from the supplied inventory.
 * Unknown inventories or any global callback on the write path give null. */
export function writePathStateFacts(evidenceInput) {
  const evidence = validateType('WritePathEvidence', evidenceInput);
  const clean = evidence.globalWriteCallbacks !== null && evidence.globalWriteCallbacks.length === 0;
  return deepFreeze(Object.fromEntries(evidence.nodes.map(n => [n.nodeName, { definitionRevision: n.definitionRevision, ...derive(n, clean) }])));
}
/** A Catalogue may publish facts no looser than the derivation: false only where
 * derived false; true/null are always allowed (stricter). Every node with a false
 * fact must be covered by the inventory with the same definitionRevision. */
export function validateCatalogueWritePathFacts(catalogueInput, evidenceInput) {
  const catalogue = validateType('Catalogue', catalogueInput);
  const evidence = validateType('WritePathEvidence', evidenceInput);
  validateDigestBinding('catalogue', catalogue, evidence.catalogueDigest);
  const derived = writePathStateFacts(evidence);
  const looser = ok => requireFact(ok, 'CATALOGUE_MISMATCH', 'CATALOGUE_UNRESOLVED');
  const verified = [], stricter = [];
  for (const [name, cap] of Object.entries(catalogue.nodes)) {
    const d = Object.hasOwn(derived, name) ? derived[name] : null;
    if (d) looser(d.definitionRevision === cap.definitionRevision);
    if (cap.hasCallbacks === false) looser(d !== null && d.hasCallbacks === false);
    if (cap.hasPersistentState === false) looser(d !== null && d.hasPersistentState === false);
    if (cap.hasCallbacks === false && cap.hasPersistentState === false) verified.push(name);
    else if (d && d.hasCallbacks === false && d.hasPersistentState === false) stricter.push(name);
  }
  return deepFreeze({ scope: evidence.scope, writePath: evidence.writePath, verified, stricter });
}
