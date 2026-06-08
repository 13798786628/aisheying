# 腾讯云轻量应用服务器部署手册

## 推荐配置

1. 公测起步：轻量应用服务器 `2 核 4G 5M`。
2. 系统：Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS。
3. 地域：客户主要在国内，优先上海、广州、北京。
4. 域名：国内服务器正式访问需要 ICP 备案；备案前可先用 IP 小范围测试。

当前项目的生图在 n1n.ai API 上执行，服务器本机不跑大模型，所以不需要 GPU。部署包安装依赖时会跳过 `ffmpeg-static` 的下载脚本；当前默认关闭去水印，不影响生图和视频调用。

## 服务器初始化

```bash
sudo apt update
sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

如果镜像自带旧版 Node，仍然要升级到 Node 22；项目启动脚本依赖 Node 22 的 `--env-file`。

## 公测访问码

1. 小范围公测时，建议先在服务器 `.env` 开启访问码：

```bash
PUBLIC_ACCESS_CODE=换成你发给客户的访问码
ACCESS_TOKEN_SECRET=换成一串随机长字符
ACCESS_COOKIE_SECURE=false
```

2. 如果已经配置 HTTPS，并且客户通过域名访问，可以把 `ACCESS_COOKIE_SECURE` 改为 `true`。
3. 访问码只是一层公测保护，不等于正式客户账号系统；后续仍然需要账号、点数和资源隔离。

检查版本：

```bash
node -v
npm -v
pm2 -v
```

## 拉取代码

```bash
cd /var/www
sudo git clone <你的 GitHub 仓库地址> wedscene-ai
sudo chown -R $USER:$USER /var/www/wedscene-ai
cd /var/www/wedscene-ai
npm ci --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com
npm run build
```

如果暂时不走 Git，可以在本机生成部署包：

```bash
npm.cmd run build:deploy
```

默认部署包会让前端和后端走同一个腾讯云服务器域名/IP。若前端要继续放在 GitHub Pages、Vercel 等静态站，再用 `DEPLOY_API_BASE_URL` 指定 API 地址后重新打包。

生成的 `deploy/wedscene-ai-server.zip` 可上传到服务器。服务器上解压到 `/opt/wedscene-ai`：

```bash
sudo mkdir -p /opt/wedscene-ai
sudo unzip -o wedscene-ai-server.zip -d /opt/wedscene-ai
cd /opt/wedscene-ai
sudo bash setup-server.sh
```

首次运行会创建 `.env` 并退出。编辑真实配置后再运行一次：

```bash
sudo nano /opt/wedscene-ai/.env
cd /opt/wedscene-ai
sudo bash setup-server.sh
```

## 配置环境变量

```bash
cp .env.example .env
nano .env
```

生产环境建议：

```env
PORT=5173
NODE_ENV=production
IMAGE_PROVIDER=n1n
OPENAI_API_KEY=你的_n1n_key
OPENAI_BASE_URL=https://api.n1n.ai/v1
OPENAI_PROVIDER_LABEL=n1n.ai
OPENAI_IMAGE_MODEL=gpt-image-2-all
ENABLE_COPY_API=true
COPY_MODEL=gpt-4.1
MOTION_DIRECTOR_MODEL=gemini-3.5-flash
COPY_REQUEST_TIMEOUT_MS=120000
STORYBOARD_IMAGE_SIZE=1536x864
USE_MOCK_IMAGES=false
PUBLIC_BASE_URL=https://你的公网域名
MOTION_VIDEO_MODEL=veo_3_1-fast-components-4K
MOTION_VIDEO_DURATION=8
MOTION_VIDEO_RESOLUTION=4K
JOB_POINT_COST=5
TEXT_POINT_COST=5
SIX_IMAGE_POINT_COST=30
MOTION_POINT_COST=60
RECHARGE_PLANS=39元=450灵感值;99元=1200灵感值;199元=2600灵感值;399元=5600灵感值
```

如果云服务器可以直接访问 n1n.ai，不要配置本地 `HTTPS_PROXY`。视频生成功能需要 `PUBLIC_BASE_URL` 是 n1n.ai 能访问到的公网地址，否则会自动走演示视频占位。

## 启动服务

无代理生产启动：

```bash
pm2 start npm --name wedscene-ai -- run start:prod
pm2 save
pm2 startup
```

如果服务器必须走代理，再使用：

```bash
pm2 start npm --name wedscene-ai -- run start:proxy
```

检查：

```bash
curl http://127.0.0.1:5173/api/health
pm2 logs wedscene-ai
```

## Nginx 反向代理

创建配置：

```bash
sudo nano /etc/nginx/sites-available/wedscene-ai
```

内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/wedscene-ai /etc/nginx/sites-enabled/wedscene-ai
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS

域名备案并解析到服务器后：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 文件与数据

当前 1.0 仍使用本地 `.data` 保存生成结果，适合小范围公测。正式收费前建议迁移：

1. 图片和 zip 包：腾讯云 COS。
2. 用户、任务、点数、订单：MySQL 或 PostgreSQL。
3. 备份：数据库每日备份，COS 开启生命周期和权限控制。

## 发布更新

```bash
cd /var/www/wedscene-ai
git pull
npm ci
npm run build
pm2 restart wedscene-ai
```

## 常见排查

1. 页面打不开：检查 `pm2 status`、`pm2 logs`、Nginx 配置和安全组端口。
2. 生图失败：检查 `.env`、n1n key、服务器能否访问 API。
3. 下载失败：检查 `.data` 目录权限。
4. 上传失败：检查 Nginx `client_max_body_size` 和后端 10MB 限制。
