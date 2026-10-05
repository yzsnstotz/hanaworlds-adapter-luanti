# Local world provisioning implementation plan

> Current execution basis: CONTRACT 4.0.0 §§0–2 and the updated CARD/PLAN at root commit 54b10dc05 (2026-10-06). Only a fresh world, fresh profile and current payload are acceptance inputs. Old-version upgrades, same-version identity retention, old pairing/data/version compatibility criteria and their tests are withdrawn. Current automatic authorization, scope protection and recovery remain Stage 1 functions. The implementation records below are historical facts, not future compatibility requirements.
>
> Readback add50dd is complete. Bound successor PM01a10d22-a6a4-7b30-9315-b8f3e9df9c02 resumed only the original first-install rejection sequence with CARD/PLAN1bc18f27e and fixed stop-handoff-component diagnostic input. It is not an independent PASS/full-chain input. Two fresh worlds were observed; the second now supplies native-stop CHANNEL_CLOSED with matching packet received but dropped before handoff, before consumer entry. Hand off that owning Host/helper failure evidence and stop; no production Adapter fix or gate claim. Original worker/config/probe continue; every handoff reads STATUS for the current PM.

**Goal:** Register `hanaworldsLuantiLocalWorlds` for trusted in-process Host consumers, including missing worlds, native operator acquisition, finite stopped installation and paired current game facts.

**Architecture:** Adapter owns roots, opaque action leases, payload bytes and courier. The public Host `hanaworldsNativeEngineControl` owns existing-account SRP, live server permission and exact child lifecycle. Adapter generates each native operation reference and never accepts operator JSON or persists stopped facts. Existing Canvas authorization, transactions and recovery stay behind their existing ports.

**Tech stack:** Node 24, existing contracts 0.3.6, existing courier and official Luanti 5.17 through the fixed delivered CURRENT Host component. No new production dependencies.

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
- [x] Pack one candidate and install its exact bytes in a fresh public DSH profile alongside the fixed delivered CURRENT Host; use public registry ports only. Fixture setup creates test native accounts/game/selection; real native permission, stop, payload/courier and game authorization remain actual.
- [x] Record missing→acquire→stopped install→running pair→current facts and negatives with a repeatable script, without signing an independent gate.
- [x] Commit/push each completed source node. Remove only own used fixtures/build caches; retain one latest package and all `_evidence`; write REPORT, locally commit only that root file, notify current PM.

The CARD already authorizes this design and real native test preparation. Independent App verification follows REPORT; no subagents, formal installation/UI/clean-machine gate or owner acceptance here.

Historical runtime continuation: public DSH installation, MISSING discovery, native admin acquisition, stopped installation and exact running handshake observed. First current-grant read rejected twice; stop per CONTRACT, retain precise BLOCKED. Later automatic enable/disable and privilege-loss runtime assertions remain NOT_RUN. SOURCE/FIXTURE final 201 Node tests, 8 Lua suites, build and contracts pin checks completed.

Historical attribution continuation (PM-authorized): SOURCE/FIXTURE actual Cordis registry preserves the lease across wrong-connection rejection; explicit origin severity 2 exporter proves prior warnings were suppressed by default threshold 1/no console sink. New operator-current diagnostic performs no readCurrentGrants and locates first post-pair inspect rejection at real public Host.inspect. Separate native-direct diagnostic invokes no Adapter or game-grant operation: same exact public native query yields CURRENT four times, fifth inspect rejects. Desktop Host owns this current-verification capability gap; its internal native rejection cause remains unestablished here. Full current-grant/automatic/revocation runtime continuation waits for owning-origin repair; original failures remain intact. Post-attribution source checks: 202 Node tests with actual Cordis diagnostic enabled, 8 Lua suites, build and unchanged contracts pin pass.

CURRENT continuation (PM-authorized, 2026-10-06): same package SHA94d97581 and 64 packed files unchanged; new fixed Host37065ec3/helper53bd161b, own test-only account initializer. One fresh full chain exits0: MISSING→native acquisition→finite stopped installation→running exact handshake→empty initial grants→native enable/automatic proof for online NativeAdmin only→native disable/empty→enable→actual worldedit revocation/empty→actual server revocation/inspect, grants and old pair deny. Wrong password/non-admin/wrong requester/connection/forged/expired cases deny. Host normal shutdown exit0/no signal; original evidence preserved. This is implementation REAL_RUNTIME with explicit environment/input fixtures, not an independent gate or formal UI.

Engineering return 2026-10-06: independent VERIFY1624fb645 SOURCE REVIEW_PASS / REAL_RUNTIME GATE_FAIL remains authoritative. New finite public observers and direct Host reduction preserve original rejection semantics; two Adapter stops and two direct Host stops succeeded without reproducing the rejected boundary. No production/package change; no internal root cause/final fix origin established. Bound repeated attempts stopped; engineering BLOCKED requests public stop-owner phase evidence before same-card continuation. Full grant/automatic/revocation chain was not rerun.

Current handoff diagnostic: source781b92a/script and3f353e5/cleanup. New Host4e57ca0f/helperb4a42ae2, unchanged actual0.2.5 SHA94d97581. Attempt1 fresh installation success; attempt2 actual native-stop rejection with fixed CHANNEL_CLOSED and matchedDropped1 before consumer. No third attempt or full-chain replay; new REPORT/BLOCKED routes owning Host/helper. Both own stopped environments archived/removed with exact receipts.
