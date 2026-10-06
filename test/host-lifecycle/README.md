# Isolated public Host lifecycle check

This harness uses the CARD-fixed INSTALL75b5 App only as a read-only Host/Node input. It never opens the App, launches Electron/Luanti, runs pnpm/Add, uses credentials, or alters a formal profile. Seed copy, tar extraction and initial disabled-bundle selection are explicit SOURCE/FIXTURE setup. Real public RPC/HTTP calls within this setup prove only isolated Host lifecycle.

Run with engineering inputs (APP = fixed INSTALL75b5 candidate, TAR = this card's final0.2.8 tgz, E = fresh directory immediately inside R/_evidence):

```sh
"$APP/Contents/Resources/runtime/hanaworlds-runtime/node/bin/node" test/host-lifecycle/runtime.mjs "$APP" "$TAR" "$E"
HANAWORLDS_TEST_HOST_APP="$APP" "$APP/Contents/Resources/runtime/hanaworlds-runtime/node/bin/node" --test test/host-lifecycle/lifecycle.test.mjs
```

The public runtime harness creates its own disposable profile immediately under the card R, records its exact root, package hash, Host argv/PID, six enable/disable changes, public listPlugins replies and status-route responses. All toggles use one Host PID; status is200 with the current package on each enable and404 on each disable. It also verifies the public `@deepseek-ai/dsh-base` management-required refusal. The native bootstrap token/cookie stay in memory, logs redact token query parameters. Shutdown uses the Host's normal IPC request; forced termination, abnormal exit or an assertion fail produces nonzero exit. The old0.2.7 baseline is expected to exit1 at the third toggle with duplicate prefix route; disabled HTTP still200 is preserved before that failure.

The focused fixture uses real fixed Cordis Context/provider effects with a labelled route table implementing the documented Host disposer behavior. It verifies all six provider ports disappear on unload, replacement registration, repeated old close ownership, failed duplicate-route service rollback, and an existing foreign service preserved after failed publication. No test implementation is a new product dependency.

After receipts are saved and Host exit/open-file checks are complete, remove only the exact own profile roots in result.json, own source node_modules and own npm cache. Keep the source, latest tar, all E (including RED) and every other card's fixed input. Do not use old profiles/version compatibility or a Host restart to mask the defect. Formal Enable now/REAL_UI and product cards remain separate independent gates.
