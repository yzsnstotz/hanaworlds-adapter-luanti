# HanaWorlds Luanti Adapter 0.3.1

Local, fresh-install `world-adapter/v6` transport, pinned to the root entry of
`hanaworlds-contracts@0.4.0` (source `8cfb18f8e13aa33d7a942f230ec6117914322cdd`,
pack SHA256 `d7b22e76de5e161abe7525596df608b3f00445fb4237808941cb5ef8328e9bc4`).
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

## Validation and retained history

The 0.3.1-only read seam reproduction is `test/real-catalogue.mjs`, using fresh
source and extracted-package profiles. Its `HW_LOCAL_*` inputs match the core
script and it needs only a public Host lifecycle fixture, no Canvas fixture.
`npm run test:catalogue` covers unbound/invalid/closed reads. Payload0.3.0 bytes
and the protected eleven-core-check 0.3.0 evidence remain unchanged.

Use Node24.13.1, an isolated npm cache, `npm ci --ignore-scripts`, `npm run build`,
`npm test`, `npm run test:lua` and `npm run verify:contracts`. The current core
runtime reproduction is `test/real-local-world.mjs`; its inputs are an actual
extracted npm pack, fixed Cordis App path, a fresh evidence root and separately
installed pinned WorldEdit. It launches only its own headless Luanti processes.
Host/Canvas interfaces in that reproduction are explicit public peer fixtures.
It proves component native transport, not formal Desktop, model, GUI or owner
acceptance. No release, registry publication or deployment is performed.

The old 8146f000/0.2.9 source and its old-wire tests remain in Git/source as
historical inputs. Legacy modules and grant.lua are excluded from this package's
explicit file list. Old tests are retained; old protocol tests and the larger
reentry/replay/concurrency/remote matrix are DEFERRED, not deleted or counted as
current passes. See `DEFERRED-LOCAL-WORLD.md`.
