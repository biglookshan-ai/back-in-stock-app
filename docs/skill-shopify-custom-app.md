---
name: shopify-custom-app-dev
description: End-to-end process for building a self-use (custom, unlisted) Shopify embedded app with a storefront Theme App Extension, App Proxy APIs, webhooks, and an admin dashboard — distilled from building CINEGEARPRO's back-in-stock app. Use when scaffolding, debugging dev tunnels/webhooks/auth, or planning a Shopify app.
metadata:
  type: reference
  domain: shopify
---

# Shopify 自定义 App 开发流程（自用 / 未上架）

一套从 0 到可上线的实战流程,适用于**自用 Custom distribution** 的嵌入式 app(后台 + storefront 注入 + webhook + 邮件等副作用)。

## 0. 关键概念(先建立正确心智)

- **App ≠ 住在 Shopify 里**。App 是**你自己的 Web 服务 + 数据库**,跑在你的服务器上;Shopify 只通过 **API / webhook** 提供店铺数据。订阅记录、统计、模板等业务数据存在 **app 自己的库**。
- **两种 "Custom App" 别混淆**:
  1. admin「Develop apps」创建 → 拿 Admin token,简单,但**没有 Theme App Extension / App Bridge**。
  2. **Shopify CLI 构建 + Custom distribution(未上架)** → 功能完整(主题扩展 + 嵌入式后台)。**要 storefront 按钮就必须用这个**。
- **新版 Developer Dashboard 的坑**:手动在 dashboard 建 app 再 `config link`,会出现 `application_url=https://shopify.dev/apps/default-app-home` 占位、URL 不自动更新等问题。**优先用 CLI 直接创建 app**(`shopify app dev --reset` → Create new app)。

## 1. 技术栈(推荐基线)

| 层 | 选型 |
|---|---|
| 框架 | Shopify **Remix App Template**(`@shopify/shopify-app-remix`) |
| 后台 UI | Polaris + App Bridge |
| Storefront 注入 | **Theme App Extension**(App Block) |
| DB / ORM | Prisma（dev: SQLite；prod: Postgres / Cloudflare D1） |
| 邮件 | **可插拔 MailerAdapter**：dev SMTP(nodemailer);Workers/边缘环境必须用 HTTP API(Resend) |
| 队列(大群发) | BullMQ+Redis 或 Cloudflare Queues |

## 2. 脚手架

```bash
# 官方模板（推荐 CLI 直接 init；也可 clone 模板仓库再 git init）
npm install -g @shopify/cli@latest
# 关键：让 CLI 创建 app，而不是关联手动建的
npm run dev -- --reset     # 选 “Create a new app”
```
- `shopify.server.ts`:`distribution: AppDistribution.SingleMerchant`(自用)。
- 模板自带 `shopify.web.toml.liquid` —— **手动搬文件时必须渲染成 `shopify.web.toml`**,否则 CLI 不启动 Remix 后端,app 首页一直是占位页。
- `prisma migrate dev` 建库;`tsc --noEmit` + `npm run build` 做静态验证(嵌入式 app 无法用浏览器 preview)。

## 3. 三大集成点 & 常见坑

### 3.1 嵌入式后台(Admin)
- 路由 `app.*.tsx`,`authenticate.admin(request)` 取 session/admin。
- **app 首页空白("Find this app in the pages where you work")** = `application_url` 是占位 / Remix 后端没起。查:`shopify.web.toml` 是否存在、进程里 `SHOPIFY_APP_URL` 是否隧道地址、`ps` 看 vite 进程是否在跑、`lsof` 看本地端口是否 200。
- 子路由不想嵌套进父布局 → 用 `app.parent_.child.tsx` 的**下划线**约定。

### 3.2 Storefront(Theme App Extension + App Proxy)
- **按钮/弹窗**:App Block(`blocks/*.liquid` + `assets/*.js,*.css`),商家在主题编辑器添加。文案/样式做成 **block settings**(`{% schema %}`),用 `data-*` 传给 JS,JS 用 **CSS 变量**应用样式 → 可视化自定义、不碰代码。
- **storefront 拿不到的数据**(分地点库存、`inventory_quantity`)→ 用 **App Proxy** 同源 `POST /apps/<subpath>/...` 回后端,`authenticate.public.appProxy(request)` 验签 + 拿 admin client。
- **App Proxy 致命坑**:`[app_proxy].url` **不能带路径**!dev 只替换域名、保留路径,带 `/apps/default-app-home` 会让请求落到 `/那段路径/subscribe` → 404。设成无路径的 HTTPS(如 `https://example.com`),dev 注入隧道域名后正好命中 `/subscribe`。
- 防滥用:CORS 同源(proxy 天然同源)、honeypot 隐藏字段、邮箱正则、后端用 Admin API **复核**前端提交(防篡改 barcode/价格)。

### 3.3 Webhooks
- **声明式(toml)webhook 在 dev 下常常不注册** → 到货等事件收不到。**可靠做法**:在 `shopifyApp()` 配 `webhooks` + `hooks.afterAuth` 调 `shopify.registerWebhooks({ session })`,每次认证按当前 `appUrl`(dev 隧道/prod 域名)注册。
- 诊断:`webhookSubscriptions` 这个 Admin 查询**不显示** app 级声明式订阅,空 ≠ 没注册;真正看「事件来没来」要看**服务端日志**。临时可用 Admin API `webhookSubscriptionCreate` 手动注册到当前隧道。
- **受保护客户数据**:`orders/*`、`read_orders`、`customers` 等需在 Developer Dashboard 申请 **Protected customer data access**,否则 `dev`/`deploy` 直接报错卡住启动。自用 app 提交表单一般即批。

## 4. 邮件 / 副作用

- **Shopify 没有事务性邮件 API**。"用 Shopify 自带邮件自动逐人触发"不可行;Shopify Email 是手动营销群发。
- 所以走自己的通道:**SMTP(dev/Node)** 或 **HTTP API(Resend,边缘/Workers 必须)**。把发信抽象成 `MailerAdapter`,统计写自己的 `EmailLog`(不依赖邮件商)。
- SMTP 认证失败 `535`:多为「用了登录密码而非客户端专用密码」/ 服务未开启 / 组织后台未放行第三方客户端。用 `nodemailer.verify()` 脱离 app 快速验证。

## 5. dev 工作流 & 高频排错速查

| 现象 | 多半原因 | 处理 |
|---|---|---|
| app 首页空白占位 | 后端没起 / URL 占位 | 建 `shopify.web.toml`;`--reset` 重建 app |
| storefront 提交 Network error | proxy 没注册 / url 带路径 | 配 `[app_proxy]`、url 去掉路径、重启 dev |
| 改库存收不到到货邮件 | webhook 没注册 | afterAuth 注册;看服务端日志而非 Admin 查询 |
| `Unknown argument xxx`(Prisma) | 迁移后没重启,进程用旧 client | 重启 dev |
| 公网地址连接被拒 | cloudflared 快速隧道掉了 | 重启 dev(或上线换固定域名) |
| dev 反复要 store password | 开发店没开 Online Store / 有密码保护 | 加 Online Store 渠道或关密码 |

## 6. 上线前清单

- [ ] DB 切 Postgres / D1(改 `provider` + `DATABASE_URL`,代码不动)
- [ ] App 部署到常驻主机 / 边缘(固定 HTTPS 域名)
- [ ] 邮件切 HTTP API(Resend)若在 Workers
- [ ] `shopify app deploy` 推 webhook / proxy / scopes 到生产
- [ ] 发件域名配 **SPF / DKIM / DMARC** 提升送达
- [ ] 大群发上队列;受保护数据走审批;退订/GDPR 合规
- [ ] 监控、错误上报、数据库备份

## 7. 验证哲学

嵌入式 app 大量逻辑无法用浏览器 preview 验证。**用静态 + 数据层验证**:`prisma validate/migrate`、`tsc --noEmit`、`npm run build`、直接 `sqlite3`/Admin API 查数据、`nodemailer.verify()`。能在不进 UI 的情况下定位 90% 的问题。
