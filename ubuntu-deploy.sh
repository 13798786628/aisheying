#!/bin/bash
# Ubuntu 轻量云服务器部署脚本（为你的服务器定制）

echo "🚀 婚礼 AI 视频系统 - Ubuntu 服务器部署"
echo "=========================================="
echo ""

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo "❌ 请使用 root 用户运行此脚本"
    exit 1
fi

echo "📋 步骤 1/8: 检查系统信息..."
echo "系统: $(lsb_release -d | cut -f2)"
echo "IP: $(hostname -I | awk '{print $1}')"
echo ""

echo "📋 步骤 2/8: 检查并安装 Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✓ Node.js 已安装: $NODE_VERSION"

    # 检查版本是否为 18+
    NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Node.js 版本过低，正在升级到 v18..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
else
    echo "正在安装 Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

echo ""
echo "📋 步骤 3/8: 检查并安装 PM2..."
if command -v pm2 &> /dev/null; then
    echo "✓ PM2 已安装: $(pm2 -v)"
else
    echo "正在安装 PM2..."
    npm install -g pm2
fi

echo ""
echo "📋 步骤 4/8: 创建项目目录..."
mkdir -p /www/wwwroot/wedscene-ai
cd /www/wwwroot/wedscene-ai

echo ""
echo "📋 步骤 5/8: 检查并解压项目文件..."
if [ -f "/tmp/wedscene-deploy.tar.gz" ]; then
    echo "正在解压..."
    tar -xzf /tmp/wedscene-deploy.tar.gz
    rm /tmp/wedscene-deploy.tar.gz
    echo "✓ 解压完成"
else
    echo "❌ 未找到 /tmp/wedscene-deploy.tar.gz"
    echo ""
    echo "请先上传部署包："
    echo "  1. 使用轻量云控制台的文件上传功能"
    echo "  2. 或使用 FileZilla 上传到 /tmp/"
    echo ""
    exit 1
fi

echo ""
echo "📋 步骤 6/8: 安装项目依赖..."
npm install --production --registry=https://registry.npmmirror.com

echo ""
echo "📋 步骤 7/8: 配置环境变量..."
if [ ! -f ".env" ]; then
    cp .env.example .env

    # 自动配置 PUBLIC_BASE_URL
    SERVER_IP=$(hostname -I | awk '{print $1}')
    sed -i "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://$SERVER_IP:5173|g" .env

    # 注释掉本地代理配置
    sed -i 's/^HTTPS_PROXY=/#HTTPS_PROXY=/g' .env
    sed -i 's/^HTTP_PROXY=/#HTTP_PROXY=/g' .env

    echo "✓ 已创建并自动配置 .env 文件"
    echo "   PUBLIC_BASE_URL=http://$SERVER_IP:5173"
else
    echo "✓ .env 文件已存在"
fi

echo ""
echo "📋 步骤 8/8: 启动服务..."
pm2 stop wedscene 2>/dev/null
pm2 delete wedscene 2>/dev/null
pm2 start server.mjs --name wedscene
pm2 save
pm2 startup

echo ""
echo "📋 配置防火墙..."
# Ubuntu 使用 ufw
if command -v ufw &> /dev/null; then
    ufw allow 5173/tcp 2>/dev/null
    ufw allow 80/tcp 2>/dev/null
    ufw allow 443/tcp 2>/dev/null
    echo "✓ 已配置 ufw 防火墙"
fi

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "📊 服务状态："
pm2 status
echo ""
echo "🌐 访问地址："
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "   http://$SERVER_IP:5173"
echo ""
echo "📝 常用命令："
echo "   查看日志: pm2 logs wedscene"
echo "   重启服务: pm2 restart wedscene"
echo "   查看状态: pm2 status"
echo ""
echo "⚠️  如果无法访问，请检查："
echo "   1. 轻量云控制台 → 防火墙 → 添加 5173 端口"
echo "   2. PM2 日志: pm2 logs wedscene"
echo "   3. 服务器日志: journalctl -u pm2-root -f"
echo ""
