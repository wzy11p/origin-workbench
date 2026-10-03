#!/bin/bash
set -euo pipefail
source "$(dirname -- "$0")/common.sh"
origin_require_node
[[ -f "$origin_app/node_modules/typescript/bin/tsc" ]] ||
  origin_fail '缺少依赖，请先运行 bash scripts/setup.sh。'
cd "$origin_app"
"$origin_node" node_modules/typescript/bin/tsc --noEmit
"$origin_node" scripts/check-i18n.js
"$origin_node" node_modules/electron-vite/bin/electron-vite.js build --config packages/desktop/electron.vite.config.ts
