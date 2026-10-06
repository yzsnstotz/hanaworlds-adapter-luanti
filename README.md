# HanaWorlds Luanti Adapter

Stage 1 source is proposed by pull request. No release is available from this baseline.

## Trusted Host current-grant check

The DSH Host service `hanaworldsSessionAuthorizationV1` advertises the bundled
`hanaworlds-contracts@0.3.9` handshake and accepts
`call('VerifyCurrentGrant', request)` using `session-authorization/v1`. The
request must contain the **original** `OriginalSessionBinding` already issued
and durably held by a trusted Host. This Adapter does not create a Session
binding or infer one from an online player. It checks the current paired
Luanti grant for the exact world, player, original grant reference, grant
epoch and native `WORLD_BUILD_WITH_ENGINE_PROTECTION` scope on every call.
For this Luanti payload, the native grant reference is the grant epoch.

The Host supplies `hanaworldsSessionAuthorizationHostV1` with
`authenticateAdapterCaller()` and `call('ReadOriginalBinding', request)`.
The former must check the active privileged Host call provenance **outside
request JSON**; a constant `true` is valid only in an isolated test fixture.
The latter must read the Host's original durable issuance for the exact live
Core Session incarnation. The Adapter compares every field of that returned
binding with the caller-held original before and after its game query. A
missing Host service or failed provenance check rejects the call. Missing
original history returns `UNKNOWN`; a replaced or mismatched original returns
`MISMATCH`; revoked, offline, permission-lost or regranted original grants
return `REVOKED`. Only an exact live match returns `CURRENT`. The consuming
Host must recheck its Session binding before a write. The Adapter never
decides a Canvas transaction.

## Fresh local provisioning (0.2.6)

The public `hanaworldsLuantiLocalWorlds` service discovers missing worlds, obtains native administrator proof through the public Host, and installs the current payload only inside its finite stopped-world callback. Installation creates a new world identity and courier pairing. Existing payload locations are rejected; upgrade, backup/restore, rollback and identity-preserving reinstall implementations and their version-specific tests have been removed under CONTRACT 4.0.0. Current running identity, authorization/revocation, automatic mode, protection and transaction recovery remain available.

The component self-test uses only ENGINE-CURRENT `stop-fixed-component` (99a8973) and a fresh world/profile. See `test/local-world-runtime/README.md` for the public loader/registry/native chain and cleanup procedure. Old diagnostic and failure inputs remain protected evidence; an implementation observation never signs the independent Adapter gate or product acceptance.

## Native automatic authorization entry (0.2.7)

A native administrator or authenticated singleplayer world owner receives the existing world authorization form on joining. Click **Automatic authorization** to open the current automatic panel, then explicitly enable or disable it. Closing the form changes no mode; leaving and rejoining offers the entry again. The entry and toggle recheck native authority and the current online player session. Ordinary builders keep the individual authorization flow. This isolated candidate has SOURCE/FIXTURE checks only; its rendered native entry and formal product write gate require independent verification.

## Host lifecycle (Adapter 0.2.8, payload 0.2.7)

Each Adapter instance retains the disposer returned by the public Host route registration. Normal unload removes its status route before asynchronous resource cleanup. Repeated or concurrent closes cannot unregister a later instance at the same path; rejected resource cleanup remains retryable. Cordis owns publication and withdrawal of its services, including rollback of failed activation. The Host duplicate-route and required-management guards remain intact.

This change only affects Host lifecycle. All game payload bytes, native authority, grant, automatic mode, transaction and protection rules are unchanged from 0.2.7. See `test/host-lifecycle/README.md` for the isolated public Host reproduction and evidence limits.

## Current contract input (Adapter 0.2.9)

The generated vendor subset now uses the exact admitted contracts0.3.9 artifact. Current world and original-grant provider advertisements match its capability helpers, which refuse older package advertisements. This pin update retains the 0.2.8 lifecycle implementation and unchanged 0.2.7 payload. Public Add over fixed75b5's already loaded seed0.2.6 still runs the old factory and remains a separate Desktop replacement blocker; see `test/host-lifecycle/add-replacement.mjs`. No new authorization issuer or transaction decision is introduced.
