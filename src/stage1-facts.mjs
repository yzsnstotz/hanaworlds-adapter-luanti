import { createHash, randomBytes } from 'node:crypto';
import { validateType, canonicalJSON } from '#contracts';
import { ADAPTER_ID, ADAPTER_VERSION } from './version.mjs';

/** Stage 1 engine facts for Canvas configuration: the current player's collision
 * envelope and what WorldEdit the running engine actually loaded. Read-only, in
 * memory only: nothing here is persisted or logged (INV-POSE-STAYS-IN-ENGINE).
 * A missing fact is a named refusal; no design size, package version or default
 * stands in for it. */
export const AVATAR_ENVELOPE_VERSION = 'adapter-avatar-envelope/v1';
export const WORLDEDIT_FACTS_VERSION = 'adapter-worldedit-runtime/v1';
const UNIT = 'luanti-node';
const sha = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');

/** Named refusal: the public code stays in the contract vocabulary; `detail`
 * is this Adapter's own label of what is missing (not a wire error). */
export function refusal(code, reason, detail) {
  return Object.assign(new Error(code), { code, reason, detail, publicError: { code, reason } });
}
const PLAYER_REFUSALS = new Set(['PLAYER_NOT_CONNECTED', 'PLAYER_NOT_SINGULAR', 'COLLISIONBOX_UNREADABLE']);

export function domainOf(row) {
  return { worldRef: row.worldRef, connectionRef: row.connectionRef,
    connectionIncarnationRef: row.incarnation, payloadVersion: row.payloadVersion, payloadDigest: row.payloadDigest };
}

export function createStage1Facts() {
  // Per runtime: player digests are not comparable across Adapter restarts.
  const salt = randomBytes(32).toString('hex');
  const ledgers = new Map(); // worldRef -> { avatar: Entry[], worldedit: Entry[] }
  const ledger = worldRef => {
    if (!ledgers.has(worldRef)) ledgers.set(worldRef, { avatar: [], worldedit: [] });
    return ledgers.get(worldRef);
  };
  const now = () => new Date().toISOString();

  /** Publish one observation; the previous current entry is retired with the
   * reasons it no longer holds. Retired entries are never returned as current. */
  function publish(list, record, compare) {
    const previous = list.find(e => e.state === 'CURRENT');
    if (previous && previous.revision === record.revision) return { ...previous.record, supersedes: previous.supersedes };
    let supersedes = null;
    if (previous) {
      const reasons = compare(previous.record, record);
      Object.assign(previous, { state: 'RETIRED', retiredAt: now(), retiredBy: record.revision, reasons });
      supersedes = { revision: previous.revision, reasons };
    }
    list.push({ state: 'CURRENT', revision: record.revision, record, supersedes, publishedAt: record.observedAt });
    return { ...record, supersedes };
  }
  /** Retire the current entry without a successor (player gone, World left). */
  function withdraw(list, reasons) {
    for (const e of list) if (e.state === 'CURRENT')
      Object.assign(e, { state: 'RETIRED', retiredAt: now(), retiredBy: null, reasons });
  }
  const domainChanges = (a, b) => {
    const out = [];
    if (a.domain.connectionRef !== b.domain.connectionRef || a.domain.connectionIncarnationRef !== b.domain.connectionIncarnationRef)
      out.push('CONNECTION_DOMAIN_CHANGED');
    if (a.domain.payloadDigest !== b.domain.payloadDigest) out.push('PAYLOAD_CHANGED');
    return out;
  };

  return {
    salt,
    async avatarEnvelope(row, engine) {
      const list = ledger(row.worldRef).avatar, domain = domainOf(row);
      let raw;
      try { raw = await engine.avatarEnvelope(salt); }
      catch (error) {
        if (PLAYER_REFUSALS.has(error.message)) {
          withdraw(list, [error.message]);
          throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', error.message);
        }
        throw error;
      }
      if (typeof raw?.playerRef !== 'string' || !/^[0-9a-f]{64}$/.test(raw.playerRef))
        throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', 'COLLISIONBOX_UNREADABLE');
      const avatarDimensions = validateType('AvatarDimensions',
        { width: raw.width, height: raw.height, depth: raw.depth, unit: UNIT });
      const body = { profileVersion: AVATAR_ENVELOPE_VERSION, avatarDimensions, playerRef: raw.playerRef, domain };
      const record = { ...body, revision: `avatar-envelope-${sha(body)}`, observedAt: now(),
        source: { kind: 'ENGINE_FACT', producer: `${ADAPTER_ID}@${ADAPTER_VERSION}`,
          engineRead: 'core.get_connected_players() == 1; ObjectRef:get_properties().collisionbox',
          derivation: 'extents only: width=x2-x1, height=y2-y1, depth=z2-z1; offsets/position/yaw not released',
          playerSelection: 'exactly one connected player, else refused (no guessed player)' },
        lifetime: { validWhile: ['same connection incarnation', 'same player (playerRef)', 'same engine-reported box'],
          note: 'an observation, not a subscription: re-read before use; Prepare still rechecks bodies (INV-BODY-RECHECK-AT-PREPARE)' } };
      return publish(list, record, (a, b) => {
        const out = domainChanges(a, b);
        if (a.playerRef !== b.playerRef) out.push('PLAYER_CHANGED');
        if (canonicalJSON(a.avatarDimensions) !== canonicalJSON(b.avatarDimensions)) out.push('ENVELOPE_CHANGED');
        return out;
      });
    },
    async worldEditFacts(row, engine) {
      const list = ledger(row.worldRef).worldedit, domain = domainOf(row);
      const before = validateType('Catalogue', await engine.catalogue());
      const runtime = await engine.worldEditRuntime();
      const after = validateType('Catalogue', await engine.catalogue());
      if (before.gameRevision !== after.gameRevision) throw refusal('CURRENT_WORLD_MISMATCH', 'REVISION_CHANGED', 'CATALOGUE_CHANGED_DURING_READ');
      if (typeof runtime?.modListed !== 'boolean' || typeof runtime?.apiTable !== 'boolean')
        throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', 'WORLDEDIT_RUNTIME_UNREADABLE');
      const modRevision = Object.hasOwn(after.modRevisions, 'worldedit') ? after.modRevisions.worldedit : null;
      const listed = runtime.modListed && modRevision !== null;
      // Both the loaded-mod list and the runtime API must agree; otherwise UNKNOWN.
      const loadState = listed && runtime.apiTable ? 'LOADED'
        : !runtime.modListed && modRevision === null && !runtime.apiTable ? 'NOT_LOADED' : 'UNKNOWN';
      const hasVersion = typeof runtime.versionString === 'string' && runtime.versionString !== '';
      const version = loadState !== 'LOADED' ? { status: 'UNKNOWN', reason: loadState === 'NOT_LOADED' ? 'NOT_LOADED' : 'LOAD_STATE_UNKNOWN' }
        : hasVersion ? { status: 'KNOWN', value: runtime.versionString,
          major: Number.isInteger(runtime.versionMajor) ? runtime.versionMajor : null,
          minor: Number.isInteger(runtime.versionMinor) ? runtime.versionMinor : null,
          source: 'loaded mod runtime: worldedit.version_string / worldedit.version' }
        : { status: 'UNKNOWN', reason: 'VERSION_NOT_EXPOSED_BY_LOADED_MOD' };
      const body = { profileVersion: WORLDEDIT_FACTS_VERSION, loadState, version,
        catalogue: { gameId: after.gameId, gameRevision: after.gameRevision, worldeditModRevision: modRevision,
          meaning: 'loaded-registry fingerprint (sha256(mod|gameRevision)), not a Git/package revision' },
        domain };
      const record = { ...body, revision: `worldedit-runtime-${sha(body)}`, observedAt: now(),
        source: { kind: 'ENGINE_FACT', producer: `${ADAPTER_ID}@${ADAPTER_VERSION}`,
          engineRead: 'core.get_modnames(); rawget(_G, "worldedit"); Catalogue (fact_catalogue) read before and after' },
        lifetime: { validWhile: ['same connection incarnation', 'same Catalogue gameRevision'] } };
      return publish(list, record, (a, b) => {
        const out = domainChanges(a, b);
        if (a.catalogue.gameRevision !== b.catalogue.gameRevision) out.push('CATALOGUE_CHANGED');
        if (a.loadState !== b.loadState || canonicalJSON(a.version) !== canonicalJSON(b.version)) out.push('WORLDEDIT_CHANGED');
        return out;
      });
    },
    /** World left this Adapter (retire/close): nothing stays current for it. */
    withdrawWorld(worldRef, reason) {
      const l = ledgers.get(worldRef); if (!l) return;
      withdraw(l.avatar, [reason]); withdraw(l.worldedit, [reason]);
    },
    withdrawAll(reason) { for (const worldRef of ledgers.keys()) this.withdrawWorld(worldRef, reason); },
    /** Current and retired entries for a World (no names, no positions). */
    ledger(worldRef) {
      const l = ledgers.get(worldRef) ?? { avatar: [], worldedit: [] };
      const view = e => ({ state: e.state, revision: e.revision, publishedAt: e.publishedAt,
        retiredAt: e.retiredAt ?? null, retiredBy: e.retiredBy ?? null, reasons: e.reasons ?? null });
      return { worldRef, avatarEnvelope: l.avatar.map(view), worldEdit: l.worldedit.map(view) };
    },
  };
}
