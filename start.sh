#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 数据目录指针文件（存"数据目录指向哪"的偏好）：位于平台默认数据目录内，
# 与服务端 getDataDirPrefFile / 桌面壳 data_dir_pref_file 保持一致。
# Windows: %LOCALAPPDATA%\coeditor\data-dir.json
# macOS:   ~/Library/Application Support/coeditor/data-dir.json
# Linux:   $XDG_DATA_HOME/coeditor/data-dir.json（默认 ~/.local/share/coeditor/data-dir.json）
if [ -z "${COEDITOR_DATA_DIR_FILE:-}" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      COEDITOR_DATA_DIR_FILE="${LOCALAPPDATA:-$USERPROFILE/AppData/Local}/coeditor/data-dir.json" ;;
    Darwin)
      COEDITOR_DATA_DIR_FILE="$HOME/Library/Application Support/coeditor/data-dir.json" ;;
    *)
      COEDITOR_DATA_DIR_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/coeditor/data-dir.json" ;;
  esac
fi
PREF_FILE="$COEDITOR_DATA_DIR_FILE"

# 未显式指定数据目录时，优先采用「设置 → 数据目录」中持久化的偏好；
# 否则回退到仓库内默认 data/ 目录。
if [ -z "${COEDITOR_DATA_DIR:-}" ] && [ -s "$PREF_FILE" ]; then
  PREF_DIR="$(node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).dataDir||'')}catch(e){}" "$PREF_FILE" 2>/dev/null)"
  if [ -n "$PREF_DIR" ]; then
    export COEDITOR_DATA_DIR="$PREF_DIR"
  fi
fi
export COEDITOR_DATA_DIR="${COEDITOR_DATA_DIR:-$SCRIPT_DIR/data}"
exec node "$SCRIPT_DIR/packages/server/dist/server/src/index.js"
