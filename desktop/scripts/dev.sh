#!/usr/bin/env bash
# tauri dev 的 beforeDevCommand：起前端（5173）与后端（3001），devServer 已代理 /api → 3001。
set -euo pipefail
cd "$(dirname "$0")/../.." # coeditor 根
pnpm dev
