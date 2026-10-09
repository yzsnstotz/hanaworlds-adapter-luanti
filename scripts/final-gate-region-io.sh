#!/bin/bash
# Final component gate for S1-AD-REGION-IO-01. Usage: final-gate.sh <commit> <fresh evidence dir>
set -u
R=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-REGION-IO-01; S=$R/source; F=$2
WE=/Users/yzliu/.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01/_evidence/verifier-01a10bd8-1e40-7741-ad7f-0d131f3aa940/worldedit-upstream/Minetest-WorldEdit-62ffafe3bcb386600c431ef3840d91c3c8f85639/worldedit
CM=$R/deps/node_modules/@deepseek-ai/cordis/lib/index.js
export npm_config_update_notifier=false
rm -rf "$F" "$R/extract-050"; mkdir -p "$F"
cd "$S"; [ "$(git rev-parse HEAD)" = "$1" ] && [ -z "$(git status --short)" ] || { echo "HEAD/clean mismatch"; exit 2; }
{ node --version; /Applications/luanti.app/Contents/MacOS/luanti --version | head -1; git rev-parse HEAD; } > "$F/runtime.txt"
( set -x; npm run build && npm test && npm run test:lua && npm run test:catalogue && npm run test:materials && npm run test:region && npm run verify:contracts ) > "$F/source-suite.log" 2>&1; echo "EXIT=$?" >> "$F/source-suite.log"
npm pack --pack-destination "$F" --cache $R/npm-cache > "$F/pack.log" 2>&1; T=$F/hanaworlds-adapter-luanti-0.5.0.tgz; shasum -a 256 "$T" > "$F/tar.sha256"
X=$R/extract-050; mkdir -p $X; tar -xzf "$T" -C $X; P=$X/package
( cd $P && npm install --omit=dev --ignore-scripts --no-audit --no-fund --cache $R/npm-cache ) > "$F/package-install.log" 2>&1
( cd $P; n=0; bad=0; for f in $(find . -type f -not -path './node_modules/*' -not -name package-lock.json | sed 's|^\./||' | sort); do n=$((n+1)); a=$(shasum -a 256 "$f" | cut -d' ' -f1); b=$(cd "$S" && git show HEAD:"$f" | shasum -a 256 | cut -d' ' -f1); [ "$a" = "$b" ] || { bad=$((bad+1)); echo "MISMATCH $f"; }; done; echo "entries=$n mismatches=$bad" ) > "$F/artifact-entries.txt"
node --input-type=module -e "const m=await import('$P/src/index.mjs');const s=await import('$S/src/index.mjs');console.log(JSON.stringify({package:await m.payloadDigest(),source:await s.payloadDigest()}))" > "$F/payload-digest.json"
( cd "$P" && node scripts/verify-contracts-range.mjs 2>/dev/null || (cd "$S" && node scripts/verify-contracts-range.mjs) ) > "$F/contracts-pin.json" 2>&1
mkdir -p $P/test && cp "$S/test/local-region-io.test.mjs" $P/test/ && ( cd $P && node --test test/local-region-io.test.mjs ) > "$F/package-test.log" 2>&1; echo "EXIT=$?" >> "$F/package-test.log"; rm -rf $P/test
for kind in source package; do PK=$S; [ $kind = package ] && PK=$P
  for gate in region percell; do E=$F/$kind-$gate-runtime; mkdir -p $E
    script=test/real-region-io.mjs; [ $gate = percell ] && script=test/real-local-world.mjs
    ( cd "$S" && HW_LOCAL_E=$E HW_LOCAL_PACKAGE=$PK HW_CORDIS_MODULE=$CM HW_WORLDEDIT=$WE timeout 900 node $script ) > $E/result.log 2>&1; echo "EXIT=$?" >> $E/result.log
  done
done
grep -H "EXIT=" "$F"/*.log "$F"/*/result.log
