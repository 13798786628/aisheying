#!/bin/bash
# 修复版：快速部署到 106.53.167.63

SERVER_IP="106.53.167.63"
SSH_PORT="22"

echo "🚀 开始部署到腾讯云服务器"
echo "================================"
echo "服务器 IP: $SERVER_IP"
echo "SSH 端口: $SSH_PORT"
echo "================================"
echo ""

# 检查当前目录
if [ ! -f "server.mjs" ]; then
    echo "❌ 错误：请在项目根目录运行此脚本"
    exit 1
fi

# 停止可能正在运行的进程（避免文件被占用）
echo "📋 准备打包..."
pkill -f "node server.mjs" 2>/dev/null
sleep 1

# 打包文件（添加 --ignore-failed-read 忽略文件变化）
echo "📦 正在打包项目文件..."
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

echo "✓ 打包完成（大小: $(du -h wedscene-deploy.tar.gz | awk '{print $1}')）"
echo ""

# 上传文件
echo "📤 正在上传到服务器 $SERVER_IP ..."
echo "   （需要输入服务器密码）"
scp -P $SSH_PORT wedscene-deploy.tar.gz root@$SERVER_IP:/tmp/

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ 上传失败，请检查："
    echo "   1. 服务器密码是否正确"
    echo "   2. 网络连接是否正常"
    echo "   3. 服务器 22 端口是否开放"
    rm -f wedscene-deploy.tar.gz
    exit 1
fi

echo "✓ 上传完成"
echo ""

# 在服务器上解压
echo "📦 正在服务器上解压..."
ssh -p $SSH_PORT root@$SERVER_IP << 'ENDSSH'
mkdir -p /www/wwwroot/wedscene-ai
cd /www/wwwroot/wedscene-ai
tar -xzf /tmp/wedscene-deploy.tar.gz
rm /tmp/wedscene-deploy.tar.gz
echo "✓ 解压完成"
ENDSSH

if [ $? -ne 0 ]; then
    echo "❌ 服务器操作失败"
    rm -f wedscene-deploy.tar.gz
    exit 1
fi

# 清理本地文件
rm -f wedscene-deploy.tar.gz

echo ""
echo "================================"
echo "✅ 文件上传成功！"
echo "================================"
echo ""
echo "📝 下一步操作："
echo ""
echo "1️⃣ SSH 连接到服务器："
echo "   ssh root@$SERVER_IP"
echo ""
echo "2️⃣ 运行部署脚本："
echo "   cd /www/wwwroot/wedscene-ai"
echo "   bash deploy-to-server.sh"
echo ""
echo "3️⃣ 编辑 .env 文件时，设置："
echo "   PUBLIC_BASE_URL=http://$SERVER_IP:5173"
echo ""
echo "4️⃣ 部署完成后访问："
echo "   http://$SERVER_IP:5173"
echo ""
echo "================================"
