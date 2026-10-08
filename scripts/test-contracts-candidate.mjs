// Install a supplied, byte-checked contracts candidate in an isolated testing copy.
// This does not modify source pins/vendor and never downloads or publishes a package.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const [archiveArg, sha, runArg] = process.argv.slice(2);
if (!archiveArg || !/^[a-f0-9]{64}$/.test(sha ?? '') || !runArg) throw Error('Usage: test-contracts-candidate.mjs <pack> <sha256> <fresh-own-run>');
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..'), archive = resolve(archiveArg), run = resolve(runArg);
if (run === source || run.startsWith(source + '/') || existsSync(run)) throw Error('FRESH_ISOLATED_TEST_RUN_REQUIRED');
const bytes = readFileSync(archive), actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== sha) throw Error('CONTRACTS_PACK_DIGEST_MISMATCH');
mkdirSync(run, { recursive: true, mode: 0o700 });
for (const name of ['src', 'payload', 'test', 'dev']) cpSync(join(source, name), join(run, name), { recursive: true });
mkdirSync(join(run, 'node_modules/hanaworlds-contracts'), { recursive: true });
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', join(run, 'node_modules/hanaworlds-contracts')]);
cpSync(join(source, 'node_modules/canonicalize'), join(run, 'node_modules/canonicalize'), { recursive: true });
const pkg = JSON.parse(readFileSync(join(source, 'package.json'))), contracts = JSON.parse(readFileSync(join(run, 'node_modules/hanaworlds-contracts/package.json')));
pkg.imports = { '#contracts': 'hanaworlds-contracts' };
writeFileSync(join(run, 'package.json'), JSON.stringify(pkg, null, 2));
mkdirSync(join(run, 'tmp'), { mode: 0o700 });
const tests = ['local-world-current', 'local-world-v6', 'local-catalogue', 'local-region-io', 'local-flat-world',
  'local-material-facts', 'local-material-sources', 'local-world-switch', 'local-world-delete', 'local-region-state',
  'world-readback-surface', 'world-manage', 'local-contract-handshake'].map(name => `test/${name}.test.mjs`);
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: run, encoding: 'utf8',
  env: { ...process.env, TMPDIR: join(run, 'tmp'), HW_EXPECT_CONTRACTS: `${contracts.name}@${contracts.version}` } });
writeFileSync(join(run, 'stdout.log'), result.stdout ?? ''); writeFileSync(join(run, 'stderr.log'), result.stderr ?? '');
const receipt = { archive, sha256: actual, bytes: bytes.length, exactPackage: `${contracts.name}@${contracts.version}`,
  tests, testCopy: run, sourcePinsChanged: false, exitCode: result.status, error: result.error?.message ?? null };
writeFileSync(join(run, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); console.log(JSON.stringify(receipt));
process.exitCode = result.status ?? 1;
