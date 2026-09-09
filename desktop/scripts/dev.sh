#!/usr/bin/env bash
# tauri dev 的 beforeDevCommand：起前端（5173）与后端（3001），devServer 已代理 /api → 3001。
set -euo pipefail
cd "$(dirname "$0")/../.." # coeditor 根
# 桌面注册表：默认插件 + desktop 插件（与 tauri build 的 build-desktop.sh 一致）
export PLUGIN_REGISTRY_PATH="$PWD/packages/client/src/plugin/registry.desktop.ts"
pnpm dev
