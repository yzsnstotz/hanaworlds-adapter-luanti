# Adapter-owned document protocol structures

Q-98/Q-99 replaces SDK releases with additive project contract documents and
provider-owned structures. The project C-world-facts/C-world-adapter baseline
snapshots are in `docs/protocol-baseline`; the additive Host protocol is in
`docs/protocol-scoped-state.md`. Provider supplements are delivered separately in
the card's `contract-add` directory for the program to append after integration.

`src/protocol` owns the necessary schema, metadata, strict JSON/schema/domain and
binding validators, exact canonical digest rules and declarations. The selected
380 schema definitions cover the current Adapter handlers and their public peer
requests/responses; sibling-only schemas and tool/plugin/placement-setting
bindings are excluded. No sibling implementation, SDK package, full repository
or complete fixture set is included. Existing wire/error/hash/handshake bytes
are preserved, including historical compatibility identifiers. An identifier
such as `hanaworlds-contracts@2.13.0` is legacy protocol data, never a module or
package resolution, new SDK release or present dependency.

MIT helper/schema/type adaptations derive from the historical v2.13.0 source
f8baf189099b517cacfe8a0b385d140932923b17, annotated tag object
e4826d650256aab88f2b40b39d095a58b5934e19. `scripts/protocol-history.json` preserves
its original source-file hashes as historical attribution, with LICENSE and
NOTICE retained. No build/verify/test step reads or resolves that repository.
Only the required config facts, source startup, session sequence/directory and
catalogue projection examples were adapted into module test fixtures. Existing
packaged module fixtures retain their canonical bytes and historical lineage.

`scripts/protocol-source.json` records actual local input hashes and mechanism.
Normal `verify:contracts` rejects altered/unmanifested inputs, document omissions,
external dependency/lock/source edges and vendor copies; it checks real protocol
handshakes and examples. Normal builds use pinned esbuild to compile only local
inputs into development and production value modules, emitting build-input and
artifact hashes. Public declarations are copied from the owned source. Packed
production includes generated values/declarations/assets/legal notices and the
source manifest; no development value file, test fixtures or external SDK is
shipped. Package-boundary walks actual exports and every executable/resource
edge, rejects stale/missing/foreign artifacts, and audits generation provenance.

Subsequent provider main d82bba6 adds optional transportPolicy to the existing
engine/write/capability facts, and optional logical FailureSource to Error.
These document-derived shapes and their required validation are retained in the
owned structures so integration cannot drop them. Their normal default example
is in test/fixtures/transport-policy.json; duplicate names, bad fields and range
inconsistency refuse. The three public results and error fields remain additive.
The card tree integrates that main implementation and its Node/Lua/real courier
regressions. Fresh verification evidence is recorded in the card REPORT; the
program must still run the complete gate on integrated main before consumption.

The public ./host factory defaults to its plugin-owned built validator. Explicit
C.validateType injection remains supported for existing Host callers/fixtures;
ordinary production assembly needs neither an external SDK nor a private
protocol module import. NativeControl shapes and process ownership checks remain
required, and malformed input is tested through the default public factory.

The additive Canvas source facts Host read is documented in
`docs/protocol-canvas-facts.md`. Its twelve owned types, completeness/domain
checks and declarations are normal build inputs. Purposes, typical scales and
complete grid Frame are explicit source-authored normal payload data in
`canvas-facts.json`; native reads bind that world's actual file bytes and
partition observations to scope/provider identities. No shared package, wire
operation, synchronous guard or historical alias supplies these facts.
