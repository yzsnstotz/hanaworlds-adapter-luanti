#!/bin/bash
# S1-AD-FLAT-WORLD-01: 0.7.0 source + installed tar, real Luanti/VoxeLibre.
# Usage: final-gate-flat-world.sh <commit> <fresh evidence directory under R/_evidence>
# Each failed command retains its full output and stops; no retry or timeout wrapper.
set -euo pipefail
umask 077
R=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-FLAT-WORLD-01
S=$R/source
V=0.7.0
WE=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01/_evidence/verifier-01a10bd8-1e40-7741-ad7f-0d131f3aa940/worldedit-upstream/Minetest-WorldEdit-62ffafe3bcb386600c431ef3840d91c3c8f85639/worldedit
GAME=$R/downloads/voxelibre-extract/mineclone2
GAME_ZIP=$R/downloads/voxelibre-zip/voxelibre-0.92.3.zip
CONTRACT_TAR=/Users/yzliu/.cache/hanaworlds-runs/S1-CONTRACT-REGION-V1-01/_evidence/final-052/hanaworlds-contracts-0.5.2.tgz
CM=$R/deps/node_modules/@deepseek-ai/cordis/lib/index.js
export npm_config_update_notifier=false
[[ $# = 2 ]] || { echo 'Expected commit and fresh evidence directory'; exit 2; }
F=$2
X=$R/extract-$V
[[ "$F" = "$R/_evidence/"* && ! -e "$F" && ! -e "$X" ]] || { echo 'Fresh evidence/extraction directories required; archive previous evidence first'; exit 2; }
[[ "$(node --version)" = v24.13.1 ]] || { echo 'Requires Node 24.13.1 in PATH'; exit 2; }
cd "$S"
[[ "$(git rev-parse HEAD)" = "$1" && -z "$(git status --short)" ]] || { echo 'HEAD/clean mismatch'; exit 2; }
mkdir -p "$F"
step() {
  local log=$1 code
  shift
  if "$@" > "$log" 2>&1; then code=0; else code=$?; fi
  printf '%s\t%s\n' "$code" "$log" >> "$F/steps-exit.tsv"
  case "$log" in *.json) ;; *) echo "EXIT=$code" >> "$log" ;; esac
  cat "$log"
  [[ $code = 0 ]] || exit "$code"
}
{
  node --version
  /Applications/luanti.app/Contents/MacOS/luanti --version
  git rev-parse HEAD
  grep -E '^(title|version)' "$GAME/game.conf"
  shasum -a 256 "$GAME_ZIP" "$CONTRACT_TAR"
} > "$F/runtime.txt"
step "$F/input-integrity.log" python3 - "$S" "$CONTRACT_TAR" "$GAME_ZIP" <<'PY'
import hashlib, json, pathlib, sys, tarfile
s, c, g = map(pathlib.Path, sys.argv[1:])
assert hashlib.sha256(c.read_bytes()).hexdigest() == 'e6c50766ffc821ca90e07c38f473456952ef650e8a321f676dc44ce7d7d72209'
assert hashlib.sha256(g.read_bytes()).hexdigest() == '51ea9242aabb1f29575abbfb599c79bcde9435616ea097c0582e11ac1b2b279d'
manifest = json.loads((s/'vendor/hanaworlds-contracts.manifest.json').read_text())
with tarfile.open(c) as t:
    for name in manifest['vendored']:
        assert (s/'vendor/hanaworlds-contracts'/name).read_bytes() == t.extractfile('package/'+name).read(), name
print(json.dumps({'contracts':'0.5.2','vendoredEntriesComparedWithActualTar':len(manifest['vendored']),'mismatches':0,'gameZipVerified':True}))
PY
step "$F/source-install.log" npm ci --ignore-scripts --no-audit --no-fund --cache "$R/npm-cache"
step "$F/cordis-install.log" npm install --prefix "$R/deps" --ignore-scripts --no-audit --no-fund --cache "$R/npm-cache" @deepseek-ai/cordis@4.0.4
step "$F/source-suite.log" bash -ec 'set -e; npm run build; npm test; npm run test:lua; lua test/facts.lua; npm run test:catalogue; npm run test:materials; npm run test:region; npm run test:flat; npm run verify:contracts'
step "$F/pack.log" npm pack --pack-destination "$F" --cache "$R/npm-cache"
T=$F/hanaworlds-adapter-luanti-$V.tgz
shasum -a 256 "$T" > "$F/tar.sha256"
mkdir "$X"
tar -xzf "$T" -C "$X"
P=$X/package
step "$F/artifact-entries.txt" python3 - "$S" "$P" <<'PY'
import hashlib, json, pathlib, subprocess, sys
s, p = map(pathlib.Path, sys.argv[1:])
entries=[]
for f in sorted(p.rglob('*')):
    if not f.is_file(): continue
    name=f.relative_to(p).as_posix()
    source=subprocess.check_output(['git','show','HEAD:'+name],cwd=s)
    data=f.read_bytes()
    assert source==data, name
    entries.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
print(json.dumps({'entries':len(entries),'mismatches':0,'files':entries},indent=2))
PY
step "$F/package-install.log" bash -ec 'cd "$1"; npm install --omit=dev --ignore-scripts --no-audit --no-fund --cache "$2"' _ "$P" "$R/npm-cache"
step "$F/payload-digest.json" node --input-type=module - "$P" "$S" <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [p,s]=process.argv.slice(2);
const packageDigest=await (await import(pathToFileURL(p+'/src/index.mjs'))).payloadDigest();
const sourceDigest=await (await import(pathToFileURL(s+'/src/index.mjs'))).payloadDigest();
assert.equal(packageDigest,sourceDigest);
console.log(JSON.stringify({package:packageDigest,source:sourceDigest}));
JS
step "$F/contracts-pin.json" node scripts/verify-contracts-pin.mjs
mkdir -p "$P/test/support"
cp "$S/test/local-region-io.test.mjs" "$S/test/local-flat-world.test.mjs" "$S/test/local-material-facts.test.mjs" "$P/test/"
cp "$S/test/support/material-facts.lua" "$P/test/support/"
step "$F/package-test.log" bash -ec 'cd "$1"; node --test test/local-region-io.test.mjs test/local-flat-world.test.mjs test/local-material-facts.test.mjs' _ "$P"
rm -rf "$P/test"
run() {
  local evidence=$F/$1-flat-runtime
  mkdir "$evidence"
  step "$evidence/result.log" env HW_LOCAL_E="$evidence" HW_LOCAL_PACKAGE="$2" HW_CORDIS_MODULE="$CM" HW_WORLDEDIT="$WE" HW_GAME="$GAME" node test/real-flat-world.mjs
}
run source "$S"
run package "$P"
step "$F/cross-run-registry.json" python3 - "$F" <<'PY'
import json,pathlib,sys
f=pathlib.Path(sys.argv[1])
source=json.loads((f/'source-flat-runtime/results.json').read_text())
package=json.loads((f/'package-flat-runtime/results.json').read_text())
assert source['catalogue']['gameRevision']==package['catalogue']['gameRevision']
print(json.dumps({'sourceGameRevision':source['catalogue']['gameRevision'],'packageGameRevision':package['catalogue']['gameRevision'],'equal':True,'scope':'loaded-registry facts; not a game source revision'}))
PY
# Only inspect processes belonging to these two fresh gate worlds.
step "$F/leftover-processes.txt" python3 - "$F" <<'PY'
import json,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
remaining=[]
for role in ['source','package']:
    for p in json.loads((root/(role+'-flat-runtime')/'processes.json').read_text()):
        assert p['exitCode']==0 and p['signal'] is None,p
        check=subprocess.run(['ps','-p',str(p['pid']),'-o','command='],capture_output=True,text=True)
        if str(root) in check.stdout: remaining.append(check.stdout.strip())
print(json.dumps({'leftover':len(remaining),'processes':remaining}))
assert not remaining
PY
echo 'COMPONENT_SELF_CHECK_COMPLETE; independent VERIFY and product gates remain separate'
