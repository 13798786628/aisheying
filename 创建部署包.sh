#!/bin/bash
# 创建可上传的部署包

echo "📦 创建部署包..."
echo ""

cd "$(dirname "$0")"

# 停止可能运行的进程
pkill -f "node server.mjs" 2>/dev/null
sleep 1

# 打包
tar --ignore-failed-read -czf wedscene-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.cache' \
    --exclude='output' \
    --exclude='*.log' \
    --exclude='.env' \
    --exclude='.git' \
    --exclude='wedscene-deploy.tar.gz' \
    . 2>/dev/null

if [ ! -f "wedscene-deploy.tar.gz" ]; then
    echo "❌ 打包失败"
    exit 1
fi

FILESIZE=$(du -h wedscene-deploy.tar.gz | awk '{print $1}')
echo "✅ 部署包已创建：wedscene-deploy.tar.gz"
echo "   大小：$FILESIZE"
echo ""
echo "📤 上传方式："
echo ""
echo "方式 1：使用 FileZilla 上传"
echo "  - 连接：sftp://106.53.167.63"
echo "  - 上传到：/tmp/wedscene-deploy.tar.gz"
echo ""
echo "方式 2：使用 SCP（需要扫码）"
echo "  scp wedscene-deploy.tar.gz root@106.53.167.63:/tmp/"
echo ""
echo "上传后，在服务器执行："
echo "  cd /www/wwwroot"
echo "  mkdir -p wedscene-ai"
echo "  cd wedscene-ai"
echo "  tar -xzf /tmp/wedscene-deploy.tar.gz"
echo "  bash deploy-to-server.sh"
echo ""
