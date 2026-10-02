// Verifies that the installed hanaworlds-contracts package is exactly the
// reviewed contracts@0.3.0 artifact: `npm pack` of the installed directory
// must reproduce the pinned sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PINNED = { version: '0.3.0', revision: 'e82735780bdfd4ea8e662781455040a6e5306121',
  sha256: '47a2e5cc77590fb471ffedde715682564e169a0d88dbc5005b71d8d542b38f5c' };
const dir = mkdtempSync(join(tmpdir(), 'hw-contracts-pin-'));
try {
  const out = JSON.parse(execFileSync('npm', ['pack', './node_modules/hanaworlds-contracts',
    '--pack-destination', dir, '--json'], { encoding: 'utf8' }));
  const sha256 = createHash('sha256').update(readFileSync(join(dir, out[0].filename))).digest('hex');
  const ok = out[0].version === PINNED.version && sha256 === PINNED.sha256;
  console.log(JSON.stringify({ ...PINNED, observedVersion: out[0].version, observedSha256: sha256, ok }));
  if (!ok) process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
