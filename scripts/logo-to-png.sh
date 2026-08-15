#!/usr/bin/env bash
# 从矢量源 docs/brand/logo.svg 生成全部 logo PNG：
#   docs/brand/logo.png                 1024x1024 透明原图
#   packages/client/src/assets/logo.png 紧凑裁剪 256x256（前端 Header 使用）
# sharp 缓存在临时目录，避免每次安装依赖。
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${TMPDIR:-/tmp}/coeditor-svg2png"
mkdir -p "$WORK"
if [ ! -d "$WORK/node_modules/sharp" ]; then
  echo "[logo-to-png] installing sharp (cached at $WORK)"
  (cd "$WORK" && npm init -y >/dev/null 2>&1 && npm install sharp --no-audit --no-fund >/dev/null)
fi

export NODE_PATH="$WORK/node_modules"
node scripts/svg-to-png.js docs/brand/logo.svg docs/brand/logo.png 1024
node scripts/svg-to-png.js docs/brand/logo.svg packages/client/src/assets/logo.png 256 --trim
