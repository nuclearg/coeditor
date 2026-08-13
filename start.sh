#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export COEDITOR_DATA_DIR="$SCRIPT_DIR/data"
exec node "$SCRIPT_DIR/packages/server/dist/server/src/index.js"
