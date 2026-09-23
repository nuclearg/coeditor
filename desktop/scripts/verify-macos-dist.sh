#!/usr/bin/env bash
# macOS **分发包**验证闸门（签名 + 公证 + staple），CI 与本地通用。
#
# 与 verify-macos-signature.sh 的分工：
#   verify-macos-signature.sh —— 只查「签名本身没坏」（防 Sealed Resources=none 那种
#                               内核 SIGKILL 的绝症），ad-hoc 阶段用，允许自动重签修复。
#   本脚本                   —— 查「分发包够不够格让用户双击即开」：Developer ID 签名、
#                               Gatekeeper 放行、公证票据已 staple。**不修复签名**，
#                               只对 .dmg 缺公证票据做一次显式补票（可关）。
#
# 用法:
#   bash scripts/verify-macos-dist.sh <path-to.app|path-to.dmg>
#
# 环境变量:
#   REQUIRE_DEVELOPER_ID=1  强制要求 Developer ID 签名（CI 配了 Apple secrets 时置 1）。
#                           未置 1 时退化为「只查签名完整性」，便于未配 secrets 的 fork。
#   AUTO_STAPLE_DMG=1       默认 1：.dmg 缺公证票据且提供了公证凭据时，显式补公证 + staple
#   APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH   公证凭据（补票时必需）
#   ALLOW_UNNOTARIZED=1     允许「已签名但未公证/未 staple」的产物通过（快速通道用，
#                           对应 tauri build --skip-stapling）。此时只把公证相关判据
#                           （spctl 放行、stapler validate）降级为告警，签名完整性 /
#                           Developer ID / hardened runtime 仍然强制；并强制不补票
#                           （否则本脚本自己 notarytool submit --wait 会把时间等回去）。
#                           ⚠️ 通过≠可分发：这种包只在联网时能被 Gatekeeper 放行。
#
# 退出码：0=全部通过；1=不达标（CI 应中断，禁止把包发出去）；2=用法错误
#
# 注意：macOS 自带 bash 3.2，不要用 associative array / ;;& 等 4.x 语法。
set -euo pipefail

TARGET="${1:-}"
REQUIRE_DEVELOPER_ID="${REQUIRE_DEVELOPER_ID:-0}"
AUTO_STAPLE_DMG="${AUTO_STAPLE_DMG:-1}"
ALLOW_UNNOTARIZED="${ALLOW_UNNOTARIZED:-0}"

# 快速通道下禁止本脚本自己补票：notarytool submit --wait 正是我们想避开的那段等待。
if [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
  AUTO_STAPLE_DMG=0
fi

if [[ -z "$TARGET" ]]; then
  echo "用法: bash scripts/verify-macos-dist.sh <path-to.app|path-to.dmg>" >&2
  exit 2
fi
if [[ ! -e "$TARGET" ]]; then
  echo "✋ 目标不存在: $TARGET" >&2
  exit 2
fi

log() { printf '%s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; FAILED=1; }

FAILED=0
KIND=""
APP=""
DMG=""
DMG_MOUNTPOINT=""
cleanup() {
  if [[ -n "$DMG_MOUNTPOINT" ]]; then
    hdiutil detach "$DMG_MOUNTPOINT" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- 定位 .app（dmg 则只读挂载后取出；挂载点用于后续 spctl/codesign）----
case "$TARGET" in
  *.app)
    KIND="app"; APP="$TARGET"
    ;;
  *.dmg)
    KIND="dmg"; DMG="$TARGET"
    STALE_VOL="/Volumes/$(basename "$DMG" .dmg)"
    if [[ -d "$STALE_VOL" ]]; then
      hdiutil detach "$STALE_VOL" -quiet 2>/dev/null || true
      sleep 1
    fi
    ATTACH_OUT="$(hdiutil attach "$DMG" -nobrowse -readonly 2>&1 || true)"
    DMG_MOUNTPOINT="$(printf '%s\n' "$ATTACH_OUT" | awk -F'\t' 'NF>=3 && $NF ~ /^\/Volumes/ {mp=$NF} END{print mp}')"
    if [[ -z "$DMG_MOUNTPOINT" || ! -d "$DMG_MOUNTPOINT" ]]; then
      echo "✋ dmg 挂载失败: $DMG" >&2
      printf '%s\n' "$ATTACH_OUT" | tail -3 >&2
      exit 1
    fi
    APP="$(find "$DMG_MOUNTPOINT" -maxdepth 1 -name '*.app' -print -quit)"
    ;;
  *)
    echo "只支持 .app 或 .dmg: $TARGET" >&2; exit 2
    ;;
esac

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "✋ 未找到 .app（$TARGET）" >&2; exit 1
fi
log "==> 目标: $TARGET   (app: $APP)"

# ---- 1) 签名完整性（坏签名是绝症，先排掉）----
log ""
log "---- 1/4 签名完整性 ----"
if codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  log "✅ codesign --verify --deep --strict 通过"
else
  fail "codesign --verify --deep --strict 失败"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/    /' || true
fi

# codesign 详情只取一次，后面复用。**不要**写成 `codesign -dvvv "$APP" | grep -q ...`：
# grep -q 一命中就退出，codesign 写端被关会吃 SIGPIPE 返回 141，在 set -o pipefail 下
# 整条管道判为失败，于是「明明有 runtime flag 也被判成没启用」。
CODESIGN_INFO="$(codesign -dvvv "$APP" 2>&1 || true)"

SEALED="$(printf '%s\n' "$CODESIGN_INFO" | grep -E '^Sealed Resources' || true)"
if printf '%s' "$SEALED" | grep -q 'Sealed Resources=none'; then
  fail "资源未封存（$SEALED）——坏签名特征，用户侧会被内核 SIGKILL"
else
  log "✅ 资源已封存（${SEALED:-未知}）"
fi

# ---- 2) 签名主体：Developer ID ----
log ""
log "---- 2/4 签名主体 ----"
AUTHORITIES="$(printf '%s\n' "$CODESIGN_INFO" | grep -E '^Authority=' || true)"
TEAM="$(printf '%s\n' "$CODESIGN_INFO" | grep -E '^TeamIdentifier=' || true)"
log "    ${AUTHORITIES:-（无 Authority）}"
log "    ${TEAM:-（无 TeamIdentifier）}"

if printf '%s' "$AUTHORITIES" | grep -q 'Developer ID Application'; then
  log "✅ 由 Developer ID Application 签名"
elif [[ "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
  fail "要求 Developer ID 签名，实际不是（可能回落成了 ad-hoc：检查 APPLE_SIGNING_IDENTITY 是否与证书完全一致）"
else
  log "⚠️  非 Developer ID（ad-hoc）。未要求强制分发签名，继续只做完整性检查。"
fi

if printf '%s' "$AUTHORITIES" | grep -q 'Developer ID Application'; then
  if printf '%s\n' "$CODESIGN_INFO" | grep -q 'flags=.*runtime'; then
    log "✅ 已启用 hardened runtime"
  else
    fail "Developer ID 签名但未启用 hardened runtime（公证要求）"
  fi
fi

# ---- 3) Gatekeeper 放行 ----
log ""
log "---- 3/4 Gatekeeper ----"
SPCTL_OUT="$(spctl -a -vvv "$APP" 2>&1 || true)"
if printf '%s' "$SPCTL_OUT" | grep -q 'accepted'; then
  log "✅ spctl 接受 .app"
  printf '%s\n' "$SPCTL_OUT" | sed 's/^/    /'
elif [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
  log "⚠️  spctl 未接受 .app（快速通道预期如此：已签名但未公证/未 staple）"
  printf '%s\n' "$SPCTL_OUT" | sed 's/^/    /'
elif [[ "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
  fail "spctl 不接受 .app："
  printf '%s\n' "$SPCTL_OUT" | sed 's/^/    /'
else
  log "⚠️  spctl 未接受（ad-hoc 预期如此）"
fi

# ---- 4) 公证票据 staple ----
log ""
log "---- 4/4 公证票据 ----"
if xcrun stapler validate "$APP" >/dev/null 2>&1; then
  log "✅ .app 票据已 staple"
elif [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
  log "⚠️  .app 未 staple 公证票据（快速通道预期如此；联网时 Gatekeeper 会去 Apple 核对）"
  xcrun stapler validate "$APP" 2>&1 | sed 's/^/    /' || true
elif [[ "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
  fail ".app 未 staple 公证票据（用户首次离线打开仍会被拦）"
  xcrun stapler validate "$APP" 2>&1 | sed 's/^/    /' || true
else
  log "⚠️  .app 无票据（ad-hoc 预期如此）"
fi

# .dmg 自身的票据：Tauri 是否自动公证 dmg 随版本而异，故这里不依赖它，缺则显式补
if [[ "$KIND" == "dmg" ]]; then
  if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
    log "✅ .dmg 票据已 staple"
  else
    CAN_NOTARIZE=0
    if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_PATH:-}" && -f "${APPLE_API_KEY_PATH:-}" ]]; then
      CAN_NOTARIZE=1
    fi
    if [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
      log "⚠️  .dmg 未 staple 公证票据（快速通道预期如此：打包不等公证）"
    elif [[ "$AUTO_STAPLE_DMG" == "1" && "$CAN_NOTARIZE" == "1" ]]; then
      log "==> .dmg 无票据，显式补公证 + staple（notarytool submit --wait）"
      if xcrun notarytool submit "$DMG" \
            --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
            --wait 2>&1 | sed 's/^/    /' \
         && xcrun stapler staple "$DMG" 2>&1 | sed 's/^/    /' \
         && xcrun stapler validate "$DMG" >/dev/null 2>&1; then
        log "✅ .dmg 补票后已 staple"
      else
        fail ".dmg 补公证失败（用 xcrun notarytool log <id> ... 看逐条原因）"
      fi
    elif [[ "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
      fail ".dmg 无票据且无法补（缺 APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH）"
    else
      log "⚠️  .dmg 无票据（未配公证凭据，跳过补票）"
    fi
  fi

  # dmg 本体也要 Gatekeeper 接受（用户下载到的就是这个文件）
  DMG_SPCTL="$(spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 || true)"
  if printf '%s' "$DMG_SPCTL" | grep -q 'accepted'; then
    log "✅ spctl 接受 .dmg"
  elif [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
    log "⚠️  spctl 未接受 .dmg（快速通道预期如此）"
    printf '%s\n' "$DMG_SPCTL" | sed 's/^/    /'
  elif [[ "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
    fail "spctl 不接受 .dmg："
    printf '%s\n' "$DMG_SPCTL" | sed 's/^/    /'
  else
    log "⚠️  spctl 未接受 .dmg（ad-hoc 预期如此）"
  fi
fi

log ""
if [[ "$FAILED" == "0" ]]; then
  if [[ "$ALLOW_UNNOTARIZED" == "1" ]]; then
    log "==> 结果: 签名达标，但**未公证/未 staple** ($TARGET)"
    log ""
    log "    ⚠️  这个包不能当正式分发包发出去："
    log "        · 已用 Developer ID 签名 + hardened runtime（这部分已强制校验）"
    log "        · 公证已上传 Apple，但本次没有等待结果、也没有 staple 票据"
    log "        · 用户联网时 Gatekeeper 会去 Apple 核对，可能放行；离线一定打不开"
    log "    补救（Apple 出结果后，票据可离线补）："
    log "        xcrun notarytool log <id> --key ... --key-id ... --issuer ...   # 看是否 Accepted"
    log "        xcrun stapler staple \"$TARGET\"                                 # 补票"
    log "        bash scripts/verify-macos-dist.sh \"$TARGET\"                     # 再跑一次本闸门确认"
    exit 0
  fi
  log "==> 结果: 通过 ($TARGET)"
  exit 0
fi
log "==> 结果: 不达标 ($TARGET)"
log "    不要把这个包发出去。详见 docs/desktop-signing.md 的排障小节。"
exit 1
