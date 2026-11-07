#!/system/bin/sh
# ============================================================================
# fetch-frida.sh — 下载 Frida 注入器（因体积大不入库）
# ----------------------------------------------------------------------------
# 用法:
#   bash scripts/fetch-frida.sh            下载 arm64 + armv7
#   bash scripts/fetch-frida.sh --abi arm  只下 armv7
# ============================================================================
set -e

VER="16.5.9"
BASE="https://github.com/frida/frida/releases/download/${VER}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets"

ABI="both"
for a in "$@"; do
  case "$a" in
    --abi=*) ABI="${a#--abi=}" ;;
    --abi) shift; ABI="$1" ;;
  esac
done

mkdir -p "$OUT"
cd "$OUT"

echo "==> Frida $VER"

fetch_one() {
  ARCH="$1"
  NAME="frida-inject-${VER}-android-${ARCH}.xz"
  URL="${BASE}/${NAME}"
  echo "  [$ARCH] $URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 -o "$NAME" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$NAME" "$URL"
  else
    echo "  ERROR: 需要 curl 或 wget"; return 1
  fi
  if command -v xz >/dev/null 2>&1; then
    xz -dkf "$NAME"
  else
    echo "  ERROR: 需要 xz 解压"; return 1
  fi
  BASE_NAME="$(basename "$NAME" .xz)"
  case "$ARCH" in
    arm)   mv -f "$BASE_NAME" frida-inject ;;
    arm64) mv -f "$BASE_NAME" frida-inject64 ;;
  esac
  chmod +x frida-inject* 2>/dev/null || true
  echo "  [$ARCH] OK"
}

case "$ABI" in
  arm)   fetch_one arm ;;
  arm64) fetch_one arm64 ;;
  both)  fetch_one arm; fetch_one arm64 ;;
esac

echo ""
echo "完成。文件在: $OUT"
ls -lh frida-inject* 2>/dev/null || true
echo ""
echo "下一步: adb push assets/frida-inject* src/* scripts/* /sdcard/kgacc/"
