# Fixed public Loader/provider/native ownership recipe

2026-10-09, F-AD-SESSION-WORLD-BIND-01 stage B preparation. Complements PUBLIC_ASSEMBLY_075.md; roots and complete NativeControl types remain there. This document supplies the missing official Loader row syntax and same-root native provider recipe. Actual Session identity, selected-object snapshot and Canvas revisions remain owning-origin supplies. This recipe does not implement Session association or grant a world write.

## Pinned official SDK supply

Registry sources were queried and the public tarballs inspected directly. These are SDK dependencies for the isolated development check, not new Adapter production dependencies.

| SDK | Origin/license | Tar bytes / SHA256 |
| --- | --- | --- |
| `@deepseek-ai/cordis@4.0.4` | [official npm package](https://www.npmjs.com/package/@deepseek-ai/cordis/v/4.0.4), deepseek-ai/deepseek-harness `vendor/cordis`, MIT | 55651 / `99a5cdb344de37cb033cb4e3a1dcfd29585d46f7d3a9c64bca9991554927185c` |
| `@deepseek-ai/cordis-plugin-loader@1.0.5` | [official npm package](https://www.npmjs.com/package/@deepseek-ai/cordis-plugin-loader/v/1.0.5), same upstream `vendor/loader`, MIT | 25520 / `5d1766a1e7a7381aea7cf24ca9d9e29ed03b49430d4606f45a4884a6a3c1e58a` |

Loader `lib/types/config/entry.d.ts` publicly declares `EntryOptions {id:string,name:string,config?:any,group?:boolean|null,disabled?:boolean|null,inject?:Inject|null}`. `lib/types/index.d.ts` / `README.md` declare `ctx.loader.create`, `ctx.loader.resolve`, `ctx.loader.await`; root config has `baseUrl`. The tar README uses upstream generic import names; use the actual scoped package names above. Cordis `ctx.provide`, `ctx.plugin` and its same-root service identity are the public SDK mechanism.

An exact supported Loader entry, extending the Adapter's shipped id/name row with the now verified SDK field, is:

```yaml
id: hanaworlds-luanti-adapter
name: hanaworlds-adapter-luanti
config:
  localWorldRoots:
    - /absolute/path/to/this-new-attempt/profile/worlds
```

The canonical directory must already exist. This is an EntryOptions row for that pinned Loader, not permission to edit an accepted profile/3080/global Host. It is not a new Adapter field or protocol. The fixed programmatic equivalent is:

```js
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { join } from 'node:path';
const root = new Context();
root.provide('webServer', webServer); // actual Host public webServer implementation
root.provide('dshHomePath', (...parts) => join(OWN_DSH_HOME, ...parts));
root.provide('hanaworldsNativeEngineControl', ownedNativeControl);
await root.plugin(Loader, { baseUrl: import.meta.url });
const id = await root.loader.create({
  id: 'hanaworlds-luanti-adapter', name: 'hanaworlds-adapter-luanti',
  config: { localWorldRoots: [OWN_WORLD_ROOT] },
});
await root.loader.await();
const entry = root.loader.resolve(id); // ACTIVE fiber state 2
const local = root.get('hanaworldsLuantiLocalWorlds');
const plan = await local.describeFlatWorldCreation({requesterRef:OWN_REQUESTER,userPath:OWN_PROFILE});
```

The new check `test/adapter-loader-recipe.test.mjs` loads this exact source's public root export by file URL through the real pinned Loader (module resolution equivalent; no anonymous/public-package installation claim). It verifies ACTIVE entry, config/root readback, same-root provider identity and the current exact contracts handshake (the initial check used 0.5.3; the new candidate check uses 0.5.4-rc.1). `webServer` is explicitly a fixture in that check; it does not prove product Host/HTTP/Luanti/Canvas functionality. Do not create a second same-name entry beside an already loaded row. Real peer services must be provided by their own origins in the same root when their operations are consumed.

## Native ownership provider, with executable source recipe

The source origin already contains the independent native ownership implementation `dev/world-manage/host.mjs:createNativeHost` at the protected 0.7.5 business source, now used unchanged by this recipe. It is development-only and excluded from the Adapter tar; it is not a new production Host SDK export. The public owning-origin source can be consumed for the isolated test, without peer private maps/implementation/E. Host production wiring remains the integration origin's work.

```js
import * as C from 'hanaworlds-contracts'; // current exact declared package
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createNativeHost } from './dev/world-manage/host.mjs'; // this origin source recipe
const profile = join(OWN_STATE, 'profile');
const worlds = join(profile, 'worlds');
for (const path of [worlds, OWN_DSH_HOME, join(OWN_STATE,'logs'), join(OWN_STATE,'tmp')]) {
  await mkdir(path, {recursive:true,mode:0o700});
}
const owned = createNativeHost({
  C, state:OWN_STATE, profile, worlds, luanti:OWN_LUANTI_EXECUTABLE,
  event(kind,facts) { appendOwnEvidence({kind,...facts}); },
});
root.provide('hanaworldsNativeEngineControl', owned.host);
// root Loader registration as above. On orderly own-service shutdown:
// close this Adapter service first, then await owned.shutdown().
```

All uppercase variables are required own-attempt inputs, not guessed product paths/defaults. New profile GAME/WorldEdit supply and actual Luanti executable remain prerequisites. No existing accepted profile/world/service is reused. The fixture recipe does not bypass game/EULA/security or install content.

The source provider validates NativeControlInput/Query/Evidence with the contracts SDK; uses its canonical own profile/world-root constraint; rejects a second live child for the world and detected foreign process use; spawns its own child with world/config/log paths; retains `{input,child,exit,controlRef}` across exit. `inspect` validates the exact controlRef/requester/world/operation and checks that owned PID still exists. Child `exit` captures code/signal. `withStoppedWorld` awaits actual child exit and the foreign-process recheck before invoking/awaiting the callback with that same PID/operation/world. Already exited records remain available for later exact callbacks. The existing development provider requires exit code 0 for its own normal stop; that is this recipe's local policy, not an added NativeControlEvidence field or universal protocol requirement. No supplied JSON PID or role becomes trusted.

`test/native-ownership-recipe.test.mjs` verifies this **unchanged source recipe** with an actual owned Node child whose engine stdout/log behaviour is a synthetic fixture. It checks wrong operation rejection, CURRENT actual PID, PID absence during STOPPED callback, retained repeat callback and actual exit code/signal association. This is SOURCE/FIXTURE with actual child lifecycle, **not REAL_LUANTI**. The initial synthetic program omitted the logfile and was corrected; its failed setup log is retained separately. Tests create/remove only their own transient directories, not retained product evidence or accepted worlds.

## Scope and remaining gates

This supplies the Adapter official Loader/provider registration/native ownership recipe. The now supplied Canvas CAS route and the Adapter singular Inspection mapping are documented in PUBLIC_INSPECTION_RECIPE.md. No new worldRevision protocol or request/display/first-ref/private-map authority is created.

Stage B source additionally permits multiple independent native connections and provides a development consumer of existing Canvas ReadWorldSelectionContext / SelectWorldConnection / SwitchWorldConnection. That consumer generates only request IDs, takes the caller's authoritative expectedRevision, and re-reads Canvas; it stores no associations or generated selectionRevision. It is not yet connected to the page. Candidate v0.5.4-rc.1 has now arrived: its exact public tag and 26 canonical package members match the installed dependency. The own source is now version 0.7.6, payload unchanged at 0.6.0. The new candidate tests cover the Loader, multi-connection preparation, existing Canvas selection consumer and retirement consumer. Session directory/unbind/page integration, 47612 UI, full consumer consistency, real Luanti, first step/checklist and product delivery remain pending. No new Adapter tar has been produced.

C3 implementation impact: current DiscoverConnections/ListWorlds inspect every runtime and reject the entire inventory if one connection fails; aggregate capabilityRevision is version-only. Excluding an exited/unavailable connection while preserving other rows and advancing aggregate revision would change that old observable return behaviour. This is reported to PM before changing it. No STOPPED enum, new exit field or exit event has been added.

## Session page continuation

New `dev/world-manage/session-server.mjs` uses this exact pinned Loader recipe with a fresh profile, own native Host, actual Adapter tar entry and explicit contract Canvas/Workshop fixtures. It registers oracle and `createInspectionContext` forwarding providers in the same root. `HW_BIND_STATE`, `HW_BIND_SDK_ROOT`, `HW_BIND_LUANTI` and (for exact tar consumption) `HW_BIND_ADAPTER_MODULE` are mandatory own paths; declared loopback port is 47612. No accepted root/profile or credentials are inputs. Source consumers and tar supply are reported by the current card REPORT; formal 0.5.4 is still HOLD.
