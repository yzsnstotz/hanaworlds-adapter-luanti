import { engineGuards as contractGuards, guardRefusalError, validateType } from '#contracts';

/** Exactly what payload region.lua guards() declares: each engine guard and the courier
 * operations that run it. A world whose loaded payload declares anything else is not paired,
 * so the declaration below holds for every paired world. */
export const ENGINE_GUARDS = Object.freeze({
  bodyClearance: Object.freeze(['prepare_check', 'apply', 'apply_state', 'restore', 'region_write']),
  perCellProtection: Object.freeze(['prepare_check', 'apply', 'apply_state', 'restore', 'region_write']),
  playerEnclosure: Object.freeze(['prepare_check', 'apply', 'apply_state', 'region_write']),
});
export function sameGuards(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join() === Object.keys(ENGINE_GUARDS).sort().join() &&
    Object.entries(ENGINE_GUARDS).every(([k, ops]) => Array.isArray(value[k]) && value[k].join() === ops.join());
}

const GUARD = Object.freeze({ bodyClearance: 'BODY_CLEARANCE', perCellProtection: 'CELL_PROTECTION', playerEnclosure: 'PLAYER_ENCLOSURE' });
const FINDING = Object.freeze({ BODY_OCCUPIED: 'BODY_CLEARANCE', PROTECTED_CELL: 'CELL_PROTECTION', PLAYER_ENCLOSED: 'PLAYER_ENCLOSURE' });
// Public stage -> courier operation that runs the guard there. PrepareRecoverable and
// ApplyHistory call prepare_check with their effects before anything is written; ApplyHistory
// then writes through apply_state, which runs it again.
// REGION_APPLY and REGION_RESTORE are both voxel.write (purpose APPLY / RESTORE): every changed
// solid cell against real bodies, every changed or extras-cleared cell against protection, and
// (payload 0.10.0) the enclosure guard over the whole request's post-write passability.
// Not declared: INSPECT_REGION (an overlapping footprint is a placement CHOICE, not a guard
// error) and PREPARE_HISTORY (no engine check).
const STAGE_OPERATION = Object.freeze({ PREPARE_RECOVERABLE: 'prepare_check', APPLY_COMPILED: 'apply',
  APPLY_HISTORY: 'apply_state', RESTORE: 'restore', REGION_APPLY: 'region_write', REGION_RESTORE: 'region_write' });

/** PublicCapabilities.engineGuards for a paired world, derived from its loaded payload's guards. */
export function engineGuardDeclaration(guards) {
  const stages = contractGuards.stages.map(s => s.stage);
  return validateType('EngineGuardDeclaration', { profileVersion: contractGuards.id,
    coverage: Object.entries(GUARD).map(([key, guard]) => {
      const ops = guards[key] || [];
      const covered = stages.filter(st => STAGE_OPERATION[st] && ops.includes(STAGE_OPERATION[st]));
      // The local courier has no player identity: protection is asked for the empty name.
      return { guard, stages: covered, protectionPrincipal: guard === 'CELL_PROTECTION' && covered.length ? 'ANONYMOUS' : null };
    }) });
}
export const ENGINE_GUARD_DECLARATION = engineGuardDeclaration(ENGINE_GUARDS);

/** GuardRefusal for an engine detail at a stage, or null when the detail names no declared guard. */
export function guardRefusal(stage, detail) {
  if (detail === 'RESTORE_GUARD_UNAVAILABLE') return stage === 'RESTORE' ? { guard: 'BODY_CLEARANCE', stage, finding: 'GUARD_UNAVAILABLE' } : null;
  const guard = FINDING[detail];
  if (!guard || !ENGINE_GUARD_DECLARATION.coverage.find(c => c.guard === guard).stages.includes(stage)) return null;
  return { guard, stage, finding: detail };
}
/** { error, guardRefusal } for a guard refusal at `stage`, or null. At a restore stage `cause` (the
 * failure that made the restore necessary) gives the transaction form; without it (a stateless
 * WriteRegion RESTORE, which knows no cause) the contract's engine form: nothing written, causeCode null. */
export function refusalDetail(stage, detail, { transactionRef = null, cause = null } = {}) {
  const refusal = guardRefusal(stage, detail);
  return refusal ? { error: guardRefusalError(refusal, { transactionRef, cause }), guardRefusal: refusal } : null;
}

/** Operations whose responses carry guardRefusal beside error. */
export const GUARDED_OPERATIONS = Object.freeze(new Set(['PrepareRecoverableTransaction', 'ApplyCompiledTransaction',
  'PrepareHistoryTransaction', 'ApplyHistoryTransaction', 'RestoreTransaction', 'InspectRegion', 'WriteRegion']));
