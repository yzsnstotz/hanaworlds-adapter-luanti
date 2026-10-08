#!/bin/bash
set -euo pipefail
# HW_WORLD_MANAGE_PORT selects the registered isolated trial port (default 47607).
[[ $# = 2 ]] || { echo 'Usage: start.sh <own state directory> <cordis module>'; exit 2; }
STATE=$1; CORDIS=$2; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$STATE/logs"
if [[ -f "$STATE/service.pid" ]] && kill -0 "$(cat "$STATE/service.pid")" 2>/dev/null; then
  echo 'Own service already running'; exit 1
fi
python3 - "$STATE" "$CORDIS" "$HERE/server.mjs" "$(command -v node)" <<'PY_START'
import os, pathlib, subprocess, sys
state, cordis, server, node = sys.argv[1:]
env = dict(os.environ, HW_WORLD_MANAGE_STATE=state, HW_CORDIS_MODULE=cordis)
with open(pathlib.Path(state) / 'logs/service.log', 'ab', buffering=0) as log:
    process = subprocess.Popen([node, server], env=env, stdin=subprocess.DEVNULL,
        stdout=log, stderr=log, start_new_session=True, close_fds=True)
(pathlib.Path(state) / 'service.pid').write_text(str(process.pid) + '\n')
print('started detached pid', process.pid)
PY_START
