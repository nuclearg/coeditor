#!/usr/bin/env bash
# macOS 产物签名校验闸门（CI 与本地通用）。
#
# 为什么需要它：
#   历史上 Tauri 打出的 .app 出现过「签名声称有资源、实际没有」的坏签名——
#       code has no resources but signature indicates they must be present
#   这种包在内核层（AMFI）直接 SIGKILL，用户双击、Cmd+O、右键「打开」全部无效，
#   连「系统设置 → 隐私与安全性 → 仍要打开」都不会出现（该按钮只对「签名有效但未公证」的包生效）。
#   坏签名比「未公证」严重得多：未公证只是摩擦，坏签名是绝症。
#
# 本脚本做两件事：
#   1) 校验：对 .app（或 .dmg 内的 .app）做 --deep --strict 校验，并断言资源已封存
#   2) 修复（仅当 IDENTITY=-）：按 codesign 要求的顺序重签（先内嵌二进制、再 bundle），重新封存资源
#
# 用法:
#   bash scripts/verify-macos-signature.sh <path-to.app|path-to.dmg> [identity]
#   identity 省略时默认 "-"（ad-hoc）；显式传 "-" 时允许自动修复。
#   AUTO_REPAIR=1 时，校验失败才尝试修复（默认 1）；AUTO_REPAIR=0 时只校验不改动。
#
# 退出码：0=通过；1=失败（CI 应据此中断，禁止把坏包发出去）
set -euo pipefail

TARGET="${1:-}"
IDENTITY="${2:--}"
AUTO_REPAIR="${AUTO_REPAIR:-1}"

if [[ -z "$TARGET" ]]; then
  echo "用法: bash scripts/verify-macos-signature.sh <path-to.app|path-to.dmg> [identity]" >&2
  exit 2
fi
if [[ ! -e "$TARGET" ]]; then
  echo "✋ 目标不存在: $TARGET" >&2
  exit 2
fi

log() { printf '%s\n' "$*"; }

# ---- 从 dmg 中取出 .app（只读挂载，不改动原 dmg）----
APP=""
DMG_MOUNTPOINT=""
cleanup() {
  if [[ -n "$DMG_MOUNTPOINT" ]]; then
    hdiutil detach "$DMG_MOUNTPOINT" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 注意：用 if/elif 而非 case + ";;&"——macOS 自带 bash 3.2，不支持 fall-through 语法。
case "$TARGET" in
  *.dmg)
    log "==> 挂载 dmg: $TARGET"
    # 先清理同名卷的残留挂载：上一次 attach 若解析失败/被中断，卷会留在 /Volumes，
    # 导致再次 attach 不打印挂载点，本脚本会误判为「挂载失败」而静默跳过校验（假阴性）。
    STALE_VOL="/Volumes/$(basename "$TARGET" .dmg)"
    if [[ -d "$STALE_VOL" ]]; then
      hdiutil detach "$STALE_VOL" -quiet 2>/dev/null || true
      sleep 1
    fi
    ATTACH_OUT="$(hdiutil attach "$TARGET" -nobrowse -readonly 2>&1 || true)"
    # 真实输出形如：/dev/disk4s1<TAB>Apple_HFS<TAB>/Volumes/CoEditor
    DMG_MOUNTPOINT="$(printf '%s\n' "$ATTACH_OUT" | awk -F'\t' 'NF>=3 && $NF ~ /^\/Volumes/ {mp=$NF} END{print mp}')"
    if [[ -z "$DMG_MOUNTPOINT" || ! -d "$DMG_MOUNTPOINT" ]]; then
      echo "错误：dmg 挂载失败: $TARGET" >&2
      printf '%s\n' "$ATTACH_OUT" | tail -3 >&2
      exit 1
    fi
    APP="$(find "$DMG_MOUNTPOINT" -maxdepth 1 -name '*.app' -print -quit)"
    ;;
  *.app)
    APP="$TARGET"
    ;;
  *)
    echo "错误：只支持 .app 或 .dmg: $TARGET" >&2
    exit 2
    ;;
esac

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "错误：未在 $TARGET 中找到 .app" >&2
  exit 1
fi
log "==> 目标 .app: $APP"

# ---- 结构自检：确认真的是个 bundle（防止校验一个残缺目录）----
for required in Contents/Info.plist Contents/MacOS; do
  if [[ ! -e "$APP/$required" ]]; then
    echo "✋ bundle 结构不完整，缺 $required" >&2
    exit 1
  fi
done

# ---- 收集内嵌可执行文件（sidecar / externalBin 等）----
# 这些必须单独签：bundle 签名不会自动覆盖它们，且它们最容易被杀软盯上。
nested_bins() {
  find "$APP/Contents/MacOS" -maxdepth 1 -type f -perm -u+x 2>/dev/null
}

cert_info() {
  codesign -dvvv "$APP" 2>&1 | grep -E '^(Authority|TeamIdentifier|Signature|Timestamp)=' || true
}

sealed_info() {
  codesign -dvvv "$APP" 2>&1 | grep -E '^Sealed Resources' || echo "Sealed Resources=(无)"
}

check_once() {
  codesign --verify --deep --strict "$APP" >/dev/null 2>&1
}

# ---- 修复：按正确顺序重签 ----
repair() {
  log "==> 重签 (identity=${IDENTITY}; 先内嵌二进制、后 bundle，确保资源被正确封存)"
  # 1) 先清掉可能存在的残缺签名，避免叠加
  codesign --remove-signature "$APP" 2>/dev/null || true
  while IFS= read -r bin; do
    [[ -n "$bin" ]] || continue
    codesign --remove-signature "$bin" 2>/dev/null || true
    codesign --force --sign "$IDENTITY" \
      --identifier "$(basename "$bin")" \
      --options runtime \
      --entitlements "$(dirname "${BASH_SOURCE[0]}")/macos-entitlements.plist" \
      "$bin" 2>&1 | sed 's/^/    /'
  done < <(nested_bins)
  # 2) 再签 bundle：这一步才会生成 Sealed Resources（资源封存）
  codesign --force --deep --sign "$IDENTITY" \
    --identifier "$(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo unknown)" \
    --options runtime \
    --entitlements "$(dirname "${BASH_SOURCE[0]}")/macos-entitlements.plist" \
    "$APP" 2>&1 | sed 's/^/    /'
}

# ---- 主流程 ----
log ""
log "---- 校验 ----"
if check_once; then
  log "✅ codesign --verify --deep --strict 通过"
  PASSED=1
else
  log "❌ codesign --verify --deep --strict 失败"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /' || true
  PASSED=0
fi

if [[ "$PASSED" == "0" ]]; then
  if [[ "$AUTO_REPAIR" == "1" && "$IDENTITY" == "-" ]]; then
    log ""
    log "---- 自动修复（ad-hoc）----"
    if repair && check_once; then
      log "✅ 修复后校验通过"
      PASSED=1
    else
      log "❌ 自动修复未能解决，需人工介入"
      PASSED=0
    fi
  else
    log ""
    log "(AUTO_REPAIR=${AUTO_REPAIR} identity=${IDENTITY}: 不做自动修复)"
    log "  正式分发请用 Developer ID 证书签名 + 公证。"
  fi
fi

log ""
log "---- 签名特征 ----"
cert_info | sed 's/^/    /'
sealed_info | sed 's/^/    /'

# 坏签名的典型特征：Sealed Resources=none 而签名本身存在
if sealed_info | grep -q 'Sealed Resources=none'; then
  log "    ⚠️  资源未封存（Sealed Resources=none）——这正是坏签名的特征"
  PASSED=0
fi

log ""
if [[ "$PASSED" == "1" ]]; then
  log "==> 结果: 通过 (${APP})"
  exit 0
else
  log "==> 结果: 失败 (${APP})"
  log "    坏签名的包用户无法运行（内核 SIGKILL），请勿分发。"
  exit 1
fi
