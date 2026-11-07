#!/system/bin/sh
# ============================================================================
# detect.sh — kgacc 设备兼容性检测
# 在目标设备上运行，判断能否安装伴唱/原唱切换功能
# 用法: sh detect.sh
# ============================================================================
echo "=========================================="
echo "  kgacc 兼容性检测"
echo "=========================================="
echo ""

SCORE=0
MAX=10

ok()   { echo "  [OK]   $1"; SCORE=$((SCORE+1)); }
warn() { echo "  [!!]   $1"; }
fail() { echo "  [FAIL] $1"; }

echo "--- 1. 系统识别 ---"
BRAND=$(getprop ro.product.brand)
MODEL=$(getprop ro.product.model)
MANU=$(getprop ro.product.manufacturer)
SDK=$(getprop ro.build.version.sdk)
REL=$(getprop ro.build.version.release)
HARMONY=$(getprop ro.build.version.harmonyos 2>/dev/null)
OHOS=$(getprop ro.build.version.ohos 2>/dev/null)
echo "  厂商: $MANU"
echo "  品牌: $BRAND"
echo "  型号: $MODEL"
echo "  Android: $REL (SDK $SDK)"
[ -n "$HARMONY" ] && echo "  HarmonyOS: $HARMONY"
[ -n "$OHOS" ] && echo "  OpenHarmony: $OHOS"

if echo "$MANU$BRAND" | grep -qi "huawei\|honor"; then
    echo ""
    echo "  >>> 检测到华为/荣耀设备"
fi

echo ""
echo "--- 2. Root 权限 ---"
ROOT=0
if command -v su >/dev/null 2>&1; then
    if su 0 id 2>/dev/null | grep -q "uid=0"; then
        ok "root 可用 (su 0)"
        ROOT=1
    elif su -c id 2>/dev/null | grep -q "uid=0"; then
        ok "root 可用 (su -c)"
        ROOT=1
    else
        fail "有 su 但授权失败"
    fi
else
    fail "无 su 命令"
fi

echo ""
echo "--- 3. SELinux ---"
SE=$(getenforce 2>/dev/null)
case "$SE" in
    Permissive) ok "SELinux = Permissive" ;;
    Enforcing)  warn "SELinux = Enforcing (需要额外处理)" ;;
    *)          warn "SELinux = $SE" ;;
esac

echo ""
echo "--- 4. 系统分区可写 ---"
if [ "$ROOT" = "1" ]; then
    if mount -o remount,rw /system 2>/dev/null; then
        ok "/system 可挂载 rw"
        mount -o remount,ro /system 2>/dev/null
    else
        fail "/system 只读，无法挂载 rw"
    fi
else
    fail "无 root，跳过"
fi

echo ""
echo "--- 5. 目标应用 ---"
PKG=""
for C in com.tencent.karaoketv com.tencent.karaoke; do
    if pm path "$C" >/dev/null 2>&1; then
        PKG="$C"
        break
    fi
done
if [ -n "$PKG" ]; then
    ok "已安装: $PKG"
    echo "        $(pm path $PKG | head -1)"
else
    fail "未安装全民K歌 TV"
    echo "        华为智慧屏多数不支持 APK，需先确认能否安装"
fi

echo ""
echo "--- 6. 注入能力 ---"
if [ "$ROOT" = "1" ]; then
    PID=$(pidof "$PKG" 2>/dev/null | awk '{print $1}')
    if [ -n "$PID" ]; then
        ok "应用运行中 pid=$PID"
    else
        warn "应用未运行（不影响判定）"
    fi
else
    fail "无 root，无法 ptrace 注入"
fi

echo ""
echo "--- 7. 存储空间 ---"
FREE=$(df /data 2>/dev/null | tail -1 | awk '{print $4}')
if [ -n "$FREE" ] && [ "$FREE" -gt 204800 ]; then
    ok "/data 剩余 $((FREE/1024)) MB"
else
    warn "/data 剩余不足 200MB"
fi

echo ""
echo "=========================================="
echo "  结论"
echo "=========================================="
echo "  得分: $SCORE / $MAX"

if [ "$ROOT" = "1" ] && [ "$SE" = "Permissive" ]; then
    echo "  >>> 可以安装"
elif [ "$ROOT" = "1" ]; then
    echo "  >>> 大概率可以，但需处理 SELinux"
else
    echo "  >>> 无法安装"
    echo ""
    echo "  原因：本方案需要 root 权限做运行时注入"
    echo "  华为智慧屏 bootloader 锁定，官方不提供解锁，"
    echo "  因此无法获取 root。"
    echo ""
    echo "  替代方案："
    echo "    1) 外接 Android TV 盒子（推荐）"
    echo "    2) 华为智慧屏仅作显示，音频走盒子"
fi
echo "=========================================="
