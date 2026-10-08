// Evidence walk of the dev page in real headless Chrome over CDP (no extra npm dependency).
// Usage: node browser-walk.mjs <evidence dir> <chrome profile dir>
// Step 1 as the owner would: open the exact entry, keep the sample world selected, click
// 「读取 / 重新读取」, wait for the map. Then reload (same readback must show), click again
// (digest must match), and open localhost / query / tail-path variants. Screenshots + JSON.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [out, profileDir] = process.argv.slice(2);
if (!out || !profileDir) throw Error('usage: browser-walk.mjs <evidence dir> <chrome profile dir>');
await mkdir(out, { recursive: true }); await mkdir(profileDir, { recursive: true });
await rm(join(profileDir, 'DevToolsActivePort'), { force: true }); // a previous Chrome's port is not this one
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,1600', 'about:blank'], { stdio: 'ignore' });
let port, ws;
const steps = [];
try {
  for (;;) {
    const s = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8').catch(() => null);
    if (s) { port = Number(s.split('\n')[0]); break; }
    if (chrome.exitCode !== null) throw Error('CHROME_EXITED');
    await new Promise(y => setTimeout(y, 100));
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((y, n) => { ws.onopen = y; ws.onerror = n; });
  let id = 0; const waiting = new Map(), events = [];
  ws.onmessage = m => { const v = JSON.parse(m.data); if (v.id && waiting.has(v.id)) { waiting.get(v.id)(v); waiting.delete(v.id); } else events.push(v); };
  const cdp = (method, params = {}) => new Promise((y, n) => { const k = ++id; waiting.set(k, v => v.error ? n(Error(JSON.stringify(v.error))) : y(v.result)); ws.send(JSON.stringify({ id: k, method, params })); });
  const evaluate = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  async function open(url) {
    const loaded = new Promise(y => { const t = setInterval(() => { const i = events.findIndex(e => e.method === 'Page.loadEventFired'); if (i >= 0) { events.splice(i, 1); clearInterval(t); y(); } }, 50); });
    await cdp('Page.navigate', { url }); await loaded;
    await waitFor(`document.getElementById('worlds').textContent !== '加载中…'`);
  }
  async function waitFor(expr) { for (;;) { if (await evaluate(`!!(${expr})`)) return; await new Promise(y => setTimeout(y, 200)); } }
  async function shot(name) { const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(join(out, name), Buffer.from(data, 'base64')); return join(out, name); }
  const view = () => evaluate(`({ url: location.href, banner: document.getElementById('banner').textContent, status: document.getElementById('status').textContent,
    error: document.getElementById('error').textContent, selected: document.querySelector('input[name=world]:checked')?.value,
    ownerDisabled: document.querySelector('input[value=owner]')?.disabled, ownerReason: document.querySelectorAll('.worlds label')[1]?.textContent,
    resultShown: !document.getElementById('result').hidden, materials: document.getElementById('materials').innerText,
    counts: document.getElementById('counts').innerText, meta: document.getElementById('meta').innerText })`);
  const record = async (step, file) => { const v = await view(); steps.push({ step, screenshot: file, at: new Date().toISOString(), ...v }); console.log(step, v.status, v.error); return v; };
  await open('http://127.0.0.1:47606/');
  await record('01-open-entry', await shot('01-open-entry.png'));
  await evaluate(`document.getElementById('read').click()`);
  await waitFor(`!document.getElementById('read').disabled && (document.getElementById('status').textContent.includes('完成') || document.getElementById('error').textContent)`);
  const first = await record('02-step1-read-sample', await shot('02-step1-read-sample.png'));
  const d1 = await evaluate(`current?.surface?.readDigest`);
  await open('http://127.0.0.1:47606/');
  await record('03-reload-same-readback', await shot('03-reload-same-readback.png'));
  const d2 = await evaluate(`current?.surface?.readDigest`);
  await evaluate(`document.getElementById('read').click()`);
  await waitFor(`!document.getElementById('read').disabled && (document.getElementById('status').textContent.includes('完成') || document.getElementById('error').textContent)`);
  await record('04-reread-digest-compare', await shot('04-reread-digest-compare.png'));
  const d3 = await evaluate(`current?.surface?.readDigest`);
  for (const [name, url] of [['05-localhost', 'http://localhost:47606/'], ['06-query', 'http://127.0.0.1:47606/?from=owner&x=1#map'],
    ['07-tail-path', 'http://localhost:47606/world/sample/extra/tail?q=1']]) { await open(url); await record(name, await shot(`${name}.png`)); }
  await writeFile(join(out, 'walk.json'), JSON.stringify({ chromeVersion: (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser,
    digests: { firstRead: d1, afterReload: d2, reread: d3 }, reloadSame: d1 === d2, rereadSame: d1 === d3, firstOk: first.resultShown && !first.error, steps }, null, 2));
  console.log('digests', d1, d2, d3);
} finally { ws?.close(); chrome.kill('SIGTERM'); }
