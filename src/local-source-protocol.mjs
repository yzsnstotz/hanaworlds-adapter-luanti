import { canonicalJSON, ContractError, validateType } from '#contracts';

export const LOCAL_SOURCE_VERSION = 'local-worlds/v2';
const ref = v => typeof v === 'string' && v.length > 0;
const shape = () => { throw new ContractError('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE'); };
export function closedObject(value, fields, required = fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) shape();
  if (Object.keys(value).some(k => !fields.includes(k)))
    throw new ContractError('UNKNOWN_REQUIRED_FIELD', 'validate', 'INVALID_SHAPE');
  if (required.some(k => !Object.hasOwn(value, k))) shape();
}
export function sourceRequest(input, scoped) {
  const q = JSON.parse(canonicalJSON(input));
  closedObject(q, scoped ? ['contractVersion', 'requestId', 'source', 'operation', 'payload'] : ['contractVersion', 'requestId']);
  if (!ref(q.requestId)) shape();
  if (q.contractVersion !== LOCAL_SOURCE_VERSION)
    throw new ContractError('PAYLOAD_VERSION_MISMATCH', 'validate', 'VERSION_UNSUPPORTED');
  if (!scoped) return q;
  closedObject(q.source, ['sourceRef', 'instanceRef']);
  if (!Object.values(q.source).every(ref)) shape();
  const fields = { discover: ['worldRoot'], createWorld: ['templateId', 'displayName'],
    pair: ['worldRef', 'connectionRef', 'connectionIncarnationRef'],
    deleteWorld: ['worldRef', 'confirmationName'], describeSourceWorld: ['worldRef'] };
  if (!Object.hasOwn(fields, q.operation)) shape();
  closedObject(q.payload, fields[q.operation], q.operation === 'pair' ? ['worldRef'] : fields[q.operation]);
  if (!Object.values(q.payload).every(ref)) shape();
  if (q.operation === 'pair' && Object.hasOwn(q.payload, 'connectionRef') !== Object.hasOwn(q.payload, 'connectionIncarnationRef')) shape();
  return q;
}
export function sourceError(code, mutationState = 'NONE', reason = 'REQUIRED_FACT_UNKNOWN') {
  return validateType('Error', { code, phase: mutationState === 'NONE' ? 'validate' : 'apply',
    retryability: 'AFTER_NEW_FACTS', mutationState, transactionRef: null, causeCode: null, reason });
}
export function creationMaterials(input = []) {
  const rows = JSON.parse(canonicalJSON(input));
  if (!Array.isArray(rows)) shape();
  const seen = new Set(['flat']);
  for (const row of rows) {
    closedObject(row, ['templateId', 'displayName', 'description', 'creationFacts']);
    if (![row.templateId, row.displayName, row.description].every(ref) || seen.has(row.templateId)) shape();
    seen.add(row.templateId);
  }
  return rows;
}
