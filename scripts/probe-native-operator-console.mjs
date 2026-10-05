// Diagnostic only. No operator proof is issued and no Adapter payload installed.
// Run at project root; all disposable state belongs to this card's cache.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
if (resolve(process.cwd()) !== project) throw new Error('PROJECT_ROOT_REQUIRED');
const base = join(homedir(), '.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01');
const evidence = join(base, '_evidence');
const engine = process.env.HW_LUANTI_BIN || '/Applications/luanti.app/Contents/MacOS/luanti';
await mkdir(evidence, { recursive: true });
const run = await mkdtemp(join(base, 'native-console-probe-'));
const world = join(run, 'profile/worlds/Operator Capability Probe');
await mkdir(world, { recursive: true });
await mkdir(join(run, 'profile/games/hw_operator_probe'), { recursive: true });
await writeFile(join(run, 'profile/games/hw_operator_probe/game.conf'),
  'title = HanaWorlds native operator capability probe\n');
await writeFile(join(world, 'world.mt'), 'gameid = hw_operator_probe\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n');
const config = join(run, 'luanti.conf');
await writeFile(config, 'bind_address = 127.0.0.1\nport = 0\nserver_announce = false\n');
let log = '', consoleUnavailable = false;
const child = spawn(engine, ['--server', '--terminal', '--world', world,
  '--config', config, '--logfile', ''], {
  env: { ...process.env, LUANTI_USER_PATH: join(run, 'profile') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const receive = bytes => {
  log += bytes.toString();
  if (!consoleUnavailable && log.includes('compiled without ncurses')) {
    consoleUnavailable = true;
    child.kill('SIGINT');
  }
};
child.stdout.on('data', receive);
child.stderr.on('data', receive);
// A bounded diagnostic terminates only its own child. Expiry is unknown,
// never a successful operator proof or a substitute for engine readiness.
const timer = setTimeout(() => child.kill('SIGINT'), 8000);
let result;
try {
  result = await new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => ok({ code, signal }));
  });
} finally { clearTimeout(timer); }
await writeFile(join(evidence, 'native-console-capability.log'), log);
const summary = {
  engine, engineSha256: createHash('sha256').update(await readFile(engine)).digest('hex'),
  consoleUnavailable, result,
  source: 'REAL_LUANTI_PROCESS_DIAGNOSTIC',
  operatorProofIssued: false, adapterPayloadInstalled: false,
  credentialsReadOrCreated: false,
  capability: consoleUnavailable ? 'NATIVE_OPERATOR_CONSOLE_UNAVAILABLE' : 'INDETERMINATE',
};
await writeFile(join(evidence, 'native-console-capability.json'), JSON.stringify(summary, null, 2) + '\n');
await rm(run, { recursive: true });
console.log(JSON.stringify(summary));
// This is a failed prerequisite; never render it as a successful component gate.
process.exitCode = 1;
