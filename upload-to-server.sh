#!/bin/bash
# 快速部署到腾讯云服务器

echo "🚀 婚礼 AI 视频系统 - 快速部署"
echo ""

# 读取服务器信息
read -p "请输入服务器 IP 地址: " SERVER_IP
read -p "请输入 SSH 端口 (默认 22): " SSH_PORT
SSH_PORT=${SSH_PORT:-22}

echo ""
echo "📦 准备上传文件到服务器..."
echo "   服务器: $SERVER_IP:$SSH_PORT"
echo ""

# 创建临时压缩包
echo "1. 打包项目文件..."
tar -czf wedscene-ai-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.cache' \
  --exclude='output' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.git' \
  .

echo "   ✓ 打包完成: wedscene-ai-deploy.tar.gz"

# 上传到服务器
echo ""
echo "2. 上传到服务器..."
scp -P $SSH_PORT wedscene-ai-deploy.tar.gz root@$SERVER_IP:/tmp/

echo ""
echo "3. 在服务器上解压..."
ssh -p $SSH_PORT root@$SERVER_IP << 'ENDSSH'
mkdir -p /www/wwwroot/wedscene-ai
cd /www/wwwroot/wedscene-ai
tar -xzf /tmp/wedscene-ai-deploy.tar.gz
rm /tmp/wedscene-ai-deploy.tar.gz
echo "   ✓ 解压完成"
ENDSSH

# 清理本地临时文件
rm wedscene-ai-deploy.tar.gz

echo ""
echo "✅ 文件已上传到服务器！"
echo ""
echo "📝 下一步操作："
echo "   1. SSH 连接到服务器："
echo "      ssh -p $SSH_PORT root@$SERVER_IP"
echo ""
echo "   2. 运行部署脚本："
echo "      cd /www/wwwroot/wedscene-ai"
echo "      bash deploy-to-server.sh"
echo ""
echo "   或者手动执行以下命令："
echo "      cd /www/wwwroot/wedscene-ai"
echo "      npm install"
echo "      cp .env.example .env"
echo "      nano .env  # 编辑配置"
echo "      pm2 start server.mjs --name wedscene"
echo ""
