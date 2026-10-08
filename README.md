# HanaWorlds Luanti Adapter 0.7.2 (flat-world creation + write-path facts + read-only region state, payload 0.6.0)

Local, fresh-install `world-adapter/v6` transport, pinned to the root entry of
`hanaworlds-contracts@0.5.2` (source `6185622e977ef5136e9ef12219e0ba89dbba29db`,
pack SHA256 `e6c50766ffc821ca90e07c38f473456952ef650e8a321f676dc44ce7d7d72209`).
The text-line package 0.3.1/payload 0.3.0 and the image-material package
0.4.0/payload 0.4.0 stay separate fixed artifacts; this 0.5.0 line adds region
I/O and does not migrate worlds provisioned with an older payload. 0.6.0 adds
new flat local world creation; 0.7.0/payload 0.6.0 publishes Catalogue facts
and verifiable callback evidence under Contracts scope `write-path-init/v1`
(see below). New worlds carry payload 0.6.0; older payload worlds are not adopted.
There is no player account, username/password, grant, AUTO mode, administrator
approval or protection-region permission path in this package. Canvas owns
transaction, affected-object and durable history decisions.

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

Consumes `hanaworlds-contracts@0.5.2` (source `6185622e977ef5136e9ef12219e0ba89dbba29db`,
pack SHA256 `e6c50766ffc821ca90e07c38f473456952ef650e8a321f676dc44ce7d7d72209`).
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


## Independent world manager (Adapter 0.7.4)

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
