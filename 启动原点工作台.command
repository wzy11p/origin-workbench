#!/bin/bash
set -euo pipefail
source "$(dirname -- "$0")/scripts/common.sh"
origin_require_macos
origin_electron_dir="$origin_app/node_modules/electron/dist/Electron.app/Contents/MacOS"
[[ -x "$origin_electron_dir/Electron" && -x "$origin_root/runtime/backend/aioncore" && -x "$origin_root/runtime/docling-env/bin/python" ]] ||
  origin_fail '运行环境不完整，请先运行 bash scripts/setup.sh。'
[[ -f "$origin_app/out/main/index.js" ]] || origin_fail '缺少构建文件，请先运行 bash scripts/build.sh。'
# Resolve the physical path to avoid Electron's launch issue with symlinked stores.
origin_electron="$(cd -- "$origin_electron_dir" && pwd -P)/Electron"
export ORIGIN_ROOT="$origin_root"
export ORIGIN_DATA_DIR="${ORIGIN_DATA_DIR:-$origin_root/data/app}"
export AIONUI_BACKEND_BIN="$origin_root/runtime/backend/aioncore"
export AIONUI_CDP_PORT=0
unset SENTRY_DSN ELECTRON_RENDERER_URL ELECTRON_RUN_AS_NODE
mkdir -p "$ORIGIN_DATA_DIR/logs"
cd "$origin_app"
exec "$origin_electron" . --force-renderer-accessibility >> "$ORIGIN_DATA_DIR/logs/desktop.log" 2>&1
