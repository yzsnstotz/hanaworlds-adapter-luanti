# Stage 1 engine fact supply (Adapter 0.8.0 / payload 0.6.1 / contracts 0.5.4)

2026-10-09 · hanaworlds-adapter-luanti-SUPPLY-01 · **SOURCE + FIXTURE only.** No real Luanti,
World, Session or player has been read with this code. The real read needs a separate PM GO.

## Interface (additive, in-process)

Three new methods on the existing Host service key `hanaworldsLuantiNativeFacts`
(same key Canvas already consumes for `readCatalogue`). No new key, wire or contract type.

| Method | Returns | Refusals |
| --- | --- | --- |
| `readAvatarEnvelope(worldRef)` | `adapter-avatar-envelope/v1` record (below) | `SCHEMA_INVALID`, `ADAPTER_UNAVAILABLE`, `WORLD_NOT_BOUND`, `CURRENT_WORLD_MISMATCH`; `CAPABILITY_UNAVAILABLE` + `reason: REQUIRED_FACT_UNKNOWN` + `detail` ∈ `PLAYER_NOT_CONNECTED`, `PLAYER_NOT_SINGULAR`, `COLLISIONBOX_UNREADABLE` |
| `readWorldEditFacts(worldRef)` | `adapter-worldedit-runtime/v1` record (below) | as above; `CURRENT_WORLD_MISMATCH` + `detail: CATALOGUE_CHANGED_DURING_READ`; `CAPABILITY_UNAVAILABLE` + `detail: WORLDEDIT_RUNTIME_UNREADABLE` |
| `readStage1FactLedger(worldRef)` | `{worldRef, avatarEnvelope[], worldEdit[]}`: `{state: CURRENT|RETIRED, revision, publishedAt, retiredAt, retiredBy, reasons}` | `SCHEMA_INVALID` |

`detail` values are this Adapter's labels for what is missing, not contract error codes
(the public `code`/`reason` stay in the contracts 0.5.4 vocabulary).

### Collision envelope

- **Source**: payload `facts.avatar_envelope` → `core.get_connected_players()`; exactly one player,
  `ObjectRef:get_properties().collisionbox` (6 finite numbers, positive extents).
- **Released**: only `avatarDimensions` — contract type `AvatarDimensions`
  `{width: x2-x1, height: y2-y1, depth: z2-z1, unit: 'luanti-node'}` — and `playerRef`,
  `sha256(<per-Adapter-run random salt>|<player name>)` computed inside the engine.
- **Never released, persisted or logged**: position, yaw/look, box offsets, player name
  (INV-POSE-STAYS-IN-ENGINE). Player selection follows INV-PLACEMENT-ASK-NEVER-GUESS-PLAYER:
  none or several connected players is a named refusal, never a guessed player.
  No design size (e.g. 1×2×1) is ever substituted.
- **Domain**: `{worldRef, connectionRef, connectionIncarnationRef, payloadVersion, payloadDigest}`.
- **Revision**: `avatar-envelope-<sha256(canonical {profileVersion, avatarDimensions, playerRef, domain})>`.
- **Lifetime**: an observation, valid while the connection incarnation, the player and the
  engine-reported box are unchanged. Box sizes are pose-dependent in real games (e.g. sneaking,
  swimming), so consumers re-read before use. Prepare still rechecks every body
  (INV-BODY-RECHECK-AT-PREPARE); this fact never replaces that check.

### WorldEdit

- **Source**: payload `facts.worldedit_runtime` → `core.get_modnames()` and `rawget(_G,'worldedit')`
  (`version_string`, `version.major/minor` as exposed by the loaded mod); Catalogue read before and
  after (same `gameRevision` required).
- **loadState**: `LOADED` (in loaded mod list, in Catalogue `modRevisions`, API table present),
  `NOT_LOADED` (none of the three), `UNKNOWN` (they disagree).
- **version**: `KNOWN` with the loaded mod's own value, or `UNKNOWN` with reason
  `VERSION_NOT_EXPOSED_BY_LOADED_MOD` / `NOT_LOADED` / `LOAD_STATE_UNKNOWN`.
  npm/Git/package versions are never used.
- **catalogue.worldeditModRevision**: the existing Catalogue value — a loaded-registry fingerprint
  `sha256('worldedit|'+gameRevision)`, not a Git/package revision.
- **Pairing fact**: the existing payload handshake already refuses to pair a World whose engine has
  no WorldEdit API (`PAYLOAD_VERSION_MISMATCH` → `CURRENT_WORLD_MISMATCH` at the port). So on a
  bound World `NOT_LOADED` is not reachable; it shows as that pairing refusal.

### Lifecycle (both facts)

Kept in Adapter memory only. A new observation that differs retires the previous current entry
with reasons (`ENVELOPE_CHANGED`, `PLAYER_CHANGED`, `CONNECTION_DOMAIN_CHANGED`, `PAYLOAD_CHANGED`,
`CATALOGUE_CHANGED`, `WORLDEDIT_CHANGED`). A refusal for a missing player withdraws the current
envelope (`PLAYER_NOT_CONNECTED` …). `retireLocal` withdraws everything for the World
(`CONNECTION_RETIRED`), Adapter close withdraws all (`ADAPTER_CLOSED`); a connection change detected
after a read withdraws the World (`CONNECTION_DOMAIN_CHANGED`). Retired entries are never returned
as current. The ledger is per Adapter run and is not persisted.

## Not supplied

- `CompilationConfig.backendProfileId`: contracts 0.5.4 defines only `Ref`. Its meaning and producer
  await C-STAGE1-CONFIG-SEAM-01. Nothing is substituted (no adapterId/payloadVersion/default).

## Version impact

Payload bytes changed: payload **0.6.0 → 0.6.1**, Adapter **0.7.9 → 0.8.0**. As for every earlier
payload change, a World provisioned with payload 0.6.0 is not adopted by 0.8.0 until the 0.6.1
payload is provisioned into it (`PROVISION_PAYLOAD`, writes `worldmods/hanaworlds_adapter` only).

## Development page (FIXTURE input)

`HW_STAGE1_RUN=<own run dir> dev/stage1-supply/start.sh` → `http://127.0.0.1:47614/`.
Real Adapter public path (apply → local-world port provision/pair → courier → payload facts.lua);
fixture native Host model and fixture engine `core` (players, boxes, mods, WorldEdit global),
labelled on the page and in every response. `dev/stage1-supply/browser-walk.mjs` walks it.

## Tests

`npm run test:stage1` (7 Node tests through the public path + payload Lua test).
