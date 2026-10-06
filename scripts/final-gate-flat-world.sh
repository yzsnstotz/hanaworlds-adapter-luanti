#!/bin/bash
# Final component gate for S1-AD-FLAT-WORLD-01. Usage: final-gate-flat-world.sh <commit> <fresh evidence dir>
# 0.6.1 (G3): Catalogue hasPersistentState facts. Flat-world REAL_RUNTIME on source and on the
# extracted package covers the affected Catalogue + Contracts admission, region and per-cell
# transport on the same connection. Unrelated full gates are not repeated.
set -u
R=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-FLAT-WORLD-01; S=$R/source; F=$2
WE=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01/_evidence/verifier-01a10bd8-1e40-7741-ad7f-0d131f3aa940/worldedit-upstream/Minetest-WorldEdit-62ffafe3bcb386600c431ef3840d91c3c8f85639/worldedit
GAME=$R/downloads/voxelibre-extract/mineclone2
CM=$R/deps/node_modules/@deepseek-ai/cordis/lib/index.js
V=0.6.1
export npm_config_update_notifier=false
rm -rf "$F" "$R/extract-$V"; mkdir -p "$F"
cd "$S"; [ "$(git rev-parse HEAD)" = "$1" ] && [ -z "$(git status --short)" ] || { echo "HEAD/clean mismatch"; exit 2; }
{ node --version; /Applications/luanti.app/Contents/MacOS/luanti --version | head -1; git rev-parse HEAD; grep -E '^(title|version)' "$GAME/game.conf"; shasum -a 256 $R/downloads/voxelibre-zip/voxelibre-0.92.3.zip; } > "$F/runtime.txt"
( set -x; npm run build && npm test && npm run test:lua && npm run test:catalogue && npm run test:materials && npm run test:region && npm run test:flat && npm run verify:contracts ) > "$F/source-suite.log" 2>&1; echo "EXIT=$?" >> "$F/source-suite.log"
npm pack --pack-destination "$F" --cache $R/npm-cache > "$F/pack.log" 2>&1; T=$F/hanaworlds-adapter-luanti-$V.tgz; shasum -a 256 "$T" > "$F/tar.sha256"
X=$R/extract-$V; mkdir -p $X; tar -xzf "$T" -C $X; P=$X/package
( cd $P && npm install --omit=dev --ignore-scripts --no-audit --no-fund --cache $R/npm-cache ) > "$F/package-install.log" 2>&1
( cd $P; n=0; bad=0; for f in $(find . -type f -not -path './node_modules/*' -not -name package-lock.json | sed 's|^\./||' | sort); do n=$((n+1)); a=$(shasum -a 256 "$f" | cut -d' ' -f1); b=$(cd "$S" && git show HEAD:"$f" | shasum -a 256 | cut -d' ' -f1); [ "$a" = "$b" ] || { bad=$((bad+1)); echo "MISMATCH $f"; }; done; echo "entries=$n mismatches=$bad" ) > "$F/artifact-entries.txt"
node --input-type=module -e "const m=await import('$P/src/index.mjs');const s=await import('$S/src/index.mjs');console.log(JSON.stringify({package:await m.payloadDigest(),source:await s.payloadDigest()}))" > "$F/payload-digest.json"
( cd "$S" && node scripts/verify-contracts-pin.mjs ) > "$F/contracts-pin.json" 2>&1
mkdir -p $P/test && mkdir -p $P/test/support && cp "$S/test/local-region-io.test.mjs" "$S/test/local-flat-world.test.mjs" "$S/test/local-material-facts.test.mjs" $P/test/ && cp "$S/test/support/material-facts.lua" $P/test/support/ && ( cd $P && node --test test/local-region-io.test.mjs test/local-flat-world.test.mjs test/local-material-facts.test.mjs ) > "$F/package-test.log" 2>&1; echo "EXIT=$?" >> "$F/package-test.log"; rm -rf $P/test
run() { E=$F/$1-$2-runtime; mkdir -p $E
  ( cd "$S" && HW_LOCAL_E=$E HW_LOCAL_PACKAGE=$3 HW_CORDIS_MODULE=$CM HW_WORLDEDIT=$WE HW_GAME=$GAME timeout 900 node $4 ) > $E/result.log 2>&1; echo "EXIT=$?" >> $E/result.log; }
run source flat "$S" test/real-flat-world.mjs
run package flat "$P" test/real-flat-world.mjs
pgrep -fl "luanti --server --world $F" > "$F/leftover-processes.txt"; echo "leftover=$(wc -l < "$F/leftover-processes.txt" | tr -d ' ')" >> "$F/leftover-processes.txt"
grep -H "EXIT=" "$F"/*.log "$F"/*/result.log
