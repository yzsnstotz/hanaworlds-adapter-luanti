# World source facts (adapter 0.18.2)

The Luanti adapter provides `world-facts/v1` through
`hanaworldsWorldSourceFacts.call(operation, request)` and the returned
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

All reads validate requests and bound responses using published contracts v2.8.0.
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
and `hanaworldsInspectionContext`. The old Luanti facts/local-worlds names remain
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
