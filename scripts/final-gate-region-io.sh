#!/bin/bash
# adapter-07: current region/v3 + native J3/J5 adapter paths, source and npm artifact.
# Usage: HW_LUANTI=<headless server> HW_GAME=<VoxeLibre> final-gate-region-io.sh <commit> <fresh evidence dir>
set -euo pipefail
S=$(cd "$(dirname "$0")/.." && pwd)
COMMIT=${1:?tested commit required}
F=${2:?fresh evidence directory required}
: "${HW_LUANTI:?headless Luanti executable required}"
: "${HW_GAME:?VoxeLibre directory required}"
[ "$(git -C "$S" rev-parse HEAD)" = "$COMMIT" ]
[ -z "$(git -C "$S" status --porcelain)" ]
[ ! -e "$F" ]
case "${HW_VOXELIBRE_PATH:-ALL}" in ALL|J3|J5) ;; *) echo "Invalid VoxeLibre test path" >&2; exit 2 ;; esac
case "$F" in /Users/yzliu/.cache/hana-world-runs/adapter-07/*) ;; *) echo 'Evidence must be inside this card run directory' >&2; exit 2 ;; esac
mkdir -p "$F/tmp" "$F/tests"
export TMPDIR="$F/tmp" HW_ADAPTER_TEST_ROOT="$F/tests" HW_BIND_TEST_ROOT="$F/tests" HW_STAGE1_RUN="$F/stage1" npm_config_update_notifier=false
cd "$S"
{ node --version; "$HW_LUANTI" --version; git rev-parse HEAD; } > "$F/runtime.txt"
( npm run build && npm test && npm run test:lua && npm run test:stage1 && npm run test:region && npm run verify:contracts ) > "$F/source-suite.log" 2>&1
npm pack --json --pack-destination "$F" > "$F/pack.json"
T=$(node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1]))[0].filename)' "$F/pack.json")
shasum -a 256 "$F/$T" > "$F/tar.sha256"
mkdir "$F/extract"
tar -xzf "$F/$T" -C "$F/extract"
P="$F/extract/package"
( cd "$P" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --cache "$F/npm-cache" ) > "$F/package-install.log" 2>&1
node --input-type=module - "$S" "$P" "$F/pack.json" <<'JS' > "$F/artifact-entries.json"
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const [s,p,pack]=process.argv.slice(2),files=JSON.parse(readFileSync(pack))[0].files;
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const {path} of files){const a=hash(readFileSync(join(p,path))),b=hash(execFileSync('git',['show','HEAD:'+path],{cwd:s}));if(a!==b)throw Error('Artifact mismatch: '+path);}
console.log(JSON.stringify({entries:files.length,mismatches:0}));
JS
for kind in source package; do
  PK="$S"; [ "$kind" = package ] && PK="$P"
  for gate in region voxelibre; do
    E="$F/$kind-$gate"; mkdir "$E"
    if [ "$gate" = region ]; then
      ( unset HW_GAME; HW_NATIVE_PATH=region HW_NATIVE_E="$E" HW_NATIVE_PACKAGE="$PK" node "$S/test/real-native-paths.mjs" ) > "$E/result.log" 2>&1
    else
      HW_NATIVE_PATH="${HW_VOXELIBRE_PATH:-ALL}" HW_NATIVE_E="$E" HW_NATIVE_PACKAGE="$PK" node "$S/test/real-native-paths.mjs" > "$E/result.log" 2>&1
    fi
  done
done
node - "$F" <<'JS' > "$F/summary.json"
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2];
const gates=['source-region','source-voxelibre','package-region','package-voxelibre'].map(name=>{
 const r=JSON.parse(fs.readFileSync(path.join(root,name,'results.json')));
 const required=['NATIVE_PAIR_AND_FACTS','CALLBACK_AND_PROTECTION_ZERO_WRITE','REGION_IO_NATIVE',...(['ALL','J3'].includes(r.requestedPath)?['J3_NATIVE_HOUSE_RESTART_UNDO']:[]),...(['ALL','J5'].includes(r.requestedPath)?['J5_NATIVE_BATCH_RESTART_RESTORE']:[])];
 if(!required.every(step=>r.steps.some(s=>s.name===step)))throw Error('Missing steps '+name);
 if(!r.pass||r.cleanupError||r.processes.some(p=>p.exit?.code!==0))throw Error('Failed gate '+name);
 for(const p of r.processes){try{process.kill(p.pid,0);throw Error('Still alive '+p.pid);}catch(e){if(e.code!=='ESRCH')throw e;}}
 return {name,path:r.requestedPath,pass:r.pass,steps:r.steps.map(s=>s.name),processes:r.processes};
});const fullPaths=gates.filter(g=>g.name.endsWith('voxelibre')).every(g=>g.path==='ALL');console.log(JSON.stringify({pass:fullPaths,selectedGatesPassed:true,fullPaths,gates},null,2));if(!fullPaths)process.exitCode=1;
JS
cat "$F/summary.json"
