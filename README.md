# WedScene AI 一键生成爆款图文

上传一张婚礼现场照片或设计图，生成婚礼分镜、类似婚礼参考素材、布置前后对比图，或把婚礼设计图渲染成真实现场候选图。默认模式会生成摄像师专业横版分镜图，保留现场照色调，重点渲染花艺、道具、灯光等细节，方便后续做大片感婚礼视频。

## 当前开放功能

- 电影感分镜图：根据现场照生成 6 个横版视频分镜镜头，默认 `1536x864`
- 类似婚礼：根据这场婚礼生成其他类似的婚礼，生成 6 张，比例跟上传图一致，相似但不重复
- 布置前后对比图：上传 1 张现场图，生成 1 张布置后效果图，并合成 `1080x1440` 的 3:4 上下 2 宫格
- 设计图转实景：上传 1 张婚礼设计图/效果图，生成 1 张 `1536x864` 真实现场图，不合成上下对比图
- 只写标题文案：上传婚礼图片后不生图，直接根据画面生成爆款标题、正文和话题
- 分镜总览：电影感分镜会自动拼成 `1080x1440` 纯图片总览
- 爆款标题文案：优先走 `gpt-4.1` 看图写中文标题、正文、话题标签，失败时自动使用本地兜底文案；视频提示词整理单独走 `gemini-3.5-flash`
- 资源库：生成完成后自动保存图片和视频素材，客户可预览、放大和逐张保存
- 页面导航：顶部菜单切换独立页面，不再把所有内容堆在一条长页里
- 公测访问码：可选开启，方便小范围邀请客户测试
- 1.0 手动充值：可选开启账号登录、试用点数、生成扣点和管理员手动加点
- 其他功能在用户端显示“申请使用”

## 本地运行

```bash
npm install
npm run build
npm start
```

默认访问：

```text
http://127.0.0.1:5173
```

没有配置真实生图密钥时，后端会进入演示模式，完整跑通上传、任务进度、生图、爆款首图和文案链路。

## 图片接口配置

复制 `.env.example` 为 `.env`，填入你的真实密钥：

```bash
IMAGE_PROVIDER=n1n
OPENAI_API_KEY=你的_n1n_key
OPENAI_BASE_URL=https://api.n1n.ai/v1
OPENAI_PROVIDER_LABEL=n1n.ai
OPENAI_IMAGE_MODEL=gpt-image-2-all
OPENAI_IMAGE_FALLBACK_MODELS=gpt-image-2
N1N_IMAGE_INPUT_MODE=auto
OPENAI_IMAGE_QUALITY=medium
STORYBOARD_IMAGE_SIZE=1536x864
CONSTRUCTION_CHECKLIST_IMAGE_SIZE=1536x864
CONSTRUCTION_CHECKLIST_HD_WIDTH=4096
CONSTRUCTION_CHECKLIST_DETAIL_EXPORTS=true
USE_MOCK_IMAGES=false
```

PowerShell 临时启动示例：

```powershell
$env:IMAGE_PROVIDER="n1n"
$env:OPENAI_API_KEY="你的_n1n_key"
$env:OPENAI_BASE_URL="https://api.n1n.ai/v1"
$env:OPENAI_PROVIDER_LABEL="n1n.ai"
$env:OPENAI_IMAGE_MODEL="gpt-image-2-all"
$env:STORYBOARD_IMAGE_SIZE="1536x864"
$env:CONSTRUCTION_CHECKLIST_HD_WIDTH="4096"
$env:USE_MOCK_IMAGES="false"
npm.cmd start
```

小鸡 / baziapi 图片接口已在后端禁用；服务商模型名请通过 `OPENAI_IMAGE_MODEL` 或 `OPENAI_IMAGE_FALLBACK_MODELS` 配置。

默认使用 `/v1/images/edits`，把用户上传的现场照作为 multipart 参考图文件发送给模型。这样生成图会围绕真实现场照的场地结构、机位、花艺、灯光和材质展开，而不是只按文字生成泛婚礼图。

如果服务商只支持 `/v1/images/generations` 的 JSON 参考图字段，可以改成：

```bash
N1N_IMAGE_INPUT_MODE=generations
N1N_IMAGE_GENERATIONS_ENDPOINT=https://api.n1n.ai/v1/images/generations
```

字段名要以服务商文档为准，可能是 `reference_images`、`image`、`reference_image` 或其他名称。

## 切换到 n1n.ai / OpenAI-compatible 图像 API

使用 n1n.ai 这类 OpenAI-compatible 接口时，把 `.env` 改成下面这样：

```bash
IMAGE_PROVIDER=n1n
OPENAI_API_KEY=你的_n1n_key
OPENAI_BASE_URL=https://api.n1n.ai/v1
OPENAI_PROVIDER_LABEL=n1n.ai
OPENAI_IMAGE_MODEL=gpt-image-2-all
OPENAI_IMAGE_FALLBACK_MODELS=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
ENABLE_COPY_API=true
COPY_MODEL=gpt-4.1
MOTION_DIRECTOR_MODEL=gpt-4.1
DOUBAO_VIDEO_PROMPT_MODEL=doubao-seed-2-0-lite-260428
COPY_REQUEST_TIMEOUT_MS=120000
STORYBOARD_IMAGE_SIZE=1536x864
USE_MOCK_IMAGES=false
PUBLIC_BASE_URL=https://你的公网域名
IMAGE_ENHANCE_POINT_COST=5
MOTION_VIDEO_MODEL=veo_3_1_fast_components_vip
MOTION_VIDEO_ENDPOINT=https://llm-api.net/v1/videos
MOTION_REFERENCE_LIMIT=3
MOTION_VIDEO_DURATION=10
MOTION_VIDEO_RESOLUTION=4K
MOTION_VIDEO_SIZE=1280x720
MOTION_VIDEO_POLL_INTERVAL_MS=5000
MOTION_POINT_COST=200
```

切换后重启服务即可。当前后端使用 n1n 文档里的 `/v1/images/edits` multipart 调用结构，会把上传的婚礼现场图作为参考图传给 `gpt-image-2-all`，继续保留“根据现场照生成分镜”的工作流。

爆款标题文案和视频提示词整理都使用同一个 `OPENAI_BASE_URL` 下的 `/chat/completions`，但模型分开配置：`COPY_MODEL` 用于小红书标题文案，`MOTION_DIRECTOR_MODEL` 用于站内视频运镜整理，`DOUBAO_VIDEO_PROMPT_MODEL` 专门用于根据分镜图生成豆包视频提示词。这个模型需要支持图片输入；如果 n1n 后台的文本/视觉模型名不同，只需要分别换成可用模型。如果暂时不想走文案接口，把 `ENABLE_COPY_API=false` 即可。

菜单栏的 AI 对话工具使用后端 `/api/chat` 代理到 `CHAT_API_ENDPOINT`，每次成功发送消耗 `CHAT_POINT_COST=1` 灵感值。失败会自动退回；如需切换模型，设置 `CHAT_MODEL=...`；如需固定到亚洲入口，设置 `CHAT_API_ENDPOINT=https://llm-api.net/v1/chat/completions`。

当前视频模式使用 n1n/llm-api 视频接口，按文档用参考图提交视频任务。当前接回的上游视频模型是 `veo_3_1_fast_components_vip`，支持 1-3 张有序参考图；前端保持线上版本的连续转场流程，后端会按上传顺序把参考图提交给该模型。`PUBLIC_BASE_URL` 必须是服务商能访问到的公网域名，否则上游无法拉取参考图。

## API

- `GET /api/health`：查看当前生图 provider 和模型
- `POST /api/chat`：AI 对话代理，字段为 `messages`、可选 `system` 和多张参考图 `images`
- `POST /api/jobs`：上传图片并创建任务，字段为 `image` 和 `mode`
- `GET /api/jobs/:id`：轮询任务进度和结果
- `GET /api/resources`：查看“我的资源”里已自动保存的素材
- `/generated/:jobId/...`：生成后的图片资源
- `/my-resources/:resourceId/...`：持久保存的客户查看资源

`mode` 支持：

- `similar_style`
- `setup_comparison`
- `design_render_scene`
- `cinematic_storyboard`
- `copy_title`

## 1.0 手动充值账号系统

1.0 可以先不接支付，开启账号系统后由管理员手动给客户加点。`.env` 示例：

```bash
ACCOUNT_SYSTEM_ENABLED=true
ACCOUNT_TOKEN_SECRET=换成一串随机密钥
TRIAL_POINTS=5
JOB_POINT_COST=5
TEXT_POINT_COST=1
IMAGE_ENHANCE_POINT_COST=5
SIX_IMAGE_POINT_COST=30
STORYBOARD_POINT_COST=50
DESIGN_RENDER_POINT_COST=5
ADMIN_TOKEN=换成管理员私密口令
RECHARGE_PLANS=29.9元=300灵感值;299元=3000灵感值;899元=11000灵感值;3980元=高级代理权益包
```

当前版本自助注册使用 11 位手机号作为账号，暂不要求短信验证码；后续短信通道准备好后再把 `PHONE_VERIFICATION_REQUIRED=true` 打开。

创建客户账号：

```bash
node scripts/account-admin.mjs create 13800138000 张三 3 246810
```

这会创建手机号账号 `13800138000`，初始密码 `246810`，初始 3 点。客户用手机号和密码进入网站。

手动充值：

```bash
node scripts/account-admin.mjs recharge 13800138000 1000 99元月度包
```

查看账号：

```bash
node scripts/account-admin.mjs list
```

开启账号系统后，后端会在创建生成任务前检查点数，点数不足会拒绝生成；任务创建成功扣 1 点；如果生成任务最终失败且无法继续，会自动退回点数。资源库会按账号隔离。

## 部署建议

这个版本带后端 API，优先部署到支持长期运行 Node 服务的平台。国内公测建议使用腾讯云轻量应用服务器 `2核4G5M` 起步，后续按量升级。

启动命令：

```bash
npm run build && npm start
```

如果云服务器不需要本地代理，使用：

```bash
npm run build
npm run start:prod
```

必须配置：

```text
IMAGE_PROVIDER=n1n
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_IMAGE_MODEL
```

不要把真实密钥写进前端、代码仓库或压缩包。

更多上线步骤见：

- `docs/LAUNCH_PLAN.md`
- `docs/TENCENT_CLOUD_DEPLOY.md`
- `docs/GITHUB_RELEASE_CHECKLIST.md`
- `docs/QA_1_0_CHECKLIST.md`
