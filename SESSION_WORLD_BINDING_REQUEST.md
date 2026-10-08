# Adapter Session–World binding seam request

Card: F-AD-SESSION-WORLD-BIND-01, phase 1. Base: Adapter 0.7.5 / 27911172f7b7af351bc3b819cd35e6860348b6c3. Published contracts: v0.5.3, tag/main 3457493da209178f815d6950e323e1dc462e8d6c. This is a request for shared interface/ownership clarification, not an implemented API or an authority grant.

The owner selected A: each Session has one current World; multiple Sessions may share A; S1 may select B and return to A while S2 still selects A. Session selection must work before any world runs. Adapter lifecycle facts must remain separate from Canvas transaction decisions and Core Session identity/lifecycle.

## Observed current boundaries

- Published `world-adapter/v6` has `DiscoverConnections`, `ListWorlds`, `ReadLocalConnection` and transaction/inspection operations, but no declared read/bind/unbind Session association operation.
- `canvas/v5` owns `ReadWorldSelectionContext`, `SelectWorldConnection` and `SwitchWorldConnection`. `CurrentContext` and `LocalWorldContext.selectionRevision` belong to that selection; a locally generated fixture revision is not Canvas truth.
- `session/v3` domain owner is Workshop. The published profile does not declare a trusted Core Session existence/liveness provider for Adapter binding validation. Syntax-valid `Ref` is not evidence that a Session exists.
- `src/local-world-port.mjs:343–345` retires every previous binding when pairing a new World. `src/local-runtime.mjs:39` rejects pairing while any runtime row exists. `src/local-runtime.mjs:162–167` rechecks the real Canvas selection before transaction transport.
- `dev/world-manage/manager.mjs:37–40,108` currently stores explicitly labelled fixture contexts. Promoting this Map to public trusted binding would conceal the missing identity and selection authority.
- Deletion's existing `callerMustVerify: NO_LIVE_SESSION_BINDING` (`src/local-world-port.mjs:281`) is not an Adapter-side inventory of all live Core Sessions.

These source/profile facts establish an undeclared shared seam. They do not establish that a new wire version is mandatory: the PM/contracts owner can explicitly authorize a typed in-process SDK extension using existing value types if that is the intended boundary.

## Minimal requested decision/interface

1. Define who supplies authenticated known/live Core Session identity to Adapter and how provider identity, revocation/deletion and replacement are checked outside request JSON. A development fixture may supply S1/S2 through the same interface and must be labelled.
2. Define Adapter association read/bind/unbind inputs and results, including a known Session with `UNBOUND` before a world runs, exactly one selected World per Session, binding revision/CAS, exact connection/world identity, and named unknown Session/world/out-of-root errors. Proposed operation names are `ReadSessionWorldBinding`, `BindSessionWorld`, `UnbindSessionWorld`; these names are proposals, not current protocol operations.
3. Distinguish persistent selected-world association from a currently running native connection and Canvas transaction selection. Decide whether S2→A must remain live while S1→B, or may retain a selected-but-stopped A with explicit readiness. The UI must not label a stopped/stale incarnation trusted-current. Owner A is unchanged; this question is an engineering representation/lifecycle boundary, not a request to choose product A again.
4. Define the binding inventory used by deletion: any registered live Session reference prevents deletion, including references that are not the foreground Session. Define serialization across bind/switch/unbind/delete, restart/revocation behaviour, and failure preservation. No new shared-world write authority is created.

If an SDK-only extension is sufficient, record its provider and value contracts and approve that narrow route; otherwise extend the shared contracts in their owning card. This Adapter worker must not change Canvas/Core/Desktop, synthesize Canvas revisions, or create a private competing binding protocol.

## Implementation after the seam is confirmed

- Add the public Adapter association port and consume the approved Session provider. Keep all world identity/root and Canvas-only write checks.
- Change native world retention only to the approved shared-session lifecycle semantics; never stop S2's retained A as an implicit consequence of S1 switching.
- Add the same World's page Session section with fixture S1/S2 and a per-Session dropdown. Selecting an unbound known Session returns a visible unconnected state, not a world-unavailable rejection.
- First write new tests for unbound selection, S1/S2 shared A, S1 A→B→A preserving S2, failed switch preserving association, unknown identities/root escapes, unbind and bound-world deletion refusal. These are new phase-1 checks; old phase-0 and accepted formal package tests are not repeated.
- Start only the registered own 47612 instance after a fresh availability check and deliver a real first-step screenshot/at-most-six-step checklist. No service or screenshot currently exists for this request.

Current state: PARTIAL, phase-1 production capability/UI/REAL_RUNTIME/REAL_UI NOT_RUN. No owner action, credentials, funds, deployment, new tag or test replay is requested.


## I-K2 public assembly clarification (2026-10-09; documentation only)

The public request at integration `a56c172dd7d559763d7671e4cbc2bf2c00722d41`, `composition/k2-text/formal053/public-assembly-request.json`, is answered for existing Adapter 0.7.5 in [PUBLIC_ASSEMBLY_075.md](PUBLIC_ASSEMBLY_075.md). Formal v0.5.3 already publishes NativeControlInput/Lease/Query/Evidence and LocalEngineControlPort; these do not require a new wire/tag. Adapter plugin config is localWorldRoots:string[], and its exact shipped Loader patch contains only id/name; existing public setRoots is an alternative once the plugin is loaded.

Please confirm the pinned official Loader/provider recipe and the authoritative owning-origin public supplier for the consumed hanaworldsWorldRevisionOracle.read(worldRef) and hanaworldsLuantiInspectionContext.read(InspectWorldRequest) result {current:true,worldRef,worldRevision,objectRef,objectRevision}. These existing structural checks are not a named SDK declaration or permission to invent a Host snapshot from request JSON/private Canvas maps. Preserve Canvas selection/world/object revision authority and known-Session identity; if an existing typed SDK route suffices, identify it rather than preselecting a new protocol. Session binding implementation stays PAUSED; I-K2 World UNBOUND/history NO_SESSION and transactions/Undo/Luanti/UI NOT_RUN remain as recorded in its public request. No extra capability or runtime authority is requested by this documentation handoff.
