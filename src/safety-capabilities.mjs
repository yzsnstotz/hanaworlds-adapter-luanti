import { safetyCheckFailure } from '#contracts';

/** Exactly what payload region.lua guards() declares: each engine guard and the courier
 * operations that run it. A world whose loaded payload declares anything else is not paired,
 * so the service-level ProtocolHandshake below holds for every paired world. */
export const ENGINE_GUARDS = Object.freeze({
  restoreBodyRecheck: Object.freeze(['restore']),
  perCellProtection: Object.freeze(['prepare_check', 'apply', 'apply_state', 'restore', 'region_write']),
  playerEnclosure: Object.freeze(['prepare_check', 'apply', 'apply_state']),
});

/** Advertised contract safety capabilities. Region writes have no enclosure guard, so
 * world-adapter-region/v1:no-body-enclosure is not advertised and consumers refuse by name. */
export const WORLD_ADAPTER_SAFETY = Object.freeze(['world-adapter/v7:restore-body-recheck',
  'world-adapter/v7:cell-protection', 'world-adapter/v7:no-body-enclosure']);
export const REGION_SAFETY = Object.freeze(['world-adapter-region/v1:restore-body-recheck',
  'world-adapter-region/v1:cell-protection']);

/** Engine guard details (courier reply `detail`) that refused a restore before its first write. */
export const RESTORE_GUARD_DETAILS = Object.freeze(['BODY_OCCUPIED', 'PROTECTED_CELL']);

const WRITE_GUARD = Object.freeze({
  'world-adapter/v7': { PROTECTED_CELL: 'world-adapter/v7:cell-protection', PLAYER_ENCLOSED: 'world-adapter/v7:no-body-enclosure' },
  'world-adapter-region/v1': { PROTECTED_CELL: 'world-adapter-region/v1:cell-protection' },
});
const RESTORE_GUARD = Object.freeze({
  'world-adapter/v7': 'world-adapter/v7:restore-body-recheck',
  'world-adapter-region/v1': 'world-adapter-region/v1:restore-body-recheck',
});

/** The contract's exact public Error for an engine guard refusal, or null when `detail` names
 * no declared guard. A restore refused by a guard uses the restore-body-recheck outcome: the
 * contract has one public restore-refusal shape; which guard refused stays in the private detail. */
export function guardFailure(wire, detail, { restore = false, transactionRef = null } = {}) {
  const id = restore ? (RESTORE_GUARD_DETAILS.includes(detail) ? RESTORE_GUARD[wire] : null) : WRITE_GUARD[wire]?.[detail];
  return id ? safetyCheckFailure(id, transactionRef) : null;
}

export function sameGuards(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join() === Object.keys(ENGINE_GUARDS).sort().join() &&
    Object.entries(ENGINE_GUARDS).every(([k, ops]) => Array.isArray(value[k]) && value[k].join() === ops.join());
}
