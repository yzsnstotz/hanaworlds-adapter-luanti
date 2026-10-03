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
| `cordis.patch.yml`, `package.json`, `package-lock.json`, `.gitignore` | Origin configuration; npm metadata identifies the two external package dependencies. |
| `README.md`, `GADGET.md`, `NOTICE` | Origin documentation; historical AGPL statements are updated for 0.1.1 without changing prior copies. |
| `LICENSE` | Standard MIT permission text for owner source, based on the [OSI MIT license](https://opensource.org/license/mit). |

The source dependency `hanaworlds-contracts@0.3.0` remains MIT at public
revision `e82735780bdfd4ea8e662781455040a6e5306121` (package sha256
`47a2e5cc77590fb471ffedde715682564e169a0d88dbc5005b71d8d542b38f5c`); the
package is not vendored. Its fixtures are read by tests from the installed
package only. `canonicalize@5.1.0` remains Apache-2.0 and is installed through
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
