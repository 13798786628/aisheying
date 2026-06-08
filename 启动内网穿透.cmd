@echo off
chcp 65001 >nul
title Localtunnel 内网穿透

echo ========================================
echo   启动 Localtunnel 内网穿透
echo ========================================
echo.

echo [1/2] 停止旧的 localtunnel 进程...
taskkill /F /FI "WINDOWTITLE eq localtunnel*" >nul 2>&1
timeout /t 2 >nul

echo [2/2] 启动 localtunnel（端口 5173）...
echo.

npx localtunnel --port 5173

echo.
echo Localtunnel 已停止
pause
