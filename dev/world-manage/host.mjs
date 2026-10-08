import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const fail = code => { throw Error(code); };
async function port() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const value = server.address().port; await new Promise(yes => server.close(yes)); return value;
}
// Real process owner for this isolated development environment. No product profile is used.
// Native STOPPED truth is from our child exit event, retained for repeated exact callbacks.
export function createNativeHost({ C, state, profile, worlds, luanti, event }) {
  const records = new Map(); let client = null;
  const environment = { ...process.env, HOME: profile, LUANTI_USER_PATH: profile,
    XDG_CACHE_HOME: join(profile, 'cache'), TMPDIR: join(state, 'tmp') };
  async function foreignActivity(path) {
    if (dirname(path) !== worlds || await realpath(path) !== path || !(await lstat(path)).isDirectory()) fail('CONNECTION_NOT_FOUND');
    const ours = new Set([...records.values()].filter(r => !r.exit).map(r => r.child.pid));
    if (client && !client.exit) ours.add(client.child.pid);
    const observed = new Map();
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,comm=']);
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match || !/luanti|minetest/i.test(match[2]) || ours.has(Number(match[1]))) continue;
      let args;
      try { args = (await exec('/bin/ps', ['-p', match[1], '-o', 'args='])).stdout; }
      catch (e) { if (e.code === 1 && !e.stderr) continue; throw Error('REQUIRED_FACT_UNKNOWN'); }
      if (args.includes(path)) observed.set(Number(match[1]), { pid: Number(match[1]), worldPath: path, source: 'PROCESS_ARGUMENTS' });
    }
    let opened;
    try { opened = await exec('/usr/sbin/lsof', ['-nP', '-Fpn', '+D', path]); }
    catch (e) { if (e.code !== 1 || e.stderr) fail('REQUIRED_FACT_UNKNOWN'); opened = { stdout: e.stdout ?? '', stderr: '' }; }
    if (opened.stderr) fail('REQUIRED_FACT_UNKNOWN');
    let pid;
    for (const line of opened.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      if (line.startsWith('n') && pid && pid !== process.pid && !ours.has(pid))
        observed.set(pid, { pid, worldPath: path, source: 'OPEN_WORLD_FILE' });
    }
    return [...observed.values()];
  }
  function record(q) {
    C.validateType('NativeControlQuery', q);
    const r = records.get(q.controlRef);
    if (!r || ['worldPath', 'requesterRef', 'operationRef'].some(k => q[k] !== r.input[k])) fail('CURRENT_WORLD_MISMATCH');
    return r;
  }
  async function stopped(r) {
    if (!r.exit) { const done = once(r.child, 'exit'); if (!r.child.kill('SIGINT')) fail('REQUIRED_FACT_UNKNOWN'); await done; }
    if (r.exit.code !== 0) fail('NATIVE_STOP_FAILED');
  }
  const host = {
    async acquire(input) {
      C.validateType('NativeControlInput', input);
      if (input.userPath !== profile || dirname(input.worldPath) !== worlds || await realpath(input.worldPath) !== input.worldPath) fail('DEV_HOST_WORLD_OUTSIDE_ROOT');
      if ([...records.values()].some(r => !r.exit && r.input.worldPath === input.worldPath) || (await foreignActivity(input.worldPath)).length) fail('WORLD_IN_USE');
      const id = randomUUID(), logfile = join(state, 'logs', `server-${id}.log`), config = join(state, 'logs', `server-${id}.conf`), serverPort = await port();
      await writeFile(config, `port = ${serverPort}\nbind_address = 127.0.0.1\nsecure.http_mods = hanaworlds_adapter\nserver_announce = false\ncreative_mode = true\nenable_damage = false\n`, { mode: 0o600 });
      const argv = ['--server', '--world', input.worldPath, '--config', config, '--logfile', logfile];
      const child = spawn(luanti, argv, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      const r = { input, child, config, logfile, serverPort, argv, exit: null };
      const controlRef = `dev-world-host:${id}`; records.set(controlRef, r);
      let ready = false, output = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data.toString(); if (output.includes(' listening on ')) ready = true; });
      child.once('error', error => { r.exit = { code: null, error: error.message }; });
      child.on('exit', (code, signal) => { r.exit = { code, signal }; event('NATIVE_EXIT', { pid: child.pid, worldPath: input.worldPath, code, signal }); });
      event('NATIVE_START', { controlRef, pid: child.pid, worldPath: input.worldPath, operationRef: input.operationRef, logfile, serverPort });
      while (!ready) {
        if (r.exit) fail('LUANTI_EARLY_EXIT');
        await new Promise(yes => setTimeout(yes, 100));
        const text = await readFile(logfile, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
        ready = text.includes(' listening on ');
      }
      return { controlRef, worldPath: input.worldPath };
    },
    async inspect(q) {
      const r = record(q); if (r.exit) fail('CURRENT_WORLD_MISMATCH'); process.kill(r.child.pid, 0);
      return C.validateType('NativeControlEvidence', { state: 'CURRENT', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef });
    },
    async withStoppedWorld(q, consume) {
      const r = record(q); await stopped(r);
      if ((await foreignActivity(r.input.worldPath)).length) fail('WORLD_IN_USE');
      const evidence = C.validateType('NativeControlEvidence', { state: 'STOPPED', worldPath: r.input.worldPath, processId: r.child.pid, operationRef: r.input.operationRef });
      event('HOST_STOPPED_CALLBACK', { ...evidence, controlRef: q.controlRef }); return consume(evidence);
    },
  };
  const game = {
    running: () => !!client && !client.exit,
    async enter(current) {
      if (this.running()) fail('GAME_CLIENT_RUNNING');
      const r = [...records.values()].find(r => !r.exit && r.child.pid === current.nativeProcessId && r.input.worldPath === current.worldPath);
      if (!r) fail('CURRENT_WORLD_MISMATCH');
      const logfile = join(state, 'logs', `client-${randomUUID()}.log`);
      const child = spawn(luanti, ['--go', '--address', '127.0.0.1', '--port', String(r.serverPort), '--name', 'world-manager', '--logfile', logfile],
        { env: environment, stdio: 'ignore' });
      client = { child, exit: null, worldPath: current.worldPath, logfile }; const owned = client;
      child.once('error', error => { owned.exit = { error: error.message }; });
      child.once('exit', (code, signal) => { owned.exit = { code, signal }; event('GAME_EXIT', { pid: child.pid, code, signal, worldPath: owned.worldPath }); });
      event('GAME_START', { pid: child.pid, serverPid: r.child.pid, serverPort: r.serverPort, worldPath: current.worldPath, logfile });
      return { started: true, pid: child.pid, serverPid: r.child.pid, serverPort: r.serverPort, worldPath: current.worldPath, logfile };
    },
  };
  return { host, game, foreignActivity, records,
    async shutdown() {
      if (game.running()) { const done = once(client.child, 'exit'); client.child.kill('SIGINT'); await done; }
      for (const r of records.values()) await stopped(r);
    } };
}
