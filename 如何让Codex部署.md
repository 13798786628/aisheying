# 🤖 如何让 Codex 帮你部署到腾讯云

## 方式 1：简短指令（推荐）

直接对 Codex 说：

```
请帮我将这个项目部署到腾讯云服务器：

服务器信息：
- IP: [你的服务器IP]
- 端口: 22
- 用户: root
- 密码: [你的密码]

部署要求：
1. 上传项目到 /www/wwwroot/wedscene-ai（排除 node_modules, .cache, *.log）
2. 安装 Node.js 18、PM2
3. 运行 deploy-to-server.sh 自动部署脚本
4. 配置 .env 文件中的 PUBLIC_BASE_URL 为服务器公网地址
5. 用 PM2 启动服务
6. 开放防火墙端口 5173

参考文档：项目中的"腾讯云部署指南.md"
```

---

## 方式 2：分步指令（详细版）

### 第一步：上传文件

对 Codex 说：
```
请帮我将当前项目上传到腾讯云服务器：
- 服务器 IP: [你的IP]
- SSH 端口: 22
- 用户名: root
- 密码: [你的密码]
- 目标目录: /www/wwwroot/wedscene-ai

不要上传这些文件：
- node_modules/
- .cache/
- output/
- *.log
- .env

可以使用项目中的 upload-to-server.sh 脚本。
```

### 第二步：配置服务器

对 Codex 说：
```
SSH 连接到服务器 [你的IP]，然后：

1. 检查并安装 Node.js 18：
   curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
   yum install -y nodejs

2. 安装 PM2：
   npm install -g pm2

3. 进入项目目录：
   cd /www/wwwroot/wedscene-ai

4. 运行自动部署脚本：
   bash deploy-to-server.sh
```

### 第三步：配置环境变量

对 Codex 说：
```
编辑服务器上的 /www/wwwroot/wedscene-ai/.env 文件：

需要修改：
- PUBLIC_BASE_URL=http://[服务器IP]:5173
  （或者 https://your-domain.com 如果有域名）

需要删除或注释：
- HTTPS_PROXY=...
- HTTP_PROXY=...

其他配置保持不变。
```

### 第四步：启动服务

对 Codex 说：
```
在服务器上启动服务：
cd /www/wwwroot/wedscene-ai
pm2 start server.mjs --name wedscene
pm2 save
pm2 startup

开放防火墙：
firewall-cmd --zone=public --add-port=5173/tcp --permanent
firewall-cmd --reload

查看状态：
pm2 status
pm2 logs wedscene
```

---

## 方式 3：使用自动化脚本（最简单）

对 Codex 说：

```
我的项目已经准备好了部署脚本。

请帮我：
1. 在本地运行 upload-to-server.sh，将文件上传到服务器
   - 服务器 IP: [你的IP]
   - SSH 端口: 22

2. SSH 连接到服务器，运行 /www/wwwroot/wedscene-ai/deploy-to-server.sh
   这个脚本会自动完成所有配置

3. 修改 .env 文件中的 PUBLIC_BASE_URL 为服务器公网地址

4. 用 PM2 启动服务

详细步骤见项目中的"同步到腾讯云-快速指南.md"
```

---

## 🔑 重要信息准备

在与 Codex 对话前，准备好这些信息：

### 必需信息
- [ ] 腾讯云服务器 IP 地址
- [ ] SSH 端口（通常是 22）
- [ ] Root 密码
- [ ] 域名（如果有）

### 可选信息
- [ ] 腾讯云账号密码（如果需要 Codex 操作控制台）
- [ ] 安全组配置

---

## 📋 预期对话流程

1. **你说**：请帮我部署项目到腾讯云，服务器 IP 是 xxx
2. **Codex**：好的，我开始上传文件...
3. **Codex**：文件上传完成，开始安装环境...
4. **Codex**：正在配置 .env 文件...
5. **Codex**：启动服务...
6. **Codex**：部署完成！可以通过 http://xxx:5173 访问

---

## 💡 提示

### 如果 Codex 问你问题
- **"需要安装什么版本的 Node.js？"** → 回答：Node.js 18
- **"需要开放哪些端口？"** → 回答：22, 80, 443, 5173
- **"PUBLIC_BASE_URL 设置什么？"** → 回答：http://服务器IP:5173 或你的域名
- **"需要配置 Nginx 吗？"** → 回答：先不用，能访问再说

### 如果遇到问题
告诉 Codex 查看：
- PM2 日志：`pm2 logs wedscene`
- 部署文档：项目中的"腾讯云部署指南.md"

---

## ✅ 验证部署成功

部署完成后，让 Codex 帮你验证：

```
请帮我验证部署是否成功：

1. 检查 PM2 状态：pm2 status
2. 查看最新日志：pm2 logs wedscene --lines 20
3. 测试访问：curl http://localhost:5173
4. 确认日志中显示的 PUBLIC_BASE_URL 是否正确
```

---

**准备好了吗？复制上面的指令，直接发给 Codex 就可以了！** 🚀
