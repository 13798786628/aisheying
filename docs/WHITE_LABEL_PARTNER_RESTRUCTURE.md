# WedScene AI 白标代理与多租户重构方案

## 一句话判断

客户提出的“换成他的 Logo、绑定他的域名、他分享出去就是他的品牌”，本质不是单次定制网页，而是一个可以收费的白标代理体系。建议把现有产品从“单一 WedScene 工具站”升级为“总部平台 + 代理品牌站 + 分享归因”的多租户系统。

## 现有基础

当前项目已经具备白标化的核心底座：

- 账号系统：`.data/users.json` 已有用户、点数、登录码、会员有效期等字段。
- 管理后台：`admin.html` + `/api/admin/accounts` + `/api/admin/recharge` 已支持创建账号和加点。
- 资源归属：`.data/resources-manifest.json` 已有 `ownerId`、`ownerLogin`。
- 静态品牌位置：`index.html`、`login.html` 目前 Logo 和品牌名写死为 WedScene。
- 单域名配置：`site-config.js` 目前只处理 API 地址，没有租户、品牌、域名解析逻辑。

所以不建议重写系统，建议在现有账号和资源体系上加一层 `tenant / partner`。

## 商业模式

### 1. 代理会员制

适合婚礼策划公司、主持团队、摄影摄像团队、婚庆培训机构。

收费方式：

- 入驻费：一次性收 999 到 2999 元，用于开通白标后台、上传 Logo、配置分享页。
- 月费：199 到 699 元/月，按品牌站能力和额度分档。
- 点数批发：代理用较低成本买点，再给自己的客户使用或转售。
- 超额抽成：客户在代理站充值时，平台抽取 20% 到 40%。

推荐套餐：

| 档位 | 价格 | 权限 |
| --- | --- | --- |
| 联盟代理 | 199 元/月 | 同域名分享页换 Logo，代理可查看自己的客户和订单 |
| 白标代理 | 699 元/月 | 独立 Logo、品牌名、联系方式、二维码、自定义分享链接 |
| 品牌站 | 1999 元/年起 | 绑定独立域名，隐藏 WedScene，代理拥有子后台 |

### 2. 同域名轻白标

这是最先上线、成本最低的版本。

形式：

```text
https://你的域名.com/?partner=abc
https://你的域名.com/share/abc/resource_xxx
https://你的域名.com/invite/abc
```

用户通过代理链接注册后，自动归属到代理。以后他登录、生成、分享时默认显示代理 Logo。

优点：

- 不需要客户备案、解析域名。
- 上线快。
- 适合先验证代理需求。

缺点：

- 浏览器地址栏还是你的主域名。
- 对强品牌客户吸引力不如独立域名。

### 3. 独立域名白标

形式：

```text
https://ai.某婚礼公司.com
https://wed.某主持团队.cn
```

代理把 CNAME 或 A 记录解析到你的服务器。服务器根据 `Host` 识别租户，返回对应 Logo、品牌名、客服微信、价格、注册归属。

优点：

- 客户感知是代理自己的 AI 工具。
- 代理更愿意付年费。
- 可谈城市独家、行业独家、培训机构合作。

缺点：

- 需要处理备案、SSL、域名映射、误配置提示。
- 后台必须有租户隔离和权限边界。

## 产品权限设计

### 平台总管理员

你自己使用。拥有全部权限：

- 创建代理。
- 绑定域名。
- 审核 Logo。
- 设置代理点数成本。
- 查看全部用户、任务、充值、消耗。
- 给代理加点、冻结代理、转移客户。

### 代理管理员

客户使用。只能管理自己名下内容：

- 修改自己的 Logo、品牌名、客服微信、二维码、宣传文案。
- 创建或查看自己邀请来的用户。
- 给自己客户加点。
- 查看自己的客户生成记录。
- 获取自己的邀请链接和分享链接。
- 查看收入、点数消耗、分润记录。

### 普通用户

通过某个代理链接注册或访问时：

- 登录页显示代理 Logo。
- 首页显示代理品牌。
- 资源分享页显示代理品牌。
- 点数不足时联系代理客服，而不是联系平台总客服。
- 生成的资源归属用户，同时带上代理归属。

## 核心规则

### 品牌显示优先级

页面显示哪个 Logo，按这个顺序判断：

1. URL 里有 `?partner=abc`，优先显示这个代理品牌。
2. 当前域名绑定了代理，显示域名对应代理品牌。
3. 当前登录用户有 `tenantId`，显示用户所属代理品牌。
4. 资源分享链接有 `tenantId`，显示资源所属代理品牌。
5. 都没有则显示 WedScene 默认品牌。

### 分享归属规则

用户 A 属于代理 `tenant_a`，他分享出去的链接应包含品牌上下文：

```text
/share/resource_xxx?t=tenant_a
/r/resource_xxx
```

打开分享页时：

- 页面 Logo 用 `tenant_a`。
- 联系方式用 `tenant_a`。
- 新访客点击注册时自动带上 `tenant_a`。
- 新用户注册后 `tenantId = tenant_a`。

### 域名识别规则

每次请求根据 `Host` 查找租户：

```text
ai.brand-a.com -> tenant_a
video.brand-b.cn -> tenant_b
www.你的主站.com -> default
```

如果 Host 未配置：

- API 返回默认品牌。
- 管理后台提示“域名未绑定代理”。
- 不影响主站访问。

## 数据结构建议

短期仍可使用 JSON 文件，后期建议迁移 SQLite 或 PostgreSQL。

### tenants.json

```json
{
  "tenants": [
    {
      "id": "tenant_xxx",
      "slug": "brand-a",
      "name": "某某婚礼影像",
      "status": "active",
      "plan": "white_label",
      "logoUrl": "/tenant-assets/tenant_xxx/logo.png",
      "brandColor": "#111827",
      "supportWechat": "brand_wechat",
      "supportWechatQr": "/tenant-assets/tenant_xxx/wechat.png",
      "domains": ["ai.brand-a.com"],
      "adminUserIds": ["user_xxx"],
      "createdAt": "2026-06-04T00:00:00.000Z",
      "updatedAt": "2026-06-04T00:00:00.000Z"
    }
  ]
}
```

### users.json 增加字段

```json
{
  "tenantId": "tenant_xxx",
  "tenantRole": "tenant_admin",
  "invitedByTenantId": "tenant_xxx"
}
```

`tenantRole` 建议取值：

- `platform_admin`
- `tenant_admin`
- `member`

### resources-manifest.json 增加字段

```json
{
  "tenantId": "tenant_xxx",
  "shareTenantId": "tenant_xxx",
  "shareSlug": "abc123"
}
```

资源本身还是属于用户，但展示品牌归属代理。

### ledger 增加字段

```json
{
  "tenantId": "tenant_xxx",
  "source": "tenant_recharge",
  "commissionAmount": 19.8
}
```

用于后续分润和代理结算。

## API 重构

### 公开品牌 API

```text
GET /api/site-context?partner=abc
```

返回：

```json
{
  "tenant": {
    "id": "tenant_xxx",
    "slug": "brand-a",
    "name": "某某婚礼影像",
    "logoUrl": "/tenant-assets/tenant_xxx/logo.png",
    "supportWechat": "brand_wechat",
    "supportWechatQr": "/tenant-assets/tenant_xxx/wechat.png"
  },
  "defaultTenant": false
}
```

前端 `index.html`、`login.html` 进入页面先请求这个接口，再替换 Logo、品牌名、客服信息。

### 平台管理员 API

```text
GET    /api/admin/tenants
POST   /api/admin/tenants
PATCH  /api/admin/tenants/:id
POST   /api/admin/tenants/:id/logo
POST   /api/admin/tenants/:id/domains
DELETE /api/admin/tenants/:id/domains/:domain
```

使用现有 `ADMIN_TOKEN` 即可，后续可升级为平台管理员账号。

### 代理管理员 API

```text
GET   /api/tenant/admin/dashboard
PATCH /api/tenant/admin/profile
POST  /api/tenant/admin/logo
GET   /api/tenant/admin/accounts
POST  /api/tenant/admin/accounts
POST  /api/tenant/admin/recharge
GET   /api/tenant/admin/invite-link
```

注意：代理管理员接口必须强制过滤 `tenantId`，不能让代理看到其他代理客户。

### 注册和登录

注册接口增加租户上下文：

```text
POST /api/account/register
```

请求体增加：

```json
{
  "tenantId": "tenant_xxx",
  "partner": "brand-a"
}
```

后端不要完全信任前端传入的 `tenantId`，应优先用服务端解析：

- 当前域名绑定的 tenant。
- 邀请链接里的 partner。
- 分享资源里的 tenant。

## 前端重构

### 不再写死品牌

当前 `index.html` 顶部 Logo 和 `login.html` 登录页 Logo 写死。建议改为：

```html
<img data-brand-logo alt="" hidden>
<span data-brand-name>WedScene</span>
```

然后 `app.js` 或新增 `site-context.js` 统一替换：

```js
applyBrand(siteContext.tenant)
```

### 页面要替换的内容

- 顶部 Logo。
- 品牌名。
- 登录页 Logo。
- 页面标题 `document.title`。
- 联系客服微信。
- 客服二维码。
- 分享页 Open Graph 标题和图片。
- 点数不足提示。
- 注册成功提示。

### 管理后台拆分

当前 `admin.html` 是平台总后台。建议保留，并新增：

```text
tenant-admin.html
/tenant-admin
```

代理管理员打开的是自己的后台，避免误接触平台总权限。

## 技术实施阶段

### 第一阶段：7 天内可上线的轻白标

目标：先卖起来，验证客户是否愿意付钱。

改造内容：

- 新增 `.data/tenants.json`。
- 新增 `/api/site-context`。
- 用户注册时写入 `tenantId`。
- 首页和登录页支持动态 Logo、品牌名、客服微信。
- 平台后台可创建代理，生成邀请链接。
- 分享链接带 `tenantId` 或 `partner`。

这一阶段不用先做独立域名，先用同域名邀请链接。

### 第二阶段：独立域名白标

目标：提升客单价。

改造内容：

- `Host` 解析租户。
- 租户域名配置。
- Nginx 支持多域名转发到同一个 Node 服务。
- 自动或手动配置 SSL。
- 域名未绑定提示。
- `PUBLIC_BASE_URL` 改为按请求动态生成，不能再只有一个全局值。

注意：当前视频接口依赖 `PUBLIC_BASE_URL` 给上游拉图。多域名后，建议新增：

```js
publicAbsoluteUrl(req, path)
```

优先使用当前请求域名，必要时回退平台主域名。

### 第三阶段：代理结算和分润

目标：让代理有动力推广。

改造内容：

- 每笔充值写入 `tenantId`。
- 计算代理收益和平台收益。
- 代理后台显示客户数、消耗点数、充值金额、待结算金额。
- 支持导出明细。
- 支持冻结代理和用户。

### 第四阶段：数据库化

目标：避免 JSON 文件并发写入和数据膨胀风险。

建议迁移：

- SQLite：适合单机部署，最快。
- PostgreSQL：适合多服务器和更长期 SaaS。

推荐表：

```text
tenants
tenant_domains
users
resources
jobs
ledger
tenant_invites
tenant_settlements
```

## 关键风险

### 不要让代理直接改整站 HTML

如果每个客户都单独复制一份网页，以后功能升级会失控。正确做法是同一套代码读取不同租户配置。

### 不要只换 Logo 不做归属

只换 Logo 没有商业闭环。必须记录：

- 谁邀请来的用户。
- 谁产生了消耗。
- 谁该拿分润。
- 分享页属于哪个品牌。

### 独立域名不能用全局 PUBLIC_BASE_URL

当前系统有 `PUBLIC_BASE_URL` 全局配置。多域名后，资源公开 URL 和视频参考图 URL 要按请求域名或租户主域名生成，否则代理域名下分享出去可能跳回主站。

### 权限隔离必须先做

代理管理员只能看自己的用户和资源。所有代理后台 API 都要按 `tenantId` 过滤，不能只靠前端隐藏。

## 推荐落地顺序

1. 先做同域名白标代理，发布 `?partner=xxx` 邀请链接。
2. 用 3 到 5 个真实客户测试，他们是否愿意上传 Logo 并转发给客户。
3. 确认愿意付费后，再做独立域名和代理后台。
4. 当代理超过 10 个，迁移数据库。
5. 当代理开始收客户钱，做分润和结算报表。

## 对外销售话术

可以把它包装成：

```text
给婚礼人自己的 AI 视频和效果图工作台。
不用开发，不用买服务器，不用接 AI 接口。
上传你的 Logo，客户看到的是你的品牌。
你发出去的链接、客户注册、生成记录、后续充值，都归到你的品牌下面。
```

推荐报价：

```text
轻白标：199 元/月，主站链接带你的品牌 Logo。
独立品牌站：699 元/月，绑定你的域名，隐藏平台品牌。
城市合伙人：2999 元/年起，享受点数批发价和客户充值分润。
```

## 最小可行版本清单

- 平台后台创建代理。
- 代理有 `slug`、品牌名、Logo、客服微信、二维码。
- `/api/site-context` 能按 `partner` 或域名返回品牌。
- 首页和登录页动态显示品牌。
- 注册用户自动写入 `tenantId`。
- 资源和任务写入 `tenantId`。
- 分享链接保留品牌。
- 代理管理员能看到自己的客户。

这套最小版本完成后，就可以开始正式卖代理，不需要等完整 SaaS 全部做完。
