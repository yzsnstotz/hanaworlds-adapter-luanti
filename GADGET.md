# HanaWorlds Luanti Adapter

Version0.7.2 (payload0.6.0, contracts0.5.2) publishes Catalogue facts under
`write-path-init/v1`, with `NativeFacts.readWritePathEvidence(worldRef)` returning
the actual callback inventory and public validation result. Only a known empty
write-path global registry and nodes without initialization/state hooks can yield
false/false. UNKNOWN stays null; `ignore` and initialization-path nodes remain
rejected. Independent later player/ABM/LBM changes are detected by full-state
readback and same-origin Undo conflict checks, not declared absent.

`hanaworldsWorldAdapterV6.protocolHandshake` advertises world-adapter 6.1 with
callback-free-write and write-path-state-facts; `hanaworldsWorldAdapterRegionV1`
advertises region 1.1 with callback-free-write plus its existing read/write,
load, lighting and restore capabilities. K3 consumers check protocol major,
minor and required capabilities; provenance hashes do not decide compatibility.

New flat-world creation remains `createFlatWorld` / `describeFlatWorldCreation`
on `hanaworldsLuantiLocalWorlds`: Luanti flat mapgen in the new world's own
map_meta.txt, current payload pre-installed, explicit prerequisite/game-choice
errors, never overwriting a world. Region I/O uses emerge_area + VoxelManip
mapblock batches and per-chunk KNOWN/UNKNOWN, expectedCurrentDigest and lighting
facts. Canvas decides commits and restores its BEFORE_IMAGE states. Host-visible
facts include the current world, connection incarnation, actual native PID,
payload digest and non-switchable placement invariants. No player approval path.

The Adapter transports Canvas's compiled effects and saved history state.
Canvas decides transactions and history; Painter does not write the world,
Brush remains pure, and Adapter does not import another plugin implementation.
Only the actual Canvas caller can reach mutators through the in-process port.
The loopback status URL exposes no mutator or private courier key.

Public inputs, native provisioning, registry/history facts and readback semantics
are documented in README.md. Missing current-world facts, mismatched footprints,
state conflicts and unverified restoration remain visible failures. Existing
payload installs and old protocol requests are not adopted.

Component SOURCE/FIXTURE and own local REAL_RUNTIME are distinct from formal
App/GUI/model/Shell Undo and owner ACCEPTED. Historical authorization, AUTO,
remote and compatibility inputs stay archived or deferred; they are not active
features of this current package.

The public read-only NativeFacts.readCatalogue(worldRef) supplies the complete
loaded-engine Catalogue for the actual current world. Unknown fields remain
explicit; Host may wire Workshop Catalogue.read to this method.

0.7.2 adds read-only NativeFacts.readRegionState(worldRef, box) for the paired world (no
Canvas context, no transaction, no write) and a development page (dev/world-readback, port
47606) that shows a clearly marked sample-world FIXTURE's surface materials and heights from
one real read. Owner worlds need the App Host's public connection supply.
