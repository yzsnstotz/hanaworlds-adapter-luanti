# HanaWorlds Luanti Adapter 0.5.0 (region I/O line, payload 0.5.0)

Local, fresh-install `world-adapter/v6` transport, pinned to the root entry of
`hanaworlds-contracts@0.5.0` (source `c006a839a6e6c2c63d57a14b72e4e6b26fa717f1`,
pack SHA256 `7fb42f1eaaf4988730f6cf254faecb84bbbb1d84e293558b66727c470181b31e`).
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

## Region I/O — world-adapter-region/v1 (0.5.0)

Consumes `hanaworlds-contracts@0.5.0` (source `c006a839a6e6c2c63d57a14b72e4e6b26fa717f1`,
pack SHA256 `7fb42f1eaaf4988730f6cf254faecb84bbbb1d84e293558b66727c470181b31e`).
`ctx.get('hanaworldsWorldAdapterRegionV1')` exposes `call('ReadRegion' | 'WriteRegion',
request)`, `protocolHandshake` (protocol `world-adapter-region` major 1 minor 0 and the
five `world-adapter-region/v1:*` capabilities; provenance is a record only) and
`lastFacts()` (engine batch/emerge facts of the last call, evidence only). Only the
`hanaworlds-canvas` caller fiber is admitted; every call checks the current paired
connection/incarnation and the Canvas `ReadWorldSelectionContext` like the per-cell
path. Another wire (e.g. `world-adapter-region/v2`) is `UNSUPPORTED_VERSION` before any
engine dispatch; consumers decide compatibility with the contract's
`checkProtocolCompatibility` (same major, minor, capabilities), never package versions.

**ReadRegion.** Each mapblock-aligned batch is queued with `core.emerge_area` (memory,
disk or generation) and read with one VoxelManip `read_from_map`. A chunk is KNOWN only
when none of its cells reads back as `ignore`. `loadMethod` comes from
`core.compare_block_status(block, "loaded")` taken before the request (the emerge
action alone cannot tell: Luanti reports blocks generated within the same mapchunk as
FROM_MEMORY or CANCELLED). Unknown chunks carry `OUTSIDE_WORLD_LIMITS` (beyond
`mapgen_limit`) or `LOAD_FAILED`. `RegionState` = node/param2 block + extras (node
metadata fields, inventory stack strings, started timers of nodes that define
`on_timer`); param1 is derived light and not part of the state (contract).

**WriteRegion.** Every chunk is loaded and must be KNOWN with a state digest equal to
`expectedCurrentDigest`; an engine check-only pass of every batch follows; any failure
there is an error with `mutationState: NONE`. Each batch is then rechecked by the
engine in the same server step (private guard over nodes, param2 and extras), written
with `set_data`/`set_param2_data`/`write_to_map(true)`, extras applied (APPLY: every
specified cell loses its extras; RESTORE: exactly the given extras) and its mapblocks
light-repaired with `core.fix_light`. Every written chunk is read back from the map and
reported with its `readbackDigest`. A later failure leaves earlier chunks `WRITTEN`
and the rest `NOT_WRITTEN` (`UNKNOWN` for a lost reply). Lighting is `COMPLETE` only
when every written batch's `fix_light` returned true. Nothing is a commit: Canvas
compares summaries and restores its BEFORE_IMAGE states with purpose RESTORE.

**Batch size** derives from the courier's 4 MiB reply limit and the loaded registry
(worst-case runs/palette per mapblock), not from a setting; a batch whose metadata
makes the reply too large is read one mapblock at a time.

`npm run test:region` (FIXTURE engine double) covers the contract shapes, handshake,
rejections and per-chunk facts. `test/real-region-io.mjs` is the real-Luanti
reproduction (explicit component fixture game `hw_region_fixture`, public Host and
Canvas peer fixtures, independent `hw_probe` node/light/metadata/write-counter reads).

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
