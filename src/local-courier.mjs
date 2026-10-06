import { randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { payloadDigest } from './local-worlds.mjs';
import { PAYLOAD_VERSION } from './version.mjs';

/** Private loopback transport; no model/Canvas public HTTP mutator. */
export class LocalCourier {
  static async open(world) {
    const dir = join(world.worldPath, 'worldmods/hanaworlds_adapter');
    for (const name of ['payload.json', 'transport.json']) {
      const s = await lstat(join(dir, name));
      if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077)) throw new Error('CURRENT_WORLD_MISMATCH');
    }
    const manifest = JSON.parse(await readFile(join(dir, 'payload.json'), 'utf8'));
    const config = JSON.parse(await readFile(join(dir, 'transport.json'), 'utf8'));
    if (manifest.payloadVersion !== PAYLOAD_VERSION || manifest.payloadDigest !== await payloadDigest() ||
      manifest.worldRef !== world.worldRef || config.worldRef !== manifest.worldRef ||
      !/^[0-9a-f]{64}$/.test(config.token) || !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535)
      throw new Error('PAYLOAD_VERSION_MISMATCH');
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
      let bytes = ''; for await (const chunk of req) { bytes += chunk; if (Buffer.byteLength(bytes) > 4194304) return reply(413, {}); }
      let value; try { value = JSON.parse(bytes); } catch { return reply(400, {}); }
      if (value.worldRef !== manifest.worldRef) return reply(409, {});
      const entry = self.pending.get(value.id); if (!entry) return reply(409, {});
      self.pending.delete(value.id); clearTimeout(entry.timer);
      if (value.error) entry.reject(new Error(value.error)); else entry.resolve(value.result);
      reply(200, { status: 'RECEIVED' });
    });
    await new Promise((yes, no) => { self.server.once('error', no); self.server.listen(config.port, '127.0.0.1', yes); });
    return self;
  }
  constructor(manifest, config) {
    this.manifest = manifest; this.token = Buffer.from(config.token, 'hex');
    this.connectionIncarnationRef = randomUUID(); this.queue = []; this.pending = new Map(); this.closed = false;
  }
  dispatch(operation, input = {}) {
    if (this.closed) return Promise.reject(new Error('ADAPTER_UNAVAILABLE'));
    return new Promise((resolve, reject) => {
      const entry = { command: { ...input, id: randomUUID(), operation, worldRef: this.manifest.worldRef }, resolve, reject };
      entry.timer = setTimeout(() => {
        this.queue = this.queue.filter(x => x !== entry); this.pending.delete(entry.command.id);
        reject(new Error('RECOVERY_PENDING'));
      }, 30000);
      this.queue.push(entry);
    });
  }
  async handshake() {
    const h = await this.dispatch('handshake');
    if (h.worldRef !== this.manifest.worldRef || h.payloadVersion !== PAYLOAD_VERSION || h.payloadMatches !== true ||
      h.loadedSourceDigest !== this.manifest.payloadDigest || h.worldeditAvailable !== true) throw new Error('PAYLOAD_VERSION_MISMATCH');
    return h;
  }
  snapshot(positions) { return this.dispatch('snapshot', { positions }); }
  readback(positions) { return this.dispatch('readback', { positions }); }
  inspect(positions) { return this.dispatch('inspect', { positions }); }
  inspectRegion(value) { return this.dispatch('inspect_region', value); }
  prepareCheck(positions) { return this.dispatch('prepare_check', { positions }); }
  profile() { return this.dispatch('fact_profile'); }
  catalogue() { return this.dispatch('fact_catalogue'); }
  materialMetadata() { return this.dispatch('fact_material_metadata'); }
  capacity(cellCount) { return this.dispatch('fact_capacity', { cellCount }); }
  regionLimits() { return this.dispatch('region_limits'); }
  regionEmerge(min, max) { return this.dispatch('region_emerge', { min, max }); }
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
