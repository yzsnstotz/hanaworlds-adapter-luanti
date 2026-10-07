# Adapter 0.2.0 source and rights audit

Date: 2026-10-01, updated 2026-10-02 for 0.2.0. Scope: files in this Git origin, before changing the
owner-code declaration from AGPL-3.0-only to MIT. The direct Stage 1 user
instruction requires MIT for HanaWorlds-owned source. Git history contains one
committer/author identity for tracked `src/`, `payload/`, and `test/`:
`yzsnstotz <snstotz@gmail.com>`. Every listed baseline file was introduced in
this origin. This is provenance evidence, not independent proof of legal title.
No tracked WorldEdit implementation, Luanti engine code, or `canonicalize`
implementation was found. Calls to WorldEdit are API calls through the
separately installed `_G.worldedit` object; tests place WorldEdit only in
ignored, isolated world data. The new v3 files were written for this origin.

| File | Observed origin and third-party boundary |
| --- | --- |
| `src/bridge.mjs` | Origin commit; host transaction coordinator, no copied upstream implementation observed. |
| `src/index.mjs` | Origin commits; DSH provider wiring, no copied upstream implementation observed. |
| `src/journal.mjs` | Origin commit; private durable storage, no copied upstream implementation observed. |
| `src/local-transport.mjs` | Origin commit; local courier, no copied upstream implementation observed. |
| `src/local-worlds.mjs` | Origin commit; local discovery/provisioning, no copied upstream implementation observed. |
| `src/remote-transport.mjs` | Origin commit; operator tunnel adapter, no copied upstream implementation observed. |
| `src/v2-operations.mjs` | Origin commit; local/remote/inspection handlers, no copied upstream implementation observed. |
| `src/v2-port.mjs` | Origin commit; historical v2 provider; imports `canonicalize`, no copied package implementation observed. |
| `src/v2-transactions.mjs` | Origin commit; historical v2 transaction adapter; imports `canonicalize`, no copied package implementation observed. |
| `src/v3-port.mjs` | New Adapter implementation; imports public Contracts 0.2.1 functions, no copied Contracts implementation. |
| `src/v3-transactions.mjs` | Historical v3 Adapter implementation; imports public Contracts functions, no copied Contracts implementation. |
| `src/v4-port.mjs` | 0.2.0 Adapter implementation written for this origin; imports public Contracts 0.3.0 functions, no copied Contracts implementation. |
| `src/v4-transactions.mjs` | 0.2.0 Adapter implementation derived from this origin's own `v3-transactions.mjs`; imports public Contracts 0.3.0 functions. |
| `src/version.mjs` | 0.2.0 origin constants. |
| `src/native-storage.mjs` | 0.2.0 origin glue (native DSH home journal location). |
| `test/v4-d1-d3.test.mjs` | 0.2.0 Adapter fixture test. |
| `test/v4-native-storage.test.mjs` | 0.2.0 Adapter fixture test. |
| `src/workshop-relay.mjs` | 0.2.0 origin glue (late-bound Workshop relay). |
| `payload/hanaworlds_adapter/region.lua` | 0.2.0 Luanti API glue written for this origin (region search, relay/pick records, Prepare recheck). Calls engine APIs only; no WorldEdit, Luanti engine or areas source copied. The facing/search rules follow the approved HanaWorlds contract text, not third-party code. |
| `scripts/verify-contracts-pin.mjs` | 0.2.0 origin tooling. |
| `test/v4-workshop-relay.test.mjs` | 0.2.0 Adapter fixture test. |
| `test/transport-errors.lua` | 0.2.0 Adapter test double for the courier error path. |
| `test/real-region.mjs` | 0.2.0 diagnostic engine runner; refers to an ignored external WorldEdit copy and the admitted 0.1.1 package, never bundles them. |
| `test/support/lua-world.mjs`, `test/v4-*.test.mjs` | 0.2.0 Adapter fixture tests; `v4-carried-*` are adaptations of this origin's v3 tests. |
| `payload/hanaworlds_adapter/engine.lua` | Origin commit; calls separately installed WorldEdit API, does not contain WorldEdit source. |
| `payload/hanaworlds_adapter/init.lua` | Origin commit; Luanti API wiring, no copied engine code observed. |
| `payload/hanaworlds_adapter/mod.conf` | Origin commit; declares WorldEdit optional dependency, no third-party code. |
| `payload/hanaworlds_adapter/transport.lua` | Origin commit; Luanti courier, no copied engine code observed. |
| `test/adapter.test.mjs` | Origin commit; Adapter fixture tests. |
| `test/bridge.test.mjs` | Origin commit; Adapter fixture tests. |
| `test/engine.lua` | Origin commit; test doubles for Luanti and WorldEdit calls. |
| `test/journal.test.mjs` | Origin commit; Adapter fixture tests. |
| `test/payload.lua` | Origin commit; test doubles for Luanti and WorldEdit calls. |
| `test/plugin.test.mjs` | Origin commits; Adapter fixture tests. |
| `test/real-lifecycle.mjs` | Origin commits; diagnostic engine runner; refers to an ignored external WorldEdit copy, never bundles it. |
| `test/real-luanti.mjs` | Origin commit; diagnostic engine runner; refers to an ignored external WorldEdit copy, never bundles it. |
| `test/remote.test.mjs` | Origin commit; Adapter fixture tests. |
| `test/transport.test.mjs` | Origin commit; Adapter fixture tests. |
| `test/v2-port.test.mjs` | Origin commit; historical Adapter fixture tests. |
| `test/v2-transactions.test.mjs` | Origin commit; historical Adapter fixture tests. |
| `test/engine-history.lua` | New Adapter full-state test double. |
| `test/v3-inspect.test.mjs` | New Adapter fixture test. |
| `test/v3-history-negative.test.mjs` | New Adapter prewrite resource integrity fixture test. |
| `test/v3-journal.test.mjs` | New Adapter fixture test. |
| `test/v3-port.test.mjs` | New Adapter fixture test. |
| `test/v3-recovery.test.mjs` | New Adapter recovery fixture test. |
| `test/v3-transactions.test.mjs` | New Adapter fixture test. |
| `cordis.patch.yml`, `package.json`, `package-lock.json`, `.gitignore`, `.gitattributes` | Origin configuration; npm metadata identifies the registry dependency and the `#contracts` imports of the bundled Contracts package. |
| `vendor/hanaworlds-contracts/**` | Unmodified subset of the admitted `hanaworlds-contracts@0.3.0` package (MIT, own notices). |
| `vendor/hanaworlds-contracts.manifest.json`, `scripts/contracts-*.mjs`, `scripts/vendor-contracts.mjs` | 0.2.0 origin tooling and the manifest of the admitted package. |
| `README.md`, `GADGET.md`, `NOTICE` | Origin documentation; historical AGPL statements are updated for 0.1.1 without changing prior copies. |
| `LICENSE` | Standard MIT permission text for owner source, based on the [OSI MIT license](https://opensource.org/license/mit). |

`hanaworlds-contracts@0.3.0` remains MIT at public revision
`e82735780bdfd4ea8e662781455040a6e5306121`. 36 of the 923 entries of its admitted
package (npm pack sha256 `47a2e5cc77590fb471ffedde715682564e169a0d88dbc5005b71d8d542b38f5c`)
are bundled byte-identical under `vendor/hanaworlds-contracts`: package.json,
LICENSE, NOTICE, README.md and `licenses/`, the 24-module runtime import closure
of `dist/v3` and `dist/v4`, and 7 test fixtures. They are not relabeled or
edited. `vendor/hanaworlds-contracts.manifest.json` lists all 923 entries with
size and sha256. They are bundled because default pnpm 11 `blockExoticSubdeps`
rejects a URL subdependency of a git-hosted plugin. `npm run verify:contracts`
checks every bundled file against the manifest offline;
`npm run verify:contracts:source` re-derives the admitted pack from public
source and requires that sha256 and manifest. `canonicalize@5.1.0` remains Apache-2.0 and is installed through
the lockfile; retain its license and notice in any distribution. WorldEdit
revision `62ffafe3bcb386600c431ef3840d91c3c8f85639` remains AGPL-3.0,
installed by the world operator and never relabeled MIT. [GNU's FAQ](https://www.gnu.org/licenses/gpl-faq.html)
explains that installation alone and a combined program are different legal
cases; exact combined-work/source-offer obligations for the installed Adapter
and WorldEdit pairing remain a release review gate. No release is authorized.

The MIT decision covers the source offered in this origin at 0.1.1 and 0.2.0 under the
direct user owner-code instruction and the file-level provenance above. It
does not assert that a Git author line alone proves copyright ownership, or
that the separately installed WorldEdit is MIT.


## S1-AD-AUTO-01 provenance

The 0.2.4 grant/mode implementation and fixtures are new MIT origin code. No Luanti engine source was copied or bundled and no dependency was added. Native administrator/owner semantics were checked against the [Luanti privileges documentation](https://docs.luanti.org/for-players/privileges/) and [builtin privileges](https://github.com/luanti-org/luanti/blob/master/builtin/game/privileges.lua) / [native auth handler](https://github.com/luanti-org/luanti/blob/master/builtin/game/auth.lua). Luanti remains an external engine under LGPL-2.1-or-later; the previously recorded WorldEdit and contracts licenses/pins remain unchanged. These references document API use, not an authorization to release.


## S1-AD-LOCAL-PROVISIONING-01 provenance

Version 0.2.5 adds MIT origin code for the trusted public local-world port and its tests. It imports no sibling implementation, adds no production dependency and copies no engine source. The admitted contracts and external WorldEdit boundaries above remain unchanged. A test-only native client uses separately pinned public MIT mt/SRP libraries; it is excluded from the production package. Account/profile preparation and WorldEdit installation are isolated test inputs, not redistributed product engine binaries or a release decision.

## Local-world 0.3.0 update (2026-10-06)

New local runtime/records/courier/transactions files are written in this origin
under the same MIT owner declaration. Current payload loads only the six files
in src/version.mjs; no Luanti/WorldEdit source or user-authorization module is
bundled. The exact contracts0.4.0 MIT subset and its LICENSE/NOTICE replace the
old admitted contract bytes; scripts/contracts-pin.mjs and the vendored manifest
carry the exact revision/hash/20 entries. Separately installed WorldEdit remains
an external runtime input under its own AGPL terms. This is a source/package
update, not publication or a new combined-work license conclusion.

## Flat-world 0.6.0 update (2026-10-07)

`src/flat-world.mjs` and its tests are new MIT origin code; no production dependency
is added and nothing is bundled. The mapgen parameters follow Luanti's documented
world format (`map_meta.txt`) and flat mapgen settings; no Luanti source is copied.
Gate-only external inputs, not redistributed:
- VoxeLibre (formerly MineClone2) · 0.92.3 (commit a523240fb89713ffa6302696e8275bbd7de3bd49) ·
  code GPL-3.0-or-later, media CC-BY-SA-4.0 · https://content.luanti.org/packages/Wuzzy/mineclone2/
  (zip SHA256 51ea9242aabb1f29575abbfb599c79bcde9435616ea097c0582e11ac1b2b279d) · the real game
  installed into the gate's own Luanti user path; its `mcl_superflat_classic` setting is read by name only.
- WorldEdit · 62ffafe3bcb386600c431ef3840d91c3c8f85639 · AGPL-3.0 · as recorded above · per-cell StateProfile in the gate profile.
- @deepseek-ai/cordis · 4.0.4 · as recorded for earlier gates · gate host fixture only.

## Write-path facts 0.7.0 update (2026-10-07)

The Catalogue projection, WritePathEvidence supplier, protocol declarations and
focused tests are MIT origin code. No engine/WorldEdit implementation is copied
or bundled and no production dependency is added. The bundled public subset is
hanaworlds-contracts 0.5.2 · MIT · source 6185622e977ef5136e9ef12219e0ba89dbba29db ·
pack SHA256 e6c50766ffc821ca90e07c38f473456952ef650e8a321f676dc44ce7d7d72209 ·
https://github.com/yzsnstotz/hanaworlds-contracts · schemas/runtime validation;
its LICENSE/NOTICE and exact manifest are retained. The separately installed
WorldEdit 62ffafe and Luanti 5.17 APIs supply callback-free node-data transport;
VoxeLibre 0.92.3 supplies the real gate's registry and flat world. These external
inputs retain the versions, sources and licenses above. Cordis 4.0.4 · MIT ·
https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/cordis · temporary
component Host/Canvas fixture runtime. This update authorizes no publication
and makes no new combined-work licensing conclusion.
