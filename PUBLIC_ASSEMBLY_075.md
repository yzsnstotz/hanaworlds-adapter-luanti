# Adapter 0.7.5 public assembly information for I-K2

Documentation only, 2026-10-09. Adapter source **27911172f7b7af351bc3b819cd35e6860348b6c3**, payload **0.6.0**, contracts **0.5.3**. This answers the public request at integration source **a56c172dd7d559763d7671e4cbc2bf2c00722d41**, `composition/k2-text/formal053/public-assembly-request.json`. No peer private implementation/evidence was consumed. Session-world implementation remains PAUSED pending C-SESSION-WORLD-SEAM-01.

The request records actual Adapter loaded and Canvas/Adapter `PROTOCOL_COMPATIBLE`, but roots/games empty, WorldEdit absent, readiness false, World UNBOUND/history NO_SESSION. These are request observations, not a new runtime inspection. Transactions, Undo, Luanti and UI remain NOT_RUN in this handoff.

## Existing source and supply

- [Adapter 0.7.5 source](https://github.com/yzsnstotz/hanaworlds-adapter-luanti/tree/27911172f7b7af351bc3b819cd35e6860348b6c3). Root export `src/index.mjs`; package `private:true`, Node `>=24.13.1 <25`.
- Existing formal Adapter tar: `/Users/yzliu/.cache/hanaworlds-runs/F-AD-WORLD-MANAGE-01/17ecf2d2-8310-40e8-8b63-d0aa44dbb93d/_evidence/formal-01/hanaworlds-adapter-luanti-0.7.5.tgz`, 71477 bytes, SHA256 `51094b3049093e368bad9c0a18bc6e3fce012b88c032952dc423f42425bc7f94`. This repeats declared supply identity, not a new package verification, npm release or repack.
- [Formal contracts tag v0.5.3](https://github.com/yzsnstotz/hanaworlds-contracts/tree/v0.5.3), source `3457493da209178f815d6950e323e1dc462e8d6c`, annotated tag `b3983bc5cde7791266758842a017458386d14283`. Formal tar `/Users/yzliu/.cache/hanaworlds-runs/C-CONTRACTS-CONVERGE-01/aa952563-19c5-4d72-9a5a-d36908cad754/_evidence/gate-b-01/hanaworlds-contracts-0.5.3.tgz`, 146045 bytes, SHA256 `7f2b088b300426ea2536e08904780dc5df94eaf5e341e83cbff0cc3a42362241`.
- Published value types below are in contracts `types/local/contracts.d.ts`; published `LocalEngineControlPort` is in `types/local/index.d.ts` and `dist/local/public.d.ts`. Import the contracts root entry, not an Adapter private module. Native service name is Adapter's existing Cordis key; interface name is `LocalEngineControlPort`.

## World root and Loader/Host registration

`src/index.mjs:8–16` accepts `apply(ctx, config = {})`, with **`config.localWorldRoots: string[]`**, default `[]`. This is Adapter plugin config, not a global Host service key or an engine user-path setting. Supply absolute canonical directories owned by the new isolated attempt. Initial `apply` resolves paths; it does not create directories or perform all `setRoots` checks. Do not infer that a nonempty initial array proves a usable root.

The **exact shipped Loader patch** (`cordis.patch.yml`, selected by `package.json.dsh.bundle.patch`) is:

```yaml
- insert:
    - id: hanaworlds-luanti-adapter
      name: hanaworlds-adapter-luanti
```

This patch contains no config field. Its row id differs from Adapter's exported provider id. No complete official Loader config-row schema or native-control provider is shipped here. Do not add an invented `config:` field and call it certified Loader syntax. A Loader that already loads this row can use the existing public service, after preparing its own directory:

```js
// Assembly illustration only; NOT_RUN. OWN_ROOT is this new attempt's canonical absolute directory.
const worlds = ctx.get('hanaworldsLuantiLocalWorlds');
await worlds.setRoots({ roots: [OWN_ROOT] });
const readiness = await worlds.describeFlatWorldCreation({ requesterRef: OWN_REQUESTER, userPath: OWN_PROFILE });
```

`setRoots` accepts only `{roots:string[]}`, including `[]`; checks absolute nonempty strings, deduplicates resolved paths, requires each directory to exist, rejects symlinks and paths whose realpath differs, then updates roots serially. It does not mkdir, install games, start native processes or select a Session. It resolves `void` on success; schema/path failures reject (`SCHEMA_INVALID` / `CONNECTION_NOT_FOUND`). `discover()` then reads the configured roots only.

Where the official Host directly consumes this plugin's root export instead of the Loader row, the actual exported signature also accepts:

```js
import adapter from 'hanaworlds-adapter-luanti';
const service = adapter.apply(ctx, { localWorldRoots: [OWN_ROOT] });
```

This is an alternative direct entry illustration, not a second install beside the Loader or a tested I-K2 Host recipe. `webServer` injection is required; `dshHomePath` supplies Adapter's native journal home. The Host must supply the same-root in-process peer services needed by the operation. Existing registration API, as used by this Adapter, is `ctx.provide(name, provider)`:

```js
// Existing trusted providers supplied by their owning origins; no implementation is supplied here.
ctx.provide('hanaworldsNativeEngineControl', nativeControl); // LocalEngineControlPort
ctx.provide('hanaworldsWorldRevisionOracle', worldRevisionOracle); // authoritative Canvas logical revision
ctx.provide('hanaworldsLuantiInspectionContext', inspectionContext); // current Canvas object context
```

`hanaworldsCanvasV5`, `hanaworldsCanvasFootprintRegistry` and `hanaworldsCanvasHistoryFacts` are separate public suppliers for their respective operations. Registration does not grant transaction authority: only the actual active same-root Cordis caller fiber named `hanaworlds-canvas` reaches Adapter mutators. No request role/JSON fact replaces that check. Official Loader-specific configuration syntax/provider supply remains PARTIAL until its owning SDK supplies a pinned public recipe; the existing Adapter `setRoots` route itself is already implemented.

## Readiness and isolated external inputs

`describeFlatWorldCreation({requesterRef:Ref,userPath:Ref})` requires both nonempty strings and an absolute `userPath`; extra keys are rejected. It returns exactly `{roots, games, mapgen, perCellMod, ready, missing}`. Each game is `{gameId,title,version,gameConfDigest,flatAllowed,flatOptions}`; `perCellMod` is `null` or `{name:'worldedit',path}`. `missing` names `WORLD_ROOT`, `GAME` or `MOD` (with `mod:'worldedit'` for MOD).

The implemented precheck (`src/flat-world.mjs:40–91`) needs a nonempty configured root list, at least one `<userPath>/games/<gameId>/game.conf` allowing `flat`, and WorldEdit discovered by mod name in `<userPath>/mods` (plain mod or modpack). `allowed_mapgens` must be empty or include flat; `disallowed_mapgens` must not include flat. Declared game `mcl_superflat_classic` is applied only when its settingtypes declares it. A directory name without valid game.conf is not a discovered game. This precheck proves presence/configuration only, not native compatibility, loaded mod functions, working payload, current Session, or a transaction-ready world. Creation additionally verifies the chosen root, game/name and prevents overwrite. Multiple roots/games require explicit selection.

Existing audited external inputs (LICENSE_AUDIT.md:125–135, 153–163; not bundled in Adapter):

| Input | Existing pin / license | Official supply or configuration reference |
| --- | --- | --- |
| Luanti | 5.17.0; LGPL-2.1-or-later | [upstream](https://github.com/luanti-org/luanti); actual native process ownership/exit supplied by Host |
| VoxeLibre / MineClone2 | 0.92.3, `a523240fb89713ffa6302696e8275bbd7de3bd49`; code GPL-3.0-or-later, media CC-BY-SA-4.0 | [upstream pinned source](https://github.com/VoxeLibre/VoxeLibre/tree/a523240fb89713ffa6302696e8275bbd7de3bd49), [ContentDB listing](https://content.luanti.org/packages/Wuzzy/mineclone2/); existing audited ZIP SHA256 `51ea9242aabb1f29575abbfb599c79bcde9435616ea097c0582e11ac1b2b279d` |
| WorldEdit | `62ffafe3bcb386600c431ef3840d91c3c8f85639`; AGPL-3.0 | [upstream pinned source](https://github.com/Uberi/Minetest-WorldEdit/tree/62ffafe3bcb386600c431ef3840d91c3c8f85639); [official mod configuration](https://docs.luanti.org/for-players/installing-mods/) |

For the new isolated attempt, minimal layout is own world-root directory; own profile `games/mineclone2/game.conf` and game contents; own profile `mods/worldedit` or its valid modpack; actual owned Luanti executable/child and trusted native control. Keep included licenses/notices. Adapter-created worlds write `load_mod_worldedit=true` and their own payload; discovery alone does not prove the engine loaded these mods. The official mod documentation explains mods are disabled until enabled in a world. The ContentDB page returned an interactive challenge during this read; its listing is an existing audit reference, not a newly verified download. No challenge was bypassed; nothing was downloaded, installed, run or changed. Engine/game/mod pins repeat the existing audit, not a claim of current latest releases or universal compatibility. No old accepted profile/world is an input.

A world created with `createFlatWorld` already has the fresh payload: continue via `acquire({...action:'BIND_RUNNING_WORLD'})` then `pair({connectionRef,requesterRef,leaseRef})`; do not perform fresh provisioning again. Successful pair is native connection readiness, not Canvas Session selection or permission to write.

## Complete existing native control signatures

These are **already published v0.5.3 types**, not proposals:

```ts
// Ref = string; processId must be a positive safe integer at Adapter runtime.
type NativeControlInput = {
  requesterRef: Ref; worldPath: Ref; userPath: Ref; operationRef: Ref;
};
type NativeControlLease = { controlRef: Ref; worldPath: Ref };
type NativeControlQuery = {
  controlRef: Ref; requesterRef: Ref; worldPath: Ref; operationRef: Ref;
};
type NativeControlEvidence = {
  state: 'CURRENT' | 'STOPPED'; worldPath: Ref; processId: PositiveInt; operationRef: Ref;
};
interface LocalEngineControlPort {
  acquire(input: NativeControlInput): Promise<NativeControlLease>;
  inspect(query: NativeControlQuery): Promise<NativeControlEvidence>;
  withStoppedWorld<T>(query: NativeControlQuery,
    consume: (facts: NativeControlEvidence) => Promise<T>): Promise<T>;
}
```

`hanaworldsNativeEngineControl` must be this trusted Host-owned provider, never caller JSON. Adapter generates `operationRef` as `PROVISION_PAYLOAD:<uuid>` or `BIND_RUNNING_WORLD:<uuid>`; Host does not rewrite it. Host acquisition binds controlRef/requester/world/user path/operation to its actual owned process record. Adapter requires the returned nonempty controlRef and exact worldPath; it subsequently passes the captured query (no userPath in query) to inspect/stop. Do not confuse Host controlRef with Adapter leaseRef, SessionRef, connectionRef or connection incarnation.

`inspect` must report `CURRENT`, same worldPath and operationRef, and the actual positive safe-integer PID. The first inspection fixes PID; every subsequent fact must use the same PID. Provider identity must remain the captured provider (Cordis original identity); filesystem device/inode/path, discovered worldRef and payload identity must remain exact. Unowned PID, unrelated operation, replaced provider or stale identity cannot be declared current. Acquire/inspect failures revoke the lease rather than infer a stopped process.

`withStoppedWorld` must actually stop that owned process (or retain proof it already exited), retain the original ownership/operation/PID record after exit, and invoke/await `consume` once in the finite stopped-world scope, with `STOPPED` for that exact worldPath/PID/operation. It returns the callback's T for provisioning/stop; retirement also requires callback execution. No callback after return, multiple callback, unrelated PID, generic inspection failure, detached promise or STOPPED fact outside the callback establishes safe file mutation. Adapter rechecks provider/world identity within this scope. A stopped A's original record is needed when pairing B or deleting later; a restarted A must receive a new native acquisition rather than reuse its old process association.

**Exit evidence fields:** the published NativeControlEvidence has no `exitCode`, `signal`, `exited`, timestamps or child object fields. Do not invent required wire fields or treat `state:'STOPPED'` supplied by JSON as proof. The Host owns the child and must observe actual exit/termination for the captured PID before releasing a stopped callback; concrete PID/exit association records belong to the Host's runtime evidence. The existing API does not require every stop to be exit code 0. This document provides no Host native-control implementation or runtime proof.

## Complete inspection input/result and read-only mapping

Already published v0.5.3 values:

```ts
type LocalWorldContext = {
  connectionRef: Ref; connectionIncarnationRef: Ref; worldRef: Ref; selectionRevision: Revision;
};
type InspectWorldRequest = {
  contractVersion: 'world-adapter/v6'; sessionRef: Ref; requestId: Ref; worldRef: Ref;
  expectedWorldRevision: Revision; sampledBounds: Box; localContext: LocalWorldContext;
};
// Box={min:Position,max:Position}; Position is [SafeInt,SafeInt,SafeInt].
```

The Adapter passes that **complete validated request unchanged** to `hanaworldsLuantiInspectionContext.read(request)` for `InspectWorld`. Its consumed minimum result and the oracle are existing implementation structure (`src/local-runtime.mjs:224–271`), **not named published SDK interfaces**:

```ts
// Documentation of existing checks only; no newly declared contract/SDK export.
interface ConsumedInspectionContext {
  read(request: InspectWorldRequest): Promise<{
    current: true; worldRef: Ref; worldRevision: Revision;
    objectRef: Ref; objectRevision: Revision;
  }>;
}
interface ConsumedWorldRevisionOracle { read(worldRef: Ref): Promise<Revision>; }
```

No `{result,error}` wrapper is consumed by these supplier `read` methods. Extra supplier result fields are not consulted. Context must be current, exact requested worldRef and oracle revision; objectRef/objectRevision must be strings at the source check and must satisfy the final TargetFacts schema. Missing/noncurrent context is `TARGET_FACTS_INCOMPLETE`; missing suppliers is `CAPABILITY_UNAVAILABLE`; changed logical world revision is `STALE_REVISION`. There is no nullable/no-object success branch for this InspectWorld supplier: don't substitute a fabricated object or a Session revision. Supplier rejection/error mapping remains the Adapter public response logic.

Public read-only composition, preserving Canvas authority:

1. Caller supplies the contract-validated InspectWorldRequest with real current Canvas localContext, exact paired world/incarnation and actual expected Canvas logical world revision. UNBOUND or absent Session cannot be filled with invented context.
2. Adapter calls the published `hanaworldsCanvasV5.call('ReadWorldSelectionContext', {contractVersion:'canvas/v5',requestId:request.requestId+':current-selection',sessionRef,worldRef})`. The validated result is `WorldSelectionContext` whose **`selection`** must be `BOUND`; `selection.connectionRef`, `selection.context.currentSession`, and `selection.context.localContext` must match. Do not return CurrentContext as the top-level result. `UNBOUND` remains a real selection result, not inspection readiness.
3. `hanaworldsWorldRevisionOracle.read(worldRef)` supplies Canvas's current **world** revision. `hanaworldsLuantiInspectionContext.read(request)` supplies the current Canvas selected object and its **object** revision. `selectionRevision` / `sessionRevision` do not automatically equal worldRevision / objectRevision. These adapters may forward an authoritative owning-origin public snapshot, but may not reconstruct it from the request or peer private maps.
4. Adapter reads catalogue and the sampled cell state from its actually paired Luanti courier; these engine facts do not come from the inspection-context supplier. It re-reads the oracle and Canvas selection before returning the validated `InspectWorldResponse {contractVersion,requestId,result:TargetFacts|null,error:Error|null}`. The read path may record request replay metadata; it does not prepare/apply/restore a world transaction. Region inspection is a separate operation and does not call this object-context supplier.

**Remaining authority/supply gap:** no named `LuantiInspectionContext` SDK interface or complete public Canvas snapshot supplier for the above object/world revisions was found in the inspected formal declarations. The existing Adapter checks describe consumption; they do not authorize a new Host implementation or prove I-K2 wiring. C-SESSION-WORLD-SEAM-01 must confirm the owning-origin public supplier/typed route and pinned official Loader/provider recipe. This clarification is appended to the existing SESSION_WORLD_BINDING_REQUEST.md; it does not demand a new wire/tag or expand the product scope.

For material/catalogue consumers, the existing public read-only forwarder can use `hanaworldsLuantiNativeFacts.readCatalogue(worldRef)` after real pair; complete Catalogue comes from loaded engine registry. `readRegionState(worldRef, box)` is a separate read-only native supplier that does not require Canvas inspection context, but still requires the actual paired world and current native process. Neither route removes the Session/seam gap or makes World UNBOUND transaction-ready.

## Status and handoff

Public information supplied: exact Adapter root config and shipped Loader row; safe existing setRoots route; complete already published native types/method signatures with owned PID/exit semantics; complete inspection request and consumed-result fields; public read-only selection mapping; existing external pins and minimal isolated layout.

PARTIAL: official Loader/provider recipe and authoritative inspection/Session snapshot route require owning SDK/seam confirmation; this handoff implements neither. Production source, versions, package, schema, contracts and peer origins are unchanged. No install/start/restart/stop, game/EULA change, old test replay, new probe, transaction, Undo, UI screenshot or Core runtime claim. Accepted services 47610/47607/47606 and their source/world/profile/evidence remain protected. PM may route these public gaps to C-SESSION-WORLD-SEAM-01 while I-K2 consumes only already authorized existing capabilities.


## Stage B follow-up (2026-10-09)

The fixed official Loader/provider/native ownership recipe is now supplied in [PUBLIC_HOST_RECIPE.md](PUBLIC_HOST_RECIPE.md), using pinned official Loader1.0.5/Cordis4.0.4 and the existing own-origin native Host source. The earlier Loader field uncertainty is resolved by its actual public EntryOptions declaration and new SOURCE/FIXTURE check; other historical 0.7.5 supply statements remain unchanged. Canvas selected-object snapshots and the exact new candidate remain owning-origin inputs.
