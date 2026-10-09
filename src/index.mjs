import { placementInvariants, ContractError, schemaBundle } from '#contracts';
import { createLocalWorldPort } from './local-world-port.mjs';
import { createLocalRuntime } from './local-runtime.mjs';
import { ADAPTER_ID, ADAPTER_VERSION, PAYLOAD_VERSION } from './version.mjs';
export { payloadDigest, discoverLocalWorlds } from './local-worlds.mjs';
export const name = ADAPTER_ID;
export const inject = ['webServer'];
/** Read-only native facts fail with the contract's own public Error shape: the internal code is
 * kept (unknown codes become CAPABILITY_UNAVAILABLE), phase validate, nothing mutated; a malformed
 * input is SCHEMA_INVALID/INVALID_SHAPE, every other refusal REQUIRED_FACT_UNKNOWN (as the
 * world-adapter/v7 port already answers). A ContractError passes through unchanged. */
function publicFailures(fn) {
  const convert = error => {
    if (error instanceof ContractError) throw error;
    const code = schemaBundle.definitions.ErrorCode.enum.includes(error?.code ?? error?.message) ? (error.code ?? error.message) : 'CAPABILITY_UNAVAILABLE';
    throw Object.assign(new ContractError(code, 'validate', code === 'SCHEMA_INVALID' ? 'INVALID_SHAPE' : 'REQUIRED_FACT_UNKNOWN'),
      typeof error?.detail === 'string' ? { detail: error.detail } : {});
  };
  return (...args) => {
    try { const r = fn(...args); return r && typeof r.then === 'function' ? r.catch(convert) : r; }
    catch (error) { convert(error); }
  };
}
export function apply(ctx, config = {}) {
  const get = n => ctx.get?.(n);
  let local;
  const runtime = createLocalRuntime({ ctx, homePath: get('dshHomePath'),
    resolveCanvas: () => get('hanaworldsCanvasV5'), resolveRegistry: () => get('hanaworldsCanvasFootprintRegistry'),
    resolveHistory: () => get('hanaworldsCanvasHistoryFacts'), resolveOracle: () => get('hanaworldsWorldRevisionOracle'),
    resolveInspection: () => get('hanaworldsLuantiInspectionContext'),
    inspectConnection: ref => local.inspectConnection(ref) });
  local = createLocalWorldPort({ roots: config.localWorldRoots ?? [],
    resolveControl: () => get('hanaworldsNativeEngineControl'), resolveCanvas: () => get('hanaworldsCanvasV5'), runtime });
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
  ctx.provide('hanaworldsWorldAdapterRegionV1', runtime.regionIO);
  // Every failure leaving this service is a contract ContractError (publicError), never a bare Error.
  const facts = Object.fromEntries(['readScopedState', 'readCatalogue', 'readWritePathEvidence', 'readRegionState',
    'readMaterialSources', 'readConfigEngineFacts', 'readWorldEditFacts', 'readStage1FactLedger']
    .map(name => [name, publicFailures(runtime[name])]));
  ctx.provide('hanaworldsLuantiNativeFacts', facts);
  unregister = ctx.webServer.register({ kind: 'prefix', path: '/api-hanaworlds-luanti', handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) { res.statusCode = 403; res.end(); return; }
    if (req.method !== 'GET' || req.url !== '/api-hanaworlds-luanti/status') { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(service.status()));
  } });
  return service;
}

export default { apply, inject, name };
