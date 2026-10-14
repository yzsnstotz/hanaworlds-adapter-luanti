import { randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat as nativeLstat, readFile as nativeReadFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { payloadDigest } from './local-worlds.mjs';
import { PAYLOAD_VERSION } from './version.mjs';
import { validateTransportSettings, validatePairedTransportSettings, transportPolicy, BATCH_ENVELOPE_RESERVE_BYTES } from './transport-policy.mjs';
import { resourceFailure, ioKind } from './resource-errors.mjs';
import { sameGuards } from './safety-capabilities.mjs';
import { sourceRead, checkSourceScope } from './source-scope.mjs';
const lstat = (...args) => sourceRead(() => nativeLstat(...args));
const readFile = (...args) => sourceRead(() => nativeReadFile(...args));


/** Private loopback transport; no model/Canvas public HTTP mutator. */
export class LocalCourier {
  static async open(world, settings = {}) {
    const dir = join(world.worldPath, 'worldmods/hanaworlds_adapter');
    for (const name of ['payload.json', 'transport.json']) {
      let s; try {s = await lstat(join(dir,name));} catch(error) {throw resourceFailure('ADAPTER_UNAVAILABLE','pair',name==='payload.json'?'payload-identity':'courier-config',ioKind(error),error);}
      if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077)) throw resourceFailure('CURRENT_WORLD_MISMATCH','pair',name==='payload.json'?'payload-identity':'courier-config','UNSAFE_PATH');
    }
    const readJSON=async(name,resource)=>{
      let raw; try {raw=await readFile(join(dir,name),'utf8');} catch(error) {throw resourceFailure('ADAPTER_UNAVAILABLE','pair',resource,ioKind(error),error);}
      try {const value=JSON.parse(raw); if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
      catch(error) {throw resourceFailure('PAYLOAD_VERSION_MISMATCH','pair',resource,'CORRUPT');}
    };
    const manifest = await readJSON('payload.json','payload-identity');
    const config = await readJSON('transport.json','courier-config');
    if (manifest.payloadVersion !== PAYLOAD_VERSION || manifest.payloadDigest !== await payloadDigest() ||
      manifest.worldRef !== world.worldRef || config.worldRef !== manifest.worldRef ||
      !/^[0-9a-f]{64}$/.test(config.token) || !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535)
      throw new Error('PAYLOAD_VERSION_MISMATCH');
    const expected = validateTransportSettings(settings);
    const actual = validatePairedTransportSettings(config.settings);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw resourceFailure('PAYLOAD_VERSION_MISMATCH','pair','courier-settings','INVALID_CONFIG');
    await checkSourceScope();
    const self = new LocalCourier(manifest, config);
    self.server = createServer(async (req, res) => {
      const reply = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      const address = req.socket.remoteAddress;
      const raw = req.headers.authorization?.slice(7);
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(address) || !req.headers.authorization?.startsWith('Bearer ') ||
        !/^[0-9a-f]{64}$/.test(raw ?? '') || !timingSafeEqual(Buffer.from(raw, 'hex'), self.token)) return reply(403, {});
      if (req.method === 'GET' && req.url === '/poll') {
        const entry = self.queue.shift();
        if (entry) self.pending.set(entry.command.id, entry);
        return reply(200, { worldRef: manifest.worldRef, command: entry?.command ?? null });
      }
      if (req.method !== 'POST' || req.url !== '/result') return reply(404, {});
      let length = 0; const chunks = [];
      try { for await (const chunk of req) { length += chunk.length; if (length > self.settings.courierBodyBytes) return reply(413, {error:'LIMIT_EXCEEDED',source:'courier-result-body'}); chunks.push(chunk); } }
      catch { return reply(400, {error:'CAPABILITY_UNAVAILABLE',source:'courier-result-io'}); }
      let value; try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); } catch { return reply(400, {error:'SCHEMA_INVALID',source:'courier-result-decode'}); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, {error:'SCHEMA_INVALID'});
      if (value.worldRef !== manifest.worldRef) return reply(409, {});
      const entry = self.pending.get(value.id); if (!entry) return reply(409, {});
      self.pending.delete(value.id); clearTimeout(entry.timer);
      if (value.error) {
        // detail names the engine guard that refused (BODY_OCCUPIED, PROTECTED_CELL, PLAYER_ENCLOSED, ...).
        const error = new Error(value.error); if (typeof value.detail === 'string') error.detail = value.detail;
        if (['COURIER_RESULT_BODY','COURIER_COMMAND_BODY'].includes(value.detail)) error.source = {owner:'world-source',operation:entry.command.operation,resource:value.detail === 'COURIER_COMMAND_BODY'?'courier-command-body':'courier-result-body',kind:'LIMIT',nativeCode:null};
        if (value.detail === 'COURIER_COMMAND_BODY') error.beforeNativeDispatch = true;
        entry.reject(error);
      } else entry.resolve(value.result);
      reply(200, { status: 'RECEIVED' });
    });
    try {
      await checkSourceScope();
      await new Promise((yes, no) => { self.server.once('error', no); self.server.listen(config.port, '127.0.0.1', yes); });
      await checkSourceScope();
      return self;
    } catch (error) {
      if (self.server.listening) await self.close();
      throw error;
    }
  }
  constructor(manifest, config) {
    this.settings = validateTransportSettings(config.settings === undefined ? {} : config.settings);
    this.manifest = manifest; this.token = Buffer.from(config.token, 'hex');
    this.connectionIncarnationRef = randomUUID(); this.queue = []; this.pending = new Map(); this.closed = false;
  }
  dispatch(operation, input = {}) {
    if (this.closed) return Promise.reject(new Error('ADAPTER_UNAVAILABLE'));
    const command = { ...input, id: randomUUID(), operation, worldRef: this.manifest.worldRef };
    const pollBody = JSON.stringify({worldRef:this.manifest.worldRef, command});
    if (Buffer.byteLength(pollBody) > this.settings.courierBodyBytes) return Promise.reject(Object.assign(
      resourceFailure('LIMIT_EXCEEDED',operation,'courier-command-body','LIMIT'), {beforeNativeDispatch:true}));
    return new Promise((resolve, reject) => {
      const entry = { command: JSON.parse(pollBody).command, resolve, reject };
      entry.timer = setTimeout(() => {
        this.queue = this.queue.filter(x => x !== entry); this.pending.delete(entry.command.id);
        reject(resourceFailure('RECOVERY_PENDING',operation,'courier-result-wait','WAIT_EXPIRED'));
      }, this.settings.courierResultWaitMs);
      this.queue.push(entry);
    });
  }
  async handshake() {
    const h = await this.dispatch('handshake');
    if (h.worldRef !== this.manifest.worldRef || h.payloadVersion !== PAYLOAD_VERSION || h.payloadMatches !== true ||
      h.loadedSourceDigest !== this.manifest.payloadDigest) throw new Error('PAYLOAD_VERSION_MISMATCH');
    // The advertised safety capabilities hold only if this engine runs every guard
    // (e.g. no core.is_protected => perCellProtection false): such a world is not paired.
    if (!sameGuards(h.engineGuards)) throw new Error('CAPABILITY_UNAVAILABLE');
    if (!h.transportSettings || JSON.stringify(validatePairedTransportSettings(h.transportSettings)) !== JSON.stringify(this.settings))
      throw resourceFailure('PAYLOAD_VERSION_MISMATCH','handshake','courier-settings','INVALID_CONFIG');
    this.engineGuards = h.engineGuards;
    return h;
  }
  snapshot(positions) { return this.dispatch('snapshot', { positions }); }
  readback(positions) { return this.dispatch('readback', { positions }); }
  inspect(positions) { return this.dispatch('inspect', { positions }); }
  inspectRegion(value) { return this.dispatch('inspect_region', value); }
  /** effects ({position,nodeName}) make the engine run its enclosure guard as well. */
  prepareCheck(positions, effects) { return this.dispatch('prepare_check', effects ? { positions, effects } : { positions }); }
  profile() { return this.dispatch('fact_profile'); }
  catalogue() { return this.dispatch('fact_catalogue'); }
  writePath() { return this.dispatch('fact_write_path'); }
  materialMetadata() { return this.dispatch('fact_material_metadata'); }
  writeBackend() { return this.dispatch('fact_write_backend'); }
  sourceDeclaration() { return this.dispatch('fact_world_source'); }
  capacity(cellCount) { return this.dispatch('fact_capacity', { cellCount }); }
  async regionLimits() {
    const limits = await this.dispatch('region_limits');
    if (limits.maxBodyBytes !== this.settings.courierBodyBytes) throw resourceFailure('PAYLOAD_VERSION_MISMATCH','region_limits','courier-settings','INVALID_CONFIG');
    return {...limits, envelopeReserveBytes:BATCH_ENVELOPE_RESERVE_BYTES};
  }
  transportPolicy() { return transportPolicy(this.settings); }
  regionEmerge(min, max, geometry) { return this.dispatch('region_emerge', { min, max, ...geometry }); }
  regionRead(args) { return this.dispatch('region_read', args); }
  regionWrite(batch) { return this.dispatch('region_write', batch); }
  apply(effects, beforeImage, scopeBeforeImage, operationDigest) {
    return this.dispatch('apply', { effects, beforeImage, scopeBeforeImage, operationDigest,
      prepared: { status: 'PREPARED', operationDigest } });
  }
  applyState(targetImage, beforeImage, operationDigest) {
    return this.dispatch('apply_state', { targetImage, beforeImage, operationDigest,
      prepared: { status: 'PREPARED', operationDigest } });
  }
  restore(beforeImage, transactionId) {
    return this.dispatch('restore', { beforeImage, recovery: { status: 'RESTORING', transactionId } });
  }
  async close() {
    this.closed = true;
    for (const e of [...this.queue, ...this.pending.values()]) { clearTimeout(e.timer); e.reject(new Error('RECOVERY_PENDING')); }
    this.queue = []; this.pending.clear();
    await new Promise(yes => this.server.close(yes));
  }
}
