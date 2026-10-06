# HanaWorlds Luanti Adapter

Version0.3.1 implements fresh local `world-adapter/v6` with payload0.3.0 and
contracts0.4.0. The visible Host management facts include current world,
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
