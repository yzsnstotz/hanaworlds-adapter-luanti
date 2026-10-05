# S1-AD-AUTO-01 Implementation Plan

Goal: a native Luanti administrator or singleplayer owner can enable/disable world-local automatic delegation; builders retain live permission, grant epoch, scope and protection checks.

Architecture: extend grant.lua only at the existing native authorization boundary. Server privilege is checked by Luanti, singleplayer ownership by the engine mode and authenticated singleplayer account. Store the enabling principal and a fresh epoch in mod storage. Automatic player proofs remain world/player/scope bound; mode and privilege changes invalidate old refs. Preserve explicit personal grants outside automatic mode. Existing courier/engine scope and protection checks continue unchanged. Add only a read-only mode fact on the existing paired local grant-evidence service.

Tech stack: Lua payload; Node 24 ES modules; current admitted contracts pin unchanged.

Official authority: https://docs.luanti.org/for-players/privileges/ and Luanti builtin/game/{auth,privileges}.lua. server is admin maintenance privilege; it is not granted by default in singleplayer.

Execution: this authorized worker executes inline. PM separately dispatches independent review and formal product verification.

- [x] Write test/auto-grant.lua covering native form authority, stale/forged submissions, world persistence, proof epoch, offline/no-build beneficiaries, admin revocation/account recreation and singleplayer ownership; observe missing command failure.
- [x] Extend payload/hanaworlds_adapter/grant.lua with native status/toggle form and persistent auto proofs; run all Lua regressions.
- [x] Write Node grant evidence mode read and courier tests; observe missing method failure. Extend transport.lua, local-transport.mjs and v2-operations.mjs with a read-only mode projection; deny wrong world/unpaired or malformed replies.
- [x] Version payload/package to 0.2.4, declare 0.2.3 upgrade, regenerate metadata through normal version script/edit source metadata, run build, all Node/Lua tests and contracts pin check.
- [x] Document exact native commands and limitations; commit/push deliverable, produce latest isolated package and evidence, clean only this card outputs, write REPORT and notify current PM from STATUS.

Formal unified App/game UI, entry preparation and leoventory verification belong to the later independent verifier; no product PASS/TO_TEST from this implementation self-test.
