# HanaWorlds Luanti Adapter 0.19.0

The `world-source` provider connects to local Luanti worlds, supplies neutral world
facts and executes Canvas-authorized transactions through native engine APIs.
Replace this adapter together with its paired local-runtime when changing sources.
Luanti and VoxeLibre run separately; no engine or game is bundled.

Use Node >=24.13.1 <25 and Lua. From a fresh checkout:

```sh
npm ci
npm run verify:contracts && npm run test:contracts && npm test
npm run build
npm pack
```

The development contract input is exactly
`git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.13.0`.
Normal builds compile its required runtime structures and public types into this
plugin. Production exports load `dist/runtime/` without the contract package or
build tools installed. The lock and `scripts/contracts-source.json` identify the
published source; embedded SDK LICENSE and NOTICE remain in the package.

Public Cordis services are `hanaworldsWorldAdapterV6` (`world-adapter/v8`),
`hanaworldsWorldAdapterRegionV1` (`world-adapter-region/v3`),
`hanaworldsLuantiLocalWorlds` (`local-worlds/v2`) and `hanaworldsWorldFacts`
(`world-facts/v1`). Mutators authorize the active registered provider of
`hanaworldsCanvasV5` or `hanaworldsCanvasRegionV1` in the same Cordis root;
package names and caller JSON supply no authority. Selection, inspection,
footprint/history and native lifecycle peers must supply their published facts.
Missing or stale peers refuse the operation.

The existing `hanaworldsWorldFacts` service also implements the read-only Host
method `readScopedState(connectionRef, positions)`. The active registered
`hanaworldsCanvasV5` provider in the same official Cordis root calls it through
the tracked service reference. It delegates to the paired native snapshot path
and returns the actual `worldRef`, `StateProfile` and opaque `ScopedCells`.
Positions must be nonempty, sorted numerically by x/y/z and unique; they are
never reordered or deduplicated. Root callers, forged identities, other roots
and stale providers refuse. The package root declares `WorldFactsHostPort` and
`ScopedStateFacts` using the existing scoped binding types. The corresponding
shared SDK addition is pending formal publication for this source candidate.
See [scoped state](docs/world-source-facts.md#read-only-host-scoped-state).

Configure explicit `localUserPath` and `localWorldRoots`; use `localCreationRoot`
and `localGameId` when there is a choice. The local-world service provides
`discover`, `createWorld` (`templateId: 'flat'`), `pair`, `describeSourceWorld` and
name-confirmed `deleteWorld`. Create installs this source's payload and returns
opaque `creationFacts`. Pair consumes an existing native lifecycle lease; it
neither launches another world nor selects a Canvas session. Delete checks exact
world identity, current name, active leases, journal state and Canvas retirement.
Describe is read-only and returns the exact opaque source locator with optional
verified startup facts. See [source locator](docs/source-locator.md).

World facts supply opaque materials, display names/colors, neutral tags and
orientation indices, `emptyMaterialRef`, partition, geometry, bounds, state rules,
lighting, opaque write backend/configuration, guard declarations and player body
facts. Only this world source interprets engine node names and orientation bytes.
See [world facts](docs/world-source-facts.md). Geometry is `voxel-grid/v1`;
partition edge is `[16,16,16]`. Cell writes bind native `swap_node` at payload load;
region writes use the native bulk path. WorldEdit is not required or installed by
the current verification runners.

Prepare/apply/readback/restore bind the current world and connection incarnation.
Ordinary cell writes clear metadata, inventory and timers; recovery restores saved
state exactly. Derived lighting is recomputed and compared using StateProfile
rules. Conflicts, unavailable capabilities and uncertain recovery remain errors.
`QueryTransaction` preserves the original durable receipt after reconnect and
returns the current context separately. Older payloads and records are refused.

The package exports `./host`, `./inspection-context`, `./source-locator`,
`./local-worlds-v2-mock`, `./world-source-facts-mock` and the declared JSON fixtures.
Mock providers use the published SDK fixtures; they have no world/runtime effects.

Diagnostic gates run from any working directory:

```sh
HW_LUANTI=/path/to/luanti HW_GAME=/path/to/own/VoxeLibre \
  /path/to/checkout/scripts/final-gate-region-io.sh COMMIT FRESH_EVIDENCE_DIRECTORY
```

The evidence directory must be inside
`~/.cache/hana-world-runs/adapter-migration-cleanup-01` (or explicit
`HW_ADAPTER_RUN_ROOT`). `final-gate-flat-world.sh`, `final-gate-world-switch.sh`
and `final-gate-world-delete.sh` use the same inputs. Each preserves its original
real-engine test entry, runs source and packed artifacts, and retains failures.
Profiles and worlds are freshly prepared inside that evidence directory. Cordis
and contract fixtures come from this checkout's development dependencies.
SOURCE/FIXTURE, real-engine diagnostics with Host peers, real Host/UI and owner
acceptance are separate evidence levels.

Sources: [Luanti](https://github.com/luanti-org/luanti) (D-7 runtime) and
[VoxeLibre](https://content.luanti.org/packages/Wuzzy/mineclone2/) (D-8 game).
[LICENSE](LICENSE), [NOTICE](NOTICE) and [license evidence](LICENSE_AUDIT.md)
preserve attribution and approved source records. Historical pages/source moved
outside the repository; `scripts/migration-archive.json` preserves their inventory
and hashes for restoration. They are excluded from npm packages.
