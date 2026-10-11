#!/bin/bash
set -euo pipefail
S=$(cd "$(dirname "$0")" && pwd)
exec node "$S/final-gate.mjs" region-io "${1:?tested commit required}" "${2:?fresh evidence directory required}"
