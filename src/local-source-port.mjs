import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { types } from 'node:util';
import { canonicalJSON, ContractError } from '#contracts';
import { LOCAL_SOURCE_VERSION, sourceRequest, sourceError } from './local-source-protocol.mjs';
import { withSourceScope } from './source-scope.mjs';

const original = value => value?.[Symbol.for('cordis.original')] ?? value;
const fail = code => { throw Object.assign(Error(code), { sourceCurrency: code === 'CURRENT_WORLD_MISMATCH' }); };
const trackedCaller = (receiver, port, ctx) => types.isProxy(receiver) &&
  !Object.hasOwn(receiver, Symbol.for('cordis.original')) && original(receiver) === port &&
  Object.getOwnPropertyDescriptor(receiver, 'ctx')?.value === ctx ? receiver.ctx : null;

/** Source correlation and official registration authority for the added entry points.
 * Existing lifecycle methods remain on the original port and retain their ABI. */
export function attachLocalSource(port, { ctx, roots, userPath, creationRoot, materials, closed, pair }) {
  let generation = randomUUID(), signature = null;
  let lastRegistration;
  const invalidate = () => { generation = randomUUID(); signature = null; };
  // Cordis overlays ctx on its tracked proxy; use the same configurable
  // descriptor as the existing Adapter ports so the proxy can carry the caller.
  Object.defineProperty(port, 'ctx', { value: ctx, writable: true, configurable: true });
  port[Symbol.for('cordis.tracker')] = { property: 'ctx' };
  function registration(receiver, caller, captured) {
    const invoked = trackedCaller(receiver, port, ctx);
    const key = ctx?.[Symbol.for('cordis.isolate')]?.hanaworldsLocalWorlds;
    const record = key && ctx.reflect?.store?.[key];
    const fiber = caller?.fiber;
    const check = () => {
      if (closed()) fail('ADAPTER_UNAVAILABLE');
      if (!caller || !invoked || invoked.root !== caller.root || invoked.fiber !== caller.fiber ||
        !record || record !== captured || caller[Symbol.for('cordis.shadow')] !== ctx || caller.root !== ctx.root ||
        !fiber || fiber.state !== 2 || fiber.ctx?.root !== ctx.root || ctx.fiber?.state !== 2 ||
        record.fiber !== ctx.fiber || record.fiber?.state !== 2 ||
        ctx.reflect.store[key] !== record || original(record.value) !== port ||
        original(ctx.get('hanaworldsLocalWorlds')) !== port) fail('CURRENT_WORLD_MISMATCH');
    };
    check();
    if (lastRegistration && record !== lastRegistration) invalidate();
    lastRegistration = record;
    return check;
  }
  async function observe(check) {
    check();
    const paths = roots(), rows = [];
    if (!paths.length) fail('ADAPTER_UNAVAILABLE');
    for (const path of paths) {
      if (!isAbsolute(path) || resolve(path) !== path) fail('ADAPTER_UNAVAILABLE');
      const stat = await lstat(path, { bigint: true }).catch(e => { if (e.code === 'ENOENT') return null; throw e; }); check();
      if (!stat?.isDirectory() || stat.isSymbolicLink()) fail('CURRENT_WORLD_MISMATCH');
      const actual = await realpath(path); check();
      if (actual !== path) fail('CURRENT_WORLD_MISMATCH');
      rows.push({ path, device: String(stat.dev), inode: String(stat.ino) });
    }
    if (userPath !== undefined) {
      if (typeof userPath !== 'string' || !isAbsolute(userPath) || resolve(userPath) !== userPath) fail('ADAPTER_UNAVAILABLE');
      const stat = await lstat(userPath, { bigint: true }); check();
      const actual = await realpath(userPath); check();
      if (!stat.isDirectory() || stat.isSymbolicLink() || actual !== userPath) fail('ADAPTER_UNAVAILABLE');
      rows.push({ path: userPath, device: String(stat.dev), inode: String(stat.ino) });
    }
    if (canonicalJSON(roots()) !== canonicalJSON(paths)) fail('CURRENT_WORLD_MISMATCH');
    const next = canonicalJSON(rows);
    if (signature !== null && signature !== next) generation = randomUUID();
    signature = next;
    const namespace = canonicalJSON({ roots: paths, userPath: userPath ?? null, creationRoot: creationRoot ?? null });
    return { source: { sourceRef: `source:${createHash('sha256').update(namespace).digest('hex')}`, instanceRef: `instance:${generation}` }, paths, signature: next };
  }
  function descriptor(state) {
    const worldRoot = creationRoot ?? (state.paths.length === 1 ? state.paths[0] : null);
    if (!worldRoot || !state.paths.includes(worldRoot)) fail('ADAPTER_UNAVAILABLE');
    return { source: state.source, contractVersions: [LOCAL_SOURCE_VERSION], discoveryInput: { worldRoot },
      templates: [{ templateId: 'flat', displayName: '平地', description: '创建具有世界源内容与载荷的平地世界' },
        ...materials.map(({ templateId, displayName, description }) => ({ templateId, displayName, description }))] };
  }
  async function execute(receiver, input, scoped, caller, captured) {
    // Correlation never executes a caller's accessor before JSON admission.
    let requestId = null;
    try {
      const field = input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'requestId');
      if (typeof field?.value === 'string' && field.value.length) requestId = field.value;
    } catch { /* uncorrelatable input follows the documented Promise refusal */ }
    let q;
    try {
      q = sourceRequest(input, scoped);
      const checkRegistration = registration(receiver, caller, captured);
      const state = await observe(checkRegistration);
      if (scoped && canonicalJSON(q.source) !== canonicalJSON(state.source)) fail('CURRENT_WORLD_MISMATCH');
      const check = async () => {
        checkRegistration();
        const current = await observe(checkRegistration);
        if (current.signature !== state.signature || canonicalJSON(current.source) !== canonicalJSON(state.source)) fail('CURRENT_WORLD_MISMATCH');
      };
      let result;
      if (!scoped) { await check(); result = descriptor(state); }
      else {
        result = await withSourceScope(check, async () => {
          await check();
          const direct = { contractVersion: LOCAL_SOURCE_VERSION, requestId: q.requestId, ...q.payload };
          const response = q.operation === 'pair' && q.payload.connectionRef ? await pair(q, check) : await port[q.operation](direct);
          // Original operation's business refusal/UNKNOWN is returned intact. It
          // cannot be remapped to scoped admission or erase actual side effects.
          if (response.error) { await check(); return { response }; }
          await check(); return { response };
        });
        return JSON.parse(canonicalJSON(result.response));
      }
      return { contractVersion: LOCAL_SOURCE_VERSION, requestId: q.requestId, result, error: null };
    } catch (error) {
      const known = ['SCHEMA_INVALID', 'UNKNOWN_REQUIRED_FIELD', 'PAYLOAD_VERSION_MISMATCH', 'CURRENT_WORLD_MISMATCH', 'ADAPTER_UNAVAILABLE', 'CONNECTION_NOT_FOUND'];
      const code = error.publicError?.code ?? error.code ?? error.message;
      const named = known.includes(code) ? code : 'ADAPTER_UNAVAILABLE';
      const reason = ['SCHEMA_INVALID', 'UNKNOWN_REQUIRED_FIELD'].includes(named) ? 'INVALID_SHAPE'
        : named === 'PAYLOAD_VERSION_MISMATCH' ? 'VERSION_UNSUPPORTED' : 'REQUIRED_FACT_UNKNOWN';
      const refusal = sourceError(named, error.mutationState ?? 'NONE', reason);
      if (requestId === null) throw Object.assign(new ContractError(named, 'validate', reason), { cause: error });
      return { contractVersion: LOCAL_SOURCE_VERSION, requestId, result: null, error: refusal };
    }
  }
  for (const name of ['getRuntimeSource', 'callScoped']) Object.defineProperty(port, name, { enumerable: true,
    get() {
      const caller = trackedCaller(this, port, ctx);
      const key = ctx?.[Symbol.for('cordis.isolate')]?.hanaworldsLocalWorlds;
      const captured = key && ctx.reflect?.store?.[key];
      return function(input) { return execute(this, input, name === 'callScoped', caller, captured); };
    } });
  return { invalidate };
}
