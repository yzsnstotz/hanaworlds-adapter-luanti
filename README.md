# HanaWorlds Luanti Adapter

Stage 1 source is proposed by pull request. No release is available from this baseline.

## Trusted Host current-grant check

The DSH Host service `hanaworldsSessionAuthorizationV1` advertises the bundled
`hanaworlds-contracts@0.3.6` handshake and accepts
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
