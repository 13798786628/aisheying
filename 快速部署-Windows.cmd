@echo off
chcp 65001 >nul
title 部署到腾讯云 106.53.167.63

echo ========================================
echo   部署到腾讯云服务器
echo ========================================
echo.
echo 服务器 IP: 106.53.167.63
echo SSH 端口: 22
echo.

echo [1/3] 打包项目文件...
tar --exclude=node_modules --exclude=.cache --exclude=output --exclude=*.log --exclude=.env --exclude=.git -czf wedscene-deploy.tar.gz .

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 打包失败
    pause
    exit /b 1
)

echo ✓ 打包完成
echo.

echo [2/3] 上传到服务器...
echo （需要输入服务器密码）
scp -P 22 wedscene-deploy.tar.gz root@106.53.167.63:/tmp/

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 上传失败
    del wedscene-deploy.tar.gz
    pause
    exit /b 1
)

echo ✓ 上传完成
echo.

echo [3/3] 在服务器上解压...
ssh -p 22 root@106.53.167.63 "mkdir -p /www/wwwroot/wedscene-ai && cd /www/wwwroot/wedscene-ai && tar -xzf /tmp/wedscene-deploy.tar.gz && rm /tmp/wedscene-deploy.tar.gz"

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 服务器操作失败
    del wedscene-deploy.tar.gz
    pause
    exit /b 1
)

del wedscene-deploy.tar.gz

echo.
echo ========================================
echo   ✅ 文件上传成功！
echo ========================================
echo.
echo 📝 下一步操作：
echo.
echo 1. SSH 连接到服务器：
echo    ssh root@106.53.167.63
echo.
echo 2. 运行部署脚本：
echo    cd /www/wwwroot/wedscene-ai
echo    bash deploy-to-server.sh
echo.
echo 3. 编辑 .env 时设置：
echo    PUBLIC_BASE_URL=http://106.53.167.63:5173
echo.
echo 4. 访问：http://106.53.167.63:5173
echo.
echo ========================================
pause
