#!/usr/bin/env bash
# tauri build 的 beforeBuildCommand：
#   1) 构建 H5 产物（dist-h5）
#   2) esbuild 打包 server 单文件
#   3) bun compile 打成 sidecar 可执行（输出到 src-tauri/binaries/<name>-<target-triple>）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[desktop] 1/3 build H5..."
pnpm --filter @coeditor/client build:h5

echo "[desktop] 2/3 bundle server (esbuild)..."
mkdir -p packages/server/dist/server/src
pnpm --filter @coeditor/server exec esbuild src/index.ts \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile=dist/server/src/index.js

echo "[desktop] 3/3 compile sidecar (bun)..."
command -v bun >/dev/null || { echo "需要 bun（https://bun.sh）来编译 sidecar" >&2; exit 1; }
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p desktop/src-tauri/binaries
bun build --compile packages/server/src/index.ts \
  --outfile "desktop/src-tauri/binaries/coeditor-server-$TRIPLE"

echo "[desktop] sidecar ready: desktop/src-tauri/binaries/coeditor-server-$TRIPLE"
