#!/bin/bash
# 快速部署到 106.53.167.63

SERVER_IP="106.53.167.63"
SSH_PORT="22"

echo "🚀 开始部署到腾讯云服务器"
echo "================================"
echo "服务器 IP: $SERVER_IP"
echo "SSH 端口: $SSH_PORT"
echo "================================"
echo ""

# 检查文件
if [ ! -f "server.mjs" ]; then
    echo "❌ 错误：请在项目根目录运行此脚本"
    exit 1
fi

# 打包文件
echo "📦 正在打包项目文件..."
tar -czf wedscene-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.cache' \
    --exclude='output' \
    --exclude='*.log' \
    --exclude='.env' \
    --exclude='.git' \
    .

if [ $? -ne 0 ]; then
    echo "❌ 打包失败"
    exit 1
fi

echo "✓ 打包完成"
echo ""

# 上传文件
echo "📤 正在上传到服务器 $SERVER_IP ..."
scp -P $SSH_PORT wedscene-deploy.tar.gz root@$SERVER_IP:/tmp/

if [ $? -ne 0 ]; then
    echo "❌ 上传失败，请检查："
    echo "   1. 服务器 IP 是否正确"
    echo "   2. 密码是否正确"
    echo "   3. 网络连接是否正常"
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
echo "1. SSH 连接到服务器："
echo "   ssh root@$SERVER_IP"
echo ""
echo "2. 运行部署脚本："
echo "   cd /www/wwwroot/wedscene-ai"
echo "   bash deploy-to-server.sh"
echo ""
echo "3. 编辑 .env 文件时，设置："
echo "   PUBLIC_BASE_URL=http://$SERVER_IP:5173"
echo ""
echo "4. 部署完成后访问："
echo "   http://$SERVER_IP:5173"
echo ""
echo "================================"
