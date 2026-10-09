# Stage 1 engine fact supply (Adapter 0.8.3 / payload 0.6.2 / contracts git #semver:^0.5.6)

2026-10-09 · hanaworlds-adapter-luanti-SUPPLY-01 · **SOURCE + FIXTURE only.** No real Luanti,
World, Session or player has been read with this code. The real read needs a separate PM GO.

Supersedes 0.8.0 / payload 0.6.1, which released the player's collision-box size. Under the
current INV-POSE-STAYS-IN-ENGINE ruling, actual collision boxes and their pose-dependent sizes are
used only inside the engine and never leave the Adapter; 0.8.0 is withdrawn and must not be consumed.

## Interface (additive, in-process)

New methods on the existing Host service key `hanaworldsLuantiNativeFacts` (the key Canvas already
consumes for `readCatalogue`). No new key, wire, operation or contract type.

| Method | Returns | Refusals |
| --- | --- | --- |
| `readConfigEngineFacts(worldRef)` | `config-engine-facts/v1` record, the shape of the contracts 0.5.5-rc.1 candidate `ConfigEngineFactsPort` (below) | `SCHEMA_INVALID`, `ADAPTER_UNAVAILABLE`, `WORLD_NOT_BOUND`, `CURRENT_WORLD_MISMATCH` (+ `detail: CATALOGUE_CHANGED_DURING_READ`); `CAPABILITY_UNAVAILABLE`/`REQUIRED_FACT_UNKNOWN` + `detail` `WRITE_BACKEND_SEMANTICS_UNSUPPORTED` (typed ContractError); unreadable/not-ready backend is UNAVAILABLE/ENGINE_FACT_UNREADABLE |
| `readWorldEditFacts(worldRef)` | `adapter-worldedit-runtime/v1` record (below) | as above; `detail: WORLDEDIT_RUNTIME_UNREADABLE` |
| `readStage1FactLedger(worldRef)` | `{worldRef, configEngineFacts[], worldEdit[]}`: `{state: CURRENT|RETIRED, revision, publishedAt, retiredAt, retiredBy, reasons}` | `SCHEMA_INVALID` |

`detail` values are this Adapter's labels, not contract error codes.

### config-engine-facts/v1

```
{ profileVersion: 'config-engine-facts/v1',
  connection: { worldRef, connectionRef, connectionIncarnationRef },   // the exact paired connection
  catalogueDigest,                                                      // digestValue('catalogue', Catalogue) of the same registry snapshot
  avatarEnvelope: { availability: 'UNAVAILABLE', reason: 'NO_PUBLIC_SOURCE' },
  writeBackend: { availability: 'KNOWN', basis: 'LOADED_PAYLOAD_DECLARATION',
                  backendProfileId: 'hanaworlds-luanti-worldedit-cell-write/v1',
                  nodeWriteSemantics: 'explicit-nodeName-param2-static-v2' }
              | { availability: 'UNAVAILABLE', reason: 'NOT_DECLARED_BY_PAYLOAD' | 'ENGINE_FACT_UNREADABLE' },
  sourceRevision }                                                      // sha256('HanaWorlds|config-engine-facts/v1|config-engine-facts|' + canonical(projection))
```

- **avatarEnvelope is always UNAVAILABLE.** The payload produces no collision box, size, position,
  yaw, player name or player count for this read; player presence and pose do not change any
  output (tested). No design size such as 1×2×1 is produced. Body safety stays where it was:
  InspectRegion body occupancy and the Prepare recheck of every connected player's actual box
  (INV-BODY-RECHECK-AT-PREPARE), both inside the engine. The exact dcbe/0.5.5-rc.1 schema fixes this form to `UNAVAILABLE/NO_PUBLIC_SOURCE`.
- **writeBackend** comes only from the loaded payload: `engine.lua` `WRITE_BACKEND` declares the
  backend `Engine:apply` implements (one WorldEdit `set` + `set_param2` per effect cell, then a light
  refresh). It is KNOWN only when the running engine can execute it (WorldEdit `set`/`set_param2`,
  `fix_light`, `get_node_light`). Not adapterId, payloadVersion, package version or a default.
  Changing that write path requires a new `backendProfileId`. The id string is the payload's
  declaration; its spelling is this worker's choice.
- **sourceRevision**: exact candidate SDK `digestValue('config-engine-facts', projection).sha256`;
  all emitted records pass `validateType('ConfigEngineFacts')`. Since 0.8.3 contracts come from the
  contract source as `#semver:^0.5.6` (first released version with these fields), checked offline by
  `scripts/verify-contracts-range.mjs`; no exact pin or pack manifest. SOURCE/FIXTURE only.

### WorldEdit (adapter-worldedit-runtime/v1)

- **Source**: payload `facts.worldedit_runtime` → `core.get_modnames()` and `rawget(_G,'worldedit')`
  (`version_string`, `version.major/minor` as exposed by the loaded mod); Catalogue before/after.
- **loadState**: `LOADED` (in loaded mod list, in Catalogue `modRevisions`, API table present),
  `NOT_LOADED` (none of the three), `UNKNOWN` (they disagree).
- **version**: `KNOWN` with the loaded mod's own value, or `UNKNOWN` with reason
  `VERSION_NOT_EXPOSED_BY_LOADED_MOD` / `NOT_LOADED` / `LOAD_STATE_UNKNOWN`. npm/Git/package
  versions are never used.
- **catalogue.worldeditModRevision**: the existing Catalogue value (what Canvas uses as
  `worldeditRevision`) — a loaded-registry fingerprint `sha256('worldedit|'+gameRevision)`.
- The existing payload handshake refuses to pair a World without the WorldEdit API, so on a bound
  World `NOT_LOADED` is not reachable; it shows as that pairing refusal.

### Lifecycle

Adapter memory only, not persisted or logged. A differing observation retires the previous current
entry with reasons (`CONNECTION_DOMAIN_CHANGED`, `PAYLOAD_CHANGED`, `CATALOGUE_CHANGED`,
`WRITE_BACKEND_CHANGED`, `WORLDEDIT_CHANGED`). `retireLocal` withdraws the World
(`CONNECTION_RETIRED`), Adapter close withdraws all (`ADAPTER_CLOSED`), a connection change seen
after a read withdraws the World. Retired entries are never returned as current.

## Version impact

Payload **0.6.0 → 0.6.2**, Adapter **0.7.9 → 0.8.2**. A World provisioned with payload 0.6.0 is not
adopted until 0.6.2 is provisioned into it (`PROVISION_PAYLOAD`, writes `worldmods/hanaworlds_adapter`).

## Development page (FIXTURE input)

`HW_STAGE1_RUN=<own run dir> PORT=47615 dev/stage1-supply/start.sh` → `http://127.0.0.1:47615/`. Real Adapter
public path; fixture native Host model and fixture engine `core`, labelled on the page and in every
response. `dev/stage1-supply/browser-walk.mjs` walks it.

## Tests

`npm run test:stage1` (8 Node tests through the public path + payload Lua test).

`npm run test:config-facts`: candidate provider valid/invalid public fixtures, consumer decisions and Adapter producer conformance (SOURCE/FIXTURE).
