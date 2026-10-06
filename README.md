# HanaWorlds Luanti Adapter 0.5.0 (region I/O line, payload 0.5.0)

Local, fresh-install `world-adapter/v6` transport, pinned to the root entry of
`hanaworlds-contracts@0.4.2` (source `aad7c0ea2a4a9a93dfb13555c46cd98b9b5da777`,
pack SHA256 `c3528a4fc3f0cdf94245c4d2d8b1cfa5d28db96d1cd00ae74737bdbdfcd26ec6`).
The text-line package 0.3.1/payload 0.3.0 and the image-material package
0.4.0/payload 0.4.0 stay separate fixed artifacts; this 0.5.0 line adds region
I/O and does not migrate worlds provisioned with an older payload.
There is no player account, username/password, grant, AUTO mode, administrator
approval or protection-region permission path in this package. Canvas owns
transaction, affected-object and durable history decisions.

## Public in-process ports

The plugin publishes `hanaworldsWorldAdapterV6.call(operation, request)`,
`hanaworldsLuantiLocalWorlds` and
`hanaworldsLuantiNativeFacts.readScopedState(connectionRef, positions)`.
`hanaworldsLuantiNativeFacts.readCatalogue(worldRef)` returns the complete
contracts0.4.0 `Catalogue` directly (no digest-only or custom envelope). It
accepts the exact currently paired worldRef and rechecks the actual Host
process/world/connection before and after reading Luanti's loaded
`registered_nodes`, `get_game_info` and `get_modnames` through the private
courier. Unbound/wrong/stopped worlds fail closed. It includes registered
materials that are not placed in the inspected region. Unknown capabilities
remain null with exact `unknownFields`; they are never inferred from a hash,
placed nodes, model output or defaults. Host may bind the Workshop public
`hanaworldsCatalogue.read(worldRef)` to this supplier. Host cannot inspect
Adapter engine/rows directly and supplies no invented capacity result.

The V6 port carries the exact bundled handshake. Mutating calls require the
actual active Cordis caller fiber for the Host Loader's `hanaworlds-canvas`
entry in the same root; caller JSON cannot assert this provenance. The only
HTTP route is a loopback, read-only status route.

Local provisioning: discover the selected world, acquire with
`{connectionRef, requesterRef, userPath, action:'PROVISION_PAYLOAD'}`, then
`provision({connectionRef, requesterRef, leaseRef})`. The Host's
`hanaworldsNativeEngineControl` must supply actual native process facts and
stop that process before invoking its finite stopped-world callback.
Provisioning installs six payload files, a fresh world identity and a private
loopback courier key. Existing payload locations fail; there is no migration
or old-wire compatibility. Acquire again with `BIND_RUNNING_WORLD`, then
`pair(...)`. Pair verifies the actually loaded payload digest and creates a
new connection incarnation. Every scoped request rechecks the actual Host
process/world/operation association and the Canvas selection context.

Canvas supplies `hanaworldsCanvasV5.call('ReadWorldSelectionContext', ...)`
using the exact 0.4.0 `WorldSelectionContext.selection` envelope. Existing
object footprints come from
`hanaworldsCanvasFootprintRegistry.readFootprints(worldRef, objectRefs, request)`:
`{current:true, durable:true, worldRef, objects:ScopedObjectFootprints}`.
This must be Canvas's current durable registry projection; request-held
footprints are compared with it before prepare and again before apply.

For history, Canvas supplies `hanaworldsCanvasHistoryFacts.read(request)`:
`{current:true, durable:true, worldRef, originTransactionId, historyRevision,
worldRevision, objectRevisions, affectedObjectRefs, originVerifiedReceiptDigest}`.
Those values must come from Canvas's durable current history/head, not be
copied out of caller JSON. The Adapter additionally verifies its own saved
origin receipt, before image, after image and their exact digests. For
inspection, the existing public `hanaworldsWorldRevisionOracle.read(worldRef)`
and `hanaworldsLuantiInspectionContext.read(request)` supply Canvas's current
revision/selected-object context. These are logical Canvas revisions, not
claims of a Luanti whole-world revision. Native catalogue, region, body and
cell state come from the paired engine. Missing public peer facts fail closed.

## Scoped writes and same-origin Undo

`readScopedState` returns the actual state profile and opaque per-cell hashes.
A cell hash is SHA256 of the UTF-8 prefix
`HanaWorlds|contracts@0.4.0|adapter-scoped-cell/v1\n` followed by canonical JSON
of `{profile,record}`. Consumers carry these bytes in `ScopedWorldBinding`;
they do not recreate cell state from a plan. The complete union of checked
positions and existing object footprints is re-snapshotted before the durable
write barrier and checked again inside Luanti immediately before mutation.

Before images and request outcomes are fsynced to the Adapter's world-bound
journal under the native `dshHomePath` service. The engine writes only compiled
static-node effects, repairs derived lighting, then the Adapter reads the
complete scoped state. The actual derived param1 bytes are retained in the
after image. An exact completed request returns its saved response without a
second engine write. Partial failure restores the whole saved scope and reads
it back; an unverified restore remains an error with unknown mutation state.
Undo transports the exact saved before image from the same verified source
transaction and verifies the restored readback. It does not infer an inverse
from a new build or delete a bounding box.

## Readonly material sources (0.4.0)

`ctx.get('hanaworldsLuantiNativeFacts').readMaterialSources(worldRef)` returns the
contracts0.4.2 `{snapshot, textures}` envelope for the actual paired world. The
paired Luanti process supplies one synchronous registry snapshot through the private
courier (`fact_material_metadata`): the same Catalogue as `readCatalogue`, the
engine game path (`get_game_info().path`), user path (`get_user_path()`), the
`texture_path` setting, load-ordered mods (`get_modnames(true)` + `get_modpath`)
and a narrow appearance projection. Node reads texture bytes only from those roots.

Legal param2 (`Catalogue.allowedParam2`) is derived from engine semantics only:
`facedir` → 0..23; `none` → the engine placement value (`place_param2`, else 0,
as in builtin `item_place_node`). Every other paramtype2 stays null/unknown.
A supported appearance is an opaque `normal` drawtype whose 1..6 tiles all name
the same plain `.png`/`.jpg` file with no modifier, animation, colour, palette or
overlay. Source precedence follows Luanti 5.17.0 `Server::fillMediaCache`:
user `textures/server` (reported UNRESOLVED_SOURCE, not a game/mod source), game
`textures`, then mods in reverse load order; sub-directories starting with `_` or
`.` are ignored, a duplicate inside the winning recursive root, an empty/oversized
file, any symlink/unreadable media directory, an `override.txt` in game textures or
a non-empty `texture_path` all give UNKNOWN. `hasPersistentState`/`collisionBoxes`
remain unknown regardless of KNOWN textures. Metadata is read twice around the
byte resolution; any change of registry facts, bytes, connection or process rejects
`CURRENT_WORLD_MISMATCH`. Source basis is SERVER_ASSET_ONLY: no client texture-pack
or rendered-appearance claim, no RGB values, no cache.

`npm run test:materials` covers the Lua projection and resolver (FIXTURE).
`test/real-material-sources.mjs` is the focused real-Luanti reproduction with an
explicit component fixture game; it does not represent the product game.

## Region I/O (0.5.0)

`ctx.get('hanaworldsLuantiRegionIO')` is the bulk transport for the Canvas
transaction owner (only the `hanaworlds-canvas` caller fiber is admitted):

- `describe()` — self-description: purpose, typical scale, preconditions,
  protocol `hanaworlds-region-io` 1.0.0 and its capabilities, `atomic: false`.
- `negotiate({name, version, requiredCapabilities})` — compatible iff same
  breaking line (major; for 0.x, major.minor) and every required capability is
  offered. Minor/patch/source-hash differences never reject; another line rejects
  `PROTOCOL_MAJOR_MISMATCH`, a missing capability `CAPABILITY_UNAVAILABLE`.
- `readRegion({worldRef, connectionRef, connectionIncarnationRef, protocol, min, max})`
- `writeRegion({worldRef, connectionRef, connectionIncarnationRef, protocol, voxels, expectedBlocks})`

Every call is checked before any engine dispatch: protocol line, current paired
world/connection/incarnation and the native process (`inspectConnection`).

**Load before read.** Each mapblock-aligned batch is first queued with
`core.emerge_area` (fetch from memory, load from disk or generate) and the reply
waits for the engine's last callback; it is then read with one VoxelManip
`read_from_map`. A block is KNOWN only when none of its cells reads back as
`ignore`; the emerge action (GENERATED / FROM_MEMORY / FROM_DISK / CANCELLED /
ERRORED) is reported as a fact. Luanti also reports CANCELLED for a queued block
that another queued block's mapchunk already generated, so the readback, not the
action, decides. Any UNKNOWN block makes the read `UNKNOWN` (no voxels) and a
write `REJECTED` before the first write.

**Write.** `voxels` are region voxels v1 (see FIXTURE NOTICE in
`src/region-voxels.mjs`): palette of `{nodeName, param2}` and runs in x-fastest,
then y, then z order. `air` is an explicit dig; a `null` run is unspecified and
keeps the current cell. `expectedBlocks` must list every block of the region with
the digest the caller read. All batches are prechecked (loaded, digests match,
changed cells static/stateless/non-liquid, no solid into a player body) by the
engine without writing; then each batch is rechecked, written with
`set_data`/`set_param2_data`/`write_to_map(true)` (engine lighting), its light
repaired with `core.fix_light` over the batch's mapblocks (the returned `true` is
the light completion fact) and read back from the map: specified cells must equal
the target and unspecified cells must be unchanged. Writes never fall back to a
per-node loop.

**Not a transaction.** Batches are separate engine steps. A failure after the
first batch returns `PARTIAL` with per-batch facts (`WRITTEN_VERIFIED`,
`NOT_WRITTEN`, `UNKNOWN` for a lost reply) and after-digests; the Canvas restores
its own pre-write region snapshot with `writeRegion` (restore transport). Nothing
here is reported as atomic.

**Batch size** is derived from the courier's actual 4 MiB body limit and the
loaded registry (worst-case run/palette bytes), not from a setting; one batch is
the only engine-side working set. Region/block digests use the text format
`hw-region-cells/1` (identical in `voxel.lua` and `region-voxels.mjs`; each read
recomputes them on the host from the returned cells).

`npm run test:region` (FIXTURE engine double) covers negotiation, the voxels
fixture, batching, rejection and partial facts. `test/real-region-io.mjs` is the
real-Luanti reproduction (explicit component fixture game `hw_region_fixture`,
public Host/Canvas peer fixtures, independent `hw_probe` node/light/write-counter
reads).

## Validation and retained history

The 0.3.1-only read seam reproduction is `test/real-catalogue.mjs`, using fresh
source and extracted-package profiles. Its `HW_LOCAL_*` inputs match the core
script and it needs only a public Host lifecycle fixture, no Canvas fixture.
`npm run test:catalogue` covers unbound/invalid/closed reads. Payload0.3.0 bytes
and the protected eleven-core-check 0.3.0 evidence remain unchanged.

Use Node24.13.1, an isolated npm cache, `npm ci --ignore-scripts`, `npm run build`,
`npm test`, `npm run test:lua` and `npm run verify:contracts`. The current core
runtime reproduction is `test/real-local-world.mjs`; its inputs are an actual
extracted npm pack, an installed Cordis module (`HW_CORDIS_MODULE`) or the fixed
Cordis App path, a fresh evidence root and separately
installed pinned WorldEdit. It launches only its own headless Luanti processes.
Host/Canvas interfaces in that reproduction are explicit public peer fixtures.
It proves component native transport, not formal Desktop, model, GUI or owner
acceptance. No release, registry publication or deployment is performed.

The old 8146f000/0.2.9 source and its old-wire tests remain in Git/source as
historical inputs. Legacy modules and grant.lua are excluded from this package's
explicit file list. Old tests are retained; old protocol tests and the larger
reentry/replay/concurrency/remote matrix are DEFERRED, not deleted or counted as
current passes. See `DEFERRED-LOCAL-WORLD.md`.
