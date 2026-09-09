#!/bin/bash
set -e

# 切到脚本所在目录（仓库根），保证从任意目录执行都能正确解析相对路径
cd "$(dirname "$0")"

echo "=== 1. Typecheck ==="
pnpm typecheck

echo "=== 2. Building client (H5) ==="
pnpm --filter @coeditor/client build:h5

echo "=== 3. Bundling server (esbuild, single file, all deps inlined) ==="
mkdir -p packages/server/dist/server/src
pnpm --filter @coeditor/server exec esbuild src/index.ts \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile=dist/server/src/index.js

echo ""
echo "=== Done ==="
echo ""
echo "启动方式（在 packages/server 目录下）："
echo "  COEDITOR_DATA_DIR=../../data node dist/server/src/index.js"
