#!/bin/bash
# Drawnix source imports resolve against this checkout's single locked JS graph.
set -euo pipefail
source "$(dirname -- "$0")/common.sh"
origin_shared_modules="$origin_app/node_modules"
origin_vendor_modules="$origin_root/vendor/drawnix/node_modules"
[[ -d "$origin_shared_modules" && -d "$origin_root/vendor/drawnix" ]] ||
  origin_fail '请先安装 desktop/node_modules，并保留 vendor/drawnix 源码。'
if [[ -e "$origin_vendor_modules" || -L "$origin_vendor_modules" ]]; then
  [[ -d "$origin_vendor_modules" ]] &&
    [[ "$(cd -- "$origin_vendor_modules" && pwd -P)" == "$(cd -- "$origin_shared_modules" && pwd -P)" ]] ||
    origin_fail 'vendor/drawnix/node_modules 已有不同内容，未覆盖；请先将它移走后重试。'
else
  ln -s ../../desktop/node_modules "$origin_vendor_modules"
fi
