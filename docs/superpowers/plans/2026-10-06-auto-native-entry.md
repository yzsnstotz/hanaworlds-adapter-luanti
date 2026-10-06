# Native automatic authorization entry implementation plan

**Goal:** A native administrator enters the existing automatic panel by clicking in the existing world form, without typing a command.
**Architecture:** grant.lua reuses its native formspec and existing can_manage/PlayerRef/action/epoch controls; mode writers and authorization/protection remain unchanged. Same writer executes inline per CARD; no subagents or formal GUI.
**Tech stack:** Luanti5.17 native Lua formspec/join/receive-fields APIs, existing Adapter/contracts, current component Node24 for package checks.

- [ ] Add test/auto-native-entry.lua with real grant module and fixture native callbacks. Assert server-only manager sees grant form after join then clicks hw_auto_open to AUTO_FORM; opening leaves mode disabled. Run `lua test/auto-native-entry.lua`, expected missing join form/button failure before production change; save RED.
- [ ] In show(name), add `button[5,6;4.5,0.8;hw_auto_open;Automatic authorization]` only when can_manage(name); keep enabled status label above the button row. In delayed join, show when current manager OR existing builder-without-grant condition. In the grant receive-fields branch, on hw_auto_open clear only pending personal UI; recheck can_manage and show_auto, then return before any toggle handling. Run new fixture, existing auto-grant/grant Lua fixtures and Lua syntax; save GREEN and refusal assertions.
- [ ] Bump package/package-lock/version/init current0.2.7 and current test mock versions, preserving all other grant/engine/protection/runtime sources. Run necessary version/loader/grant fixtures and build syntax/contracts pin; no full old successful component matrices or GUI.
- [ ] Document exact UI route and limitations in GADGET and native entry test notes; commit/push explicit own changes. Pack one actual0.2.7 tar under this card R using an own cache. Audit all tar files against final source and preserve old2.6 input hashes; capture source patch and script/command receipts.
- [ ] Remove only own used generated setup/cache after source/integrity/receipts and lsof/realpath/devino checks. Keep latest candidate, worktree source and all evidence. Append own AUTO REPORT with branch/commit/hash/bytes/fixture/runtime limits; normal root commit/push. Last read STATUS and notify current PM, end.

Self-review: exact grant callbacks/formspec path scoped; no GUI or API node writes; no role metadata changes, old compatibility or hidden fallback. Formal product gate and no-command native UI must still be observed by the original independent verifier.
