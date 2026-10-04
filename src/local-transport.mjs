import { randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { validateRequest } from '#contracts/v4';
import { payloadDigest } from './local-worlds.mjs';
import { PAYLOAD_VERSION } from './version.mjs';

const SURFACE = 'interaction-surface/v3';
// rc.9 user decision: the in-world renderer answers SELECT_CHOICE itself and
// never relays it; the choice is made in Shell.
function rendererRefusal(requestId) {
  return { contractVersion: SURFACE, requestId, result: null, error: {
    code: 'RENDERER_CAPABILITY_UNAVAILABLE', phase: 'validate', retryability: 'NEVER',
    mutationState: 'NONE', transactionRef: null, causeCode: null, reason: 'SCOPE_DENIED' } };
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
function fault(code) { return new Error(code); }
function loopback(address) {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}
function respond(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * Per-world loopback courier. It has no Canvas HTTP surface: only an admitted
 * in-process EngineBridge can enqueue work. The secret is generated per world
 * at provisioning time and never enters the package or logs.
 */
export class LocalEngineTransport {
  #server;
  #worldRef;
  #expectedDigest;
  #token;
  #serviceName;
  #onAction;
  #actionFrames = new Map();
  #queued = [];
  #inFlight = new Map();
  #closed = false;

  constructor(worldRef, token, serviceName, expectedDigest, onAction) {
    this.#worldRef = worldRef;
    this.#token = Buffer.from(token, 'hex');
    this.#serviceName = serviceName;
    this.#expectedDigest = expectedDigest;
    this.#onAction = onAction;
  }

  static async open(world, { serviceName, onAction } = {}) {
    if (typeof serviceName !== 'string' || !serviceName) throw fault('PERMISSION_DENIED');
    const dir = join(world, 'worldmods', 'hanaworlds_adapter');
    const [manifestInfo, transportInfo] = await Promise.all([
      lstat(join(dir, 'payload.json')), lstat(join(dir, 'transport.json')),
    ]);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() ||
        !transportInfo.isFile() || transportInfo.isSymbolicLink() ||
        (transportInfo.mode & 0o077) !== 0) throw fault('CONNECTION_UNAUTHORIZED');
    const manifest = JSON.parse(await readFile(join(dir, 'payload.json'), 'utf8'));
    const config = JSON.parse(await readFile(join(dir, 'transport.json'), 'utf8'));
    if (manifest.payloadVersion !== PAYLOAD_VERSION || manifest.payloadDigest !== await payloadDigest() ||
        config.worldRef !== manifest.worldRef || !/^luanti:[0-9a-f-]+$/.test(config.worldRef) ||
        !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535 ||
        typeof config.token !== 'string' || !/^[0-9a-f]{64}$/.test(config.token))
      throw fault('PAYLOAD_VERSION_MISMATCH');
    const transport = new LocalEngineTransport(config.worldRef, config.token, serviceName,
      manifest.payloadDigest, onAction);
    transport.#server = createServer((req, res) => transport.#handle(req, res));
    await new Promise((resolve, reject) => {
      transport.#server.once('error', reject);
      transport.#server.listen(config.port, '127.0.0.1', () => {
        transport.#server.off('error', reject);
        resolve();
      });
    });
    return transport;
  }

  #authorized(req) {
    if (!loopback(req.socket.remoteAddress)) return false;
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const raw = header.slice(7);
    if (!/^[0-9a-f]{64}$/.test(raw)) return false;
    const supplied = Buffer.from(raw, 'hex');
    return supplied.length === this.#token.length && timingSafeEqual(supplied, this.#token);
  }

  async #handle(req, res) {
    if (!this.#authorized(req)) { respond(res, 403, { error: 'CONNECTION_UNAUTHORIZED' }); return; }
    if (req.method === 'GET' && req.url === '/poll') {
      const entry = this.#queued.shift();
      if (entry) this.#inFlight.set(entry.command.id, entry);
      respond(res, 200, { worldRef: this.#worldRef, command: entry?.command ?? null });
      return;
    }
    if (req.method !== 'POST' || !['/result', '/action'].includes(req.url)) {
      respond(res, 404, { error: 'UNKNOWN_ACTION' }); return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        respond(res, 413, { error: 'SCHEMA_INVALID' }); return;
      }
    }
    let message;
    try { message = JSON.parse(body); }
    catch { respond(res, 400, { error: 'SCHEMA_INVALID' }); return; }
    if (req.url === '/action') {
      if (!this.#onAction) { respond(res, 503, { error: 'RENDERER_CAPABILITY_UNAVAILABLE' }); return; }
      const shown = this.#actionFrames.get(message?.engineActorName);
      const frame = shown?.frame;
      const action = frame?.actions?.find(entry => entry.actionId === message?.request?.actionId);
      const request = message?.request;
      if (request?.input?.kind === 'SELECT_CHOICE' && typeof request.requestId === 'string' &&
          request.requestId) {
        respond(res, 409, rendererRefusal(request.requestId)); return;
      }
      if (message?.worldRef !== this.#worldRef || !frame || !action ||
          request?.contractVersion !== SURFACE ||
          request.actorRef !== frame.actorRef || request.sessionRef !== frame.sessionRef ||
          request.authorizationRef !== frame.authorizationRef ||
          request.turnRevision !== frame.turnRevision || request.frameRef !== frame.frameRef ||
          request.frameRevision !== frame.frameRevision ||
          request.surfaceActionDigest !== action.surfaceActionDigest ||
          !action.inputKinds?.includes(request.input?.kind) ||
          typeof request.requestId !== 'string' || !request.requestId ||
          request.requestId !== request.invocationId) {
        respond(res, 409, { error: 'INVALID_FRAME' }); return;
      }
      if (request.input.kind === 'SELECT_OBJECTS') {
        const available = action.surfaceAction?.orderedTargetRefs;
        const selected = request.input.orderedObjectRefs;
        if (!Array.isArray(available) || !Array.isArray(selected) || !selected.length ||
            selected.some(ref => typeof ref !== 'string' || !available.includes(ref)) ||
            selected.some((ref, i) => i > 0 && available.indexOf(selected[i - 1]) >= available.indexOf(ref))) {
          respond(res, 409, { error: 'INVALID_FRAME' }); return;
        }
      }
      this.#actionFrames.delete(message.engineActorName);
      try {
        const principal = await this.verifyPrincipal(message.engineActorName);
        if (principal.grantRef !== shown.grantRef) throw fault('AUTHORIZATION_REVOKED');
      } catch {
        respond(res, 409, { error: 'ACTION_NOT_AUTHORIZED' }); return;
      }
      try {
        // The pinned host copy supplies every nullable projection field.
        // Luanti's JSON parser may omit null keys when round-tripping Lua tables.
        const ownerRequest = validateRequest(SURFACE, 'InvokeAction',
          { ...request, surfaceAction: structuredClone(action.surfaceAction) });
        const receipt = await this.#onAction(ownerRequest, { engineActorName: message.engineActorName,
          worldRef: this.#worldRef });
        if (receipt?.invocationId !== request.invocationId || receipt.accepted !== true ||
            typeof receipt.resultRevision !== 'string' || !receipt.resultRevision ||
            typeof receipt.ownerRef !== 'string' || !receipt.ownerRef ||
            !(receipt.domainReceiptDigest === null ||
              (typeof receipt.domainReceiptDigest === 'string' &&
                /^[0-9a-f]{64}$/.test(receipt.domainReceiptDigest))) ||
            Object.keys(receipt).some(key => !['invocationId', 'resultRevision', 'ownerRef',
              'domainReceiptDigest', 'accepted'].includes(key)))
          throw fault('RENDERER_CAPABILITY_UNAVAILABLE');
        respond(res, 200, { contractVersion: SURFACE,
          requestId: request.requestId, result: receipt, error: null });
      } catch {
        respond(res, 503, { error: 'RENDERER_CAPABILITY_UNAVAILABLE' });
      }
      return;
    }
    if (message?.worldRef !== this.#worldRef || typeof message.id !== 'string') {
      respond(res, 400, { error: 'REPLAY_MISMATCH' }); return;
    }
    const entry = this.#inFlight.get(message.id);
    if (!entry) { respond(res, 409, { error: 'STALE_TRANSACTION' }); return; }
    this.#inFlight.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(fault(message.error));
    else entry.resolve(message.result);
    respond(res, 200, { status: 'RECEIVED' });
  }

  #dispatch(operation, command) {
    if (this.#closed) return Promise.reject(fault('CONNECTION_UNAUTHORIZED'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const entry = { command: { ...command, id, worldRef: this.#worldRef, operation }, resolve, reject };
      entry.timeout = setTimeout(() => {
        this.#queued = this.#queued.filter(item => item !== entry);
        this.#inFlight.delete(id);
        reject(fault('ENGINE_RESPONSE_UNKNOWN'));
      }, 30000);
      this.#queued.push(entry);
    });
  }

  #actor(binding) {
    if (!binding?.current || typeof binding.engineActorName !== 'string' ||
        !binding.engineActorName || typeof binding.nativeGrantRef !== 'string' ||
        !binding.nativeGrantRef) throw fault('CONNECTION_UNAUTHORIZED');
    return { actorName: binding.engineActorName, grantRef: binding.nativeGrantRef };
  }

  async handshake() {
    const result = await this.#dispatch('handshake', {});
    if (result?.payloadVersion !== PAYLOAD_VERSION || result.worldRef !== this.#worldRef ||
        result.loadedSourceDigest !== this.#expectedDigest ||
        result.manifestDigest !== this.#expectedDigest || result.payloadMatches !== true ||
        result.worldeditAvailable !== true) throw fault('PAYLOAD_VERSION_MISMATCH');
    return { worldRef: this.#worldRef, payloadVersion: result.payloadVersion,
      payloadDigest: result.loadedSourceDigest, worldeditVersion: result.worldeditVersion };
  }

  async verifyPrincipal(engineActorName) {
    if (typeof engineActorName !== 'string' || !engineActorName) throw fault('CONNECTION_UNAUTHORIZED');
    const result = await this.#dispatch('authorize', { actorName: engineActorName });
    if (result?.current !== true || result.engineActorName !== engineActorName ||
        result.worldRef !== this.#worldRef || result.worldeditAvailable !== true ||
        result.scope !== 'WORLD_BUILD_WITH_ENGINE_PROTECTION' ||
        typeof result.grantRef !== 'string' || !result.grantRef)
      throw fault('CONNECTION_UNAUTHORIZED');
    return { current: true, engineActorName, worldRef: this.#worldRef,
      scope: result.scope, grantRef: result.grantRef };
  }

  async listCurrentGrants() {
    const result = await this.#dispatch('list_grants', {});
    if (!Array.isArray(result?.grants)) throw fault('CONNECTION_UNAUTHORIZED');
    const seen = new Set();
    return result.grants.map(proof => {
      if (proof?.current !== true || proof.worldRef !== this.#worldRef ||
          typeof proof.engineActorName !== 'string' || !proof.engineActorName ||
          proof.scope !== 'WORLD_BUILD_WITH_ENGINE_PROTECTION' ||
          typeof proof.grantRef !== 'string' || !proof.grantRef ||
          seen.has(proof.engineActorName)) throw fault('CONNECTION_UNAUTHORIZED');
      seen.add(proof.engineActorName);
      return { current: true, worldRef: this.#worldRef, engineActorName: proof.engineActorName,
        scope: proof.scope, grantRef: proof.grantRef };
    });
  }

  readStateProfile(binding) {
    return this.#dispatch('fact_profile', this.#actor(binding));
  }
  checkCapacity(cellCount, binding) {
    if (!Number.isSafeInteger(cellCount) || cellCount < 0) throw fault('CAPABILITY_UNAVAILABLE');
    return this.#dispatch('fact_capacity', { ...this.#actor(binding), cellCount });
  }
  readCatalogue(binding) {
    return this.#dispatch('fact_catalogue', this.#actor(binding));
  }
  readWorldRevision(binding) {
    return this.#dispatch('fact_world_revision', this.#actor(binding));
  }
  readObjectRevisions(objectRefs, binding) {
    if (!Array.isArray(objectRefs) || objectRefs.some(ref => typeof ref !== 'string' || !ref))
      throw fault('CAPABILITY_UNAVAILABLE');
    return this.#dispatch('fact_object_revisions', { ...this.#actor(binding), objectRefs });
  }

  async presentFrame(engineActorName, frame) {
    if (!this.#onAction) throw fault('RENDERER_CAPABILITY_UNAVAILABLE');
    if (typeof engineActorName !== 'string' || !engineActorName ||
        typeof frame?.sessionRef !== 'string' || !Array.isArray(frame.actions))
      throw fault('INVALID_FRAME');
    const proof = await this.verifyPrincipal(engineActorName);
    this.#actionFrames.set(engineActorName,
      { frame: structuredClone(frame), grantRef: proof.grantRef });
    let result;
    try { result = await this.#dispatch('present_frame', { engineActorName,
      grantRef: proof.grantRef, frame }); }
    catch (error) { this.#actionFrames.delete(engineActorName); throw error; }
    if (result !== true) { this.#actionFrames.delete(engineActorName); throw fault('INVALID_FRAME'); }
    return true;
  }

  snapshot(request, binding) {
    return this.#dispatch('snapshot', { ...this.#actor(binding), action: 'INSPECT',
      positions: request.coveredPositions,
      ...(request.protectedPositions === undefined ? {} :
        { protectedPositions: request.protectedPositions }) });
  }
  inspect(positions, binding) {
    return this.#dispatch('inspect', { ...this.#actor(binding), action: 'INSPECT',
      positions });
  }
  prepareCheck(positions, binding) {
    return this.#dispatch('prepare_check', { ...this.#actor(binding),
      action: 'APPLY_RECOVERABLE', positions });
  }
  inspectRegion(args, binding) {
    return this.#dispatch('inspect_region', { ...args, ...this.#actor(binding),
      action: 'INSPECT' });
  }
  apply(request, prepared, binding) {
    return this.#dispatch('apply', { ...this.#actor(binding), action: 'APPLY_RECOVERABLE',
      effects: request.effects, beforeImage: prepared.beforeImage,
      ...(request.scopeBeforeImage === undefined ? {} :
        { scopeBeforeImage: request.scopeBeforeImage }),
      prepared: { status: 'PREPARED', operationDigest: prepared.operationDigest },
      operationDigest: request.operationDigest });
  }
  applyState(request, targetImage, beforeImage, binding) {
    return this.#dispatch('apply_state', { ...this.#actor(binding),
      action: 'APPLY_RECOVERABLE', targetImage, beforeImage,
      prepared: { status: 'PREPARED', operationDigest: request.operationDigest },
      operationDigest: request.operationDigest });
  }
  readback(request, binding) {
    return this.#dispatch('readback', { ...this.#actor(binding), action: 'READBACK',
      positions: request.coveredPositions,
      ...(request.protectedPositions === undefined ? {} :
        { protectedPositions: request.protectedPositions }) });
  }
  restore(recovery, beforeImage) {
    return this.#dispatch('restore', { serviceName: this.#serviceName, action: 'RESTORE',
      beforeImage, recovery });
  }

  async close() {
    this.#closed = true;
    for (const entry of [...this.#queued, ...this.#inFlight.values()]) {
      clearTimeout(entry.timeout);
      entry.reject(fault('ENGINE_RESPONSE_UNKNOWN'));
    }
    this.#queued = [];
    this.#inFlight.clear();
    await new Promise(resolve => this.#server.close(resolve));
  }
}
