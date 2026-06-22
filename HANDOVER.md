# Back in Stock App — 交接 / 技术文档

> CINEGEARPRO「到货提醒（Email me when Available）」Shopify 自用 App 的**唯一权威技术文档**。
> 给以后重新部署、排障，或交给别的开发者接手用。最后更新：2026-06。

---

## 🔐 备份与账号清单（最重要，先守住这些）

> 光保存本地代码文件夹**不够**。代码已在 GitHub；但运行所需的服务器、数据库、密钥都在下面的在线账号里。**这 4 样任何一个丢了都可能无法恢复，请勿注销/删除：**

| # | 守住什么 | 在哪 / 地址 | 里面有什么（为什么不能丢） |
|---|---|---|---|
| 1 | **GitHub 仓库** | https://github.com/biglookshan-ai/back-in-stock-app | 全部源代码 + 历史。**这是代码的权威备份**，本地文件夹丢了可 `git clone` 找回 |
| 2 | **Railway 账号/项目** | railway.app（项目：back-in-stock-app-production） | 托管服务器 + **PostgreSQL 数据库（所有订阅记录！）** + 环境变量密钥（API secret、DATABASE_URL、RESEND_API_KEY）|
| 3 | **Shopify Partner 账号** | partners.shopify.com（Org: mungchill-test，App: Back In Stock Dev，client_id `97309ed8…`）| App 本体 + `SHOPIFY_API_SECRET` |
| 4 | **Resend 账号** | resend.com | 发邮件用的 `RESEND_API_KEY` |

**本地文件夹**：`~/back-in-stock-app/`。可留可不留（GitHub 已备份）；若要拷贝，记得带上隐藏的 `.git`、`.env`（Finder 按 `Cmd+Shift+.` 显示），`node_modules`/`build` 可不带（能重建）。

**数据库定期备份建议**：在 Railway 的 Postgres 插件里开自动备份 / 定期手动导出，订阅数据无价。

---

## 1. 这个 App 是做什么的

缺货商品页显示「Email me when Available」按钮 → 客人留邮箱订阅 → 到货后自动/手动发邮件提醒。
另含后台：订阅管理、按产品/变体聚合、实时库存查看、邮件模板编辑、CSV 导出等。

核心特点：
- **多仓库存判断**：只按「所选库存地点」（UK 的 CineGearPro Shop + External Warehouse）判断缺货，忽略 CN Warehouse。中国仓有货也照样显示提醒按钮。
- **预订品也能订阅**：缺货但「继续销售（Pre-Order）」的商品也显示按钮（可在设置里关）。
- **精准到变体 / barcode**：记录客人订阅的具体变体和 barcode。

---

## 2. 关键身份信息（最重要，先记这些）

| 项目 | 值 |
|---|---|
| **GitHub 仓库** | https://github.com/biglookshan-ai/back-in-stock-app |
| **Shopify App client_id** | `97309ed864212552105a92b64020fda9` |
| **Shopify App 名称** | `back-in-stock-dev`（Partner 后台显示 "Back In Stock Dev"） |
| **Shopify Org** | `mungchill-test` |
| **生产店铺** | cinegearpro.co.uk（`<store>.myshopify.com`） |
| **托管平台** | Railway |
| **生产 URL** | https://back-in-stock-app-production.up.railway.app |
| **唯一配置文件** | `shopify.app.toml`（已合并，删除了旧的多余配置） |

> ⚠️ 历史上仓库里曾有 3 个 `shopify.app.*.toml`（含占位符 URL 的废弃配置）。现已整理为**唯一一个 `shopify.app.toml`**，内容即生产配置。以后别再加多余的。

---

## 3. 技术栈

- **框架**：Remix（`@remix-run/node` ^2.16）+ `@shopify/shopify-app-remix` ^4.1
- **UI**：Polaris ^12 + App Bridge 4（嵌入式后台）
- **数据库**：PostgreSQL + Prisma ^6.2
- **邮件**：Resend（HTTP API）。**不用 SMTP**，因为 Railway 封了出站 SMTP 端口。
- **Storefront 按钮**：Theme App Extension（`extensions/back-in-stock/`）
- **Shopify API 版本**：代码 `ApiVersion.January25`（`app/shopify.server.ts`）；webhooks `2026-07`
- **Node**：22（Docker 镜像 `node:22-alpine`）

---

## 4. 架构 / 数据流

```
storefront 商品页
  │  ① 加载 Theme Extension 按钮（extensions/back-in-stock）
  │     button.liquid 注入 __BIS_DATA__/__BIS_INV__，back-in-stock.js 渲染按钮
  │  ② JS 调 App Proxy /apps/back-in-stock/availability → 按所选地点算"是否缺货"
  │  ③ 客人提交 → /apps/back-in-stock/subscribe
  ▼
App Proxy（Shopify 转发，带签名校验）
  │  /apps/back-in-stock/*  →  https://...railway.app/*
  ▼
Remix App（Railway）
  ├─ 公开路由：subscribe.tsx / availability.tsx / unsubscribe.tsx（authenticate.public.appProxy）
  ├─ 嵌入式后台：app.*.tsx（authenticate.admin）
  ├─ Webhooks：webhooks.*.tsx（inventory_levels/update 触发到货群发）
  ├─ Prisma → PostgreSQL（订阅、模板、设置、发信日志）
  └─ Resend → 发邮件
```

**到货自动通知链路**：Shopify 库存变动 → `inventory_levels/update` webhook → `webhooks.inventory.update.tsx` → `notifyVariantRestocked()` → 给该变体所有 ACTIVE 订阅发「到货」邮件。

---

## 5. 目录 / 关键文件

```
app/
  shopify.server.ts            # Shopify app 初始化（API version、session 存储）
  db.server.ts                 # Prisma client
  mailer.server.ts             # 邮件适配器（Resend / SMTP 自动选择）
  email-templates.server.ts    # 邮件模板引擎：默认模板 + 变量/条件渲染 + composeEmail(全局外壳)
  email-cards.ts               # 产品卡 HTML（客户端可用，无 prisma）
  models/
    subscription.server.ts     # 核心领域逻辑：建订阅、发确认/到货信、群发、设置读写、退订签名
    inventory.server.ts        # 实时库存：按地点名定位 UK/EW + 批量查变体 Available
  components/
    EmailEditor.tsx            # 富文本/代码双模式编辑器 + 可删除产品卡小卡片 + 插入变量
  routes/
    app._index.tsx             # Dashboard（统计 + 可点击导航模块）
    app.requests.tsx           # 请求列表（筛选/标签/群发/导出/库存列）⭐ 最复杂
    app.products.tsx           # 产品订阅（按产品/按变体切换 + 实时库存）
    app.products_.detail.tsx   # 某产品的订阅明细
    app.subscribers.tsx        # 订阅者列表 + 导出
    app.templates.tsx          # 自动发送模板（确认信 / 到货信）
    app.custom-templates.tsx   # 自定义模板库（手动群发用）
    app.email-shell.tsx        # 全局邮件页眉/页脚（统一编辑）
    app.settings.tsx           # 设置（按钮/发件人/发送规则/库存地点/品牌信息）
    app.variants.tsx           # 旧路由，已重定向到 /app/products?view=variant
    availability.tsx           # ⭐ App Proxy：按所选地点算每个变体是否显示按钮
    subscribe.tsx              # ⭐ App Proxy：接收订阅
    unsubscribe.tsx            # 退订
    webhooks.*.tsx             # 各 webhook 处理
extensions/back-in-stock/
  blocks/button.liquid         # 按钮 App Block（主题里添加）
  assets/back-in-stock.js      # 按钮渲染 + 库存判定 + 弹窗（⚠️ 必须 < 10KB，见踩坑6）
  assets/back-in-stock.css
  locales/en.default.json
prisma/
  schema.prisma                # 数据模型
  migrations/                  # 手写 SQL 迁移（无本地 Postgres，见第 7 节）
shopify.app.toml               # 唯一 app 配置
Dockerfile                     # Railway 构建
```

---

## 6. 环境变量（在 Railway 项目里设置）

| 变量 | 说明 |
|---|---|
| `SHOPIFY_API_KEY` | = client_id `97309ed864212552105a92b64020fda9` |
| `SHOPIFY_API_SECRET` | Shopify app 密钥（Partner 后台 App 设置里拿） |
| `SHOPIFY_APP_URL` | `https://back-in-stock-app-production.up.railway.app` |
| `SCOPES` | `read_inventory,read_products,read_locations` |
| `DATABASE_URL` | Railway Postgres 连接串（加 Postgres 插件后自动有） |
| `RESEND_API_KEY` | Resend API key（**设了才走 Resend**；不设会退回 SMTP） |
| `SHOP_CUSTOM_DOMAIN` | 可选 |

> `.env`（本地）里只有早期遗留的 `SMTP_*`，生产用 Resend，可忽略。`.env` 不进 git（含密钥）。

---

## 7. 数据库 / Prisma（重要：迁移是手写的）

- Provider：PostgreSQL（`prisma/schema.prisma`）。
- 模型：`Session`（Shopify 自带）、`Subscription`（核心订阅）、`EmailTemplate`（确认/到货）、`CustomTemplate`（自定义模板库）、`EmailLog`（发信记录）、`Settings`（店铺设置）。
- **开发环境连不上生产 Postgres**，所以迁移是**手写 SQL**：
  1. 改 `prisma/schema.prisma`。
  2. 在 `prisma/migrations/<时间戳>_<名字>/migration.sql` 写对应 `ALTER TABLE ...`。
  3. 本地跑 `npx prisma generate`（生成 client，给 TS 用）。
  4. `git push` → Railway 部署时 `prisma migrate deploy` 自动执行该 SQL。
- 千万别在生产用 `prisma migrate dev` 或 `db push`（会改坏/重置）。

---

## 8. 部署流程 ⭐（最常用，记牢）

### A. 改了**后端**（`app/`、`prisma/`、`package.json`）
```bash
git add -A && git commit -m "..." && git push
```
Railway 监听 GitHub，自动构建部署（Dockerfile：`npm ci` → `npm run build` → `docker-start`= `prisma generate && prisma migrate deploy && remix-serve`）。无需 shopify CLI。

### B. 改了**前台扩展或 app 配置**（`extensions/`、`shopify.app.toml`）
```bash
shopify app config use shopify.app.toml      # 确保用的是唯一生产配置
shopify app deploy --allow-updates --message "说明"
```
- `--allow-updates` 让它非交互式发布（CI 友好）。
- 发布后**主题里的按钮 block 会自动用新版本**，不用动主题。
- ⚠️ 部署会把 `shopify.app.toml` 里的 app_proxy / application_url / scopes 推到线上。**确认 toml 里是真实 Railway 地址，不是 `shopify.dev` 占位符**，否则会覆坏线上（历史踩坑，见第 9 节）。

### C. 改了数据库结构
见第 7 节（手写迁移 + git push）。

---

## 9. 踩坑记录（排障必看）⭐

1. **前台按钮突然不显示** —— 真凶往往是 `extensions/.../back-in-stock.js` 在 CDN **404**（扩展版本失效）。排查：在商品页控制台看 `window.__BIS_AVAIL__`（应有 `{产品id:{变体id:{show:true}}}`）和扩展 JS 的 src 是否能 fetch 到。修法：`shopify app deploy` 重新发布扩展。

2. **多仓库存判断** —— 按钮是否显示由 `availability.tsx` 按 `Settings.displayLocationIds`（设置→参与库存计算的地点）**求和**判断。**留空 = 统计全部地点**（包括 CN 仓），会导致中国仓有货时不显示按钮。生产应只勾 **CineGearPro Shop + External Warehouse**。

3. **online vs offline token** —— 后台页用 online token（嵌入式），App Proxy（subscribe/availability）用 **offline token**。改了 scopes（如加 `read_inventory`）要重装/重授权，否则会出现「后台看得到库存、前台 availability 报错」。

4. **App Proxy `url` 不能带路径** —— `shopify.app.toml` 的 `[app_proxy] url` 只能是域名根，storefront 的 `/apps/back-in-stock/subscribe` 会被转发到 `<url>/subscribe`。

5. **邮件外壳 HTML 结构** —— 全局页眉/页脚是 `<tr>` 行、正文可能是 `<div>`。直接拼进 `<table>` 会触发浏览器 foster-parenting 让 logo 跑到正文中间。解决：正文统一包进 `<tr><td>...</td></tr>` 单元格（见 `email-templates.server.ts` 的 `composeEmail`），且正文里别用裸 `<tr>`。

6. **back-in-stock.js 必须 < 10KB** —— 超过会触发 theme check 的 `AssetSizeAppBlockJavaScript` 警告。保持精简（只删注释/空行，逻辑别动）。

7. **PostgreSQL 搜索大小写敏感** —— Prisma `contains` 默认区分大小写，搜索一律加 `mode: "insensitive"`。

8. **导出 CSV** —— 走 action（POST intent="export"）返回字符串、前端 Blob 下载。**别用 GET fetch loader**（嵌入式 app 会返回渲染后的 HTML 文档，不是数据）。

9. **Remix runtime 用 `json()`** —— 不要用 `Response.json()`（在 remix-serve 下会 500），用 `@remix-run/node` 的 `json()`。

10. **后台返回按钮** —— 嵌入式 app（iframe + App Bridge）历史会多压一条，`navigate(-1)` 会退两步。各页用 `navigate("/app")` 固定回 Dashboard。

---

## 10. 本地开发

```bash
npm install
shopify app config use shopify.app.toml
shopify app dev        # 起隧道 + 本地 Remix，装到开发店测试
```
- 注意 `shopify.app.toml` 里 `automatically_update_urls_on_dev = false`，避免 dev 把生产 URL 改成隧道地址。要跑 dev 测扩展时小心别污染生产配置。
- 类型检查：`./node_modules/.bin/tsc --noEmit`（别用 `npx tsc`，会装错版本）。
- 构建：`npm run build`。

---

## 11. 后台功能清单（导航顺序）

1. **Back in Stock Dashboard**（`/app`）— 统计卡片 + 「所有订阅/产品/客人」可点击模块
2. **请求列表**（`/app/requests`）— 状态分页、搜索、Newsletter/标签/日期筛选、标签编辑（下拉选+新增）、取消/归档/删除、手动群发邮件、CSV 导出、**可用库存列（UK/EW）**
3. **产品订阅**（`/app/products`）— 按产品 / 按变体·Barcode 切换、排序、搜索、**实时库存列**、前台/后台链接
4. **订阅者**（`/app/subscribers`）— 列表 + 导出
5. **自定义模板**（`/app/custom-templates`）— 手动群发用的可复用模板（富文本编辑器 + 点击预览）
6. **自动发送模板**（`/app/templates`）— 确认信 / 到货信
7. **页眉页脚**（`/app/email-shell`）— 全局统一编辑邮件上/下标
8. **设置**（`/app/settings`）— 按钮文案/颜色、发件人、发送规则、**参与库存计算的地点**、品牌信息

---

## 12. 从零重新部署清单

1. Fork/clone 仓库，连到 Railway（或新建 Railway 项目 + Postgres 插件）。
2. 在 Shopify Partner 建/找到 app（或用现有 client_id `97309ed8...`）。
3. Railway 设好第 6 节所有环境变量。
4. 确认 `shopify.app.toml` 的 URL 都是该 Railway 域名（非占位符）。
5. `git push` → Railway 构建 + `prisma migrate deploy` 建表。
6. `shopify app config use shopify.app.toml && shopify app deploy --allow-updates` → 发布扩展 + 配置。
7. 在目标店铺安装 app（走 OAuth），授权 scopes。
8. 主题编辑器里把「Back in Stock 按钮」block 加到商品模板。
9. App 设置里勾选「参与库存计算的地点」（UK 两仓），配好发件人 / Resend。
10. 找个缺货商品验证按钮 + 订阅 + 收信。

---

## 13. 其它参考文档（仓库内，可能略旧，以本文件为准）

`README.md`、`SETUP.md`、`TECH_DESIGN.md`、`docs/*.md`（DEPLOYMENT / DEVELOPMENT / FEATURES / DEV-JOURNEY 等）。
