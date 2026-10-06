# HanaWorlds Luanti Adapter

Version0.6.1 (payload0.5.1) publishes `hasPersistentState` only where the
loaded registry proves no engine dispatch path to state code (real VoxeLibre:
`air`); everything else stays null. Version0.6.0 adds new flat local world creation (`createFlatWorld`,
`describeFlatWorldCreation` on `hanaworldsLuantiLocalWorlds`: Luanti flat mapgen
written into the new world's map_meta.txt, payload pre-installed, explicit
missing-prerequisite and game-choice errors, never overwriting a world). It
implements fresh local `world-adapter/v6` with payload0.5.0 and
contracts0.5.0, keeping the readonly `readMaterialSources(worldRef)` fact and adding
the Canvas-only `world-adapter-region/v1` port `hanaworldsWorldAdapterRegionV1`
(Luanti emerge_area + VoxelManip mapblock batches, per-chunk KNOWN/UNKNOWN,
expectedCurrentDigest, APPLY/RESTORE, lighting fact, ProtocolHandshake major 1);
never a commit: Canvas restores its BEFORE_IMAGE states. The visible Host management facts include current world,
connection incarnation, actual native PID, payload digest and the non-switchable
Adapter placement invariants. It requires no player permission approval.

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
