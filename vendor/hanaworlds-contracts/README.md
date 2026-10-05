# hanaworlds-contracts 0.3.6 source candidate

## Trusted Session original authorization (0.3.6 increment)

`session-authorization/v1` exposes two read-only operations. A trusted Host's `ReadOriginalBinding` reads its own durable issuance for the exact live Core Session incarnation, including the original world, Luanti player, grant reference, Host authorization and binding references, grant epoch, actor and allowed actions. Missing legacy proof is `UNKNOWN` and remains read-only; revocation and Session replacement have distinct statuses. A trusted Adapter's `VerifyCurrentGrant` takes that original record and checks the paired Luanti game's current grant, returning `CURRENT` only for an exact original reference, world, player, epoch and scope match. Regrant cannot silently replace the original proof. Both services authenticate their caller outside request JSON, and the Host must recheck its live Session binding before a write. Validators check shape and correlation only; they cannot authenticate the source or perform a game check. Consumers require `checkSessionAuthorizationHandshake` before either operation. The authored profile is `spec/v4/SESSION_AUTH_EXTENSION.json`, exported with the generated schemas and TypeScript binding. Existing `session/v2`, `world-adapter/v5` and Canvas operations retain their shapes. This is SOURCE/FIXTURE evidence only.

## Current Workshop build entry (0.3.5 increment)

`session/v2` adds `AdvanceCurrentBuild`. A trusted Shell host supplies its live actor, Session, world, original game grant and displayed confirmed turn revision. Workshop authenticates that binding, selects the latest confirmed turn and current build phase from its own durable state, then derives any placement, plan, compilation, analysis or Canvas transaction identity internally. The request has no caller-supplied turn, transaction, object or invocation ID. It returns a typed pending phase, placement choice `InteractionFrame`, durable Canvas `VERIFIED` Apply receipt, or a typed error. Each phase checks its current operation-specific grant; an exact durable request replay returns the recorded outcome without another world write, while a changed payload for the same request ID is rejected. `checkBuildEntryHandshake` requires `hanaworlds-contracts@0.3.5` or `@0.3.6` even though the wire remains `session/v2`. `validateBuildEntryContext` accepts provider-supplied facts for pure conformance only; it does not authenticate those facts. The authored extension is `spec/v4/CURRENT_BUILD_ENTRY_EXTENSION.json`, shipped as `hanaworlds-contracts/v4/profile/CURRENT_BUILD_ENTRY_EXTENSION`. Existing confirmation, Undo and Canvas/Adapter transaction shapes remain unchanged. This is a FIXTURE contract candidate; no Workshop, Desktop or world runtime is claimed.

## Trusted pending Undo recovery (0.3.4 increment)

`session/v2` adds service-only `RecoverPendingUndo`; `canvas/v4` adds `RecoverPendingUndo` and read-only `ReadPendingUndoResult`. `checkUndoRecoveryHandshake(peerAdvertisement)` requires both existing wire majors and a `hanaworlds-contracts@0.3.4` or `@0.3.5` or `@0.3.6` advertisement before use. The authored protocol is `spec/v4/UNDO_RECOVERY_EXTENSION.json`, shipped as `hanaworlds-contracts/v4/profile/UNDO_RECOVERY_EXTENSION`. Earlier peers fail closed for these operations; the existing `UndoCurrentBuild` request and response are unchanged.

The host supplies an authenticated `serviceRecoveryRef` independently of the old user `authorizationRef`. Workshop selects its own durable pending Undo and obtains the original request identity from that record. Canvas selects its own durable post-barrier Undo, compares original actor, Session, world, authorization and request identity, and alone decides recovery. A merely `RESERVED` request cannot start a new Undo after revocation. Client-supplied internal transaction or object IDs are rejected. `validateUndoRecoveryRecord` and `validateUndoRecoveryResponse` check pure record and response correlation; they do not authenticate the service or prove that a record was loaded from durable storage.

The result distinguishes `VERIFIED`, `ROLLED_BACK`, `RECOVERY_PENDING` and `UNKNOWN`. Only `VERIFIED` carries a matching verified receipt; `UNKNOWN` never implies success. Missing or mismatched durable records are typed rejections. Workshop and Canvas must enforce these rules in their own real providers; this package supplies SOURCE/FIXTURE conformance only.

## Scoped same-world transaction wire (0.3.3 increment)

`world-adapter/v5` is a distinct public port for `PrepareRecoverableTransaction`, `ApplyCompiledTransaction` and `QueryPreparedTransaction`. Before using it, call `checkScopedWorldHandshake(peerAdvertisement)` and require `world-adapter/v5` and `hanaworlds-contracts@0.3.3`, `@0.3.4` or `@0.3.5` or `@0.3.6`. A 0.3.2 peer that only advertises v4 is rejected with `UNSUPPORTED_VERSION`; an old v4 validator rejects a v5 request. Do not downgrade a scoped transaction to v4.

`ScopedWorldBinding` names one `worldRef`, the transaction, operation and authorization binding digests, a state profile, the exact checked positions, Canvas registered object refs with nonempty real footprints and registry revisions, and one known current-state digest per position in their union. `scopeDigest = digestValue('scoped-world', scope).sha256`; `ScopedTxProjection` carries that digest into the prepared transaction payload and its own `scoped-transaction-payload` digest. The same scope and digest must survive Prepare, QueryPrepared, Apply and replay. `validateScopedTransition(prepare, apply)` checks the pure cross-envelope relation. `projectScopedPreparedTransaction(result)` removes the response-only before-state readback digest for Apply.

Canvas must derive object footprints from its durable registry. The Adapter must verify the paired world and service identity, read every named cell and its complete state under `stateProfile`, reject unknown or unloaded cells, and compare the same positions, object footprints and current states again immediately before the durable write barrier. The Adapter must persist the prepared scope binding and reject a replay or QueryPrepared with a changed digest. The historical `authorizationBinding.worldRevision` is still part of grant provenance; it is not a whole-world freshness gate on this v5 path. An edit outside the scoped positions leaves the scoped digest unchanged. Actual authenticity, engine reads, revocation, protection and recovery remain provider responsibilities; these source fixtures do not execute Luanti or Canvas.

`spec/v4/SCOPED_WORLD_EXTENSION.json` is the authored extension and ships at `hanaworlds-contracts/v4/profile/SCOPED_WORLD_EXTENSION`. The approved 0.3.0 base profile, 0.3.1 readback and 0.3.2 undo source inputs retain their bytes. `npm run test:v4`, `npm run typecheck` and `npm run verify:source` verify the contract lane. The generator embeds the complete definitions bundle in every v4 schema file, so adding 16 types and two digest projections regenerates all v4 schema artifacts; their prior definitions remain unchanged.

## Current-build undo contract (0.3.2 increment)

`canvas/v4` now admits `HistoryQuery.expectedHistoryRevision: null` for a fresh, authorized, read-only durable current history snapshot. A nonnull revision retains its exact CAS meaning. `session/v2` adds `ReadCurrentUndoStatus` and `UndoCurrentBuild`. Both carry trusted actor, Session, authorization and world context; the undo request also carries the turn and history revisions returned by status readback for CAS. Callers supply no object or transaction ID. Status distinguishes `AVAILABLE`, `NO_VERIFIED_BUILD` and `NO_UNDO_AT_HEAD`; a successful undo reports `VERIFIED` with before and after durable heads. The provider must derive the current build from a persisted same-Session VERIFIED Apply, let Canvas decide the authorized Undo, and query durable Canvas history again after a VERIFIED receipt before it reports success. The contract does not execute Undo or authenticate caller JSON.

`checkSessionUndoHandshake(peerAdvertisement)` requires a peer advertising `hanaworlds-contracts@0.3.2`, `@0.3.3`, `@0.3.4` or `@0.3.5` or `@0.3.6` and both `canvas/v4` and `session/v2`; an older peer with the same wire majors is rejected with `UNSUPPORTED_VERSION` before these operations. The added types and operation metadata are in `spec/v4/SESSION_UNDO_EXTENSION.json`, published as `hanaworlds-contracts/v4/profile/SESSION_UNDO_EXTENSION`. The 0.3.0 approved profile and 0.3.1 readback extension retain their source bytes. Existing operation shapes are unchanged except the declared nullable HistoryQuery revision.

## session/v2 persisted turn readback (0.3.1 increment)

`hanaworlds-contracts/v4/session/v2` adds `ReadSessionTurnDetails` as a separate read-only operation. Its request carries `actorRef`, `sessionRef`, `requestId` and `authorizationRef`. A successful response returns `sessionRef`, `sessionRevision` and turns in persisted order; every turn has `turnRef`, `turnRevision`, exact original `userText`, complete `resultText` and a confirmed `BriefProjection` or explicit `null` in `confirmedBrief`. A denial returns a typed `Error` and no turn data. The provider must authenticate the trusted context, check current revocation and read durable data; this package validates shape and response codes but cannot authenticate a caller or prove persistence.

The frozen 0.3.0 v4 profile, its approved checker inputs, existing session/v2 operation shapes and digest domains remain unchanged. `spec/v4/SESSION_READBACK_EXTENSION.json` is the additive source for 0.3.1 generated schemas and bindings. Before calling the readback operation across a provider boundary, use `checkSessionReadbackHandshake(peerAdvertisement)`: it accepts a peer advertising `hanaworlds-contracts@0.3.1`, `@0.3.2`, `@0.3.3`, `@0.3.4` or `@0.3.5` or `@0.3.6` and `session/v2`, and rejects an old 0.3.0 peer with `UNSUPPORTED_VERSION`. The general `checkContractHandshake` checks wire majors and fact profiles only; a `session/v2` match alone does not advertise the new operation. Existing consumers can keep using their unchanged operations; a new readback consumer needs compatible provider bytes. This branch is a source candidate, not a published package or runtime/UI acceptance.

Independent **non-runtime** contracts package containing the prior v2 surface, the admitted `canvas/v3` and `world-adapter/v3` surface, and the approved Stage 1 `3.0.0-rc.8` v4 lane (`interaction-surface/v3`, `world-adapter/v4`, `canvas/v4`, `painter/v3`, `target-facts/v3`). This repository does not register a gadget, establish a grant, instantiate a Session/store/transport, connect to an engine or write to a world. Provider gates remain `NOT_RUN`.

The approved Stage 1 `2.0.0-rc.5` bundle adds `NON_CANONICAL_AMBIGUITY` to exactly four `world-adapter/v3` operation response lists and eight response/authorization precedence oracles. It retains the rc.4 correction to three history response lists and thirteen response oracles. The candidate source preserves the seven v2 wires, `operations/v2`, the contracts@0.1.0 digest domain and 19 production digest goldens. The `history-operation` projection retains its contracts@0.2.0 domain. Its public origin is [yzsnstotz/hanaworlds-contracts](https://github.com/yzsnstotz/hanaworlds-contracts). This branch is not an admitted release, registry publication or product acceptance.

HanaWorlds original code is MIT-licensed; the separate Apache-2.0 upstream source fixture retains its own license. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Public surface

The root export contains strict admission, typed validation, immutable protocol inventories, explicit production projections and digest functions. The eight versioned subpaths are `interaction-surface/v2`, `world-adapter/v2`, `canvas/v2`, `session/v2`, `painter/v2`, `ReferenceBrief/v2`, `BUILD/V2`, and `operations/v2`. Case is significant. The first seven expose `validate`, `admit` and `response`. Canvas also exposes `event`; operations exposes `validate`, `admit`, `digest` and `validateCompiledSet`. Painter preserves the explicit alternate `ClarificationNeed` result rather than inventing a Build.

All 243 named types are emitted as TypeScript declarations and self-contained Draft-07 schemas. `schema-inventory` inventories the 244 schema documents, eight bindings, 38 operations, 14 Canvas event types, and 19 digest projections. JavaScript ES modules and TypeScript declarations are the minimum closed language bindings; no Lua provider is included. JSON Schema establishes structure; the public validators also enforce local normative domain invariants. Cross-provider authenticity, durable storage and engine safety cannot be inferred from structurally valid fields.

### v3 migration surface

`hanaworlds-contracts/v3` exposes the candidate v3 runtime and `history-operation` digest. `hanaworlds-contracts/world-adapter/v3` and `hanaworlds-contracts/canvas/v3` are the two changed wire bindings. `hanaworlds-contracts/v3/schemas`, `/v3/schema/*`, `/v3/schema-inventory`, `/v3/fixtures/*` and `/v3/fixture` expose the corresponding 258 named types, 259 schemas, 44 operations, 20 projections and pure oracles. The unchanged v2 paths remain explicit; a v3 mutation port rejects a v2 envelope. Existing v2 projections inside a v3 request keep their version and exact digest bytes.

Canvas v3 `ApplyRecoverableCommit` removes caller `preparedTransaction`. Canvas owns a durable reservation before trusted Adapter Prepare. A direct v2 caller of `CreateObject` cannot use its selected `objectRef` as registration authority in v3; Canvas must pin and match the generated ref against its verified creating transaction. Adapter v3 adds prepare/query/apply/abort history transaction operations for the current verified HanaWorlds author and linked objects. These are contract shapes and synthetic fixture models; the owning providers must implement the authority, durability, recovery and world effects.

```js
import { admitRequest, digestValue } from 'hanaworlds-contracts/v3';
import * as Adapter from 'hanaworlds-contracts/world-adapter/v3';
import * as Canvas from 'hanaworlds-contracts/canvas/v3';

const admitted = admitRequest('canvas/v3', 'ApplyRecoverableCommit', rawBytes);
const historyDigest = digestValue('history-operation', exactHistoryProjection).sha256;
```

The approved rc.3 erratum makes `WA-09-VALID` and `CA-09-VALID` exact v3/v3 handshakes, adds v3/v2 mixed negative cases with zero writes, and sets only the outer `ObjectNameChanged` and `HistoryPositionChanged` event versions to `canvas/v3`. The four internal v2 digest projections and their nineteen goldens remain unchanged. `npm run test:v3` checks all approved valid, invalid and ambiguity cases without exemptions. Independent specification review and admission remain separate from the test result; see [SPEC_CONFLICTS.md](https://github.com/yzsnstotz/hanaworlds-contracts/blob/codex/s1-02-contracts-v4/SPEC_CONFLICTS.md) in the source repository for the correction record.

The rc.4 response patch permits six additional Prepare errors, one QueryPrepared error, and three Apply errors for approved zero-write history outcomes. It leaves Abort and unrelated operations unchanged. Thirteen approved positive and negative response cases exercise the operation-level allowlists; they do not establish provider behavior.

The rc.5 patch permits `NON_CANONICAL_AMBIGUITY` responses from `PrepareRecoverableTransaction`, `ApplyCompiledTransaction`, `PrepareHistoryTransaction` and `ApplyHistoryTransaction` after valid authorization and a mismatched digest. Eight approved response/precedence cases distinguish that outcome from revoked authorization. Query, Abort and unrelated operations remain excluded. This source package validates response shape and allowed codes; it does not verify a provider's authorization ordering.

### v4 lane (contracts@0.3.0, approved Stage 1 `3.0.0-rc.8` with errata `3.0.0-rc.9` and `3.0.0-rc.10`)

`hanaworlds-contracts/v4` is the runtime for the seven current wires `interaction-surface/v3`, `world-adapter/v4`, `canvas/v4`, `session/v2`, `painter/v3`, `ReferenceBrief/v2` and `BUILD/V2`, plus `operations/v2`. The four changed majors have their own subpaths (`hanaworlds-contracts/interaction-surface/v3`, `/world-adapter/v4`, `/canvas/v4`, `/painter/v3`); the unchanged wires are bound to the v4 runtime under `/v4/session/v2`, `/v4/ReferenceBrief/v2`, `/v4/BUILD/V2` and `/v4/operations/v2`, so a `BUILD/V2` consumer on this lane admits `target-facts/v3` facts. `/v4/schemas`, `/v4/schema/*`, `/v4/schema-inventory`, `/v4/fixtures/*` and `/v4/fixture` expose 283 named types, 284 schemas, 46 operations, 20 projections and the pure oracles. `/v4/profile/*` ships the byte-pinned approved profile, semantic closure and settings registry. The v2 and v3 lanes and their schema identities are unchanged.

What the approved slice adds, as contract shapes and admission only:

- `world-adapter/v4`: `PrepareRecoverableTransaction`/`QueryPreparedTransaction` return `PreparedTransactionResult` (the seven `PreparedTransaction` fields plus `beforeStateReadbackDigest`); `projectPreparedTransaction` gives the seven fields Apply carries. Read-only `InspectRegion` returns `PlacementOutcome` (`REGION_INSPECTED` with a full `RegionInspection`, or `PLACEMENT_CHOICE_REQUIRED`). `validateRegionInspection` recomputes the facts, frame and coverage digests from the carried values. Prepare admits the body-recheck `SAFETY_INVARIANT_FAILED`.
- `canvas/v4`: `ListObjects` with `expectedRevision: null` is the read-only current-inventory query; `InspectPlacementRegion` relays the Adapter outcome with `unavailableSettings`; `ApplyRecoverableCommit` carries `regionInspectionBinding` (required, nullable). `validateBoundRequest` checks only the payload-carried part of that binding (build, frame and facts digests); the Canvas record match, the issued `inspectionId` and the stale-record check need the Canvas record and are not decided here.
- `painter/v3`: `regionInspection` is non-null exactly for `REGION_INSPECTED` facts, which only `picture-blocks` accepts; mismatched facts are `TARGET_FACTS_STALE`.
- rc.9: `PlacementChoiceRequired` offers `NAME_PLAYER` only for `MULTIPLE_ONLINE_PLAYERS` and `PICK_WORLD_POINT` alone for every other reason. Workshop presents `SELECT_CHOICE` in Shell; the Luanti in-world renderer answers an in-world `SELECT_CHOICE` with `RENDERER_CAPABILITY_UNAVAILABLE` (renderer behavior; the package admits that typed response).
- `interaction-surface/v3`: `PICK_WORLD_POINT`, typed `ActionDescriptor.choices` and `SELECT_CHOICE`; `validateChoiceSelection(frame, request)` returns `INVALID_SELECTION` for any `SELECT_CHOICE` value not listed for that frame and action, including `SELECT_CHOICE` sent to an action without choices; other input kinds are not checked against the list.
- `target-facts/v3` (`REGION_INSPECTED`) and `ContractHandshake`: `contractHandshake` is exactly what this package advertises, and `checkContractHandshake(advertised, required)` fails a mixed 0.2.1/0.3.0 pair with `UNSUPPORTED_VERSION/decode/VERSION_UNSUPPORTED` before any request.
- `placement.*` settings: `placementSettingDescriptors` and `placementInvariants` carry the registry (owner, user-decided defaults 2/16/8/4, consequences) for the Shell management projection; `admitPlacementSettings` never applies a default and names every unset or invalid setting in `error.unavailableSettings`.

**Use `validateBoundRequest` for v4 bound checks.** The subpath bindings' `validate` and `admit` (for example `hanaworlds-contracts/canvas/v4`) check shape and local domain rules only; they do not run the v4 bound checks (the Apply region binding, painter/v3 region coherence, BUILD/V2 frame and world coherence). Consumers must call `validateBoundRequest` from `hanaworlds-contracts/v4` (after raw admission) to get them.

No digest kind, projection or golden changes. No Adapter region search, Canvas record or Session logic is implemented here; those remain provider work and `NOT_RUN`.

`npm test` runs the legacy 558 cases, the v3 lane, `test/v4.mjs`, the four approved checkers (rc.10 bytes) unchanged against this package's exported profile/closure/fixtures (`test/v4-approved-checks.mjs`, including the 27-mutation falsifiability harness), and `test/v4-chains.mjs`, which admits every chain message through the package API and writes the per-closure-row table to `evidence/closure-coverage-v4.json`. Known differences between approved fixtures and package behavior are recorded in [SPEC_CONFLICTS.md](https://github.com/yzsnstotz/hanaworlds-contracts/blob/codex/s1-02-contracts-v4/SPEC_CONFLICTS.md) in the source repository.

```js
import { admitRequest, digestValue, runtimeCompatibility } from 'hanaworlds-contracts';
import * as Canvas from 'hanaworlds-contracts/canvas/v2';

// bytes are Uint8Array received at the caller's own boundary.
const request = admitRequest('canvas/v2', 'SetObjectSelection', bytes);
// Canonical digests accept exact declared projection objects, never arbitrary JSON.
const receiptDigest = digestValue('receipt', typedReceiptProjection).sha256;
const compatibility = runtimeCompatibility();
```

## Admission and projection boundaries

`decodeRawJSON` validates strict UTF-8, JSON grammar, duplicate **decoded** keys and Unicode scalars. It rejects overflow/non-finite numbers and never applies a reviver or full-document `JSON.parse`. The explicit stack does not impose an invented nesting limit. `snapshotJSON` uses descriptors, rejects proxies, getters, functions, symbols, custom prototypes, cycles, boxed values, sparse arrays and extra array properties, and never calls `toJSON`. It detaches inputs into plain JSON before validation. Public error values contain only the seven frozen fields, not exception text or private payloads.

`admitType`, `admitRequest` and `digestRaw` are raw-byte admission entry points. `validateType`/`validateRequest` accept already-decoded pure JSON but cannot recover whether an upstream decoder discarded duplicate keys; network callers must use raw admission before any provider query. `validateBoundRequest` checks carried digest and identity coherence without authenticating the caller. `validateWitnessCoherence` checks supplied facts but never returns an authorization grant. Pure validations return immutable detached values and do not sort, deduplicate, normalize refs, round coordinates or inject defaults.

Each digest uses the exact type declared in `digestProfile.projectionTypes` and invokes the pinned `canonicalize@5.1.0` implementation directly. The prefix is `HanaWorlds|contracts@0.1.0|<kind>\n`. No recursive deletion is performed. `projectField(kind, sourceType, source, field)` admits a complete declared wrapper and extracts the typed field; loose undeclared wrapper fields are rejected. Nested state-record metadata/inventory/timers and nested digest fields are retained.

Naming is separate: forbidden characters are rejected before trim; display text retains its trimmed original form and comparison keys use NFC then ASCII-only case conversion. `normalizeName` refuses to create persistent keys unless the actual Node/ICU runtime declares Unicode **17.0** and passes the compatibility checks. Ordinary refs never use this function. The source reference runtime was Node 24.13.1; each new runner must record its own actual version and compatibility result.

## Build and validation

On a compatible, isolated environment with public registry access:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run compat
npm run test:strict
npm test
npm run test:v3
npm run test:v4
npm run verify:source
npm run pack:artifact
```

`package-lock.json` pins canonicalize 5.1.0 and TypeScript 5.8.3 to their public npm registry integrities. Historical return evidence is not part of this source repository and does not prove the current branch's build or installation.

An explicit diagnostic command, `npm run test:source-fixture`, maps the bare canonicalize import to the unchanged approved upstream source snapshot through a **test-only loader**. It permits source/fixture checks when npm is unavailable. It is not a production fallback, an installed registry dependency, or package REAL_RUNTIME installation evidence. The loader is outside the npm artifact. Standard `npm test` does not silently use it.

`hanaworlds-contracts/fixture` exports pure, clearly named fixture evaluators for authorization ordering, replay, recovery, history, retention, deletion and event eligibility. Inputs are synthetic explicit facts; no expected outcomes or fixture IDs are passed to semantic evaluators. Reported oracle `worldWrites` values are modelled counters, not actual effects. The actual number of world writes/provider queries is zero. Query success alone never implies a changed event. Source snapshots under `spec/` are evidence only, not runtime engine dependencies.

To roll back this source candidate, consumers stay on (or return to) the admitted `0.2.1` source `5ecfce1ba47530b42bba60a674bd16f7bc39c665` and its matched artifact; the whole contracts@0.3.0 consumer set moves back together, because the handshake rejects any mixed 0.2.1/0.3.0 pair. Do not overwrite a published package version. Provider conformance, product composition, release, deployment and user acceptance remain separate gates.
