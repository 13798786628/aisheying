#!/bin/bash
# 一键部署测试脚本

echo "🔍 腾讯云部署准备检查"
echo "========================================"
echo ""

# 检查必需文件
echo "📁 检查部署文件..."
files=(
    "腾讯云部署指南.md"
    "同步到腾讯云-快速指南.md"
    "deploy-to-server.sh"
    "upload-to-server.sh"
    "nginx-config.conf"
    ".env.example"
    "server.mjs"
    "package.json"
)

missing_files=0
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file"
    else
        echo "   ✗ $file (缺失)"
        missing_files=$((missing_files + 1))
    fi
done

echo ""

# 检查脚本执行权限
echo "🔐 检查脚本权限..."
if [ -x "deploy-to-server.sh" ]; then
    echo "   ✓ deploy-to-server.sh 可执行"
else
    echo "   ⚠️  deploy-to-server.sh 需要执行权限"
    echo "      运行: chmod +x deploy-to-server.sh"
fi

if [ -x "upload-to-server.sh" ]; then
    echo "   ✓ upload-to-server.sh 可执行"
else
    echo "   ⚠️  upload-to-server.sh 需要执行权限"
    echo "      运行: chmod +x upload-to-server.sh"
fi

echo ""

# 检查 .gitignore
echo "📝 检查 .gitignore..."
if [ -f ".gitignore" ]; then
    if grep -q "node_modules" .gitignore && grep -q ".env" .gitignore; then
        echo "   ✓ .gitignore 配置正确"
    else
        echo "   ⚠️  .gitignore 可能需要更新"
    fi
else
    echo "   ⚠️  .gitignore 文件不存在"
fi

echo ""

# 检查 .env.example
echo "⚙️  检查配置文件..."
if [ -f ".env.example" ]; then
    if grep -q "PUBLIC_BASE_URL" .env.example; then
        echo "   ✓ .env.example 包含必要配置"
    else
        echo "   ⚠️  .env.example 可能缺少配置项"
    fi
else
    echo "   ✗ .env.example 文件不存在"
fi

echo ""

# 检查项目大小
echo "📦 检查项目大小..."
project_size=$(du -sh . 2>/dev/null | awk '{print $1}')
echo "   项目总大小: $project_size"

if [ -d "node_modules" ]; then
    node_modules_size=$(du -sh node_modules 2>/dev/null | awk '{print $1}')
    echo "   node_modules: $node_modules_size (上传时会排除)"
fi

echo ""

# 总结
echo "========================================"
if [ $missing_files -eq 0 ]; then
    echo "✅ 所有文件准备就绪！"
    echo ""
    echo "🚀 可以开始部署："
    echo "   方式 1: bash upload-to-server.sh"
    echo "   方式 2: 查看 同步到腾讯云-快速指南.md"
else
    echo "⚠️  有 $missing_files 个文件缺失"
    echo "   请检查上述提示"
fi
echo "========================================"
echo ""
