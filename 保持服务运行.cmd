@echo off
chcp 65001 >nul
title 婚礼AI - 保持服务运行

echo ========================================
echo   婚礼 AI 视频生成服务
echo   请保持此窗口打开
echo ========================================
echo.

:START

REM 检查并启动 localtunnel
echo [检查] 检测内网穿透状态...
tasklist /FI "WINDOWTITLE eq localtunnel*" 2>NUL | find /I "node.exe" >NUL
if "%ERRORLEVEL%" NEQ "0" (
    echo [启动] 启动内网穿透...
    start "localtunnel" /MIN npx localtunnel --port 5173
    timeout /t 8 >nul
)

REM 检查并启动服务器
echo [检查] 检测服务器状态...
curl -s http://127.0.0.1:5173/api/health >nul 2>&1
if "%ERRORLEVEL%" NEQ "0" (
    echo [启动] 启动服务器...
    start "server" /MIN node server.mjs
    timeout /t 5 >nul
)

REM 显示状态
echo.
echo [状态] 服务正在运行中...
echo.
echo 本地地址: http://127.0.0.1:5173
echo.
echo ----------------------------------------
echo 服务监控中，每 30 秒检查一次
echo 如需停止服务，请关闭此窗口
echo ----------------------------------------
echo.

timeout /t 30 >nul
goto START
