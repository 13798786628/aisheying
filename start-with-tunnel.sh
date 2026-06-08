#!/bin/bash

echo "正在启动婚礼 AI 视频服务（带内网穿透）..."
echo ""

# 检查是否已安装 localtunnel
if ! command -v lt &> /dev/null; then
    echo "正在安装 localtunnel..."
    npm install -g localtunnel
fi

# 启动服务器（后台）
echo "启动服务器..."
node server.mjs > server.tunnel.out.log 2> server.tunnel.err.log &
SERVER_PID=$!
echo "服务器 PID: $SERVER_PID"

# 等待服务器启动
sleep 3

# 启动内网穿透
echo ""
echo "启动内网穿透..."
echo "⚠️  请将下方显示的 URL 复制到 .env 文件的 PUBLIC_BASE_URL"
echo "   例如: PUBLIC_BASE_URL=https://abc-123-def.loca.lt"
echo ""
npx localtunnel --port 5173

# 退出时关闭服务器
trap "kill $SERVER_PID 2>/dev/null" EXIT
