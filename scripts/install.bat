@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
title kgacc 一键安装 - 全民K歌 + 伴唱/原唱切换
color 0B

cd /d "%~dp0"

echo.
echo ==========================================================
echo    kgacc 一键安装
echo    1. 安装 全民K歌 TV
echo    2. 安装 伴唱/原唱切换功能
echo ==========================================================
echo.

REM ============ 0. 参数 ============
set PKG=com.tencent.karaoketv
set APK=karaoke-base.apk
set IP=
set SKIPAPP=0

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--ip" ( set IP=%~2 & shift & shift & goto parse )
if /i "%~1"=="--skip-app" ( set SKIPAPP=1 & shift & goto parse )
if /i "%~1"=="--uninstall" ( set ACTION=uninstall & shift & goto parse )
if /i "%~1"=="--status" ( set ACTION=status & shift & goto parse )
shift
goto parse
:parsed

REM ============ 1. 找 adb ============
set ADB=
if exist "%~dp0adb.exe" set ADB=%~dp0adb.exe
if not defined ADB if exist "C:\Users\%USERNAME%\platform-tools\adb.exe" set ADB=C:\Users\%USERNAME%\platform-tools\adb.exe
if not defined ADB if exist "C:\platform-tools\adb.exe" set ADB=C:\platform-tools\adb.exe
if not defined ADB for /f "delims=" %%A in ('where adb.exe 2^>nul') do if not defined ADB set ADB=%%A

if not defined ADB (
    echo [错误] 找不到 adb.exe
    echo        请把 adb.exe 放本目录, 或安装 platform-tools
    echo        https://developer.android.com/studio/releases/platform-tools
    echo.
    pause
    exit /b 1
)
echo [1/7] adb: %ADB%

REM ============ 2. 连接设备 ============
echo.
echo [2/7] 搜索设备...

if defined IP (
    "%ADB%" connect %IP% >nul 2>&1
    timeout /t 2 >nul
)

set DEV=
for /f "tokens=1,2" %%A in ('"%ADB%" devices ^| findstr /r "device$"') do (
    if not defined DEV set DEV=%%A
)

if not defined DEV (
    echo        未自动发现设备, 尝试扫描常见网段...
    for %%N in (1 2 3 4 5 6 10 100 101 102 103) do (
        if not defined DEV (
            "%ADB%" connect 192.168.1.%%N:5555 >nul 2>&1
        )
    )
    timeout /t 3 >nul
    for /f "tokens=1,2" %%A in ('"%ADB%" devices ^| findstr /r "device$"') do (
        if not defined DEV set DEV=%%A
    )
)

if not defined DEV (
    echo.
    echo [错误] 没有可用设备
    echo        1^) 盒子开机了吗
    echo        2^) 同一局域网吗
    echo        3^) ADB 调试开了吗
    echo.
    echo 当前列表:
    "%ADB%" devices
    echo.
    pause
    exit /b 1
)
echo [2/7] 设备: %DEV%

REM ============ 3. root 检查 ============
echo.
"%ADB%" -s %DEV% shell "su 0 id" >nul 2>&1
if errorlevel 1 (
    echo [3/7] [错误] 需要 root
    pause
    exit /b 1
)
echo [3/7] root OK

REM ============ 状态 / 卸载 ============
if /i "%ACTION%"=="status" (
    "%ADB%" -s %DEV% shell "su 0 sh /data/local/tmp/kgacc/install.sh --status"
    echo.
    pause
    exit /b 0
)
if /i "%ACTION%"=="uninstall" (
    "%ADB%" -s %DEV% shell "su 0 sh /data/local/tmp/kgacc/install.sh --uninstall"
    echo.
    pause
    exit /b 0
)

REM ============ 4. 安装 K歌 APK ============
echo.
if "%SKIPAPP%"=="1" (
    echo [4/7] 跳过 APP 安装 ^(--skip-app^)
    goto appdone
)

"%ADB%" -s %DEV% shell "pm path %PKG%" >nul 2>&1
if not errorlevel 1 (
    echo [4/7] 检测到已安装 全民K歌, 跳过
    goto appdone
)

if not exist "%APK%" (
    echo [4/7] [跳过] 未找到 %APK%
    echo        可加 --skip-app 参数只装功能
    goto appdone
)

echo [4/7] 安装 全民K歌 (约 38MB, 请稍候)...
"%ADB%" -s %DEV% install -r -d "%APK%"
if errorlevel 1 (
    echo.
    echo [警告] 安装失败
    echo        可能原因: 签名冲突 / 存储空间不足
    echo        如已装过其它版本, 请先卸载
    echo.
) else (
    echo [4/7] 全民K歌 安装成功
    timeout /t 3 >nul
)
:appdone

REM ============ 5. 推送功能文件 ============
echo.
echo [5/7] 推送功能文件...
"%ADB%" -s %DEV% shell "su 0 mkdir -p /data/local/tmp/kgacc" >nul 2>&1
"%ADB%" -s %DEV% shell "su 0 rm -rf /data/local/tmp/kgacc/*" >nul 2>&1

for %%F in (acc.js keeper.sh kgacc-watchdog.sh kgacc.rc install.sh) do (
    if exist "%%F" (
        "%ADB%" -s %DEV% push "%%F" /data/local/tmp/kgacc/%%F >nul 2>&1
        if errorlevel 1 ( echo     [失败] %%F ) else ( echo     [OK] %%F )
    ) else ( echo     [缺失] %%F )
)

if exist "frida-inject" (
    "%ADB%" -s %DEV% push "frida-inject" /data/local/tmp/kgacc/frida-inject >nul 2>&1
    echo     [OK] frida-inject
) else (
    echo     [缺失] frida-inject  ^<-- 必需
    pause
    exit /b 1
)
if exist "frida-inject64" (
    "%ADB%" -s %DEV% push "frida-inject64" /data/local/tmp/kgacc/frida-inject64 >nul 2>&1
    echo     [OK] frida-inject64
)

"%ADB%" -s %DEV% shell "su 0 chmod 755 /data/local/tmp/kgacc/*.sh" >nul 2>&1

REM ============ 6. 执行功能安装 ============
echo.
echo [6/7] 安装伴唱/原唱切换功能...
echo ----------------------------------------------------------
"%ADB%" -s %DEV% shell "su 0 sh /data/local/tmp/kgacc/install.sh"
echo ----------------------------------------------------------

REM ============ 7. 完成 ============
echo.
echo [7/7] 全部完成!
echo.
echo ==========================================================
echo    开始使用:
echo      1. 打开 全民K歌
echo      2. 点一首歌, 开始播放
echo      3. 遥控器 连按 3 次 [菜单] 键
echo      4. 看到 Toast:
echo           KG: ACCOMPANY  = 伴唱 ^(纯伴奏^)
echo           KG: ORIGINAL   = 原唱 ^(带人声^)
echo.
echo    重启盒子后自动生效, 无需任何操作.
echo.
echo    其他命令:
echo      install.bat --status      查看状态
echo      install.bat --uninstall   完全卸载
echo      install.bat --skip-app    只装功能不装APP
echo ==========================================================
echo.
pause
