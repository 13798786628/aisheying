# GitHub 提交与 1.0 发布清单

## 每次提交前

1. 确认 `.env` 没有进入 Git。
2. 确认 `.data/`、`dist/`、`node_modules/`、日志和 zip 包没有进入 Git。
3. 确认根目录本地排查素材没有进入 Git，例如 `watermark-*.png`、`veo-*.png`、旧版 `assets/motion-demo-1.mp4`、`assets/motion-demo-2.mp4`、`assets/motion-demo.old.mp4`。
4. 运行：

```bash
npm.cmd run preflight
npm.cmd run build
```

Windows PowerShell 如果提示 `npm.ps1` 被执行策略拦截，就用上面的 `npm.cmd` 写法。

5. 本地打开：

```text
http://127.0.0.1:5173/?v=launch-pages#demo
```

6. 检查核心路径：

- 电影感分镜图按钮可用
- 类似婚礼按钮可用
- 只写标题文案按钮可用
- 客户资源库可见，且只展示图片/视频素材
- 公测说明、FAQ 可见
- 价格套餐、账号系统、点数规划不出现在客户页面

## 第一次上传 GitHub

当前这台电脑如果提示找不到 `git`，先安装 Git for Windows，再继续下面步骤。

建议步骤：

```bash
git init
git add .
git status
git commit -m "Release WedScene AI 1.0 beta"
git branch -M main
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

如果要明确标记 1.0 版本，再创建并推送 tag：

```bash
git tag -a v1.0.0 -m "WedScene AI 1.0"
git push origin v1.0.0
```

当前本机如果暂时没有安装 Git，不建议直接用 GitHub 网页拖整个项目文件夹上传，因为 `.env`、`.data`、`node_modules`、日志和本地排查素材容易被误传。优先安装 Git for Windows 后按上面的命令提交。

如果 `git status` 里出现以下内容，先停止：

- `.env`
- `.data/`
- `node_modules/`
- `dist/`
- `server.*.log`
- 任何包含真实 API key 的文件

## 1.0 云端上线前

1. 腾讯云轻量服务器准备好。
2. GitHub 仓库已创建。
3. 服务器上克隆仓库。
4. 服务器 `.env` 单独配置真实密钥。
5. `npm ci && npm run build` 成功。
6. `pm2 start npm --name wedscene-ai -- run start:prod` 成功。
7. `/api/health` 返回 `openaiEnabled: true`。
8. Nginx 反向代理可访问。
9. 客户用真实照片至少测试 3 次。

## 1.0 不要急着做的事

1. 不要一开始做复杂会员等级。
2. 不要一开始接全自动支付。
3. 不要一开始大规模开放注册。
4. 不要把生成资源长期放在服务器本地作为正式方案。
5. 不要把 API key 放到前端或 GitHub。
