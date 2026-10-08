#!/bin/bash
# Narrow 0.7.3 safe-delete gate. No G3 replay, no product GUI, no disk cleanup outside this run.
set -euo pipefail
umask 077
R=/Users/yzliu/.cache/hanaworlds-runs/F-DESKTOP-FLAT-WORLD-01/adapter-safe-delete-prep
S=$R/source
F=$R/_evidence/delete-073
X=$F/installed
WE=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01/_evidence/verifier-01a10bd8-1e40-7741-ad7f-0d131f3aa940/worldedit-upstream/Minetest-WorldEdit-62ffafe3bcb386600c431ef3840d91c3c8f85639/worldedit
GAME=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-FLAT-WORLD-01/downloads/voxelibre-extract/mineclone2
CM=$R/deps/node_modules/@deepseek-ai/cordis/lib/index.js
cd "$S"
[[ "$(node --version)" = v24.13.1 && -z "$(git status --short)" && ! -e "$F" ]] || exit 2
mkdir -p "$F" "$R/tmp"
export TMPDIR=$R/tmp
git rev-parse HEAD > "$F/source-revision.txt"
df -h "$R" > "$F/space-before.txt"
step() {
  local log=$1 code
  shift
  if "$@" > "$log" 2>&1; then code=0; else code=$?; fi
  printf '%s\t%s\n' "$code" "$log" >> "$F/steps-exit.tsv"
  cat "$log"
  [[ $code = 0 ]] || exit "$code"
}
step "$F/build.log" npm run build
step "$F/tests.log" bash -ec 'npm test && npm run test:flat && npm run test:switch && npm run test:delete && npm run verify:contracts'
step "$F/cordis-install.log" npm install --prefix "$R/deps" --ignore-scripts --no-audit --no-fund --cache "$R/npm-cache" @deepseek-ai/cordis@4.0.4
step "$F/pack.log" npm pack --pack-destination "$F" --cache "$R/npm-cache"
T=$F/hanaworlds-adapter-luanti-0.7.3.tgz
shasum -a 256 "$T" > "$F/tar.sha256"
mkdir "$X"
tar -xzf "$T" -C "$X"
P=$X/package
step "$F/package-install.log" bash -ec 'cd "$1"; npm install --omit=dev --ignore-scripts --no-audit --no-fund --cache "$2"' _ "$P" "$R/npm-cache"
step "$F/byte-identity.json" python3 - "$S" "$P" <<'PY'
import hashlib,json,pathlib,subprocess,sys
s,p=map(pathlib.Path,sys.argv[1:]); rows=[]
for f in sorted(p.rglob('*')):
    if not f.is_file() or 'node_modules' in f.relative_to(p).parts: continue
    name=f.relative_to(p).as_posix()
    if name=='package-lock.json': continue
    data=f.read_bytes()
    assert data==subprocess.check_output(['git','show','HEAD:'+name],cwd=s),name
    rows.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
print(json.dumps({'files':rows,'mismatches':0},indent=2))
PY
run() {
  local e=$F/$1-runtime
  mkdir "$e"
  step "$e/result.log" env HW_LOCAL_E="$e" HW_LOCAL_PACKAGE="$2" HW_CORDIS_MODULE="$CM" HW_WORLDEDIT="$WE" HW_GAME="$GAME" node test/real-world-delete.mjs
}
run source "$S"
run package "$P"
step "$F/summary.json" python3 - "$F" <<'PY'
import hashlib,json,pathlib,sys
f=pathlib.Path(sys.argv[1]); t=f/'hanaworlds-adapter-luanti-0.7.3.tgz'
r={}
for name in ['source','package']:
    d=json.loads((f/(name+'-runtime')/'results.json').read_text())
    assert all(p['exitCode']==0 for p in d['processes'])
    passed=[e['event'] for e in d['events'] if e['event']!='HOST_STOPPED_CALLBACK']
    assert 'SWITCHED_A_DELETED_IN_HOST_STOPPED_CALLBACK_READBACK_GONE_B_STILL_CURRENT' in passed
    r[name]={'passed':passed,'processes':len(d['processes']),'leftRunning':0,'productUI':'NOT_RUN'}
r['artifact']={'path':str(t),'bytes':t.stat().st_size,'sha256':hashlib.sha256(t.read_bytes()).hexdigest()}
print(json.dumps(r,indent=2))
PY
df -h "$R" > "$F/space-after.txt"
