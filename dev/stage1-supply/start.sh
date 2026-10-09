#!/bin/sh
# Starts the own Stage 1 fact page (fixture input, real Adapter code) on 127.0.0.1.
# usage: HW_STAGE1_RUN=<own run dir> [PORT=47614] dev/stage1-supply/start.sh
set -eu
: "${HW_STAGE1_RUN:?own run directory required}"
cd "$(dirname "$0")/../.."
exec node dev/stage1-supply/server.mjs
