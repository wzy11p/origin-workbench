#!/bin/bash
# Install locked dependencies without starting the desktop application.
set -euo pipefail
source "$(dirname -- "$0")/common.sh"
[[ $# -eq 0 || ( $# -eq 1 && "$1" == --check ) ]] ||
  origin_fail '用法：bash scripts/setup.sh [--check]'
origin_require_macos
origin_require_node
origin_bun="$(command -v "${ORIGIN_BUN:-bun}")" || origin_fail '请先安装 Bun 1.3.9。'
[[ "$("$origin_bun" --version)" == 1.3.9 ]] || origin_fail '需要 Bun 1.3.9，以使用已验证的锁文件。'
origin_uv="$(command -v "${ORIGIN_UV:-uv}")" || origin_fail '请先安装 uv 0.12.9。'
[[ "$("$origin_uv" --version)" == uv\ 0.12.9* ]] || origin_fail '需要 uv 0.12.9，以重建已验证的 Python 环境。'
if [[ "${1:-}" == --check ]]; then
  printf '%s\n' '安装前检查通过：macOS arm64、Node.js、Bun、uv。'
  exit 0
fi

export PATH="$(dirname -- "$origin_bun"):$PATH"
printf '%s\n' '安装桌面依赖（锁定版本），首次需要网络连接。'
cd "$origin_app"
"$origin_bun" install --frozen-lockfile --ignore-scripts
"$origin_root/scripts/link-dependencies.sh"
"$origin_node" node_modules/electron/install.js
"$origin_node" "$origin_root/scripts/check-runtime.mjs"

printf '%s\n' '安装轻量资料解析环境：不安装 Torch、本地大模型或模型权重。'
origin_python="$origin_root/runtime/docling-env/bin/python"
if [[ ! -x "$origin_python" ]]; then
  "$origin_uv" venv --python 3.12 "$origin_root/runtime/docling-env"
fi
[[ "$("$origin_python" -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')" == 3.12 ]] ||
  origin_fail 'runtime/docling-env 必须使用 Python 3.12；请移走旧环境后重新安装。'
"$origin_uv" pip sync --python "$origin_python" --require-hashes "$origin_root/workers/requirements.txt"
"$origin_root/scripts/fetch-backend.sh"
printf '%s\n' '依赖安装完成。接着运行 bash scripts/build.sh，再运行 bash scripts/verify.sh。'
