# 🚀 Ubuntu 轻量云服务器 - 快速部署命令

## 你已经登录到 Ubuntu 服务器了！

现在按照以下步骤操作：

---

## 第 1 步：检查系统信息

```bash
# 查看系统版本
lsb_release -a

# 查看 IP 地址
hostname -I

# 查看当前目录
pwd
```

---

## 第 2 步：安装 Node.js 18

```bash
# 下载并安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

# 验证安装
node -v
npm -v
```

---

## 第 3 步：安装 PM2

```bash
sudo npm install -g pm2

# 验证安装
pm2 -v
```

---

## 第 4 步：上传部署包

**你需要先上传 wedscene-deploy.tar.gz 到服务器**

### 方式 A：使用轻量云控制台文件上传

1. 在轻量云控制台，找到你的服务器实例
2. 点击"文件传输"或"上传文件"
3. 上传 `wedscene-deploy.tar.gz` 到 `/tmp/` 目录

### 方式 B：使用 FileZilla

**连接信息：**
- 协议：SFTP
- 主机：106.53.167.63
- 端口：22
- 用户：ubuntu（或 root）
- 密码：你的密码

**上传文件：**
- 本地：`C:\Users\22591\Desktop\婚礼ai视频\wedscene-deploy.tar.gz`
- 远程：`/tmp/`

### 方式 C：使用 SCP（从你的电脑运行）

```bash
scp -P 22 wedscene-deploy.tar.gz ubuntu@106.53.167.63:/tmp/
```

---

## 第 5 步：部署项目

**上传完成后，在服务器上执行：**

```bash
# 创建项目目录
sudo mkdir -p /www/wwwroot/wedscene-ai
cd /www/wwwroot/wedscene-ai

# 解压部署包
sudo tar -xzf /tmp/wedscene-deploy.tar.gz
sudo rm /tmp/wedscene-deploy.tar.gz

# 安装依赖
sudo npm install --production --registry=https://registry.npmmirror.com

# 配置环境变量
sudo cp .env.example .env
sudo nano .env
```

**编辑 .env 文件（重要）：**
```bash
PUBLIC_BASE_URL=http://106.53.167.63:5173

# 删除或注释这两行
# HTTPS_PROXY=http://127.0.0.1:7897
# HTTP_PROXY=http://127.0.0.1:7897
```

保存：`Ctrl+X` → `Y` → `Enter`

```bash
# 启动服务
sudo pm2 start server.mjs --name wedscene
sudo pm2 save
sudo pm2 startup
```

---

## 第 6 步：配置防火墙

### 在轻量云控制台配置（推荐）

1. 进入轻量应用服务器控制台
2. 选择你的实例
3. 点击"防火墙"标签
4. 添加规则：
   - TCP 5173
   - TCP 80
   - TCP 443

### 或在服务器上配置

```bash
# 如果使用 ufw
sudo ufw allow 5173/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

---

## 第 7 步：验证部署

```bash
# 检查 PM2 状态
pm2 status

# 查看日志
pm2 logs wedscene

# 测试本地访问
curl http://localhost:5173
```

---

## 第 8 步：浏览器访问

打开浏览器访问：
```
http://106.53.167.63:5173
```

看到婚礼 AI 视频生成系统页面，**部署成功！** 🎉

---

## 🔧 一键部署命令（上传文件后）

**如果文件已上传到 /tmp/，复制这一条命令执行：**

```bash
sudo mkdir -p /www/wwwroot/wedscene-ai && cd /www/wwwroot/wedscene-ai && sudo tar -xzf /tmp/wedscene-deploy.tar.gz && sudo npm install --production --registry=https://registry.npmmirror.com && sudo cp .env.example .env && sudo sed -i 's|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://106.53.167.63:5173|g' .env && sudo sed -i 's/^HTTPS_PROXY=/#HTTPS_PROXY=/g' .env && sudo sed -i 's/^HTTP_PROXY=/#HTTP_PROXY=/g' .env && sudo pm2 start server.mjs --name wedscene && sudo pm2 save && sudo pm2 startup && pm2 status
```

---

## 📝 常用命令

```bash
# PM2 管理
pm2 status              # 查看状态
pm2 logs wedscene      # 查看日志
pm2 restart wedscene   # 重启服务
pm2 stop wedscene      # 停止服务

# 系统信息
df -h                  # 磁盘使用
free -m                # 内存使用
htop                   # 资源监控
```

---

**现在开始执行第 1 步，检查系统信息！** 🚀
