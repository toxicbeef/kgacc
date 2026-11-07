#!/system/bin/sh
# ============================================================================
# install.sh — kgacc 一键安装（设备侧，由 install.bat 自动调用）
# ============================================================================
# 用法:
#   su 0 sh install.sh              安装
#   su 0 sh install.sh --status     查看状态
#   su 0 sh install.sh --uninstall  卸载
# ============================================================================

SRC=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
[ -n "$SRC" ] || SRC=/data/local/tmp/kgacc
D=/data/local/tmp/kg
PKG_FILE=/data/local/tmp/kgacc_pkg
LOG=$D/install.log
ACTION=install

for a in "$@"; do
  case "$a" in
    --uninstall) ACTION=uninstall ;;
    --status) ACTION=status ;;
    --pkg=*) echo "${a#--pkg=}" > $PKG_FILE ;;
  esac
done

log() { echo "$(date '+%m-%d %H:%M:%S') $1" 2>/dev/null | tee -a "$LOG" 2>/dev/null; }

# ---------- 包名探测 ----------
detect_pkg() {
  if [ -f "$PKG_FILE" ]; then
    P=$(cat "$PKG_FILE" 2>/dev/null | tr -d ' \r\n')
    [ -n "$P" ] && { echo "$P"; return; }
  fi
  for C in com.tencent.karaoketv com.tencent.karaoke com.tencent.kgtv; do
    if pm path "$C" >/dev/null 2>&1; then echo "$C"; return; fi
  done
  echo com.tencent.karaoketv
}

PKG=$(detect_pkg)

# ---------- 状态 ----------
if [ "$ACTION" = "status" ]; then
  echo "=========== kgacc status ==========="
  echo "pkg       : $PKG"
  echo "dir       : $D"
  echo "abi       : $(getprop ro.product.cpu.abi)"
  echo "sdk       : $(getprop ro.build.version.sdk)"
  echo "selinux   : $(getenforce)"
  echo "watchdog  : $(pgrep -f kgacc-watchdog | head -1)"
  echo "keeper    : $(pgrep -f 'kg/keeper.sh' | head -1)"
  echo "injector  : $(pgrep -f frida-inject | head -1)"
  echo "init.svc  : $(getprop init.svc.kgaccwatchdog)"
  [ -f $D/acc_state ] && echo "state     : $(cat $D/acc_state)"
  [ -f $D/acc_mode ]  && echo "mode      : $(cat $D/acc_mode)"
  [ -f /system/etc/init/kgacc.rc ] && echo "boot      : installed" || echo "boot      : none"
  echo "===================================="
  exit 0
fi

# ---------- 卸载 ----------
if [ "$ACTION" = "uninstall" ]; then
  log "===== uninstall ====="
  setprop ctl.stop kgaccwatchdog 2>/dev/null
  pkill -9 -f kgacc-watchdog 2>/dev/null
  pkill -9 -f 'kg/keeper.sh' 2>/dev/null
  pkill -9 -f frida-inject 2>/dev/null
  sleep 1
  if mount -o remount,rw /system 2>/dev/null; then
    rm -f /system/etc/init/kgacc.rc
    mount -o remount,ro /system 2>/dev/null
  fi
  rm -rf "$D"
  rm -f $PKG_FILE
  echo "uninstalled. reboot to fully clean."
  exit 0
fi

# ============ 安装 ============
[ "$(id -u)" = "0" ] || { echo "ERROR: need root (su 0)"; exit 1; }

mkdir -p "$D"
log "===== kgacc install ====="
log "src=$SRC pkg=$PKG abi=$(getprop ro.product.cpu.abi)"

# 1) 停旧实例
setprop ctl.stop kgaccwatchdog 2>/dev/null
pkill -9 -f kgacc-watchdog 2>/dev/null
pkill -9 -f 'kg/keeper.sh' 2>/dev/null
pkill -9 -f frida-inject 2>/dev/null
sleep 2
rm -rf "$D/.wd.lockdir" "$D/.keeper.lockdir" "$D/acc_state" "$D/acc_off"

# 2) 拷贝文件
for f in acc.js keeper.sh kgacc-watchdog.sh; do
  if [ -f "$SRC/$f" ]; then
    cp -f "$SRC/$f" "$D/$f" && log "copied $f"
  else
    log "MISSING $f"
  fi
done
chmod 644 "$D/acc.js"
chmod 755 "$D/keeper.sh" "$D/kgacc-watchdog.sh"

# 3) 注入器
ABI=$(getprop ro.product.cpu.abi)
if [ -f "$SRC/frida-inject64" ] && echo "$ABI" | grep -qE 'arm64|x86_64'; then
  cp -f "$SRC/frida-inject64" "$D/frida-inject" && chmod 755 "$D/frida-inject"
else
  cp -f "$SRC/frida-inject" "$D/frida-inject" && chmod 755 "$D/frida-inject"
fi
chown root:root "$D/frida-inject" 2>/dev/null
log "injector ready ($ABI)"

# 4) 默认配置
[ -f "$D/acc_mode" ] || { echo -n acc > "$D/acc_mode"; log "mode=acc"; }
[ -f "$D/acc_key" ]  || { echo -n "82"  > "$D/acc_key";  log "trig key=82 (MENU)"; }

# 5) 开机自启
if mount -o remount,rw /system 2>/dev/null; then
  mkdir -p /system/etc/init 2>/dev/null
  cp -f "$SRC/kgacc.rc" /system/etc/init/kgacc.rc 2>/dev/null
  chmod 644 /system/etc/init/kgacc.rc
  log "boot service installed"
  mount -o remount,ro /system 2>/dev/null
else
  log "WARN /system ro -> autostart skipped"
fi

# 6) 启动
nohup sh "$D/kgacc-watchdog.sh" >/dev/null 2>&1 &
sleep 3
log "watchdog started: $(pgrep -f kgacc-watchdog | head -1)"

# 7) 拉起 APP 以便注入
am start -n "$PKG/.app.activity.MainActivity" >/dev/null 2>&1
sleep 12

echo ""
echo "========================================"
echo "       kgacc 安装完成"
echo "========================================"
echo "  package  : $PKG"
echo "  目录     : $D"
echo "  watchdog : $(pgrep -f kgacc-watchdog | head -1)"
echo "  keeper   : $(pgrep -f 'kg/keeper.sh' | head -1)"
echo "  injector : $(pgrep -f frida-inject | head -1)"
[ -f $D/acc_state ] && echo "  心跳     : $(cat $D/acc_state)"
echo ""
echo "  用法: 遥控器连按 3 次 [菜单] 键"
echo "        Toast: KG: ACCOMPANY / KG: ORIGINAL"
echo "========================================"
