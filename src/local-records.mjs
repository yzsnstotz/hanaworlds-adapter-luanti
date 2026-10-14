import { open, rename, readFile as nativeReadFile, lstat as nativeLstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { resourceFailure, ioKind } from './resource-errors.mjs';
import { sourceRead, sourceWrite } from './source-scope.mjs';
const lstat = (...args) => sourceRead(() => nativeLstat(...args));
const readFile = (...args) => sourceRead(() => nativeReadFile(...args));

/** Fresh per-world durable before images and outcomes. No authority state. */
export class LocalRecords {
  static async open(directory, worldRef) {
    const file = join(directory, 'local-world-state');
    let data, observed=false;
    try {
      const stat = await lstat(file); observed=true;
      if (!stat.isFile() || stat.isSymbolicLink()) throw resourceFailure('SAVED_RESOURCE_UNAVAILABLE','storage-read','transaction-journal','UNSAFE_PATH');
      const raw=await readFile(file,'utf8');
      try { data=JSON.parse(raw); } catch(error) { throw resourceFailure('SAVED_RESOURCE_UNAVAILABLE','storage-read','transaction-journal','CORRUPT',error); }
      validateRecordData(data,worldRef);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error.source ? error : resourceFailure(error.message==='CURRENT_WORLD_MISMATCH'?'CURRENT_WORLD_MISMATCH':'SAVED_RESOURCE_UNAVAILABLE','storage-read','transaction-journal',error.message==='CURRENT_WORLD_MISMATCH'?'VERSION':ioKind(error),error);
      if (observed) throw resourceFailure('SAVED_RESOURCE_UNAVAILABLE','storage-read','transaction-journal','NOT_FOUND',error);
      data = { version: 'contracts@2.0.0', worldRef, transactions: {}, requests: {} };
    }
    return new LocalRecords(directory, data);
  }
  constructor(directory, data) { this.directory = directory; this.data = data; }
  async save(next) {
    const file = join(this.directory, `pending-${randomUUID()}`);
    let handle, dir;
    try {
      await sourceWrite(async () => { handle = await open(file, 'wx', 0o600); });
      await sourceWrite(() => handle.writeFile(JSON.stringify(next))); await sourceWrite(() => handle.sync());
    } finally { if (handle) await handle.close(); }
    await sourceWrite(() => rename(file, join(this.directory, 'local-world-state')));
    try {
      await sourceRead(async () => { dir = await open(this.directory, 'r'); });
      await sourceWrite(() => dir.sync());
    } finally { if (dir) await dir.close(); }
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

/** One read-side validity rule, also used for the deletion activity check. */
export function validateRecordData(data, worldRef) {
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  if (!object(data) || !object(data.transactions) || !object(data.requests) ||
      Object.values(data.transactions).some(t=>!object(t)||typeof t.transactionId!=='string'||typeof t.status!=='string') ||
      Object.values(data.requests).some(r=>!object(r)||typeof r.digest!=='string'||!object(r.response)))
    throw resourceFailure('SAVED_RESOURCE_UNAVAILABLE','storage-read','transaction-journal','CORRUPT');
  if (data.version !== 'contracts@2.0.0' || data.worldRef !== worldRef)
    throw resourceFailure('CURRENT_WORLD_MISMATCH','storage-read','transaction-journal','VERSION');
  return data;
}
