# Public client and CURRENT_VIEW Inspection recipe

2026-10-09 · F-AD-SESSION-WORLD-BIND-01 · **SOURCE only; no execution or authorization supplied by this document.** This describes the unchanged Adapter 0.7.8 implementation at `be07b112b7af89505c107209c7cfeb54b34e6047`, payload 0.6.0, exact `hanaworlds-contracts@0.5.4`. The later source commit containing this file changes documentation only. Use the existing business tar, not a new package or a peer development-file import.

## 1. Identity, exports and the actual declaration gap

Existing tar: `hanaworlds-adapter-luanti-0.7.8.tgz`, **79,269 bytes**, SHA256 `281e739aa9cbe77a38ed90ee6022574a2e84f9fe9115ee55543c90c168c1bf4c`, at `/Users/yzliu/.cache/hanaworlds-runs/F-AD-SESSION-WORLD-BIND-01/01a11d08-e03e-7253-bf92-aede778f6e17/_evidence/public-host/`. Its public `provider-config-public.json` and `adapter-host-public-supply.json` describe the fixed Host assembly and package identity.

| Import | Runtime / type file | Existing behavior |
| --- | --- | --- |
| `hanaworlds-adapter-luanti/host` → `createNativeHost` | `src/host.mjs` / `src/host.d.ts` | Returns `{host, game, foreignActivity, records, shutdown}` at runtime; only `host` is the contracts NativeControl port |
| `hanaworlds-adapter-luanti/inspection-context` → `createInspectionContext` | `src/inspection-context.mjs` / `src/inspection-context.d.ts` | Returns `read(InspectWorldRequest)`, forwarding singular authoritative selected-object facts |
| Adapter root export | `src/index.mjs` | Registers `hanaworldsLuantiLocalWorlds`, `hanaworldsWorldAdapterV6`, NativeFacts and region services |

**Typed gap is real:** shipped `OwnedNativeHost` exposes `host`, `foreignActivity`, `shutdown`; it omits `game`. The following JavaScript recipe describes an existing runtime return field. It does not claim a typed `owned.game` consumer already compiles. No `as any`, ambient declaration, new export, protocol, or business implementation is supplied here. The minimal follow-up is an additive `OwnedNativeHost.game` declaration matching the existing `running()` and `enter(current)` input/result, plus a narrow packed-declaration check; that needs a separate PM mechanical GO and fresh exact tar identity. `records` remains owner internals and is not a proposed consumer API.

The package is ESM; use the exported `/host` and `/inspection-context` subpaths. Existing `PUBLIC_HOST_RECIPE.md` / `PUBLIC_INSPECTION_RECIPE.md` have historical sections; their final 0.7.8 supply section supersedes the earlier development-only export statements. This standalone recipe supplies the missing client details.

## 2. createNativeHost and same-root provider mapping

```js
// Illustrative JavaScript for a separately authorized consumer window; not run here.
import * as C from 'hanaworlds-contracts'; // installed exact 0.5.4
import { createNativeHost } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';

const owned = createNativeHost({
  C,
  state: OWN_CANONICAL_STATE,
  profile: OWN_CANONICAL_PROFILE,
  worlds: OWN_CANONICAL_WORLDS_PARENT,
  luanti: OWN_SERVER_EXECUTABLE,
  luantiClient: OWN_CLIENT_EXECUTABLE, // optional; defaults to luanti
  event: appendOwnEvent,
});
root.provide('hanaworldsNativeEngineControl', owned.host);
root.provide('hanaworldsLuantiInspectionContext', createInspectionContext({
  resolveCanvas: () => root.get('hanaworldsCanvasV5'),
  resolveOracle: () => root.get('hanaworldsWorldRevisionOracle'),
}));
// Use the existing official Loader EntryOptions once:
// {id:'hanaworlds-luanti-adapter', name:'hanaworlds-adapter-luanti',
//  config:{localWorldRoots:[OWN_CANONICAL_WORLDS_PARENT]}}
// webServer and dshHomePath must already be supplied in this same root.
// The owning origins supply the actual Canvas and authoritative world oracle.
```

| Option | Exact consumed shape and source |
| --- | --- |
| `C` | Installed contracts module; `NativeHostOptions.C` requires `validateType` |
| `state` | Own absolute canonical attempt state; existing `state/logs` and `state/tmp` directories. Factory does not mkdir them |
| `profile` | Own canonical Luanti user path. Native acquire requires `input.userPath === profile` |
| `worlds` | Existing own canonical world parent; acquire requires `dirname(worldPath) === worlds` and exact realpath |
| `luanti`, optional `luantiClient` | Known absolute executable paths from the approved public Native config; omit client only if that same executable is the intended GUI client. No installation or binary launch by recipe author |
| `event(kind, facts)` | Synchronous own event sink. Source calls it synchronously and does not await a returned promise. Do not turn output facts into input authority |

Factories register nothing and launch nothing. `owned.host` is registered as the existing `hanaworldsNativeEngineControl`; **`game` is an own Host return field, not a new Cordis provider or contract port.** Do not mount a second NativeHost around an already paired connection: `game.enter` must use the same `owned` instance whose Host actually owns the fresh server child.

Fixed public assembly remains Cordis 4.0.4 / Loader 1.0.5, Node 24.13.1, official Host/home/storage packages 0.2.0-rc.2 as listed in the provider-config packet. For an existing C2 consumer root, retain its own approved paths/game/mod/World and use the same configured state/profile/world parent. Constructing a new factory cannot adopt a stopped C2 child or a child held by another factory. This document does not grant acquire, mapgen, client launch, new World, or peer Store access.

## 3. game.enter complete JavaScript input and parameter provenance

`src/host.mjs:94–105` consumes only these fields:

```js
// Source-derived shape; no new exported TypeScript type.
const current = {
  nativeProcessId: observation.nativeProcessId, // current public local.inspect result
  worldPath: observation.worldPath,             // same result; no caller guess
};
// Call as a method: game.enter uses this.running().
const started = await owned.game.enter(current);
```

`nativeProcessId` is a number and `worldPath` is the exact canonical string. Runtime does not schema-validate `current`; it finds a retained **live own server record** with both `child.pid === current.nativeProcessId` and `input.worldPath === current.worldPath`. No match rejects `CURRENT_WORLD_MISMATCH`. A currently retained non-exited client rejects `GAME_CLIENT_RUNNING`. Additional fields are ignored by this implementation; no extra gameId, connectionRef, incarnation, port, Session, password, pick, yaw or position is required/consumed by `game.enter`.

The usable public supplier is **`hanaworldsLuantiLocalWorlds.inspect(leaseQuery)`**, not a invented `local.inspectConnection` consumer API. `inspectConnection` exists only on the local factory's internal return object; `src/index.mjs` registers `local.port`, which does not expose it.

```js
// Preconditions, already performed by the consumer under its separate GO:
// liveLease came from this root's local.acquire(BIND_RUNNING_WORLD) + successful
// local.pair, using this same owned.host. Keep that live lease; no new acquire here.
const local = root.get('hanaworldsLuantiLocalWorlds');
const leaseQuery = {
  leaseRef: liveLease.leaseRef,
  requesterRef: originalRequesterRef,
  connectionRef: liveLease.connectionRef,
};
const observation = await local.inspect(leaseQuery);
const started = await owned.game.enter({
  nativeProcessId: observation.nativeProcessId,
  worldPath: observation.worldPath,
});
```

`local.inspect` returns `{current:true, leaseRef, connectionRef, worldPath, worldRef, action, nativeProcessId}` from the actual Host CURRENT evidence; it rechecks original provider and exact World identity. Use its result immediately. `originalRequesterRef` is the trusted requester's exact value retained from that acquire, not a new authorization claim. A failed inspect revokes the lease; no invented PID, prior C2 PID, process-list candidate, discovery inventory, or Caller JSON observation can repair it. A fresh future incarnation needs its own new live acquire/pair receipts; C2 PID284/638 and their exited incarnations cannot supply this input.

On match the Host chooses its retained `serverPort` and spawns:

```text
luantiClient --go --address 127.0.0.1 --port <owned serverPort>
             --name world-manager --logfile <state/logs/client-UUID.log>
```

The child inherits the source's environment override `HOME=profile`, `LUANTI_USER_PATH=profile`, `XDG_CACHE_HOME=profile/cache`, `TMPDIR=state/tmp`; stdio is ignored. `serverPort` is chosen by the original Host acquire and is not a caller input. `worldPath` is used to bind the server ownership, not passed as a client `--world` argument. The client connects to that server; do not launch a second local world.

Returned object is exactly `{started:true, pid, serverPid, serverPort, worldPath, logfile}`. `GAME_START` records those fields; `GAME_EXIT` records actual child PID/code/signal. **`started:true` means the spawn attempt was issued, not that a player joined or a GUI loaded.** On asynchronous spawn error, `pid` can be undefined, the internal exit record is `{error: message}` and this handler does not emit a `GAME_EXIT`; return does not await readiness. `game.running()` only reports retained `client && !client.exit`, not an engine/player/GUI readiness probe. Do not add polling/retry loops or infer a live player from it.

## 4. CURRENT_VIEW and InspectRegion: actual native path

The inspection-context factory does **not** produce CURRENT_VIEW, yaw, player position or picks. It accepts only `InspectWorldRequest`, checks Canvas R1 → ListObjects → R2 and oracle, and returns a singular selected ObjectRecord. C2's empty object registry therefore remains unusable for singular InspectWorld; zero/multiple selected refs return TARGET_FACTS_INCOMPLETE.

For a new BUILD target, existing `hanaworldsWorldAdapterV6.call('InspectRegion', request)` is the mature path. With `anchor:{kind:'CURRENT_VIEW'}`, payload `region.lua:165–181` itself reads `core.get_connected_players()` and requires **exactly one actual player**, then reads that player's `get_pos()` / `get_look_horizontal()` and its collision box; no caller coordinates or yaw. The request's real placement footprint/settings come from the authorized consumer request/current settings, not a fabricated revision. Request shape:

```js
// Shape only. Values annotated below must be supplied by the owning public ports.
const request = {
  contractVersion: 'world-adapter/v6',
  requestId: nextOwnRequestId(),
  sessionRef: trustedSessionRef,
  worldRef: actualBoundWorldRef,
  localContext: actualCanvasSelection.context.localContext,
  expectedWorldRevision: actualOracleRevision,
  inspectionId: nextOwnInspectionId(),
  anchor: { kind: 'CURRENT_VIEW' },
  footprint: actualRequestedFootprint, // {widthCells, depthCells, heightCells}
  placementSettings: actualPlacementSettings,
  // {frontGapCells, forwardSearchCells, lateralSearchCells, verticalSearchCells,
  //  settingsRevision}; use the actual approved/current settings revision.
};
const admitted = C.validateBoundRequest('world-adapter/v6', 'InspectRegion', request);
const adapter = root.get('hanaworldsWorldAdapterV6');
const response = C.validateBoundResponse('world-adapter/v6', 'InspectRegion', admitted,
  await adapter.call('InspectRegion', admitted));
```

`actualCanvasSelection` comes from the owning same-root Canvas **ReadWorldSelectionContext** envelope for that trusted Session/World. Require BOUND, exact currentSession/activeWorldRef and current connection/incarnation context. `actualOracleRevision` comes from `hanaworldsWorldRevisionOracle.read(actualBoundWorldRef)`; it is a Canvas logical revision, not a Luanti map digest. The Adapter internally repeats the native/current Canvas checks and reads/rechecks that same oracle's original identity/revision across native sampling. Missing Canvas/oracle or replaced/mismatched source fails closed; do not read a peer private map or synthesize a revision from C2 hash.

Success is `result.outcome === 'REGION_INSPECTED'`, with `result.inspection` carrying actual TargetFacts (`target-facts/v4`, `REGION_INSPECTED` source), targetFactsDigest, frame, bodyOccupiedPositions, entranceFacing, placementSettings, World/source evidence. Preserve the complete actual response. `PLACEMENT_CHOICE_REQUIRED` carries native reasons such as unknown/occupied/no-ground/body/facing ambiguity; `error` or CHOICE is not valid TargetFacts. The native scan checks footprint/support ground and body geometry; successful C2 cell `[0,0,0]` does not prove the actual player's front area satisfies them.

No client join/readiness receipt is provided by C2 or this SOURCE run. The future consumer must obtain native success under its own explicitly authorized client/player/Inspection window and stop on a mismatch; it must not call InspectRegion merely to repeat a known no-player failure. Client join/game spawn can load or generate maps beyond the C2 single box and change player/mod/profile data. Client log events do not attest player geometry. InspectRegion itself samples existing loaded cells without emerge; successful localContext calls persist request-response replay metadata in own Adapter journal. This is not zero filesystem write or a transaction/Apply grant.

## 5. PICKED_POINT: consumer exists; legal issuance is still absent

`InspectRegion` accepts `anchor:{kind:'PICKED_POINT',pickRef:<actually issued ref>}` only when `region.picks[pickRef]` already names this exact Session and World. Missing/wrong-scope pick returns PICK_NOT_ISSUED. Existing payload global `hanaworlds_adapter.record_pick(ref, session, world, node, yaw)` persists to `<world>/hanaworlds-local-picks`; it is an engine-side hook, not a published Host/package pick-issuance port or actual UI provenance.

No packaged player/raycast/UI handler in this 0.6.0 payload issues a genuine pick. `.inspection-context` has no issuance method. Do not call the global from admin Lua, install a helper mod, reuse fixture-pick from a real-test fixture, or invent a pickRef/Session/coordinates to bypass CURRENT_VIEW. A pick-ref shape in a contract is not evidence of a mature legal issuer. If CURRENT_VIEW is unsuitable and the owning public UI pick issuer is not supplied, record **PICK_ISSUER_NOT_SUPPLIED** as a report label (not a new wire error), request PM routing, and stop. This doc-only GO cannot implement an issuer.

## 6. Client and server exit ownership / release sequence

One `createNativeHost` instance holds its own server records and a single current client. Server records retain input/controlRef/child/exit. `game` holds the client child and world/log association; it does not assign Canvas selection or transaction authority. It uses username `world-manager`; it does not create/select a Core Session or synthesize a pick.

For a separately authorized window, follow the existing fixed assembly's release order: **Adapter entry first → official Host entries in reverse → loader disposal → `await owned.shutdown()` → root disposal**. A consumer doing only local Adapter/Host assembly still closes its Adapter before native shutdown and releases its root last. Preserve each phase's outcome; a rejected phase does not authorize skipping remaining own cleanup. `owned.shutdown()` must run before root release. If the real client has normally Quit/disconnected, its child exit record is retained; otherwise shutdown sends **SIGINT to only that retained client** and awaits its `exit`, then stops each own server record. No game.stop/game.close export exists.

- Client shutdown does not validate client exit code/signal as success; GAME_EXIT facts must remain exact. A spawn error does not become a successful GAME_EXIT. `running()===false` alone is insufficient as a release/readiness receipt.
- Server stopped policy requires actual exit code 0; otherwise NATIVE_STOP_FAILED. Adapter local.close may already have stopped its server records; shutdown still checks retained records. Public stopWorld uses the original Host withStoppedWorld callback, not caller absence/PID assertions.
- Existing shutdown kill/exit waits have no configured timeout; client kill return is not checked in this source. Do not add force kill, sleep/retry, or claim bounded positive release evidence from this doc. Any unreleased/hung phase must stay UNKNOWN/failed and be reported under worker rules, with own logs/PIDs and phase, rather than hidden by a timeout.
- Factory/event evidence tracks OS child lifecycle; native client disappearance and real player departure are separate facts. Client launch plus client/server shutdown can write own logs/profile/World data. No peer/accepted root, global Store or auth material is an input.

## 7. Current supply outcome and the next gate

C2 public packet shows actual map rows 0→343→343 and one KNOWN scoped cell; both native incarnations are already stopped. It supplies no player/pick/TargetFacts. This recipe supplies source-accurate **JavaScript** client input/ownership/Inspection path; typed client consumption remains a named minimal mechanical gap. CURRENT_VIEW is the existing native Inspection route; its real successful result is not asserted. Pick issuance remains unsupplied. If Canvas context/oracle/current settings are absent, name the absent owning supply and stop, rather than adding authority in this Host.

This documentation does not start anything, change JS/d.ts/schema/SDK/packaging, repack the tar, rerun gates or upgrade accepted 47612. No new TO_TEST or acceptance is claimed. The source/docs full refs and exact changed paths are in this card's current REPORT. Before any future client/InspectRegion run, PM must issue that distinct window; any mechanical type completion also needs its own GO.
