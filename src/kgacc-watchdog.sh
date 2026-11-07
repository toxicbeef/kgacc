#!/system/bin/sh
# ============================================================================
# kgacc-watchdog.sh — 独立看门狗（不依赖 adb / 不依赖 keeper 自身）
# ----------------------------------------------------------------------------
# 职责：只要 keeper.sh 不在，就把它拉起来。keeper 再管注入。
# 由 init 以独立 service 常驻，本身极简（不碰 Java、不碰注入）。
# ============================================================================
D=/data/local/tmp/kg
LOG=$D/watchdog.log
INTERVAL=15

log() { echo "$(date '+%m-%d %H:%M:%S') [$$] $1" >> "$LOG" 2>/dev/null; }

# 单实例
LOCKDIR=$D/.wd.lockdir
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OLD=$(cat "$LOCKDIR/pid" 2>/dev/null)
  if [ -n "$OLD" ] && [ -d "/proc/$OLD" ]; then
    C=$(tr '\0' ' ' < "/proc/$OLD/cmdline" 2>/dev/null)
    case "$C" in *watchdog*) exit 0 ;; esac
  fi
  rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null || exit 0
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -rf "$LOCKDIR"' EXIT INT TERM

log "watchdog start"

# keeper 存活判断：遍历 /proc，排除自己，且要求 cmdline 真的是 keeper.sh
keeper_alive() {
  for P in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ "$P" = "$$" ] && continue
    [ -r "/proc/$P/cmdline" ] || continue
    C=$(tr '\0' ' ' < "/proc/$P/cmdline" 2>/dev/null)
    case "$C" in
      *keeper.sh*)
        case "$C" in
          *watchdog*) ;;
          *) return 0 ;;
        esac
        ;;
    esac
  done
  return 1
}

while true; do
  # keeper 不在 -> 拉起
  if ! keeper_alive; then
    log "keeper missing -> respawn"
    nohup sh "$D/keeper.sh" >/dev/null 2>&1 &
    sleep 5
  fi

  # keeper 在但注入器长期不在 -> 直接补一刀
  if keeper_alive; then
    if ! pgrep -f 'frida-inject' >/dev/null 2>&1; then
      # 只有在 APP 活着的时候才补
      if pidof com.tencent.karaoketv >/dev/null 2>&1; then
        # 让 keeper 自己处理，这里只记录
        log "injector absent (keeper alive), wait keeper"
      fi
    fi
  fi

  # 日志防爆：超过 512KB 截断
  if [ -f "$LOG" ]; then
    SZ=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
    if [ "$SZ" -gt 524288 ]; then
      tail -c 65536 "$LOG" > "$LOG.tmp" 2>/dev/null && mv -f "$LOG.tmp" "$LOG"
    fi
  fi

  sleep $INTERVAL
done
