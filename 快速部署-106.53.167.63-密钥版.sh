#!/bin/bash
# 使用 SSH 密钥部署到 106.53.167.63

SERVER_IP="106.53.167.63"
SSH_PORT="22"
SSH_KEY="$HOME/.ssh/wedscene_rsa"

echo "🚀 开始部署到腾讯云服务器（使用 SSH 密钥）"
echo "================================"
echo "服务器 IP: $SERVER_IP"
echo "SSH 端口: $SSH_PORT"
echo "SSH 密钥: $SSH_KEY"
echo "================================"
echo ""

# 检查密钥文件
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ 错误：SSH 密钥文件不存在"
    echo "   请先运行：bash 配置SSH密钥.sh"
    exit 1
fi

# 检查当前目录
if [ ! -f "server.mjs" ]; then
    echo "❌ 错误：请在项目根目录运行此脚本"
    exit 1
fi

# 测试连接
echo "🔍 测试 SSH 连接..."
ssh -i "$SSH_KEY" -o "ConnectTimeout=5" -o "StrictHostKeyChecking=no" root@$SERVER_IP "echo '✓ 连接成功'" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "❌ SSH 密钥连接失败"
    echo ""
    echo "请先配置 SSH 密钥："
    echo "   bash 配置SSH密钥.sh"
    echo ""
    exit 1
fi

echo "✓ SSH 密钥认证成功"
echo ""

# 停止可能正在运行的进程
echo "📋 准备打包..."
pkill -f "node server.mjs" 2>/dev/null
sleep 1

# 打包文件
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

FILESIZE=$(du -h wedscene-deploy.tar.gz | awk '{print $1}')
echo "✓ 打包完成（大小: $FILESIZE）"
echo ""

# 上传文件（使用密钥，不需要密码）
echo "📤 正在上传到服务器..."
scp -i "$SSH_KEY" -P $SSH_PORT -o "StrictHostKeyChecking=no" wedscene-deploy.tar.gz root@$SERVER_IP:/tmp/

if [ $? -ne 0 ]; then
    echo "❌ 上传失败"
    rm -f wedscene-deploy.tar.gz
    exit 1
fi

echo "✓ 上传完成"
echo ""

# 在服务器上解压
echo "📦 正在服务器上解压..."
ssh -i "$SSH_KEY" -p $SSH_PORT -o "StrictHostKeyChecking=no" root@$SERVER_IP << 'ENDSSH'
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
echo "   ssh -i ~/.ssh/wedscene_rsa root@$SERVER_IP"
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
