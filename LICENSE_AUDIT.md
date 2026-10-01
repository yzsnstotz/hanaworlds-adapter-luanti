# Adapter 0.1.1 source and rights audit

Date: 2026-10-01. Scope: files in this Git origin, before changing the
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
| `src/v3-transactions.mjs` | New Adapter implementation; imports public Contracts 0.2.1 functions, no copied Contracts implementation. |
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

The source dependency `hanaworlds-contracts@0.2.1` remains MIT at public
revision `5ecfce1ba47530b42bba60a674bd16f7bc39c665`; the package is not
vendored. `canonicalize@5.1.0` remains Apache-2.0 and is installed through
the lockfile; retain its license and notice in any distribution. WorldEdit
revision `62ffafe3bcb386600c431ef3840d91c3c8f85639` remains AGPL-3.0,
installed by the world operator and never relabeled MIT. [GNU's FAQ](https://www.gnu.org/licenses/gpl-faq.html)
explains that installation alone and a combined program are different legal
cases; exact combined-work/source-offer obligations for the installed Adapter
and WorldEdit pairing remain a release review gate. No release is authorized.

The MIT decision covers the source offered in this origin at 0.1.1 under the
direct user owner-code instruction and the file-level provenance above. It
does not assert that a Git author line alone proves copyright ownership, or
that the separately installed WorldEdit is MIT.
