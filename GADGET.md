# HanaWorlds Luanti Adapter

Version0.7.5 (payload0.6.0, contracts0.5.3) publishes Catalogue facts under
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

C-local-worlds v2 provides `createWorld` (`templateId: 'flat'`), `discover` and
name-confirmed `deleteWorld`. Native Host helpers remain `createFlatWorld` / `describeFlatWorldCreation`
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

## Development API and production package

hanaworlds-contracts is an exact-tag devDependency. Supported Node 24 installs and
normal builds generate the Adapter's public runtime modules under dist/runtime;
private #contracts imports in development sources are lowered to local relative
artifact imports. A selected SDK value module is compiled from the pinned tag,
with declaration files and required MIT attribution copied from that same supply.
The production tar contains no SDK package, repository or development build tools.
Public export paths, neutral protocols and native payload behavior remain unchanged.
The #contracts development condition selects the unshipped development value module.
Its default selects the local production value module. Source verification runs with
the explicit development condition; fresh production consumers run with default
conditions and cleared NODE_OPTIONS/NODE_PATH. Production artifacts never load #contracts.
Source tag/SHA, verified input digests and output digests are in dist/runtime-build.json.

npm run test:package-boundary is included in npm test, build and normal prepack.
It examines a real normal npm pack tgz and all public entries, reachable code,
package imports, declarations and packaged resources. It rejects corrupt manifests,
external SDK loads, computed module loads, external development-resource reads,
missing local resources and changed generated values. Its internal normal pack
still rebuilds artifacts; only recursion into a second copy of the same gate is omitted.

The gate installs that tgz using pnpm 11.28.5 with default strict production policy,
a fresh consumer/config directory and no development SDK. It loads all public
runtime/fixture exports, reads actual owned local-world files and the native payload,
consumes protocol errors across separate SDK implementations and verifies public
declarations with development TypeScript. Missing bundles fail real Node loading;
exotic subdependencies and unreviewed builds fail real strict installation.
This is SOURCE/BUILD/PACKAGE evidence. Official Host/Client, Luanti execution, UI and
owner acceptance remain separate product gates.
