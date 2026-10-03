#!/bin/bash
# The checked digest is from the upstream v0.2.2 release asset metadata.
set -euo pipefail
source "$(dirname -- "$0")/common.sh"
origin_require_macos
origin_backend_dir="$origin_root/runtime/backend"
origin_backend_url='https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/aioncore-v0.2.2-aarch64-apple-darwin.tar.gz'
origin_backend_sha='70c50b84be9e17ba574a2c74370e6d57a267f44bdd6ecf641740cf220737d5cb'
# Digest of the binary extracted from the archive verified above, not a manifest.
origin_binary_sha='04404864ca622159ffcc79ef9cb468e82fc820b91f16d565c5a5efdb0b0c4cb1'
if [[ -f "$origin_backend_dir/aioncore" && ! -L "$origin_backend_dir/aioncore" ]]; then
  origin_existing_sha="$(shasum -a 256 "$origin_backend_dir/aioncore" | cut -d ' ' -f 1)"
  if [[ "$origin_existing_sha" == "$origin_binary_sha" ]]; then
    chmod 755 "$origin_backend_dir/aioncore"
    printf '%s\n' '本地后端 v0.2.2 SHA-256 校验通过，复用已安装文件。'
    exit 0
  fi
fi
mkdir -p "$origin_backend_dir"
origin_download_dir="$(mktemp -d "$origin_backend_dir/.download.XXXXXX")"
trap 'rm -rf -- "$origin_download_dir"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 180 \
  --output "$origin_download_dir/backend.tar.gz" "$origin_backend_url"
origin_download_sha="$(shasum -a 256 "$origin_download_dir/backend.tar.gz" | cut -d ' ' -f 1)"
[[ "$origin_download_sha" == "$origin_backend_sha" ]] || origin_fail '后端下载的 SHA-256 不匹配，已停止安装。'
tar -xzf "$origin_download_dir/backend.tar.gz" -C "$origin_download_dir" aioncore
[[ -f "$origin_download_dir/aioncore" && ! -L "$origin_download_dir/aioncore" ]] || origin_fail '后端归档缺少可执行文件。'
[[ "$(shasum -a 256 "$origin_download_dir/aioncore" | cut -d ' ' -f 1)" == "$origin_binary_sha" ]] ||
  origin_fail '后端二进制的 SHA-256 不匹配，已停止安装。'
chmod 755 "$origin_download_dir/aioncore"
mv -f "$origin_download_dir/aioncore" "$origin_backend_dir/aioncore"
printf '%s\n' '本地后端 v0.2.2 下载及 SHA-256 校验完成。'
