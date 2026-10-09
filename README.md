# HanaWorlds Luanti Adapter 0.7.5 (flat-world creation + write-path facts + read-only region state, payload 0.6.0)

Local, fresh-install `world-adapter/v6` transport, pinned to the root entry of
`hanaworlds-contracts@0.5.3` (published tag `v0.5.3`, source
`3457493da209178f815d6950e323e1dc462e8d6c`, pack SHA256
`7f2b088b300426ea2536e08904780dc5df94eaf5e341e83cbff0cc3a42362241`).
The text-line package 0.3.1/payload 0.3.0 and the image-material package
0.4.0/payload 0.4.0 stay separate fixed artifacts; this 0.5.0 line adds region
I/O and does not migrate worlds provisioned with an older payload. 0.6.0 adds
new flat local world creation; 0.7.0/payload 0.6.0 publishes Catalogue facts
and verifiable callback evidence under Contracts scope `write-path-init/v1`
(see below). New worlds carry payload 0.6.0; older payload worlds are not adopted.
There is no player account, username/password, grant, AUTO mode, administrator
approval or protection-region permission path in this package; since payload
0.7.0 the engine only checks protection per written cell and refuses (see
"Engine guards"). Canvas owns transaction, affected-object and durable history decisions.

## Public in-process ports

The plugin publishes `hanaworldsWorldAdapterV6.call(operation, request)`,
`hanaworldsLuantiLocalWorlds` and
`hanaworldsLuantiNativeFacts.readScopedState(connectionRef, positions)`.
`hanaworldsLuantiNativeFacts.readCatalogue(worldRef)` returns the complete
public `Catalogue` directly (no digest-only or custom envelope). It
accepts the exact currently paired worldRef and rechecks the actual Host
process/world/connection before and after reading Luanti's loaded
`registered_nodes`, `get_game_info` and `get_modnames` through the private
courier. Unbound/wrong/stopped worlds fail closed. It includes registered
materials that are not placed in the inspected region. Unknown capabilities
remain null with exact `unknownFields`; they are never inferred from a hash,
placed nodes, model output or defaults. Host may bind the Workshop public
`hanaworldsCatalogue.read(worldRef)` to this supplier. Host cannot inspect
Adapter engine/rows directly and supplies no invented capacity result.

The V6 port retains the exact bundled ContractHandshake and also publishes
`protocolHandshake`: `world-adapter` major 6 minor 1 with
`world-adapter/v6:callback-free-write` and `world-adapter/v6:write-path-state-facts`.
K3 consumers use `checkProtocolCompatibility` with the required major/minor and
capabilities; package versions and hashes are provenance, not compatibility. Mutating calls require the
actual active Cordis caller fiber for the Host Loader's `hanaworlds-canvas`
entry in the same root; caller JSON cannot assert this provenance. The only
HTTP route is a loopback, read-only status route.

Local provisioning: discover the selected world, acquire with
`{connectionRef, requesterRef, userPath, action:'PROVISION_PAYLOAD'}`, then
`provision({connectionRef, requesterRef, leaseRef})`. The Host's
`hanaworldsNativeEngineControl` must supply actual native process facts and
stop that process before invoking its finite stopped-world callback.
Provisioning installs seven payload files, a fresh world identity and a private
loopback courier key. Existing payload locations fail; there is no migration
or old-wire compatibility. Acquire again with `BIND_RUNNING_WORLD`, then
`pair(...)`. Pair verifies the actually loaded payload digest and creates a
new connection incarnation. Every scoped request rechecks the actual Host
process/world/operation association and the Canvas selection context.

### Same-service second world (0.7.1)

No new public fields or wire are required. After pairing A, the Host may stop
its exact owned A process. Create independent B normally, then
`acquire({connectionRef:B.connectionRef, requesterRef, userPath,
action:'BIND_RUNNING_WORLD'})` and `pair({connectionRef:B.connectionRef,
requesterRef, leaseRef:BLease.leaseRef})` on the same service. Pair returns the
existing observation plus `paired:true`, B's world/payload identity and a fresh
`connectionIncarnationRef`. It does not select a Canvas world or session.

Before pairing B, Adapter invokes the original A control provider's existing
`withStoppedWorld(AQuery, consume)` using its captured controlRef, requester,
world path and operation. Host must retain that ownership record after A exits
and supply its actual exited PID/world/operation inside a finite awaited callback.
It may stop the owned process as part of this existing operation. A generic
CURRENT-inspection error, a stopped fact outside the callback, a replaced
provider, missing callback, unknown identity or mismatched PID is insufficient.
Those cases reject pair B with `CURRENT_WORLD_MISMATCH`; B is not returned as
paired, and Host owns cleanup of rejected native sessions. No restart/reinstall
of Adapter, caller-held lifecycle facts, or guessed process identity is used.

A's CURRENT reads fail as soon as Host inspection no longer verifies it. Its
control query is retained solely for the stop callback, never as a current lease.
After that callback verifies A's exact identity, all A leases are invalidated,
serialized runtime work drains, the old courier closes, and A's runtime record
is removed before pairing B. Old world/connection reads and lease reuse reject;
connection inventory contains only B after success. If failure occurs after
A retirement, A stays invalidated; no old binding is restored. Failed B does not
become a current connection. Whole-service `close()` remains permanent disposal.

Host implementations that discard A's control/exit record or cannot honor
`withStoppedWorld` for that owned stopped process must supply that existing
public lifecycle capability before consuming this sequence. Same-connection
re-pair remains unsupported. Source and installed-package evidence exercises
the public Host peer with real isolated Luanti children; Desktop integration,
Canvas selection and product Enter game are separate gates.

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

## Read-only region state and the development readback page (0.7.2)

`hanaworldsLuantiNativeFacts.readRegionState(worldRef, box)` reads a node box of the exact
currently paired world with the same emerge + VoxelManip chunk reads as `ReadRegion`, but
outside any transaction: no Canvas selection context, no `localContext`, no BEFORE_IMAGE
role and no write. It returns `{worldRef, connectionRef, connectionIncarnationRef,
payloadVersion, payloadDigest, box, chunks, facts}`; every chunk is a public
`RegionChunkRead` (KNOWN with `state`/`stateDigest`, or UNKNOWN with its reason) and each
`stateDigest` is rechecked. The Host process/world/connection is inspected before and after.
Unbound/wrong/stopped worlds fail closed (`WORLD_NOT_BOUND`, `CURRENT_WORLD_MISMATCH`), an
invalid box is `SCHEMA_INVALID`. Loading a never-visited area lets Luanti generate it (the
engine's own map generation, as a player visit would); the Adapter writes nothing. Payload
bytes are unchanged (0.6.0), so worlds created by 0.7.x stay bindable.

`dev/world-readback/` (development only, not packaged) serves http://127.0.0.1:47606/ and
http://localhost:47606/ (loopback IPv4 and IPv6; any page path or query recovers to the page,
`/api/*` is JSON). It loads this plugin into its own Cordis root and calls only public ports.
The selectable **sample world is a FIXTURE**, marked on every view: created by
`createFlatWorld` in the service's own isolated Luanti user path and run by the labelled
development Host in `server.mjs` (one real headless Luanti child; no Canvas peer). Reading
uses `readRegionState` around the spawn centre (x=0,z=0: no `static_spawnpoint` in the dev
config and no `/setworldspawn` in the fresh world, so VoxeLibre leaves spawn to the engine's
search around the origin), growing the vertical window until each column's top is bracketed;
the top-down map, materials and heights all come from the one final read whose digest is
shown. The owner's real worlds are not listed, started or read here: they need the
HanaWorlds.app Host's public connection supply, an integration input. Start detached with
`dev/world-readback/start.sh <state dir> <cordis lib/index.js>`; the state dir must contain
`profile/games/mineclone2` and `profile/mods/worldedit`, else the page lists the Adapter's own
`describeFlatWorldCreation` missing items. `npm run test:readback` covers the fail-closed
port and the projection (FIXTURE); `dev/world-readback/browser-walk.mjs` drives the page in
headless Chrome for screenshots.

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
a non-empty `texture_path` all give UNKNOWN. `collisionBoxes` remains
unknown regardless of KNOWN textures; `hasPersistentState` follows the rule below. Metadata is read twice around the
byte resolution; any change of registry facts, bytes, connection or process rejects
`CURRENT_WORLD_MISMATCH`. Source basis is SERVER_ASSET_ONLY: no client texture-pack
or rendered-appearance claim, no RGB values, no cache.

Catalogue `hasCallbacks` / `hasPersistentState` (payload 0.6.0) follow the
Contracts 0.5.2 scope **`write-path-init/v1`**: the declared write/restore path
and its initialization requirements. Per-cell writes/restores use separately
installed WorldEdit `set` / `set_param2` (VoxelManip) plus `swap_node`; region
writes/restores use VoxelManip. These node-data paths execute no node-definition
callbacks. Full state (metadata, inventory, timers) is still read back and
included in digests; Canvas retains transaction and Undo decisions.

`hanaworldsLuantiNativeFacts.readWritePathEvidence(worldRef)` returns
`{catalogue, evidence, check}` from one actual paired registry snapshot. The
public `WritePathEvidence` lists each node's `definedCallbacks` field names
and `definitionRevision`, the Catalogue digest, and `globalWriteCallbacks`
(currently `registered_on_mapblocks_changed`). Before returning, the Adapter
runs Contracts `validateCatalogueWritePathFacts`. Revisions fingerprint the
loaded registry's public facts and callback names, not Lua function addresses
or game/mod source-code revisions.

- When the global write registry is missing/unreadable or has handlers, both
  facts remain null for all nodes. A present handler is named
  `register_on_mapblocks_changed` in the evidence.
- Initialization/lifecycle hooks (`on_construct`, `after_place_node`,
  `on_timer`, `on_destruct`, `after_destruct`) give `hasCallbacks: true` and
  `hasPersistentState: null`. Metadata-inventory hooks, `on_receive_fields`
  and `preserve_metadata` also keep persistent state unknown.
- With a known empty global write registry and none of those hooks, both
  facts are false. `ignore` stays null (stricter than the public derivation)
  because it is an unloaded placeholder and must never become writable.
- Player callbacks, ABM/LBM and independent world dynamics are outside this
  scope; their later effects are not claimed absent. Complete readback digests
  detect state changes, and same-origin Undo refuses a changed after-state.

The public static-material validators are unchanged: true or null still
rejects. Real VoxeLibre air/stone have only out-of-scope player hooks and can
be admitted when the actual global write registry is empty; furnace/chest
initialization hooks remain rejected before mutation. Grass still has unknown
param2=color and initialization hooks; this update does not make it writable.

`npm run test:materials` covers the Lua projection and resolver (FIXTURE).
`test/real-material-sources.mjs` is the focused real-Luanti reproduction with an
explicit component fixture game; it does not represent the product game.

## Region I/O — world-adapter-region/v1 (0.5.0)

Consumes `hanaworlds-contracts@0.5.3` (published tag `v0.5.3`, source
`3457493da209178f815d6950e323e1dc462e8d6c`, pack SHA256
`7f2b088b300426ea2536e08904780dc5df94eaf5e341e83cbff0cc3a42362241`).
`ctx.get('hanaworldsWorldAdapterRegionV1')` exposes `call('ReadRegion' | 'WriteRegion',
request)`, `protocolHandshake` (protocol `world-adapter-region` major 1 minor 1, the five existing capabilities
and `world-adapter-region/v1:callback-free-write`; provenance is a record only) and
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

## New flat local world (0.6.0)

`hanaworldsLuantiLocalWorlds` also creates a new local single-player world that is
flat by default and immediately bindable:

- `describeFlatWorldCreation({requesterRef, userPath})` returns, without creating
  anything, the configured world roots, the games installed in
  `<userPath>/games` (gameId, title, version, game.conf SHA256, whether the game
  allows the `flat` mapgen, and the game's own declared flat option), the mapgen
  parameters that will be written, the per-cell mod found in `<userPath>/mods`, and
  `ready`/`missing[]` naming each missing prerequisite (`WORLD_ROOT`, `GAME`, `MOD`).
- `createFlatWorld({requesterRef, userPath, root?, gameId?, worldName?})` stages
  a new world directory, fsyncs it and renames it into the world root. The new
  world carries `world.mt` (gameid, world_name, sqlite3 backends,
  `load_mod_worldedit = true`), `map_meta.txt` with the flat mapgen, and
  `worldmods/hanaworlds_adapter` with a fresh world identity and courier key.
  The result is `{created, connectionRef, worldPath, worldName, worldRef,
  payloadVersion, payloadDigest, game, mapgen, perCellMod, nextAction:'BIND_RUNNING_WORLD'}`;
  its `connectionRef` is exactly what `discover()` reports for that world, so the
  Host continues with `acquire({..., action:'BIND_RUNNING_WORLD'})` and `pair`.
  No `PROVISION_PAYLOAD` start/stop cycle is needed for a world created here.

Mapgen (written into the new world only, so no global Luanti setting, Host
config or other world is read for it or changed): Luanti's own `flat` mapgen,
`chunksize=5`, `water_level=1`, `mapgen_limit=31000`,
`mg_flags=nocaves,nodungeons,light,nodecorations,biomes,ores`,
`mgflat_spflags=nolakes,nohills,nocaverns`, `mgflat_ground_level=8`, a fresh
random 64-bit `seed`. When the chosen game's `settingtypes.txt` declares the game's
own flat option `mcl_superflat_classic` (VoxeLibre/MineClone2), it is set to
`true`: VoxeLibre then generates its classic superflat (grass at y=8, dirt y=7..6,
bedrock y=5). Every applied value is returned in `mapgen`.

Choices are never guessed: with no `gameId`, exactly one installed game that
allows `flat` is used, otherwise `GAME_SELECTION_REQUIRED`/`GAME_NOT_INSTALLED`
with `details.choices`; a game that disallows `flat` is `MAPGEN_NOT_SUPPORTED`;
with several roots and no `root`, `WORLD_ROOT_REQUIRED` with the choices. The
per-cell StateProfile needs WorldEdit; without it creation fails
`PREREQUISITE_MISSING` naming the mod and where it is looked for. An existing
name is `WORLD_EXISTS` and is never overwritten; with no `worldName` a new
`hanaworlds-flat-<UTC>-<hex>` name is used. On any failure the staging directory
is removed and no world is created or selected. Existing worlds are not migrated.

## Safe deletion of an Adapter-created world (0.7.3)

`hanaworldsLuantiLocalWorlds` adds two methods. No Contracts type, wire, payload
or other origin changes; payload stays 0.6.0.

- `createFlatWorld` now also writes `hanaworlds-created-world.json` in the new
  world's own directory (outside the payload): `{format:'hanaworlds-adapter-created-world/1',
  createdBy:'hanaworlds-adapter-luanti', adapterVersion, worldRef, worldName, root, createdAt}`.
  It is the only ownership proof. Worlds without it (user worlds, provisioned
  worlds, worlds created by 0.7.2 or earlier), copies or moved worlds are
  `WORLD_OWNERSHIP_UNKNOWN` and are never deleted.
- `describeWorldDeletion({requesterRef, connectionRef, worldRef})` changes nothing and
  returns `{connectionRef, worldRef, worldName, worldPath, root, productCreated,
  createdAt, dataLoss:{scope:'ENTIRE_WORLD_DIRECTORY', files, bytes}, nativeStop,
  deletable, blockers[], callerMustVerify:['NO_LIVE_SESSION_BINDING']}`.
- `deleteWorld({requesterRef, connectionRef, worldRef})` rechecks every fact,
  deletes, then reads back. Success: `{deleted:true, connectionRef, worldRef,
  worldName, worldPath, removed:{files,bytes}, nativeStop, readback:{listed:false, pathExists:false}}`.

Checks (service side, all at call time): `connectionRef` must be what `discover()`
lists now in a configured root (else `CONNECTION_NOT_FOUND`; a world outside the
current roots is unreachable); its realpath is unchanged and its payload worldRef
equals `worldRef` (else `CURRENT_WORLD_MISMATCH`); the creation marker matches
worldRef, name and root. Named blockers: `WORLD_IN_USE` with reason
`LIFECYCLE_LEASE_OPEN` (any acquired lease, paired or not), `ADAPTER_CONNECTION_BOUND`,
`RUNTIME_CONNECTION_OPEN`, `TRANSACTION_IN_FLIGHT` (the world's Adapter journal has
a transaction not `VERIFIED`/`ROLLED_BACK`/`ABORTED_PREPARED`);
`REQUIRED_FACT_UNKNOWN` (`JOURNAL_UNREADABLE`, `RUNTIME_ACTIVITY_UNAVAILABLE`);
`CURRENT_WORLD_MISMATCH` (`NATIVE_CONTROL_PROVIDER_REPLACED`). A rejected deletion
carries `error.details.blockers` and changes nothing.

The current world cannot be deleted: switch to another world first (0.7.1
sequence); the switched-away world then has no lease or binding. If this service
ever acquired the world, deletion runs only inside the original Host's
`withStoppedWorld(originalQuery, consume)` with exact STOPPED PID/world/operation
facts (`nativeStop:'HOST_STOPPED_CALLBACK'`); a Host that refuses, has no record,
gives other facts or was replaced rejects with `CURRENT_WORLD_MISMATCH` and the
world is kept. Stopping a process is never deletion. A world this service never
acquired reports `nativeStop:'NOT_LAUNCHED_BY_THIS_SERVICE'`: Adapter has no Host
query for it and cannot observe a process that another component started.

Removal renames the exact directory (same device/inode) to a hidden
`.hanaworlds-deleting-*` name in the same root (discovery never lists
`.hanaworlds-*` staging), then removes it. A removal failing after the rename is
`DELETE_INCOMPLETE` with `details.residuePath`, never reported as deleted.
Success requires `discover()` to no longer list it and the path to be absent
(`READBACK_MISMATCH` otherwise). Deletion never touches Canvas transactions,
other worlds or the Adapter journal of that worldRef (kept as is).

Caller responsibilities (not observable by Adapter): no live conversation/Canvas
session is bound to the world (`callerMustVerify`), the user confirmed the exact
`worldName` and `dataLoss`, and Cancel simply does not call `deleteWorld`.

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

The focused final gate is `bash scripts/final-gate-flat-world.sh <commit> <fresh-E>`.
It requires Node 24.13.1 and the pinned real-game/WorldEdit/Cordis inputs listed
in the script, records source and installed-package runs, compares package bytes
with the commit, and refuses reused evidence/work directories. Existing failed
runs remain archived under this card's `_evidence/`. This is a component gate;
Desktop UI, model/skill selection, real Canvas transactions and product Undo
remain separate independent gates.


## Independent world manager (Adapter 0.7.5)

`dev/world-manage/` is a development-only consumer of this Adapter's public ports,
listening on loopback port 47607 at `/worlds`. It creates new isolated flat worlds,
switches existing worlds without recreating them, starts a real Luanti game client,
and previews/cancels/confirms safe deletion with directory/list absence readback.
The page prominently labels session bindings as contract-shaped fixtures. The worlds,
server child/exit records, external-process checks and game window are real.

Start with Node 24.13.1: `bash dev/world-manage/start.sh <own-state> <cordis-module>`.
Copy the separately licensed VoxeLibre game and WorldEdit into that state's
`profile/games/mineclone2` and `profile/mods/worldedit` first. Missing prerequisites
are reported by the Adapter; the service does not install or reuse a product profile.
The service remains detached, and supports localhost, 127.0.0.1 and query parameters.
The existing readback service on 47606 is unaffected.

New public `hanaworldsLuantiLocalWorlds.stopWorld({requesterRef, connectionRef, worldRef})`
stops exactly the caller's current world using its original Host STOPPED callback and
retires its runtime binding. It retains the Adapter service and world directory for
later reconnect. Wrong identities/requesters are refused. Host child exit records are
retained for repeated stopped-world callbacks when switching back or deleting.

Deletion confirmations are one-shot and fixed to one exact world. The independent
consumer checks all fixture session bindings and external process/open-file observations
again at confirmation, before the public Adapter rechecks ownership, world identity,
leases, runtime activity and journal safety. Cancel has no world mutation. Product App,
profile and old worlds are outside this service's root and never used.

`node scripts/test-contracts-candidate.mjs <pack> <sha256> <fresh-own-run>` checks pack
bytes and installs only in a fresh isolated test copy, selecting the current 13-file
conformance suite and exact-package advertisement. It leaves source pins/vendor intact.
A candidate is not a published version; the formal tag repin/validation gate is separate.

For shared macOS installations, `HW_LUANTI_CLIENT` may name the executable in this
card's private copy of the official Luanti app. This gives the native window
a unique application path without changing the server binary or any other app.
Set it before starting this independent development service; it is not a
product profile, new engine implementation or authentication input.

## Formal contracts dependency (Adapter 0.7.5)

Install with Node 24.13.1 and `npm ci --ignore-scripts`. `#contracts` resolves the
installed package; there is no contracts vendor copy. The dependency names the
published `v0.5.3` tag, and package-lock.json pins the downloaded archive integrity.
`npm run verify:contracts` checks the exact package, tag reference, lock and all
25 admitted npm-pack entry digests. With TMPDIR set to an own-card run directory,
`npm run verify:contracts:source` also checks the annotated and peeled remote tag
and requires repacking the installed source to reproduce the formal 146045-byte
archive above. `npm run test:contracts` includes byte/missing-module/tag refusal.
Existing 0.7.4 / contracts0.5.2 trial services retain their own source and profile;
this dependency update does not upgrade or restart them. Historical gate scripts
for earlier cards and contracts versions are not current formal-product gates.

## Candidate source preparation (2026-10-09)

Own branch source is Adapter 0.7.6 / payload 0.6.0, pinned to exact contracts v0.5.4-rc.1. This source node is PARTIAL, with no new Adapter tar or 47612 UI delivery. Accepted 0.7.5/0.5.3 remains protected. Current public packet: [Loader/native ownership](./PUBLIC_HOST_RECIPE.md), [Inspection/CAS/revision mapping](./PUBLIC_INSPECTION_RECIPE.md). Candidate pin and new consumer tests cover only SOURCE/FIXTURE; page, real Luanti/Core and product gates remain pending.

New implementation continuation: native exit removes its connection from available inventory and advances aggregate capabilityRevision without declaring STOPPED; oracle/Inspection identities are retained and rechecked. The development Session/World page uses `session-server.mjs` and explicit contracts fixtures, with an actual tar installed in the same pinned official SDK root. Canvas is the only selection authority, Workshop fixture supplies trusted identities/directory, and the manager stores no Session-world table. G-S/U and singular Inspection forwarding are implemented. Actual new tar/runtime/UI identities and remaining formal/Core gates are recorded in F-AD-SESSION-WORLD-BIND-01 REPORT.


## Formal identity-only repin (0.7.7)

Adapter 0.7.7 keeps payload 0.6.0 and pins exact hanaworlds-contracts@0.5.4. Published tag v0.5.4 (annotated b3721db855ffe08dfa524e6eea6a5da4eed4c220, peeled 85687fc3811e4c8ee6e69410d46d8026e19d2c75) supplies 157837 bytes, SHA256 b920097dee8bf57ef44cc9ca964829e568b14c9e1b15a77bf4599f69391062ec, 26 canonical members. The rc.1-to-formal supplier change is identity/derived identity/README only; no candidate or older business gate is replayed. Offline member verification and exact handshake describe this package identity only.

The existing 47612 TO_TEST instance remains Adapter 0.7.6 / contracts 0.5.4-rc.1 with its original source, SDK, service and worlds. This formal package does not replace or restart it and has no new UI/Core/model/Luanti/product acceptance claim. Native Host and Inspection recipes above retain their historical node semantics; production Host export supply is a separate change.


## Public mechanical Host supply (Adapter 0.7.8 / formal contracts 0.5.4)

This node supersedes the earlier development-only export limitation. The business tar exports `hanaworlds-adapter-luanti/host` (`createNativeHost`, `NativeHostOptions`, `OwnedNativeHost`) and `hanaworlds-adapter-luanti/inspection-context` (`createInspectionContext`, `CanvasReadPort`, `WorldRevisionOracle`, `InspectionContextOptions`, `SingularInspectionFacts`). Consumers import these package subpaths; no peer development file copying/import is needed. The original own implementations were relocated byte-for-byte; development entry files now re-export them. No contracts, Canvas state, Session state, native PID truth or transaction authority is added.

```js
import * as C from 'hanaworlds-contracts'; // exact 0.5.4 in the same installation
import { createNativeHost } from 'hanaworlds-adapter-luanti/host';
import { createInspectionContext } from 'hanaworlds-adapter-luanti/inspection-context';
const owned = createNativeHost({ C, state: OWN_STATE, profile: OWN_PROFILE,
  worlds: OWN_CANONICAL_WORLD_ROOT, luanti: OWN_LUANTI_BINARY, event: appendOwnEvent });
root.provide('hanaworldsNativeEngineControl', owned.host);
root.provide('hanaworldsLuantiInspectionContext', createInspectionContext({
  resolveCanvas: () => root.get('hanaworldsCanvasV5'),
  resolveOracle: () => root.get('hanaworldsWorldRevisionOracle'),
}));
// Load the Adapter exactly once via the fixed official Loader EntryOptions row:
// {id:'hanaworlds-luanti-adapter', name:'hanaworlds-adapter-luanti',
//  config:{localWorldRoots:[OWN_CANONICAL_WORLD_ROOT]}}
// Required existing same-root supplies: webServer, dshHomePath.
// Canvas and the world oracle must be supplied by their owning origins.
// On shutdown: close/dispose the Adapter first; then await owned.shutdown().
```

All state/profile/worlds/logs/tmp paths are new canonical own-attempt paths; the caller creates empty directories before assembly. `luanti` and optional `luantiClient` are absolute executable paths; `event(kind,facts)` is the caller's synchronous evidence sink. Configuration fields are the same original NativeHost inputs, not new Adapter settings. Constructing either factory neither launches a child nor creates a world. Native acquire is an explicit later write/engine operation; it is not permitted by a read-only assembly run. Unknown leases reject `CURRENT_WORLD_MISMATCH`, and no supplied PID becomes trusted.

The provider's `host` is the published `LocalEngineControlPort`; the exact acquire/inspect/withStoppedWorld types come from contracts 0.5.4. Child/exit ownership and repeated finite STOPPED callbacks retain the original implementation and local policy. The inspection factory forwards the existing Canvas R1→ListObjects→R2 route and authoritative oracle, rejects absent/replaced/inconsistent suppliers and zero/multiple selection, and never invents object/world/Session revisions. `CanvasReadPort` is a local TypeScript description of the two existing public Canvas operations, not a new contract wire or authority.

`test/public-host-packed-assembly.mjs` is a read-only consumption entry: it loads both factories from the actual installed business tar, registers them in the real pinned official Cordis/Loader root, reads empty connection/world inventories, rejects an unknown native lease, and closes the Adapter before native shutdown. Its webServer registration is explicitly a fixture; this is not a complete DSH Host or product entry. The engine path is explicitly a nonexecuted fixture and no acquire is called. Source tests cover only new exports and lazy empty providers. Packed TypeScript consumption checks the shipped declarations. Positive real-child/PID/STOPPED/Luanti/selected-object/Core/model/transaction/UI/owner gates are NOT_RUN in this node, and prior candidate gates are not replayed.

47612 remains the protected candidate 0.7.6 / contracts 0.5.4-rc.1 service; the 0.7.7 identity-only tar and this separate 0.7.8 Host-supply tar do not replace it. Exact branch/commit/tar bytes/SHA and provider-config packet are advertised in the card REPORT and the new public supply JSON, not inferred from the old candidate packet.

## Contracts dependency (Adapter 0.8.3)

Adapter 0.8.3 keeps payload 0.6.2 and changes only how contracts are referenced: `hanaworlds-contracts` is `git+https://github.com/yzsnstotz/hanaworlds-contracts.git#semver:^0.5.6`. The lower bound is the first released version that carries the config engine facts this source uses. npm caret semantics on a 0.x version allow `>=0.5.6 <0.6.0`. Compatibility between peers is decided separately, by the contracts' own same-major handshake/schema predicate. The previous exact tarball pin, its per-file pack manifest and the candidate-install script are removed; `npm run verify:contracts` checks the range, the lockfile's git resolution, the installed version and the SDK major predicate offline. Accepted and protected services keep their original packages and are not changed by this source revision.

## Engine guards (Adapter 0.9.0 / payload 0.7.0)

Payload 0.7.0 adds three engine-side write guards. Every refusal is `SAFETY_INVARIANT_FAILED` (restore: `RESTORE_FAILED`) plus an Adapter-private `detail` on the courier reply naming the guard; no position, yaw or box leaves the engine. Nothing is skipped when a guard cannot run: the write is refused.

| Guard | Detail | Runs in (courier operations) | Rule |
|---|---|---|---|
| G1 `restoreBodyRecheck` | `BODY_OCCUPIED` | `restore` | Before the first restore write, every cell that would receive a non-air node it does not hold now is checked against every connected player's real collision box. Blocked ⇒ nothing written, `RESTORE_FAILED`; the host keeps the transaction `RESTORE_FAILED` with `restoreFailure {code, detail}` and its cells stay reserved against new Prepares. An engine built without the guard returns `RESTORE_FAILED`/`RESTORE_GUARD_UNAVAILABLE`. |
| G2 `perCellProtection` | `PROTECTED_CELL` | `prepare_check`, `apply`, `apply_state`, `restore`, `region_write` | `core.is_protected(pos, '')` for every written cell (region write: every changed or extras-cleared cell). The local courier has no player identity, so the empty name is asked: any cell a protection mod claims is refused, owner or not. No `is_area_protected` sampling. Without `core.is_protected` the guard is declared `false` and every write is `CAPABILITY_UNAVAILABLE`. |
| G3 `playerEnclosure` | `PLAYER_ENCLOSED` | `prepare_check` (Prepare passes its effects), `apply`, `apply_state` | Each connected player is their real box: the columns it overlaps, `ceil(box height)` cells tall. A feet cell is standable when those cells are passable (air, or a registered node with `walkable == false`; unknown counts as solid). Moves: horizontal step, step up one cell when standing on something with headroom, fall one cell. The player is out when the feet cell leaves the write's bounding box grown by one cell horizontally, rises above its top or drops below its bottom. The write is refused only if it turns "out" into "not out" for some player. Not run for `region_write` or `restore` (declared accordingly). |

The handshake carries `engineGuards` from `region.lua` `guards()`: each guard is the list of operations that run it, or `false`. The host pairs a World only if its loaded payload declares exactly the lists above (otherwise `CAPABILITY_UNAVAILABLE`, not paired), so the service-level contract advertisement below holds for every paired World.

Limits of G3 (design, not hidden): it is local to the write's box; a corridor capped far from the player, flying, swimming, climbing and ladders are not modelled; a player whose box already cannot reach "out" before the write is not protected by it. These are stated so a consumer can decide, not defaults to tune.

## Contracts 1.0 (Adapter 0.12.1 / payload 0.9.0, formal v1.0.0)

`hanaworlds-contracts` is `git+https://github.com/yzsnstotz/hanaworlds-contracts.git#semver:^1.0.0` (formal release; 0.12.1 changed only the range and lock from the rc.3 candidate, whose consistency carries over: the Adapter-facing types are identical in 1.0.0). Wires: `world-adapter/v7` (major 7, minor 0), `world-adapter-region/v2` (major 2, minor 0; capability ids `world-adapter-region/v2:*`), `canvas/v6`, `session/v4`. `npm run verify:contracts` accepts a semver prerelease lower bound.

- **No body geometry**: `InspectRegion` returns no body positions (payload `region.lua` emits no `body`; a reply that has one is refused). Bodies are still checked inside the engine at inspection (footprint refused as a placement choice), Prepare and every write.
- **`PublicCapabilities.engineGuards`** (`engine-guards/v1`, in `ReadLocalConnection`), derived from the paired World's payload `guards()`; a World whose payload declares anything else is not paired:

| Guard | Stages declared | Not declared |
|---|---|---|
| `BODY_CLEARANCE` | PREPARE_RECOVERABLE, APPLY_COMPILED, APPLY_HISTORY, RESTORE, REGION_APPLY, REGION_RESTORE | INSPECT_REGION, PREPARE_HISTORY |
| `CELL_PROTECTION` (`protectionPrincipal: ANONYMOUS`) | same | same; no ACTING_PRINCIPAL |
| `PLAYER_ENCLOSURE` | PREPARE_RECOVERABLE, APPLY_COMPILED, APPLY_HISTORY | everything else (restores, region writes) |

  Consumers refuse an uncovered stage by name (`requireEngineGuards`). `ANONYMOUS` means protection is asked for the empty name: every protected cell is refused for everyone; it is not protection on behalf of the acting player (no identity source exists). A WriteRegion RESTORE refused by a guard (in its check-only pass, nothing written) answers with `guardRefusal` and the contract's engine form (`SAFETY_INVARIANT_FAILED`, phase `restore`, `causeCode null`, `mutationState NONE`); the stateless writer knows no cause, Canvas adds it when the restore was a rollback.
- **Refusals**: guarded responses carry `guardRefusal` beside `error`, and the error is exactly `guardRefusalError(guardRefusal)`. A write refused at apply (after Prepare passed) is rolled back with zero writes; its `ROLLED_BACK` receipt carries the refusal. A failed restore is `RESTORE_FAILED` pending manual recovery: `applyFailure {error, guardRefusal}` keeps why the write failed, `error.causeCode` equals that code, `guardRefusal` says why the restore was refused (`restoreStatus FAILED` then).
