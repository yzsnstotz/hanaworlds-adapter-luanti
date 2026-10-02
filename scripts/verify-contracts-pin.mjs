// Verifies that the installed hanaworlds-contracts package is exactly the
// reviewed contracts@0.3.0 artifact: `npm pack` of the installed directory
// must reproduce the pinned sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PINNED = { version: '0.3.0', revision: 'ce6d796cffee7d8596aef4b1d54e4ba577709dcf',
  sha256: '68801d2439b8344184c0feeebb19e2771c4632d0286b51111925db53e7c598df' };
const dir = mkdtempSync(join(tmpdir(), 'hw-contracts-pin-'));
try {
  const out = JSON.parse(execFileSync('npm', ['pack', './node_modules/hanaworlds-contracts',
    '--pack-destination', dir, '--json'], { encoding: 'utf8' }));
  const sha256 = createHash('sha256').update(readFileSync(join(dir, out[0].filename))).digest('hex');
  const ok = out[0].version === PINNED.version && sha256 === PINNED.sha256;
  console.log(JSON.stringify({ ...PINNED, observedVersion: out[0].version, observedSha256: sha256, ok }));
  if (!ok) process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
