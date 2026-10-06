import { open, rename, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Fresh per-world durable before images and outcomes. No authority state. */
export class LocalRecords {
  static async open(directory, worldRef) {
    const file = join(directory, 'local-world-state');
    let data;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SAVED_RESOURCE_UNAVAILABLE');
      data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== '0.4.0' || data.worldRef !== worldRef) throw new Error('CURRENT_WORLD_MISMATCH');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      data = { version: '0.4.0', worldRef, transactions: {}, requests: {} };
    }
    return new LocalRecords(directory, data);
  }
  constructor(directory, data) { this.directory = directory; this.data = data; }
  async save(next) {
    const file = join(this.directory, `pending-${randomUUID()}`);
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(file, join(this.directory, 'local-world-state'));
    const dir = await open(this.directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    this.data = next;
  }
  async put(transaction) {
    await this.save({ ...this.data, transactions: { ...this.data.transactions,
      [transaction.transactionId]: structuredClone(transaction) } });
  }
  get(id) { return structuredClone(Object.hasOwn(this.data.transactions, id) ? this.data.transactions[id] : null); }
  request(key) { return structuredClone(Object.hasOwn(this.data.requests, key) ? this.data.requests[key] : null); }
  async finish(key, digest, response) {
    await this.save({ ...this.data, requests: { ...this.data.requests,
      [key]: { digest, response: structuredClone(response) } } });
  }
}
