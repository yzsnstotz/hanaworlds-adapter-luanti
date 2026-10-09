import { createHash } from 'node:crypto';
import { validateType, canonicalJSON, digestValue } from '#contracts';
import { ADAPTER_ID, ADAPTER_VERSION } from './version.mjs';

/** Stage 1 engine facts for Canvas configuration. Read-only, in memory only.
 *
 * - config-engine-facts/v1 (shape of the contracts 0.5.5-rc.1 candidate port
 *   ConfigEngineFactsPort.readConfigEngineFacts): the write backend the loaded payload
 *   declares, and the avatar envelope, which is always UNAVAILABLE: actual collision
 *   boxes and their pose-dependent sizes are used only inside the engine
 *   (INV-POSE-STAYS-IN-ENGINE; Prepare body recheck unchanged). No design size or
 *   default is produced.
 * - adapter-worldedit-runtime/v1: what WorldEdit the running engine actually loaded.
 *
 * A missing fact is a named refusal or UNAVAILABLE; no package version or default stands in. */
export const CONFIG_ENGINE_FACTS_VERSION = 'config-engine-facts/v1';
export const WORLDEDIT_FACTS_VERSION = 'adapter-worldedit-runtime/v1';
// Pending the contract batch: the candidate enum has no value for "no public source".
export const AVATAR_UNAVAILABLE_REASON = 'NO_PUBLIC_SOURCE';
const sha = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');

/** contracts 0.5.4 has no 'config-engine-facts' digest kind. This is the candidate's
 * declared rule (profile digest.domainPrefixByKind + kind + domainSuffix); replace with
 * digestValue('config-engine-facts', …) when the tagged contract is pinned. */
export function configEngineFactsRevision(projection) {
  return createHash('sha256').update('HanaWorlds|config-engine-facts/v1|config-engine-facts|' + canonicalJSON(projection), 'utf8').digest('hex');
}

/** Named refusal: the public code stays in the contract vocabulary; `detail`
 * is this Adapter's own label of what is missing (not a wire error). */
export function refusal(code, reason, detail) {
  return Object.assign(new Error(code), { code, reason, detail, publicError: { code, reason } });
}

export function domainOf(row) {
  return { worldRef: row.worldRef, connectionRef: row.connectionRef,
    connectionIncarnationRef: row.incarnation, payloadVersion: row.payloadVersion, payloadDigest: row.payloadDigest };
}

export function createStage1Facts() {
  const ledgers = new Map(); // worldRef -> { config: Entry[], worldedit: Entry[] }
  const ledger = worldRef => {
    if (!ledgers.has(worldRef)) ledgers.set(worldRef, { config: [], worldedit: [] });
    return ledgers.get(worldRef);
  };
  const now = () => new Date().toISOString();

  /** Publish one observation; the previous current entry is retired with the
   * reasons it no longer holds. Retired entries are never returned as current. */
  function publish(list, revision, meta, record, compare) {
    const previous = list.find(e => e.state === 'CURRENT');
    if (previous && previous.revision === revision) return { record: previous.record, supersedes: previous.supersedes };
    let supersedes = null;
    if (previous) {
      const reasons = compare(previous.meta, meta);
      Object.assign(previous, { state: 'RETIRED', retiredAt: now(), retiredBy: revision, reasons });
      supersedes = { revision: previous.revision, reasons };
    }
    list.push({ state: 'CURRENT', revision, meta, record, supersedes, publishedAt: now() });
    return { record, supersedes };
  }
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
  /** Catalogue read before and after `read`: the facts belong to one registry snapshot. */
  async function stableCatalogue(engine, read) {
    const before = validateType('Catalogue', await engine.catalogue());
    const value = await read();
    const after = validateType('Catalogue', await engine.catalogue());
    if (before.gameRevision !== after.gameRevision) throw refusal('CURRENT_WORLD_MISMATCH', 'REVISION_CHANGED', 'CATALOGUE_CHANGED_DURING_READ');
    return { catalogue: after, value };
  }

  return {
    /** config-engine-facts/v1 for the exact paired world (candidate port shape). */
    async configEngineFacts(row, engine) {
      const list = ledger(row.worldRef).config, domain = domainOf(row);
      const { catalogue, value: raw } = await stableCatalogue(engine, async () => {
        try { return await engine.writeBackend(); }
        catch (error) { if (error.message === 'NOT_DECLARED_BY_PAYLOAD') return { notDeclared: true }; throw error; }
      });
      let writeBackend;
      if (raw?.notDeclared) writeBackend = { availability: 'UNAVAILABLE', reason: 'NOT_DECLARED_BY_PAYLOAD' };
      else if (typeof raw?.backendProfileId !== 'string' || !raw.backendProfileId || typeof raw.ready !== 'boolean')
        writeBackend = { availability: 'UNAVAILABLE', reason: 'ENGINE_FACT_UNREADABLE' };
      else if (raw.nodeWriteSemantics !== 'explicit-nodeName-param2-static-v2')
        throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', 'WRITE_BACKEND_SEMANTICS_UNSUPPORTED');
      else if (!raw.ready) throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', 'WRITE_BACKEND_NOT_READY');
      else writeBackend = { availability: 'KNOWN', basis: 'LOADED_PAYLOAD_DECLARATION',
        backendProfileId: validateType('Ref', raw.backendProfileId), nodeWriteSemantics: raw.nodeWriteSemantics };
      const projection = { profileVersion: CONFIG_ENGINE_FACTS_VERSION,
        connection: { worldRef: domain.worldRef, connectionRef: domain.connectionRef, connectionIncarnationRef: domain.connectionIncarnationRef },
        catalogueDigest: digestValue('catalogue', catalogue).sha256,
        avatarEnvelope: { availability: 'UNAVAILABLE', reason: AVATAR_UNAVAILABLE_REASON },
        writeBackend };
      const record = { ...projection, sourceRevision: configEngineFactsRevision(projection) };
      const meta = { domain, gameRevision: catalogue.gameRevision, writeBackend };
      return publish(list, record.sourceRevision, meta, record, (a, b) => {
        const out = domainChanges(a, b);
        if (a.gameRevision !== b.gameRevision) out.push('CATALOGUE_CHANGED');
        if (canonicalJSON(a.writeBackend) !== canonicalJSON(b.writeBackend)) out.push('WRITE_BACKEND_CHANGED');
        return out;
      }).record;
    },
    async worldEditFacts(row, engine) {
      const list = ledger(row.worldRef).worldedit, domain = domainOf(row);
      const { catalogue: after, value: runtime } = await stableCatalogue(engine, () => engine.worldEditRuntime());
      if (typeof runtime?.modListed !== 'boolean' || typeof runtime?.apiTable !== 'boolean')
        throw refusal('CAPABILITY_UNAVAILABLE', 'REQUIRED_FACT_UNKNOWN', 'WORLDEDIT_RUNTIME_UNREADABLE');
      const modRevision = Object.hasOwn(after.modRevisions, 'worldedit') ? after.modRevisions.worldedit : null;
      const listed = runtime.modListed && modRevision !== null;
      // The loaded-mod list, the Catalogue and the runtime API must agree; otherwise UNKNOWN.
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
      const record = { ...body, revision: `worldedit-runtime-${sha(body)}`,
        source: { kind: 'ENGINE_FACT', producer: `${ADAPTER_ID}@${ADAPTER_VERSION}`,
          engineRead: 'core.get_modnames(); rawget(_G, "worldedit"); Catalogue read before and after' },
        lifetime: { validWhile: ['same connection incarnation', 'same Catalogue gameRevision'] } };
      const out = publish(list, record.revision, { domain, gameRevision: after.gameRevision, loadState, version }, record, (a, b) => {
        const r = domainChanges(a, b);
        if (a.gameRevision !== b.gameRevision) r.push('CATALOGUE_CHANGED');
        if (a.loadState !== b.loadState || canonicalJSON(a.version) !== canonicalJSON(b.version)) r.push('WORLDEDIT_CHANGED');
        return r;
      });
      return { ...out.record, supersedes: out.supersedes };
    },
    /** World left this Adapter (retire/close): nothing stays current for it. */
    withdrawWorld(worldRef, reason) {
      const l = ledgers.get(worldRef); if (!l) return;
      withdraw(l.config, [reason]); withdraw(l.worldedit, [reason]);
    },
    withdrawAll(reason) { for (const worldRef of ledgers.keys()) this.withdrawWorld(worldRef, reason); },
    /** Current and retired entries for a World (revisions and reasons only). */
    ledger(worldRef) {
      const l = ledgers.get(worldRef) ?? { config: [], worldedit: [] };
      const view = e => ({ state: e.state, revision: e.revision, publishedAt: e.publishedAt,
        retiredAt: e.retiredAt ?? null, retiredBy: e.retiredBy ?? null, reasons: e.reasons ?? null });
      return { worldRef, configEngineFacts: l.config.map(view), worldEdit: l.worldedit.map(view) };
    },
  };
}
