#!/bin/bash
# Shared paths and prerequisites for the source distribution.
origin_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
origin_app="$origin_root/desktop"

origin_fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

origin_require_macos() {
  [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
    origin_fail '当前源码安装脚本支持 macOS Apple Silicon（arm64）。'
}

origin_require_node() {
  origin_node="$(command -v "${ORIGIN_NODE:-node}")" ||
    origin_fail '请先安装 Node.js 22.13+ 或 24，并将 node 加入 PATH。'
  local origin_node_version
  origin_node_version="$("$origin_node" -p 'process.versions.node')"
  if [[ "$origin_node_version" =~ ^22\.([0-9]+)\. ]]; then
    [[ "${BASH_REMATCH[1]}" -ge 13 ]] || origin_fail '需要 Node.js 22.13+ 或 24。'
  elif [[ ! "$origin_node_version" =~ ^24\. ]]; then
    origin_fail "不支持 Node.js ${origin_node_version}；请使用 Node.js 22.13+ 或 24。"
  fi
  export PATH="$(dirname -- "$origin_node"):$PATH"
}
