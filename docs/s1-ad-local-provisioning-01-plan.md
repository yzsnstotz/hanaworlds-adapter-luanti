# Local world provisioning implementation plan

**Goal:** Register `hanaworldsLuantiLocalWorlds` for trusted in-process Host consumers, including missing worlds, native operator acquisition, finite stopped installation and paired current game facts.

**Architecture:** Adapter owns roots, opaque action leases, payload bytes and courier. The public Host `hanaworldsNativeEngineControl` owns existing-account SRP, live server permission and exact child lifecycle. Adapter generates each native operation reference and never accepts operator JSON or persists stopped facts. Existing Canvas authorization, transactions and recovery stay behind their existing ports.

**Tech stack:** Node 24, existing contracts 0.3.6, existing courier and official Luanti 5.17 through the delivered HTTP Host component. No new production dependencies.

## 1. Public lifecycle

- [x] Add failing registration/discovery and finite-install tests in `test/local-world-port.test.mjs`.
- [x] Add `src/local-world-port.mjs`: strict snapshots, managed roots, action-bound opaque leases; acquire/inspect/provision/pair/current game reads/close; exact public Host provenance and provider withdrawal checks.
- [x] Register service in `src/index.mjs`; maintain the original external operator path for worlds not claimed through the new lifecycle.
- [x] Verify missing/forged/wrong scope/withdrawn/dead/expired/duplicate callback paths write nothing.

## 2. Shared courier

- [x] Add runtime root configuration and local pairing that shares its existing courier and connection reservation without creating a Canvas binding or transaction backend.
- [x] Recheck operator after asynchronous grant reads; keep existing recovery transport ownership and external Host compatibility.
- [x] Test loaded byte mismatch, cross-world input, current game grant read and revocation.

## 3. Candidate and runtime self-test

- [x] Version 0.2.5; admit verified 0.2.4 payload upgrade preserving identity/pairing/grants; keep native auto logic unchanged.
- [x] Run full Node/Lua/build/offline pin checks; document public method shapes and fixture/runtime boundaries.
- [ ] Pack one candidate and install its exact bytes in a fresh public DSH profile alongside the delivered HTTP Host; use public registry ports only. Fixture setup creates test native accounts/game/selection; real native permission, stop, payload/courier and game authorization remain actual.
- [ ] Record missing→acquire→stopped install→running pair→current facts and negatives with a repeatable script, without signing an independent gate.
- [ ] Commit/push each completed source node. Remove only own used fixtures/build caches; retain one latest package and all `_evidence`; write REPORT, locally commit only that root file, notify current PM.

The CARD already authorizes this design and real native test preparation. Independent App verification follows REPORT; no subagents, formal installation/UI/clean-machine gate or owner acceptance here.

Runtime continuation: public DSH installation, MISSING discovery, native admin acquisition, stopped installation and exact running handshake observed. First current-grant read rejected twice; stop per CONTRACT, retain precise BLOCKED. Later automatic enable/disable and privilege-loss runtime assertions remain NOT_RUN. SOURCE/FIXTURE final 201 Node tests, 8 Lua suites, build and contracts pin checks completed.

Attribution continuation (PM-authorized): SOURCE/FIXTURE actual Cordis registry preserves the lease across wrong-connection rejection; explicit origin severity 2 exporter proves prior warnings were suppressed by default threshold 1/no console sink. New operator-current diagnostic performs no readCurrentGrants and locates first post-pair inspect rejection at real public Host.inspect. Separate native-direct diagnostic invokes no Adapter or game-grant operation: same exact public native query yields CURRENT four times, fifth inspect rejects. Desktop Host owns this current-verification capability gap; its internal native rejection cause remains unestablished here. Full current-grant/automatic/revocation runtime continuation waits for owning-origin repair; original failures remain intact. Post-attribution source checks: 202 Node tests with actual Cordis diagnostic enabled, 8 Lua suites, build and unchanged contracts pin pass.
