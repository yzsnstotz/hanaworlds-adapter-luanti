# HanaWorlds Luanti Adapter 0.1.0 candidate

Status: `PARTIAL`. This source candidate is not a release. S1-02 product
readiness remains `UNPROVEN`.

## Source license and upstream boundary

Owner-authored Adapter source is `AGPL-3.0-only` under the included LICENSE.
The `private: true` package flag remains a registry publication guard, not a
restriction on the source license. WorldEdit is separately installed at the
pinned API revision `62ffafe3bcb386600c431ef3840d91c3c8f85639` under its
own AGPL-3.0 terms; no WorldEdit bytes are bundled. The installed combination
still requires source-offer and attribution review before release. The only npm
dependency is `canonicalize@5.1.0` (Apache-2.0), pinned by package-lock.json.
See NOTICE for Luanti and contracts boundaries.

## Boundary

Owner: this independent origin. Consumer: Canvas through the frozen
`world-adapter/v2` port; the game renderer uses `interaction-surface/v2`.
The Adapter owns engine connection, payload and transport execution. Canvas
owns world selection, object registry, policy, success and linked history.

Current implemented source: configured-root local world discovery; operator
verifier-gated local worldmods payload provisioning; stable provisioned world
identity and digest; a native Luanti `/hanaworlds` form with no invented Session;
WorldEdit API capability detection; installed source digest readback on mod
load; DSH host status route bound to loopback callers. The private engine
module contains conservative per-cell WorldEdit apply, complete state capture,
readback and restore primitives. A private host bridge has a fsynced before-image
journal, affected-cell locks and recovery states. A per-world secret and
loopback courier connect these primitives in an isolated Luanti diagnostic run.
The DSH plugin provides a fail-closed nine-operation `world-adapter/v2` service.
Discovery/listing are source-wired; binding checks live loaded bytes and a
current player through the paired courier when the host supplies a real actor
and operator verifier. No actual current player binding was established by the
isolated headless probe. Prepare/Apply/Readback/Query/Restore map v2
projections through a durable bridge when real revision, capacity, binding and
service verifiers plus a verified state profile are injected. The headless v2
probe uses fixtures for those inputs. Inspect reads three-valued Luanti node
occupancy and projects TargetFacts only when the authenticated consumer supplies
the current objectRef/objectRevision, catalogueDigest, frameDigest, portals and
capacity; absent host context fails closed. The frozen InspectWorld request does
not contain an objectRef, so the Adapter does not invent one from coordinates.
The Adapter assembles its own durable journal/backend only when trusted host
profile storage, revision oracle, verified state profile, capacity, current
engine binding and service recovery are all supplied. No such formal host
composition has been demonstrated in a supported DSH profile. The native
action callback routes through an authenticated
per-world courier and pinned frame to a Workshop owner callback, which is not
present in this candidate's real host run. The renderer covers TEXT, NAME,
DECISION and SELECT_OBJECTS; the host can deliver a frame through
`service.presentFrame` after Workshop authorization and live principal checks.
Remote source transport covers inspect, snapshot, apply, readback and restore
through an operator-authorized tunnel factory. A concrete authorized remote
target/tunnel and remote runtime remain external prerequisites; none was
contacted.

## Required closure before release

- Public, installable `hanaworlds-contracts@0.1.1` or an approved alternative
  dependency with valid license, and independent exact valid/invalid v2
  conformance against the published package. The current port implements the
  approved profile independently and exercises selected fixtures; official
  package conformance remains `NOT_RUN`.
- Formal HanaWorlds Shell profile composition, real local player/operator
  binding verifier, remote operator handshake and Workshop action owner. The
  current isolated local test uses a generated diagnostic
  operator account and synthetic `admit`/`verifyBinding` callbacks. Its true
  loaded-byte handshake passes, but current player binding is false.
- Real engine per-cell permission/protection, complete state profile and
  durable before-image, PREPARED/apply/readback/restore journal with restart
  evidence across the actual product transport. WorldEdit set/set_param2 may be
  called only after those gates. Diagnostic real-world mutation, readback,
  service restore and restart recovery have been observed; the public receipt
  has not been conformance-proven against the released contracts package.
- Native renderer bound to Workshop's actual Session/action owner through
  trusted transport, not a hand-filled frame or script.
- Independent specs, quality and admission, then product composition and
  player-visible tests. None is claimed by this candidate.

## Install and rollback behavior

`provisionLocalPayload(world, {operatorAuthority, transportPort})` requires a
live operator verifier for the exact world path and provisioning action. The
diagnostic verifier in tests is a fixture, not product authority. It rejects
missing permission, bad world paths and mismatched
installed bytes. It writes a new payload under that world's `worldmods` and
optionally a mode-0600 per-world pairing secret outside the package. This
function does not check whether the server is running. Stop the world before
provisioning and retain its backup. Roll back by restoring the prior complete
worldmod snapshot after stopping the engine; keep world identity and any
pending journal. The current candidate has no automated rollback for an
already installed payload, so
release rollback is `NOT_RUN`.

An isolated diagnostic DSH `web` profile has installed and loaded the packed
Adapter through the supported `dsh plugin` route. Removing that package made
the Adapter status route unavailable; adding the same package restored it.
This used no Shell composition or real operator verifier. In an isolated real
Luanti 5.17.0 world, stopped-server removal and same-version reprovisioning
created a new worldRef. Restoring the complete prior worldmod snapshot restored
the original worldRef and left the outside-world journal unchanged. The frozen
acceptance text does not specify identity continuity after a full payload
removal, so new installation and snapshot rollback are reported separately.
The source diagnostic is `test/real-lifecycle.mjs`; it requires an installed
package path and the pinned WorldEdit source in ignored `.runtime/` data.

Two native client diagnostics reached a player in an isolated world. In the
first, `/hanaworlds` was not delivered intact and the disposable world later
hit a full-disk SQLite error. In the second, the UI controller selected an
unrelated existing Luanti window and timed out before entering the command.
The form was not observed; `REAL_UI` remains `NOT_RUN` for this renderer path.

The `.runtime/` smoke profile is disposable test data, never a runtime
dependency. No developer absolute path or sibling repository is referenced by
packaged source.
