// Walk the own Stage 1 fact page in real headless Chrome over CDP (no npm dependency):
// the six USER_CHECKLIST steps by clicking the page, one screenshot per step.
// usage: node browser-walk.mjs <url> <evidence dir> <chrome profile dir>
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [url, out, profileDir] = process.argv.slice(2);
if (!url || !out || !profileDir) throw Error('usage: browser-walk.mjs <url> <evidence dir> <chrome profile dir>');
await mkdir(out, { recursive: true }); await mkdir(profileDir, { recursive: true });
await rm(join(profileDir, 'DevToolsActivePort'), { force: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,1300', 'about:blank'], { stdio: 'ignore' });
const steps = []; let ws;
try {
  let port;
  for (;;) {
    const s = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').catch(() => null);
    if (s) { port = Number(s.split('\n')[0]); break; }
    if (chrome.exitCode !== null) throw Error('CHROME_EXITED');
    await new Promise(y => setTimeout(y, 100));
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((y, n) => { ws.onopen = y; ws.onerror = n; });
  let id = 0; const waiting = new Map();
  ws.onmessage = m => { const v = JSON.parse(m.data); if (v.id && waiting.has(v.id)) { waiting.get(v.id)(v); waiting.delete(v.id); } };
  const cdp = (method, params = {}) => new Promise((y, n) => { const k = ++id; waiting.set(k, v => v.error ? n(Error(JSON.stringify(v.error))) : y(v.result)); ws.send(JSON.stringify({ id: k, method, params })); });
  const evaluate = async expression => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const settle = () => new Promise(y => setTimeout(y, 700));
  const click = async sel => { await evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`); await settle(); };
  const shot = async (n, title) => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = join(out, `step-${n}.png`); await writeFile(file, Buffer.from(data, 'base64'));
    const status = await evaluate(`document.getElementById('status').textContent`);
    const output = await evaluate(`document.getElementById('out').textContent`);
    const ledger = await evaluate(`[...document.querySelectorAll('#ledger tr')].map(r => r.textContent)`);
    const banner = await evaluate(`document.getElementById('banner').textContent`);
    steps.push({ step: n, title, screenshot: file, status, banner, ledger, output: output ? JSON.parse(output) : null });
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.navigate', { url }); await settle();
  // Step 1: open, connect the World, read the envelope.
  await click('#connect'); await click('#readAvatar'); await shot(1, 'connect + read envelope (single standing player)');
  // Step 2: same player sneaks.
  await click('input[value="one-sneaking"]'); await click('#readAvatar'); await shot(2, 'sneaking box → new revision, previous retired');
  // Step 3: no player / two players.
  await click('input[value="none"]'); await click('#readAvatar'); await shot('3a', 'no player → named refusal');
  await click('input[value="two"]'); await click('#readAvatar'); await shot('3b', 'two players → named refusal');
  // Step 4: WorldEdit facts.
  await click('#readWE'); await shot('4a', 'WorldEdit loaded, version 1.3');
  await click('input[value="version-hidden"]'); await click('#readWE'); await shot('4b', 'WorldEdit version not exposed → UNKNOWN');
  // Step 5: disconnect → everything retired, reads refused.
  await click('#disconnect'); await click('#readAvatar'); await shot(5, 'disconnect → WORLD_NOT_BOUND, ledger retired');
  // Step 6: reconnect → new incarnation, standing player again.
  await click('input[value="one-standing"]'); await click('input[value="version-exposed"]');
  await click('#connect'); await click('#readAvatar'); await shot(6, 'reconnect → new domain/revision');
  // Leave the service at its initial state for the owner.
  await click('#disconnect');
  await writeFile(join(out, 'walk.json'), JSON.stringify({ url, at: new Date().toISOString(), steps }, null, 1));
  console.log(JSON.stringify(steps.map(s => ({ step: s.step, status: s.status })), null, 1));
} finally { ws?.close(); chrome.kill(); }
