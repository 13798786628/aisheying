@echo off
chcp 65001 >nul
title 婚礼AI视频服务

echo ========================================
echo   婚礼 AI 视频生成服务
echo ========================================
echo.

REM 检查服务器是否已在运行
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I "node.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo [提示] 检测到 Node 进程正在运行，正在关闭...
    taskkill /F /IM node.exe >NUL 2>&1
    timeout /t 2 >nul
)

echo [1/3] 启动内网穿透 (Localtunnel)...
start /B npx localtunnel --port 5173 > tunnel.log 2>&1

echo [2/3] 等待内网穿透启动...
timeout /t 5 >nul

REM 读取公网 URL
for /f "tokens=4" %%i in ('findstr "your url is:" tunnel.log 2^>nul') do set TUNNEL_URL=%%i

if defined TUNNEL_URL (
    echo [成功] 内网穿透已启动: %TUNNEL_URL%

    REM 更新 .env 文件
    powershell -Command "(Get-Content .env) -replace 'PUBLIC_BASE_URL=.*', 'PUBLIC_BASE_URL=%TUNNEL_URL%' | Set-Content .env"
    echo [成功] 已更新 PUBLIC_BASE_URL
) else (
    echo [警告] 无法获取内网穿透 URL，使用现有配置
)

echo.
echo [3/3] 启动服务器...
start /B node server.mjs > server.log 2>&1
timeout /t 3 >nul

echo.
echo ========================================
echo   服务已启动！
echo ========================================
echo.
echo 本地访问: http://127.0.0.1:5173
if defined TUNNEL_URL (
    echo 公网访问: %TUNNEL_URL%
)
echo.
echo 视频生成功能已启用 ✓
echo.
echo 按任意键打开浏览器...
pause >nul

start http://127.0.0.1:5173

echo.
echo 服务正在运行中...
echo 关闭此窗口将停止所有服务
echo.
pause
