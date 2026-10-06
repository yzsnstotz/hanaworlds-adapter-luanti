import { placementInvariants } from '#contracts';
import { createLocalWorldPort } from './local-world-port.mjs';
import { createLocalRuntime } from './local-runtime.mjs';
import { ADAPTER_ID, ADAPTER_VERSION, PAYLOAD_VERSION } from './version.mjs';
export { payloadDigest, discoverLocalWorlds } from './local-worlds.mjs';
export const name = ADAPTER_ID;
export const inject = ['webServer'];
export function apply(ctx, config = {}) {
  const get = n => ctx.get?.(n);
  let local;
  const runtime = createLocalRuntime({ ctx, homePath: get('dshHomePath'),
    resolveCanvas: () => get('hanaworldsCanvasV5'), resolveRegistry: () => get('hanaworldsCanvasFootprintRegistry'),
    resolveHistory: () => get('hanaworldsCanvasHistoryFacts'), resolveOracle: () => get('hanaworldsWorldRevisionOracle'),
    resolveInspection: () => get('hanaworldsLuantiInspectionContext'),
    inspectConnection: ref => local.inspectConnection(ref) });
  local = createLocalWorldPort({ roots: config.localWorldRoots ?? [],
    resolveControl: () => get('hanaworldsNativeEngineControl'), runtime });
  let unregister, closing;
  const service = {
    worldAdapter: runtime.port, localWorlds: local.port,
    close() {
      const remove = unregister; unregister = undefined; remove?.();
      return closing ??= (async () => { await local.close(); await runtime.close(); })().catch(error => { closing = undefined; throw error; });
    },
    status: () => ({ adapterId: ADAPTER_ID, version: ADAPTER_VERSION, payloadVersion: PAYLOAD_VERSION,
      invariants: placementInvariants.filter(x => x.owner.includes(ADAPTER_ID)) }),
  };
  ctx.effect(() => () => service.close());
  ctx.provide('hanaworldsWorldAdapterV6', runtime.port);
  ctx.provide('hanaworldsLuantiLocalWorlds', local.port);
  ctx.provide('hanaworldsLuantiRegionIO', runtime.regionIO);
  ctx.provide('hanaworldsLuantiNativeFacts', { readScopedState: runtime.readScopedState, readCatalogue: runtime.readCatalogue,
    readMaterialSources: runtime.readMaterialSources });
  unregister = ctx.webServer.register({ kind: 'prefix', path: '/api-hanaworlds-luanti', handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) { res.statusCode = 403; res.end(); return; }
    if (req.method !== 'GET' || req.url !== '/api-hanaworlds-luanti/status') { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(service.status()));
  } });
  return service;
}

export default { apply, inject, name };
