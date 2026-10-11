import { validateType, canonicalJSON, digestValue, ContractError } from '#contracts';

/** Loaded-world config-engine-facts/v2, checked against one neutral Catalogue snapshot.
 * Backend identity is read from the payload declaration. Player geometry stays engine-only;
 * the released AvatarEnvelopeFact permits UNAVAILABLE/NO_PUBLIC_SOURCE only.
 * Native backend readiness is independent of historical WorldEdit diagnostics. */
export const CONFIG_ENGINE_FACTS_VERSION = 'config-engine-facts/v2';
// The exact candidate permits only this avatar form; no public geometry source.
export const AVATAR_UNAVAILABLE_REASON = 'NO_PUBLIC_SOURCE';

/** Exact candidate SDK digest rule; no local alternate digest implementation. */
export function configEngineFactsRevision(projection) {
  return digestValue('config-engine-facts', projection).sha256;
}

/** Named refusal: the public code stays in the contract vocabulary; `detail`
 * is this Adapter's own label of what is missing (not a wire error). */
export function refusal(code, reason, detail) {
  return Object.assign(new ContractError(code, 'validate', reason), { detail });
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
    if (canonicalJSON(before.engineRevisions) !== canonicalJSON(after.engineRevisions)) throw refusal('CURRENT_WORLD_MISMATCH', 'REVISION_CHANGED', 'CATALOGUE_CHANGED_DURING_READ');
    return { catalogue: after, value };
  }

  return {
    /** config-engine-facts/v2 for the exact paired world (published port shape). */
    async configEngineFacts(row, engine) {
      const list = ledger(row.worldRef).config, domain = domainOf(row);
      const { catalogue, value: raw } = await stableCatalogue(engine, async () => {
        try { return await engine.writeBackend(); }
        catch (error) { if (error.message === 'NOT_DECLARED_BY_PAYLOAD') return { notDeclared: true }; throw error; }
      });
      let writeBackend;
      if (raw?.notDeclared) writeBackend = { availability: 'UNAVAILABLE', reason: 'NOT_DECLARED_BY_PAYLOAD' };
      else if (typeof raw?.writeBackend?.profileId !== 'string' || !raw.writeBackend.profileId || typeof raw?.writeBackend?.revision !== 'string' || !raw.writeBackend.revision || typeof raw.ready !== 'boolean')
        writeBackend = { availability: 'UNAVAILABLE', reason: 'ENGINE_FACT_UNREADABLE' };
      else if (!raw.ready) writeBackend = { availability: 'UNAVAILABLE', reason: 'ENGINE_FACT_UNREADABLE' };
      else writeBackend = { availability: 'KNOWN', basis: 'LOADED_PAYLOAD_DECLARATION',
        writeBackend:validateType('WriteBackendRef',raw.writeBackend) };
      const projection = { profileVersion: CONFIG_ENGINE_FACTS_VERSION,
        connection: { worldRef: domain.worldRef, connectionRef: domain.connectionRef, connectionIncarnationRef: domain.connectionIncarnationRef },
        catalogueDigest: digestValue('catalogue', catalogue).sha256,
        avatarEnvelope: { availability: 'UNAVAILABLE', reason: AVATAR_UNAVAILABLE_REASON },
        writeBackend };
      const record = validateType('ConfigEngineFacts', { ...projection, sourceRevision: configEngineFactsRevision(projection) });
      const meta = { domain, engineRevisions: catalogue.engineRevisions, writeBackend };
      return publish(list, record.sourceRevision, meta, record, (a, b) => {
        const out = domainChanges(a, b);
        if (canonicalJSON(a.engineRevisions) !== canonicalJSON(b.engineRevisions)) out.push('CATALOGUE_CHANGED');
        if (canonicalJSON(a.writeBackend) !== canonicalJSON(b.writeBackend)) out.push('WRITE_BACKEND_CHANGED');
        return out;
      }).record;
    },
    /** World left this Adapter (retire/close): nothing stays current for it. */
    withdrawWorld(worldRef, reason) {
      const l = ledgers.get(worldRef); if (!l) return;
      withdraw(l.config, [reason]);
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
