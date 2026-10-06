# S1-AD-AUTO-01 native entry design

The current CARD explicitly authorizes the sole Adapter writer to add the narrowest native button/menu into the existing automatic panel, without another owner engineering approval. This design stays inside that authorization. It does not change the purpose or enable automatic authorization by itself.

Source12374a8/0.2.6 has show_auto called only from hanaworlds_auto chatcommand and existing toggle responses. There is no no-command opener in its Lua grant/session forms. The native join callback already offers a world-authorization formspec to builders needing personal confirmation.

Chosen route: join the current world as a native server administrator or actual engine singleplayer owner → existing HanaWorlds world-authorization form appears → click Automatic authorization → existing automatic panel displays status and its existing enable/disable button. Administrators get the existing world form on every join even when already authorized or automatic mode is enabled; ordinary builders retain their existing confirmation flow. Reopening after closing is leave/rejoin through the game's UI; no command is required. No inventory layout, game-mod menu dependency, or generated code is introduced.

Alternatives considered: append to the game's inventory (requires arbitrary layout/mod rebuilding coordination); force a separate auto panel on join (would replace the player's existing authorization prompt). Reusing the existing form's native button is narrower and keeps one automatic panel and one business writer.

Only grant.lua presentation/join/receive-fields routing changes. The opener is visible only to can_manage, and current online PlayerRef plus can_manage are rechecked on its authenticated form event. The open event never changes mode, accepts no supplied administrator identity, and cannot process toggle fields in the grant form. Actual enable/disable still runs the unchanged AUTO_FORM pending action/epoch/native permission checks. Losing authority between display and click rejects. Current grant/scope/protection/transactions remain unchanged.

SOURCE/FIXTURE verification: a new callback-driven Lua test must fail before the source change, then cover admin with no build privilege, repeated join while enabled, singleplayer owner, ordinary player, disconnect/replaced PlayerRef, privilege loss and mixed/forged fields. Existing auto/grant fixtures and package version/loader near-neighbors remain checks, not product proof. No GUI/official App/profile or prepared verifier environment is used. Formal native UI, successful product building and real disable/revocation/protection writes are NOT_RUN and belong to the original independent AUTO verifier.

Package/payload become0.2.7 because grant.lua bytes change. One isolated candidate under S1-AD-AUTO-01, current2.6 source/tar and formal dc47/ASAR629 inputs protected. Normal commit/push per node; REPORT appended only by this writer. Independent verifier/PM own formal installation and new-byte gates.

Applied law verification/readiness-never-equals-player-acceptance: callback fixtures cannot sign player-visible success. Safety consent law scope adds no approval to the already authorized native admin action; automatic mode still needs its explicit existing button. Scoped npm cache learning applies if packing/setup needs npm. No Docs weights are edited: this task limits writes to its origin and REPORT.

Design self-review: one origin, one existing panel, no permission or business-state expansion, no placeholders or old-version/data compatibility. Current CARD is the approval basis.
