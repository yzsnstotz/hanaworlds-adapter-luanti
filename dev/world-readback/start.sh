#!/bin/bash
# Start the F-AD-WORLD-READBACK-01 dev page detached from the calling session.
# Usage: start.sh <state dir> <cordis lib/index.js>   (Node 24.13.1 must be on PATH)
# The state dir must already hold profile/games/mineclone2 and profile/mods/worldedit;
# otherwise the page shows the Adapter's own describeFlatWorldCreation missing list.
set -euo pipefail
[[ $# = 2 ]] || { echo 'Usage: start.sh <state dir> <cordis module>'; exit 2; }
STATE=$1; CORDIS=$2; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$STATE/logs"
if [[ -f "$STATE/service.pid" ]] && kill -0 "$(cat "$STATE/service.pid")" 2>/dev/null; then
  echo "already running pid $(cat "$STATE/service.pid")"; exit 0
fi
( HW_READBACK_STATE="$STATE" HW_CORDIS_MODULE="$CORDIS" nohup node "$HERE/server.mjs" \
    < /dev/null >> "$STATE/logs/service.log" 2>&1 & echo $! > "$STATE/service.pid" )
echo "started pid $(cat "$STATE/service.pid") log $STATE/logs/service.log"
