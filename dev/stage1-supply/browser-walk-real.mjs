// Walk the own Stage 1 fact page in REAL input mode (HW_STAGE1_INPUT=real) in headless Chrome over CDP:
// the USER_CHECKLIST steps against the real own Luanti World, one screenshot per step.
// usage: node browser-walk-real.mjs <url> <evidence dir> <chrome profile dir>
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [url, out, profileDir] = process.argv.slice(2);
if (!url || !out || !profileDir) throw Error('usage: browser-walk-real.mjs <url> <evidence dir> <chrome profile dir>');
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
  // Real Luanti starts/stops behind Connect/Disconnect: wait for the page to reflect it.
  const until = async (expr, ms = 120000) => { const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr)) return; await new Promise(y => setTimeout(y, 250)); } throw Error(`WALK_TIMEOUT ${expr}`); };
  const read = async sel => { await evaluate(`document.getElementById('status').textContent=''`); await click(sel); await until(`document.getElementById('status').textContent!==''`); };
  const opened = `document.getElementById('conn').textContent.startsWith('已打开')`, closed = `document.getElementById('conn').textContent==='未打开'`;
  // The six USER_CHECKLIST steps, as the owner does them.
  await until(`document.getElementById('world').textContent.startsWith('本卡测试世界')`);
  await click('#connect'); await until(opened); await shot(1, 'open the test World: status 已打开（真实游戏世界）');
  await read('#readConfig'); await shot(2, 'write method 已知 + player body 不可用; no name/size/position/facing');
  await read('#readWE'); await shot(3, 'WorldEdit 已加载, version 1.3');
  await read('#readGuards'); await shot(4, 'three safety checks: 6 / 6 (ANONYMOUS) / 5 stages');
  await click('#disconnect'); await until(closed); await read('#readConfig'); await shot(5, 'closed World: refused 世界没有打开, records 已撤回');
  await click('#connect'); await until(opened); await read('#readConfig'); await shot(6, 'reopened: new connection number');
  // Leave the service at its initial state for the owner.
  await click('#disconnect'); await until(closed);
  await writeFile(join(out, 'walk.json'), JSON.stringify({ url, at: new Date().toISOString(), steps }, null, 1));
  console.log(JSON.stringify(steps.map(s => ({ step: s.step, status: s.status })), null, 1));
} finally { ws?.close(); chrome.kill(); }
