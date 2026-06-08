@echo off
echo 正在为视频生成功能设置内网穿透...
echo.
echo 请选择一个内网穿透工具：
echo 1. Localtunnel (无需注册，简单快速)
echo 2. Ngrok (更稳定，需要注册)
echo 3. 手动配置 PUBLIC_BASE_URL
echo.
set /p choice="请输入选择 (1/2/3): "

if "%choice%"=="1" goto localtunnel
if "%choice%"=="2" goto ngrok
if "%choice%"=="3" goto manual
goto end

:localtunnel
echo.
echo 正在安装 localtunnel...
call npm install -g localtunnel
echo.
echo 启动 localtunnel (端口 5173)...
echo 请保持此窗口开启，将显示的 URL 复制到 .env 文件的 PUBLIC_BASE_URL
echo.
npx localtunnel --port 5173
goto end

:ngrok
echo.
echo 请先到 https://ngrok.com 注册账号并获取 authtoken
echo 然后运行: ngrok config add-authtoken YOUR_TOKEN
echo 最后运行: ngrok http 5173
echo.
echo 将 ngrok 显示的 https URL 复制到 .env 文件的 PUBLIC_BASE_URL
pause
goto end

:manual
echo.
echo 请手动编辑 .env 文件，设置 PUBLIC_BASE_URL 为你的公网访问地址
echo 例如: PUBLIC_BASE_URL=https://your-domain.com
echo 或使用内网穿透: PUBLIC_BASE_URL=https://abc123.loca.lt
pause
goto end

:end
