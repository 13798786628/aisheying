#!/bin/bash
# 腾讯云服务器部署脚本

echo "================================"
echo "  婚礼 AI 视频系统 - 服务器部署"
echo "================================"
echo ""

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo "❌ 请使用 root 用户运行此脚本"
    echo "   使用方法: sudo bash deploy-to-server.sh"
    exit 1
fi

# 配置项
PROJECT_DIR="/www/wwwroot/wedscene-ai"
GIT_REPO="https://github.com/YOUR_USERNAME/wedscene-ai.git"  # 修改为你的仓库地址
NODE_VERSION="18"

echo "📋 配置信息："
echo "   项目目录: $PROJECT_DIR"
echo "   Git 仓库: $GIT_REPO"
echo "   Node 版本: $NODE_VERSION"
echo ""

# 步骤 1：检查并安装 Git
echo "步骤 1/8: 检查 Git..."
if ! command -v git &> /dev/null; then
    echo "   正在安装 Git..."
    if [ -f /etc/redhat-release ]; then
        yum install -y git
    else
        apt-get update
        apt-get install -y git
    fi
else
    echo "   ✓ Git 已安装: $(git --version)"
fi

# 步骤 2：检查并安装 Node.js
echo ""
echo "步骤 2/8: 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "   正在安装 Node.js $NODE_VERSION..."
    curl -fsSL https://rpm.nodesource.com/setup_$NODE_VERSION.x | bash -
    if [ -f /etc/redhat-release ]; then
        yum install -y nodejs
    else
        apt-get install -y nodejs
    fi
else
    echo "   ✓ Node.js 已安装: $(node -v)"
fi

# 步骤 3：检查并安装 PM2
echo ""
echo "步骤 3/8: 检查 PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "   正在安装 PM2..."
    npm install -g pm2
else
    echo "   ✓ PM2 已安装: $(pm2 -v)"
fi

# 步骤 4：创建项目目录
echo ""
echo "步骤 4/8: 准备项目目录..."
mkdir -p /www/wwwroot
cd /www/wwwroot

# 步骤 5：克隆或更新代码
echo ""
echo "步骤 5/8: 获取项目代码..."
if [ -d "$PROJECT_DIR" ]; then
    echo "   项目目录已存在，拉取最新代码..."
    cd $PROJECT_DIR
    git pull origin main
else
    echo "   克隆项目..."
    git clone $GIT_REPO $PROJECT_DIR
    cd $PROJECT_DIR
fi

# 步骤 6：安装依赖
echo ""
echo "步骤 6/8: 安装项目依赖..."
npm install --production --registry=https://registry.npmmirror.com

# 步骤 7：配置环境变量
echo ""
echo "步骤 7/8: 配置环境变量..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "   ✓ 已创建 .env 文件（从 .env.example 复制）"
        echo ""
        echo "   ⚠️  请编辑 .env 文件，配置以下重要参数："
        echo "      - PUBLIC_BASE_URL=https://your-domain.com"
        echo "      - OPENAI_API_KEY=你的密钥"
        echo "      - XIAOJI_API_KEY=你的密钥"
        echo "      - ADMIN_TOKEN=管理员密码"
        echo ""
        echo "   编辑命令: nano $PROJECT_DIR/.env"
        echo ""
        read -p "   是否现在编辑 .env 文件? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            nano .env
        fi
    else
        echo "   ❌ 未找到 .env.example 文件"
        exit 1
    fi
else
    echo "   ✓ .env 文件已存在"
fi

# 步骤 8：启动服务
echo ""
echo "步骤 8/8: 启动服务..."
pm2 stop wedscene 2>/dev/null
pm2 delete wedscene 2>/dev/null
pm2 start server.mjs --name wedscene
pm2 save
pm2 startup

# 配置防火墙
echo ""
echo "🔥 配置防火墙..."
if command -v firewall-cmd &> /dev/null; then
    firewall-cmd --zone=public --add-port=5173/tcp --permanent 2>/dev/null
    firewall-cmd --reload 2>/dev/null
    echo "   ✓ 防火墙已配置（开放 5173 端口）"
else
    echo "   ⚠️  未检测到 firewall-cmd，请手动开放 5173 端口"
fi

# 完成
echo ""
echo "================================"
echo "  ✅ 部署完成！"
echo "================================"
echo ""
echo "📊 服务状态："
pm2 status
echo ""
echo "🌐 访问地址："
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "   http://$SERVER_IP:5173"
echo ""
echo "📝 常用命令："
echo "   查看日志: pm2 logs wedscene"
echo "   重启服务: pm2 restart wedscene"
echo "   停止服务: pm2 stop wedscene"
echo "   查看状态: pm2 status"
echo ""
echo "⚠️  下一步："
echo "   1. 编辑 .env 配置文件（如果还未配置）"
echo "   2. 配置域名和 Nginx 反向代理"
echo "   3. 配置 SSL 证书（推荐）"
echo ""
echo "📖 详细文档: 腾讯云部署指南.md"
echo ""
