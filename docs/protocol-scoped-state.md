# C-world-facts v2 provider addition: scoped state Host read

Provider: Adapter, world-source role. Registration key: `hanaworldsWorldFacts` in
one official `@deepseek-ai/cordis` Host root. This is the existing neutral facts
service. The additive local Host method is `readScopedState(connectionRef, positions)`;
`call` and the four named `world-facts/v1` operations stay unchanged. This method
is not a new wire operation, handshake capability or synchronous guard.

The active registered `hanaworldsCanvasV5` provider accesses the service through
its real Cordis context. Registration name may change. Current provider value,
fiber, root and tracked caller identity must match before and after reading.
A same-name replacement, disposed fiber, cross-root caller or forged receiver is
refused. Method capture does not grant permanent authority.

`connectionRef: Ref` is a nonempty opaque reference to an already paired current
connection. `positions: Positions` is a nonempty array of integer `[x,y,z]` triples,
strictly increasing by numeric x, then y, then z. Duplicates, unsorted positions,
empty input, omitted fields or invalid shape produce `SCHEMA_INVALID` before a
native read. Adapter does not reorder or deduplicate. Successful `cells` preserve
exactly the requested order and coverage.

The root declaration exports `WorldFactsHostPort`, `ScopedStateFacts`, `Ref`,
`Positions`, `StateProfile`, `ScopedCells`, `ScopedWorldBinding`, `WorldFactsError` and `FailureSource`. The result is
`Pick<ScopedWorldBinding, 'worldRef' | 'stateProfile' | 'cells'>`: the actual paired
`worldRef`, actual `StateProfile`, and `ScopedCells`. Each successful cell is
`{position, availability:'KNOWN', stateDigest}`. It is an opaque digest, not invented cell
state. Native unreadable/missing facts are refused, never filled with defaults.

StateProfile declares engine-derived, preserved and cleared state fields. The
existing digest preimage remains byte-for-byte:
`HanaWorlds|contracts@2.0.0|adapter-scoped-cell/v2\n` followed by canonical UTF-8 JSON
of `{profile,record}`. Only derived state fields are excluded from that record;
all other opaque state, orientation, material and coordinates retain native
conversion semantics. The legacy prefix is a byte domain, not a package load or
published SDK requirement. Consumers carry the digest without reinterpreting it.

Errors use the existing JSON Error protocol (`code`, `phase`, `retryability`,
`mutationState`, `transactionRef`, `causeCode`, `reason`, optional `worldRef` and logical `source: FailureSource`),
with `mutationState:'NONE'`. Private exception constructors need not be shared.

| Condition | Named refusal |
| --- | --- |
| Missing/bad input or native result shape | SCHEMA_INVALID |
| Unpaired/unknown connection | WORLD_NOT_BOUND |
| Adapter closed | ADAPTER_UNAVAILABLE |
| Unauthorized/forged/cross-root/inactive/replaced Canvas provider | CAPABILITY_UNAVAILABLE |
| Lost or changed current world/root/connection/provider | CURRENT_WORLD_MISMATCH or existing provider refusal CAPABILITY_UNAVAILABLE |
| Unknown/unreadable native position | TARGET_FACTS_INCOMPLETE |
| Native payload/version mismatch | PAYLOAD_VERSION_MISMATCH |
| Coverage/order mismatch | READBACK_MISMATCH |
| Unknown native required field or unsupported mutation-state shape | UNKNOWN_REQUIRED_FIELD / UNSUPPORTED_MUTATION_SEMANTICS |

Other existing original reading-path errors keep their names. No retry, timeout
extension, old-name fallback, synthesized facts or weakened admission is used.
The native snapshot path retains world/root/connection and lifecycle-provider
checks before and after reads. Zero world writes, preparation, history mutation,
connection changes or binding changes occur during the read. These are
availability checks; Q42/Q61/Q62 stable/synchronous race guarantees remain unmet.
Legacy aliases remain until their separate retirement card.

```ts
import type { WorldFactsHostPort, ScopedStateFacts } from 'hanaworlds-adapter-luanti';
// In the active, registered C-canvas provider's official Host context:
const facts: WorldFactsHostPort = ctx.get('hanaworldsWorldFacts');
const state: ScopedStateFacts = await facts.readScopedState(connectionRef,
  [[-1,9,0],[0,9,0],[1,9,0]]);
// state.worldRef/state.stateProfile are the actual paired source's values.
// state.cells[i].position equals the requested position; carry stateDigest opaque.
try { await facts.readScopedState(connectionRef, [[0,9,0],[0,9,0]]); }
catch (error) {
  const refusal = error.publicError; // protocol fields, not instanceof another SDK
  if (refusal.code !== 'SCHEMA_INVALID' || refusal.mutationState !== 'NONE') throw error;
}
```

Normal and error examples are exercised by `test/scoped-state-port.test.mjs` and
`test/owned-protocol.test.mjs` in both original test gates. Structures, schema,
validators and declarations belong to this plugin, are audited by
`scripts/protocol-source.json`, and are embedded by normal build/prepack. Neither
development nor production depends on a shared contract package or repository.
