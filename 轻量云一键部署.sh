#!/bin/bash
# 轻量云服务器一键部署脚本

echo "🚀 婚礼 AI 视频系统 - 轻量云服务器部署"
echo "=========================================="
echo ""

# 检查是否在服务器上运行
if [ ! -f "/etc/redhat-release" ] && [ ! -f "/etc/lsb-release" ]; then
    echo "⚠️  此脚本需要在服务器上运行"
    echo "   请先 SSH 登录到服务器：ssh root@106.53.167.63"
    exit 1
fi

echo "📋 步骤 1/7: 检查环境..."

# 检查 Node.js
if command -v node &> /dev/null; then
    echo "✓ Node.js 已安装: $(node -v)"
else
    echo "正在安装 Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    yum install -y nodejs
fi

# 检查 PM2
if command -v pm2 &> /dev/null; then
    echo "✓ PM2 已安装: $(pm2 -v)"
else
    echo "正在安装 PM2..."
    npm install -g pm2
fi

echo ""
echo "📋 步骤 2/7: 创建项目目录..."
mkdir -p /www/wwwroot/wedscene-ai
cd /www/wwwroot/wedscene-ai

echo ""
echo "📋 步骤 3/7: 解压项目文件..."
if [ -f "/tmp/wedscene-deploy.tar.gz" ]; then
    tar -xzf /tmp/wedscene-deploy.tar.gz
    rm /tmp/wedscene-deploy.tar.gz
    echo "✓ 解压完成"
else
    echo "❌ 未找到 /tmp/wedscene-deploy.tar.gz"
    echo "   请先上传部署包到 /tmp/ 目录"
    exit 1
fi

echo ""
echo "📋 步骤 4/7: 安装项目依赖..."
npm install --production --registry=https://registry.npmmirror.com

echo ""
echo "📋 步骤 5/7: 配置环境变量..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✓ 已创建 .env 文件"
    echo ""
    echo "⚠️  重要：需要手动编辑 .env 文件"
    echo "   运行: nano .env"
    echo "   修改: PUBLIC_BASE_URL=http://106.53.167.63:5173"
    echo "   删除: HTTPS_PROXY 和 HTTP_PROXY 行"
    echo ""
    read -p "是否现在编辑? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        nano .env
    fi
else
    echo "✓ .env 文件已存在"
fi

echo ""
echo "📋 步骤 6/7: 启动服务..."
pm2 stop wedscene 2>/dev/null
pm2 delete wedscene 2>/dev/null
pm2 start server.mjs --name wedscene
pm2 save
pm2 startup

echo ""
echo "📋 步骤 7/7: 配置防火墙..."
firewall-cmd --zone=public --add-port=5173/tcp --permanent 2>/dev/null
firewall-cmd --zone=public --add-port=80/tcp --permanent 2>/dev/null
firewall-cmd --zone=public --add-port=443/tcp --permanent 2>/dev/null
firewall-cmd --reload 2>/dev/null

echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "📊 服务状态："
pm2 status
echo ""
echo "🌐 访问地址："
echo "   http://106.53.167.63:5173"
echo ""
echo "📝 常用命令："
echo "   查看日志: pm2 logs wedscene"
echo "   重启服务: pm2 restart wedscene"
echo "   查看状态: pm2 status"
echo ""
echo "⚠️  如果无法访问，请检查："
echo "   1. 轻量云控制台的防火墙规则"
echo "   2. .env 文件的 PUBLIC_BASE_URL 配置"
echo "   3. PM2 日志: pm2 logs wedscene"
echo ""
