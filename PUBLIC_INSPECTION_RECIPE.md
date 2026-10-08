# Public Adapter Inspection and revision consumption packet

2026-10-09 · F-AD-SESSION-WORLD-BIND-01 · SOURCE public recipe. Companion: [fixed Loader/native ownership](./PUBLIC_HOST_RECIPE.md) and [protected 0.7.5 assembly/types](./PUBLIC_ASSEMBLY_075.md). This document describes the existing local world-adapter/v6 source path, not historical remote v2/v4 handlers. It adds no SDK export, wire, provider implementation or world write. New own source preparation is Adapter 0.7.6 / payload 0.6.0 / exact contracts 0.5.4-rc.1; protected accepted Adapter 0.7.5 / contracts 0.5.3 remains unchanged.

## Pinned registration and ownership

Use official `@deepseek-ai/cordis@4.0.4` and `@deepseek-ai/cordis-plugin-loader@1.0.5`, with the complete `EntryOptions` row and same-root registration in PUBLIC_HOST_RECIPE.md. Shipped Adapter patch is id/name only; the pinned official Loader additionally supports `config.localWorldRoots`. Supply existing canonical own-attempt roots. Load the public Adapter root export once; never duplicate an accepted entry or replace its roots.

Same-root Host dependencies consumed by the actual Adapter:

| Cordis service key | Existing consumed shape/source | Lifetime |
| --- | --- | --- |
| `webServer` | Host `register(...)` implementation | Required injection; Adapter unregisters own HTTP prefix on close |
| `dshHomePath` | Host `(...parts) => absolute own-home path` | Adapter journal home; no global/accepted home reuse |
| `hanaworldsNativeEngineControl` | contracts `LocalEngineControlPort`; exact acquire/inspect/withStoppedWorld signatures in assembly document | Host owns actual child/PID/operation/world, retains exit record, awaits finite stopped callback |
| `hanaworldsCanvasV5` | owning Canvas `call(name, request)`; contracts canvas/v5 envelope | Authoritative current Session selection; provider replacement is rejected on current checks |
| `hanaworldsWorldRevisionOracle` | existing structural `read(worldRef): Promise<Revision>` | Authoritative Canvas logical world revision; required at Inspection call time |
| `hanaworldsLuantiInspectionContext` | existing structural `read(InspectWorldRequest)` returning raw singular facts below | Owning Canvas CAS facts, per call; not a Session table in Host/Adapter |

`createNativeHost` in this origin's public `dev/world-manage/host.mjs` is a development recipe, excluded from the production tar. Its actual owned child remains associated with input/controlRef/PID and exit code/signal; `inspect` validates CURRENT, and `withStoppedWorld` awaits actual exit and foreign-process recheck before consuming STOPPED. Shutdown closes this Adapter then the own native Host. The pinned Loader recipe tests actual SDK loading; native recipe tests actual owned Node child with a synthetic engine. Neither proves real Luanti or production Host installation. See companion for fixed npm tar identities, official sources/licenses and runnable code.

## Exact public Inspection input/output

```ts
// Ref and Revision are published contracts types. Extra request keys are rejected.
type InspectWorldInput = {
  contractVersion: 'world-adapter/v6'; sessionRef: Ref; requestId: Ref;
  worldRef: Ref; expectedWorldRevision: Revision;
  sampledBounds: Box; localContext: LocalWorldContext;
};
type InspectRegionInput = {
  contractVersion: 'world-adapter/v6'; sessionRef: Ref; requestId: Ref;
  worldRef: Ref; expectedWorldRevision: Revision; inspectionId: Ref;
  anchor: PlacementAnchor; footprint: PlacementFootprint;
  placementSettings: PlacementSettings; localContext: LocalWorldContext;
};
// Existing structural supplier read result; not a new exported contracts interface.
type ConsumedSingularFacts = {
  current: true; worldRef: Ref; worldRevision: Revision;
  objectRef: Ref; objectRevision: Revision;
};
```

`ctx.get('hanaworldsWorldAdapterV6').call('InspectWorld'|'InspectRegion', request)` returns the published envelope `{contractVersion,requestId,result,error}`. InspectWorld success is `TargetFacts` (`target-facts/v4`, source `INSPECTED`), with singular objectRef/objectRevision and actual sampled native cells, catalogue/frame/coverage digests. InspectRegion success is `PlacementOutcome`: either `REGION_INSPECTED` with `RegionInspection`/TargetFacts (source `REGION_INSPECTED`, objectRef/objectRevision null), or `PLACEMENT_CHOICE_REQUIRED` with reasons and `PICK_WORLD_POINT`. An error has result null. The supplier's `read` returns raw facts, not that envelope.

Both operations first verify actual native connection/PID, exact requested world/connection/incarnation/localContext and Canvas's BOUND selection for that trusted Session, then validate current-request/replay binding. Inspection does not prepare/apply/restore a transaction; replay metadata may be recorded. A BOUND selection retains its last real non-null localContext; READY matching inventory is required for a currently usable connection. UNBOUND or an exited/stale connection is not patched with invented context.

## Singular mapping from the supplied Canvas CAS route

Public source inputs: Canvas 0.6.6 `0c968ab991e89f248370dd547992f06f7a432b23` and I-K2 source `6cb77f96cbecaeb06f22ce976455749b7b2f7a30`, as reported in their public REPORTs. Canvas 0.6.6 still declares contracts 0.5.3, so it must not be installed beside this 0.5.4-rc.1 consumer as though exact handshakes matched. These public declarations answer the read route; this node did not execute or install peer implementations.

The existing owning Canvas route is R1 `ReadWorldSelectionContext` → `ListObjects` under R1's exact localContext → R2 `ReadWorldSelectionContext`. Validate every request/response using the installed contracts SDK. Each Read request includes canvas/v5, independent requestId, trusted sessionRef, target worldRef. `ListObjects` also includes R1 localContext and required expectedRevision (`Revision|null`; the public recipe uses null, never a guessed world/selection revision).

Require R1/R2 BOUND and their whole CurrentContext values equal, currentSession equal the trusted Session, activeWorldRef equal the target world, and localContext equal the request's current context. Request worldRef only projects inventory; it does not choose the Session world. `ObjectInventory{worldRef,registryRevision,objects}` supplies `ObjectRecord{objectRef,objectRevision,worldRef,...}`. Match the complete orderedSelectedObjectRefs against those records, retaining selection order and rejecting missing/wrong-world records. Check provider original identity around the reads. This is a CAS composition read, not an atomic snapshot or held lock.

| Canvas authoritative selection | Singular InspectWorld supplier mapping | Region mapping |
| --- | --- | --- |
| Zero selected refs | Reject `TARGET_FACTS_INCOMPLETE`; there is no nullable/no-object InspectWorld success | Explicitly choose InspectRegion for a placement request with its own anchor/footprint/settings |
| Exactly one selected ref | Match its exact ObjectRecord, read current Canvas world revision; return raw current/world/object facts only after R1/R2 consistency | Region remains independent of object selection |
| Multiple selected refs | Reject `TARGET_FACTS_INCOMPLETE`; never use the first ref or issue repeated singular calls as a batch transaction | Explicit placement operation only; it does not synthesize revisions for selected objects |
| Missing record, wrong Session/world/localContext/incarnation, or changed R2 | Reject; no repaired/guessed snapshot | Existing Canvas/Adapter current-context rejection remains required |

This table is the public composition rule to implement in the owning Host's forwarding provider. Current Adapter verifies raw singular fields and current world/revision; it does **not** inspect selected-ref cardinality inside that raw provider, nor implement this forwarding bridge. The owning bridge must enforce cardinality before supplying facts. No `read` success may be created from display rows, request values alone, an arbitrary first ref or private peer maps. The underlying generic Canvas CAS read can validly return an empty or full ordered projection; the singular Inspector has the stricter gate above. No new zero/multiple enum or operation is proposed.

## Existing world oracle and stale handling

Canvas already owns `readWorldRevision`; forward that existing authoritative supply into `hanaworldsWorldRevisionOracle.read(worldRef)`. This document fixes the Adapter's exact consumed shape above; it does not guess an unreported peer Host registration/export/signature. Actual integration binding and same-root runtime identity remain I-K2's implementation supply. There is no new worldRevision protocol request.

Adapter local `inspections()` reads oracle revision before native sampling and compares it with request.expectedWorldRevision, then reads it again after a completed sampled TargetFacts result. A mismatch is `STALE_REVISION`. The early placement-choice result does not perform that second oracle read; its observedWorldRevision is advisory and grants no write. InspectWorld raw facts must have `current:true`, exact worldRef and the observed oracle worldRevision, valid objectRef/objectRevision; otherwise `TARGET_FACTS_INCOMPLETE`. Canvas selection is checked before and after the operation against the actual localContext. Missing oracle or inspection supplier is `CAPABILITY_UNAVAILABLE`; changed Canvas selection/provider or native connection/incarnation is rejected as `CURRENT_WORLD_MISMATCH`.

The bridge must forward errors rather than replace facts; recheck provider identity and the oracle around its CAS read, and reject changed world revision with STALE_REVISION. ObjectRevision comes from ObjectRecord; worldRevision from the authoritative oracle; registryRevision, selectionRevision and sessionRevision keep their separate purposes. None is a replacement for another. A successful read does not grant later write authority: Canvas alone revalidates and decides a transaction.

Observed source limitation: current Adapter checks its oracle twice but does not capture/reject oracle or inspection-provider identity replacement within those reads; actual same-root trusted lifecycle enforcement is not proven by this packet. Do not claim the packet fixes that behaviour. Also current C3 inventory rejects the whole list if any native inspect fails and its aggregate capabilityRevision is version-only. Changing that behaviour requires the previously reported own-origin implementation work; no new exit wire/STOPPED readiness is added here.

## Verification and remaining gates

SOURCE checks: actual own current local-runtime/index and candidate public types match these input/result shapes; public I-K2/Canvas REPORTs supply the CAS read and its non-atomic boundary. Real pinned official Loader/source fixture and actual owned synthetic-child lifecycle tests pass. Candidate tar bytes/SHA, annotated/peeled tag and all 26 installed canonical members have been checked; only new candidate preparation tests run, no old 0.5.3 gate replay.

Unknown/not run: owning Host's actual singular forwarding bridge and readWorldRevision binding; real same Context/provider lifetime; new candidate peer implementation packages/combination; real Luanti/transactions/Undo/Core/models/UI/owner acceptance. The 47612 Session page is not yet started. No new Adapter tar is supplied in this node; source preparation is not permission to upgrade I-K2 or any protected accepted service.

## Actual Adapter consumer continuation (2026-10-09)

The prior SOURCE packet's missing implementation notes above describe its earlier node. The new source now implements and tests native inventory freshness, stable aggregate revision on unchanged lists, and captured original identity checks for oracle/Inspection across await and sampling. `dev/world-manage/inspection-context.mjs:createInspectionContext` now provides the singular CAS forwarding bridge described above (zero/multiple fail, exact ObjectRecord, R1/R2 context equality, provider/oracle rechecks). `session-server.mjs` registers that bridge and a explicitly named fixture Canvas world oracle in the pinned official Loader root. These are development peer fixtures, not Canvas/Workshop production supply or real Core. `session-fixture.mjs` alone owns association/precondition revisions; `session-manager.mjs` owns only UI choice/native leases/confirmation tokens. New G-S/U flow tests cover directory/known no-world/unselect preserving the other Session and UNSUPPORTED persistent deletion. Real same Context production combination remains I-K2 scope.
