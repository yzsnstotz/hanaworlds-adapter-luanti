# HanaWorlds Luanti Adapter 0.1.1 component candidate

Status: `PARTIAL`. The provider and payload are a component candidate. This is not a release or Stage 1 product proof; only the user can mark `ACCEPTED`.

## Ownership and license

This repository owns `world-adapter/v3`, its Luanti payload, and the native `/hanaworlds` renderer host. Canvas owns world selection, named object history, affected-object policy, and product success. The owner source is MIT under `LICENSE`; see the file-level `LICENSE_AUDIT.md`. The payload calls a separately installed WorldEdit API, pinned for diagnostics to revision `62ffafe3bcb386600c431ef3840d91c3c8f85639`; WorldEdit remains AGPL-3.0 and is not bundled. `canonicalize@5.1.0` remains Apache-2.0. `NOTICE` retains both boundaries. The package is private as a registry publication guard.

## Provider boundary

`hanaworldsWorldAdapterV3` exposes only the `world-adapter/v3` runtime provider. It imports the admitted public `hanaworlds-contracts@0.2.1` v3 decoder, validators, and operation list. Raw wire decoding and basic envelope admission precede the current host authorization and Canvas owner proof; bound request validation follows fresh authorization and replay checks. Invalid or unavailable host capabilities fail closed. Historical v2 implementation code remains private compatibility support for existing frozen projection and digest shapes; it is not the advertised runtime provider.

Local discovery uses configured roots. A stopped-world, current operator proof is required before payload provisioning. A verified existing 0.1.0 payload can be upgraded to 0.1.1 while retaining its world identity and a versioned 0.1.0 backup. The 0.1.1 payload performs loaded-byte handshake. Local transport is loopback-only. Remote transport requires an operator-provided tunnel; no address or credential is inferred.

The durable journal captures the full before state, verified after state, author, source transaction, history identity, and full history target state. The engine applies node, metadata, inventory, and timer state through the paired Luanti/WorldEdit path, with prewrite state checks. History Prepare and Apply recheck current binding, origin, revisions, resource integrity, and actual world state. A missing or corrupt target fails before writing. After a possible write, recovery either proves a complete rollback or retains an unknown/failed state and scope lock. Canvas must still complete linked history before product success.

InspectWorld requires trusted current object context and actual three-value cell occupancy. The native action callback requires Workshop's authenticated Session owner; the diagnostic runtime has no Workshop owner or current player binding. The renderer and real player interaction remain `UNPROVEN` for product acceptance.

## Build and isolated lifecycle

Run `npm ci`, `npm test`, `npm run test:lua`, and `npm run build` with Node 24.13.1/Unicode 17 from a clean public clone with an isolated HOME/cache/store. Pack 0.1.1 and install with the supported DSH plugin lifecycle in a fresh profile. For a real Luanti probe, set `HW_RUNTIME_ROOT` to a disposable isolated world root, `HW_WORLDEDIT_DIR` to the pinned separately licensed checkout, and `HW_INSTALLED_PLUGIN_DIR` to the DSH-installed package directory before running `node test/real-lifecycle.mjs`. The diagnostic script exercises provisioning, loaded-byte handshake, full-state apply/readback, restart, uninstall/reinstall, and snapshot rollback. This script is `REAL_RUNTIME` diagnostic only; it does not produce `REAL_UI` or product proof. Existing `.runtime` data is historical diagnostic data and must not be used for acceptance.

Rollback requires a stopped world. Restore the versioned complete payload backup with its identity/transport data and keep the outside-world journal intact for recovery. Uninstalling the payload removes that worldmod; a fresh install after full removal creates a new world identity. Never reinterpret an uncertain journal as a clean rollback.

The release path still requires independent specification review, quality review, public remote readback, clean public clone, fresh DSH profile, loaded-byte match, product composition, and user-visible manual validation. The approved history and digest failure codes come from the admitted public Contracts 0.2.1 input; this repository does not privately extend the contract.
