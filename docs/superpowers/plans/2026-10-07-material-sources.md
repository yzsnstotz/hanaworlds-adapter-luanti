# Current-world material sources implementation plan

Approved scope: current CARD, PM continuation, and Contracts0.4.2 public declaration.
One original Adapter writer executes sequentially; no subagents or new sessions.

Goal: supply MaterialSources through NativeFacts.readMaterialSources(worldRef),
with actual paired engine metadata and actual resolved server/game/mod texture bytes.
Architecture: own Lua readonly facts snapshot supplies Catalogue, appearance facts,
native game/mod/user paths and server override setting. Own Node resolver reads only
those paths, resolves simple uniform assets and builds validated typed byte envelope.
Before/after native metadata, byte/source projection and actual connection checks
must agree. Source changes during a read reject CURRENT_WORLD_MISMATCH; separate
fresh reads may return a new sourceRevision. No cached palette or RGB production.

- [x] Create independent codex/s1-ad-material-sources-20261007 worktree and verify
  exact Contracts0.4.2 tar/pin/import closure. Old source/package/E untouched.
- [ ] Add failing public supplier + actual file/source/UNKNOWN tests; retain RED.
- [ ] Add src/material-sources.mjs for confined filesystem resolution/typed response;
  local-runtime/current connection checks, local-courier readonly dispatch,
  Lua facts/material metadata and supported legal engine param2; publish service.
  Known legal engine values never fill mutation semantics/persistent-state unknowns.
- [ ] Test GREEN, build syntax/Lua, exact pin/new handshake and runtime fixtures.
- [ ] Commit/push working source; pack actual package independently install it;
  run same affected source tests and own real Luanti/real Cordis focused harness.
  Host native lifecycle is an explicit peer fixture; no Canvas/model/GUI.
- [ ] Record package entries, payload digest, exact source/remote, runtime results,
  zero writes, product UNKNOWN/NOT_RUN. Recheck protected old tar and source.
- [ ] Clean only used own install/cache/extract outputs after process/identity
  checks. Retain source/latest tar/necessary evidence/world. Commit/push REPORT
  only in shared root; fresh STATUS PM notification as final tool action then end.

Verification focuses on actual uniform texture source/priority, wrong/stopped world,
connection incarnation, legal param2, unknown static capabilities, file-source change
and zero writes. Do not rerun protected old Catalogue eight/transaction eleven gates.
Supported param2 initial subset: engine none (byte domain) and facedir (0..23);
unsupported semantics remain null. For colour-invariant uniform cubes, report one
representative from the actual known legal set; do not imply all nodes have param2=0.
Unsupported drawtypes/effects/overrides/colliding unresolved sources remain UNKNOWN.
Source basis SERVER_ASSET_ONLY; no product game or client render assertion.
