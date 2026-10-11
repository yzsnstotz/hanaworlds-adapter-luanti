# World source facts (adapter 0.19.0)

The Luanti adapter provides `world-facts/v1` through
`hanaworldsWorldFacts.call(operation, request)` (retaining the prior aliases) and the returned
`service.worldFacts` port. `ReadWorldSourceCapabilities` uses
`hanaworldsWorldAdapterV6.call` on `world-adapter/v8` minor 1. The handshake
advertises that minor and the world-facts port advertises its own protocol.
Capability owner is the role `world-source`.

| Operation | What this source supplies | Operation refusals |
| --- | --- | --- |
| ReadCatalogue | Opaque materials and empty material, neutral tags, display names, nullable sRGB colours and neutral orientation descriptors | ADAPTER_UNAVAILABLE, WORLD_NOT_BOUND |
| ReadMaterialSources | Current asset snapshot, opaque asset/source names and matching presentation; bytes remain on the existing byte port | CAPABILITY_UNAVAILABLE |
| ReadEngineFacts | voxel-grid/v1, partition edge [16,16,16], current mapgen bounds, frame, REQUIRED post-write lighting, declared write methods and backend | ADAPTER_UNAVAILABLE |
| ReadWriteProfile | Backend and complete compilation configuration, supported methods and declared avatar envelope | ADAPTER_UNAVAILABLE, CAPABILITY_UNAVAILABLE |
| ReadWorldSourceCapabilities | All write declarations, StateProfile, guard coverage and source-owned write path conclusions | ADAPTER_UNAVAILABLE |

All reads validate requests and bound responses using published contracts v2.13.0.
The connection is checked before and after reading. The complete loaded Catalogue
is checked before and after the read; asset reads also recheck metadata and bytes,
and write/engine/capability reads recheck the payload declaration and engine limits.
Currency/decode refusals retain the published common errors. Nothing starts,
provisions, selects or writes a world. Unknown facts never become defaults.

`ReadMaterialSources.presentation[materialRef]` always contains `displayName`
and `color`, including for UNKNOWN texture sources. Names come from loaded node
descriptions, with Luanti escape markup removed by its native `strip_escapes` API;
blank text and registered node identifiers are unknown (`null`). No engine node
name is substituted as a label. Colours come from a verified simple PNG's
alpha-weighted sRGB pixels, or the declared six-digit sRGB node colour when the
texture is unsupported/unreadable. Unavailable colours remain `null`.
The named source snapshot uses `asset:<digest>` and `source:<digest>` identities;
native texture/mod names and byte blobs remain inside the source's byte port.
`ReadCatalogue` uses the same presentation projection. Published examples and
the minimal mock retain one nullable presentation entry for every material ref.

The StateProfile derives `lighting` from readback, preserves no state field and
clears `inventory`, `metadata` and `timer` on normal writes. Undo/restore retains
the exact saved state through the existing native conversion. The source performs
lighting refresh after writes. Compilation declares last-writer-wins overlap,
numeric-x-y-z effect order and exact-final-effects-only compression. The backend
identity comes from the loaded payload; unreadable/undeclared backend gives null
configuration and no supported methods. PER_CELL uses the bound native writer;
REGION additionally requires the payload's voxel/emerge/metadata APIs.

Native callback inventory and its interpretation stay in this source. Initialization
callbacks imply side effects, state-bearing callbacks keep persistence unknown,
and unknown/global write callbacks cannot establish a clean material. Only known
clean materials can be placeable. The capabilities expose hasSideEffects and
hasPersistentState; consumers do not decode callbacks. Legacy evidence readers use
adapter-owned validation instead of the contracts' old callback derivation helper.

Descriptions come from loaded node definitions. Colours come from verified simple
PNG assets using pngjs and an alpha-weighted mean of sRGB channels, or an explicit
six-digit node colour declaration. Unsupported appearances, unreadable/corrupt
images, conflicting colour profiles, JPEG and PNGs larger than 1,048,576 pixels
have no derived colour. Unknown display names/colours are null. Engine fields live
only in the Catalogue's opaque extension. Orientation descriptors have null rotation
meaning where the source cannot express it generically; the native byte mapping
remains private and no consumer can assume an index is an engine code.

For D-8 VoxeLibre (`mineclone2`/`voxelibre` with loaded `mcl_playerplus`), this source
declares a fixed 1 x 2 x 1 grid planning envelope. The 0.92.3 player's normal,
sneaking, riding, swimming and elytra boxes fit inside it. Other games have
UNAVAILABLE/NO_PUBLIC_SOURCE. No live player name, posture, position or yaw is read
to supply this declaration. Actual write guards still inspect actual bodies inside
the engine, including bodies changed by additional mods. The old
config-engine-facts/v2 record remains UNAVAILABLE because its published schema only
permits that form; new consumers use WriteProfile/WorldSourceCapabilities.

Neutral service names are `hanaworldsWorldSourceFacts`, `hanaworldsLocalWorlds`
and `hanaworldsWorldInspectionContext`. The old Luanti facts/local-worlds names remain
exact aliases for this transition minor; inspection resolves the neutral name first.
Payload version 0.12.1 includes clean external material labels. Older loaded payloads must be
re-provisioned through the existing lifecycle path, not silently upgraded here.

`hanaworlds-adapter-luanti/world-source-facts-mock` exports
`createWorldSourceFactsMock(refusals)`. It implements all five reads and all declared
operation errors using the packaged published-contract examples in
`fixtures/world-source-facts.json`. Those examples and the mock are SOURCE/FIXTURE,
not evidence of a running engine, provider authenticity or live currency.

```js
const response = await facts.call('ReadWriteProfile', {
  contractVersion: 'world-facts/v1', requestId: 'write-profile-1', worldRef
});
// Bridge forwards response.result.compilationConfig and avatarEnvelope unchanged.
```

Sources: [Luanti 5.17 API](https://github.com/luanti-org/luanti/blob/5.17.0/doc/lua_api.md),
[VoxeLibre 0.92.3 player declarations](https://github.com/VoxeLibre/VoxeLibre/blob/0.92.3/mods/PLAYER/mcl_playerplus/init.lua),
[pngjs](https://github.com/pngjs/pngjs). No engine/game source is copied or bundled.
This card's verification is SOURCE/FIXTURE. Native world execution, UI composition
and owner acceptance are not established by these tests.

`frameId` and `providerRef` are opaque identities. Catalogue material extensions,
including `param2Type` and `collisionBoxes`, retain their baseline opaque semantics;
wording does not make them consumer input. Visible Frame grid units and usable
volume units are `cell`. The mock reads the public contracts fixture directly;
`npm run sync:fixtures` regenerates the five-read exported projection and `npm test`
checks for drift without changing existing export paths.

## Read-only Host scoped state

The existing service registration `hanaworldsWorldFacts` additionally provides
`readScopedState(connectionRef, positions): Promise<ScopedStateFacts>`, declared
by the package root's `WorldFactsHostPort`. The result reuses the `worldRef`,
`stateProfile` and `cells` types of the existing `ScopedWorldBinding`: actual
paired world identity, its validated `StateProfile` and validated `ScopedCells`.
This source candidate still consumes the published development SDK v2.13.0;
the shared neutral Host binding addition is pending formal publication.

This method is a Host call, separate from the existing four named world-facts
wire reads. No wire operation or protocol minor is invented. The method captures
the current registration when its tracked Cordis getter is obtained. Only the
active registered `hanaworldsCanvasV5` provider/fiber in the same official runtime
and root may invoke it. That exact provider/value/fiber is checked before native
reading and after each availability check; replacement or fiber disposal refuses.
Package/plugin names, root callers, caller JSON, forged receivers and cross-root
references provide no authority. A legally renamed Canvas provider succeeds.

`connectionRef` is a nonempty exact `Ref`. `positions` is a nonempty existing
`Positions` value: numeric x/y/z ascending with no duplicate positions. Missing,
empty, invalid, repeated or unsorted coordinates refuse with the published schema
error, without reaching the native read. The method never sorts, deduplicates,
fills gaps or retries. Snapshot coverage and records retain exactly this order.
The existing native paired connection, world/root, lifecycle provider, engine
currency and Catalogue are checked through the original reading path before and
after the snapshot. No new shared private state or alias fallback is involved.

Each cell is `KNOWN` with its original opaque `stateDigest`. The existing hash
prefix is `HanaWorlds|contracts@2.0.0|adapter-scoped-cell/v2\n`; its canonical JSON
covers `{profile, record}`, with StateProfile-derived state fields omitted from
the record. Material, orientation, position and all other state retain the exact
existing native conversion and digest bytes. Consumers forward these hashes;
they do not reconstruct the world source's engine mapping or opaque state.

Refusals retain the existing public Error protocol, always with mutationState
`NONE`: `SCHEMA_INVALID` for bad input/decoded shape; `CAPABILITY_UNAVAILABLE` for
missing/unauthorized, stale or forged provider/root identities and unknown native
capability; `WORLD_NOT_BOUND` for an unpaired connection; `ADAPTER_UNAVAILABLE`
after closure; `CURRENT_WORLD_MISMATCH` for lost/changed world, source or connection;
`TARGET_FACTS_INCOMPLETE` for an unreadable native cell. Native payload/version,
coverage, decoding and unsupported state errors retain their published names
(including `PAYLOAD_VERSION_MISMATCH`, `READBACK_MISMATCH`,
`UNKNOWN_REQUIRED_FIELD`, `UNSUPPORTED_MUTATION_SEMANTICS`). No unavailable state
becomes a fabricated `KNOWN` cell. Protocol fields, rather than a private
exception constructor, identify a refusal across roots/artifacts.

This read performs no world write, transaction preparation, history update,
selection, connection or binding change. It offers before/after availability
checks, not a synchronous stable session guard: Q42/Q61/Q62 remain separate.
The previous facts service and aliases stay available until the existing alias
retirement card handles all consumers.

```js
// Inside the active registered C-canvas provider's official Cordis context:
const facts = ctx.get('hanaworldsWorldFacts');
const { worldRef, stateProfile, cells } = await facts.readScopedState(
  connectionRef, [[-1, 9, 0], [0, 9, 0], [1, 9, 0]]
);
```
