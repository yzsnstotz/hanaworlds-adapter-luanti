// CP-S1-02 repair: the Adapter journal lives under the native DSH home
// (ctx.get('dshHomePath')), stable per world, and fails closed otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeJournalDirectory } from '../src/native-storage.mjs';
import { DurableJournal } from '../src/journal.mjs';

// Same shape as @deepseek-ai/dsh-home-paths dshHomePath(...segments).
const homeOf = root => (...segments) => join(root, ...segments);
async function freshHome() { return realpath(await mkdtemp(join(tmpdir(), 'hw-dsh-home-'))); }
const keyOf = worldRef => createHash('sha256').update(worldRef).digest('hex');
const journalPath = (home, worldRef) =>
  join(home, 'data', 'hanaworlds-adapter-luanti', 'journal', keyOf(worldRef));
const image = { worldRef: 'luanti:one', worldRevision: 'r1', coveredPositions: [[0, 0, 0]],
  records: [{ position: [0, 0, 0], nodeName: 'air', param1: 0, param2: 0, metadata: {},
    inventory: {}, timer: null }], stateProfile: { profileVersion: 'state-profile/v2' } };

test('stable per-world journal under DSH_HOME/data survives restart and plugin reinstall', async () => {
  const home = await freshHome();
  const env = { DSH_HOME: home };
  const first = await nativeJournalDirectory(homeOf(home), 'luanti:one', env);
  assert.equal(first, journalPath(home, 'luanti:one'));
  assert.equal((await readFile(join(first, 'world-binding'), 'utf8')).includes('"luanti:one"'), true);
  const journal = await DurableJournal.open(first);
  await journal.prepare({ transactionId: 'tx-1', operationDigest: 'a'.repeat(64),
    transactionPayloadDigest: 'b'.repeat(64), beforeImageDigest: 'c'.repeat(64), beforeImage: image,
    beforeStateReadbackDigest: 'd'.repeat(64) });
  // Restart / remove-reinstall of the plugin package: DSH_HOME/data is untouched,
  // the same world resolves to the same directory and its records.
  const again = await nativeJournalDirectory(homeOf(home), 'luanti:one', env);
  assert.equal(again, first);
  const reopened = await DurableJournal.open(again);
  assert.equal(reopened.query('tx-1').status, 'PREPARED');
  assert.equal(reopened.query('tx-1').beforeStateReadbackDigest, 'd'.repeat(64));
  const other = await nativeJournalDirectory(homeOf(home), 'luanti:two', env);
  assert.notEqual(other, first);
  assert.deepEqual(await readdir(other), ['world-binding']);
  // With DSH_HOME unset, the native seam's own resolution is used as-is.
  assert.equal(await nativeJournalDirectory(homeOf(home), 'luanti:one', {}), first);
});

test('invalid, missing or outside DSH home paths fail closed without writing', async () => {
  const home = await freshHome();
  const env = { DSH_HOME: home };
  const refuse = async (homePath, worldRef, environment, label) =>
    assert.rejects(() => nativeJournalDirectory(homePath, worldRef, environment),
      error => error.message === 'ADAPTER_STORAGE_UNAVAILABLE' && typeof error.reason === 'string', label);
  await refuse(undefined, 'luanti:one', env, 'seam absent');
  await refuse(homeOf(home), '', env, 'worldRef missing');
  await refuse(() => 'relative/home', 'luanti:one', {}, 'relative root');
  await refuse(() => `${home}/../${home.split('/').pop()}`, 'luanti:one', {}, 'non-normalized root');
  await refuse(homeOf(home), 'luanti:one', { DSH_HOME: `${home}-other` }, 'DSH_HOME mismatch');
  await refuse((...s) => s.length ? join(tmpdir(), ...s) : home, 'luanti:one', env, 'joins outside home');
  const missing = join(home, 'not-created');
  await refuse(homeOf(missing), 'luanti:one', { DSH_HOME: missing }, 'home missing');
  assert.deepEqual(await readdir(home), [], 'nothing was written for any refusal');

  const linkedHome = `${home}-link`;
  await symlink(home, linkedHome);
  await refuse(homeOf(linkedHome), 'luanti:one', { DSH_HOME: linkedHome }, 'home is a symlink');

  const outside = await freshHome();
  await symlink(outside, join(home, 'data'));
  await refuse(homeOf(home), 'luanti:one', env, 'data symlinked outside');
  assert.deepEqual(await readdir(outside), [], 'nothing written through the link');

  const home2 = await freshHome();
  await mkdir(join(home2, 'data', 'hanaworlds-adapter-luanti'), { recursive: true });
  await writeFile(join(home2, 'data', 'hanaworlds-adapter-luanti', 'journal'), 'not a directory');
  await refuse(homeOf(home2), 'luanti:one', { DSH_HOME: home2 }, 'journal is a file');
});

test('unreadable or foreign prior state is never adopted or replaced by a fresh identity', async () => {
  const home = await freshHome();
  const env = { DSH_HOME: home };
  const dir = await nativeJournalDirectory(homeOf(home), 'luanti:one', env);
  const marker = join(dir, 'world-binding');
  const refuse = (label) => assert.rejects(() => nativeJournalDirectory(homeOf(home), 'luanti:one', env),
    /ADAPTER_STORAGE_UNAVAILABLE/, label);
  await writeFile(marker, '{corrupt');
  await refuse('corrupt marker');
  await writeFile(marker, JSON.stringify({ format: 'hanaworlds-adapter-journal-world/1', worldRef: 'luanti:other' }));
  await refuse('marker for another world');
  // Records present but the binding marker lost: refuse rather than re-bind.
  const bare = journalPath(home, 'luanti:bare');
  await mkdir(bare, { recursive: true });
  await writeFile(join(bare, `${'e'.repeat(64)}.json`), '{}');
  await assert.rejects(() => nativeJournalDirectory(homeOf(home), 'luanti:bare', env),
    /ADAPTER_STORAGE_UNAVAILABLE/);
  assert.deepEqual(await readdir(bare), [`${'e'.repeat(64)}.json`], 'no marker written over records');
  // An unreadable transaction record keeps the journal closed (existing rule).
  const good = await nativeJournalDirectory(homeOf(home), 'luanti:three', env);
  await writeFile(join(good, `${createHash('sha256').update('tx-x').digest('hex')}.json`), '{oops');
  await assert.rejects(() => DurableJournal.open(good), /RECOVERY_PENDING/);
});
