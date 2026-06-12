# CINEGEARPRO 到货提醒 App — 完整开发文档

> 版本 v1.0（开发/测试完成）｜ 2026-06-12
> 类型：Shopify **Custom App（自用 / 未上架，CLI + Custom distribution）**
> 仓库：`~/back-in-stock-app/` ｜ App handle：`back-in-stock-dev`

---

## 1. 产品概述

缺货商品上展示「Email me when Available」按钮 → 客户填邮箱订阅(精准记录变体 barcode)→ 商品到货时自动发邮件 → 后台完整统计 + 全可自定义邮件/弹窗。功能对标成熟商业 app(SW Back in Stock / Swym / Klaviyo back-in-stock)。

### 核心能力
1. **双状态按钮**:缺货不可售(deny)/ 缺货可预订(continue)都显示按钮。
2. **按库存地点判定**:多仓场景,只统计所选地点库存决定按钮显示与到货触发。
3. **弹窗订阅**:邮箱 + 姓名 + 变体选择(只列需订阅的变体)+ 营销同意;全文案/样式可视化自定义。
4. **邮件闭环**:订阅确认信 + 到货信,品牌化模板(logo/产品卡/公司页脚),实时预览,可恢复默认。
5. **后台**:总览统计 / 产品订阅(可下钻看客户)/ 订阅者(可下钻看产品)/ 请求列表(状态分页 + 取消/归档/删除)/ 邮件模板 / 设置。
6. **转化追踪**:订阅后下单 → 标记「已订购」(需 Protected customer data 权限)。
7. **防重复**:同邮箱同变体唯一;已在等待中重复订阅不重发确认信。

---

## 2. 技术栈

| 层 | 选型 | 版本/说明 |
|---|---|---|
| 框架 | Remix + `@shopify/shopify-app-remix` | ^4.1.0,Node 适配器 |
| 后台 UI | Polaris ^12 + App Bridge ^4 | 嵌入 admin |
| Storefront | Theme App Extension（App Block） | Liquid + 原生 JS + CSS 变量 |
| DB / ORM | Prisma ^6 + SQLite(dev) | 生产换 Postgres / Cloudflare D1 |
| 邮件 | Nodemailer SMTP（Lark）| 抽象为 `MailerAdapter`,可换 Resend |
| 运行(dev) | `shopify app dev` + cloudflared 隧道 | 生产换固定域名 |

`distribution: AppDistribution.SingleMerchant`(自用)。`future.unstable_newEmbeddedAuthStrategy: true`。

---

## 3. 系统架构

```
 Storefront(主题)                  Back-in-Stock App(Remix/Node)              外部
┌────────────────┐  App Proxy  ┌──────────────────────────────┐
│ Theme Extension │──同源 POST──►│ /subscribe   公开订阅接口        │
│  按钮/弹窗 JS    │             │ /availability 分地点库存判定      │
│  (block设置驱动) │◄──JSON──────│ /unsubscribe  退订(HMAC)        │
└────────────────┘             │                              │
                                │ /app/*  Polaris 后台(6 页)     │
 Shopify Webhooks               │ ┌────────┐  ┌─────────┐       │
 inventory_levels/update ──────►│ │ Prisma │  │ Mailer  │──SMTP─┼─► Lark → 客户
 products/update         ──────►│ │(SQLite)│  │ adapter │       │
 orders/create(需审批)   ──────►│ └────────┘  └─────────┘       │
 app/uninstalled         ──────►│  webhook 经 afterAuth 自动注册   │
                                └──────────────────────────────┘
```

---

## 4. 数据模型（`prisma/schema.prisma`）

- **Session**：Shopify 会话(模板自带)。
- **Subscription**：订阅核心。字段:`shop, email, productId, variantId, barcode, customerName, marketingConsent, productTitle, variantTitle, productHandle, productImage, price, status, source, locale, createdAt, notifiedAt, orderedAt`。
  - 唯一约束 `@@unique([shop, email, variantId])`；索引 `[shop,variantId,status]`、`[shop,createdAt]`。
  - `status`：`ACTIVE`(等待)/`NOTIFIED`(已发送)/`ORDERED`(已订购)/`CANCELLED`(已取消)/`ARCHIVED`(已归档)。
- **EmailTemplate**：`shop, type(CONFIRMATION|BACK_IN_STOCK), subject, htmlBody, enabled`，唯一 `[shop,type]`。
- **EmailLog**：发信统计(自存,不依赖邮件商):`shop, subscriptionId, type, toEmail, status(SENT|FAILED), error, sentAt`。
- **Settings**：店铺配置 —— 按钮文案/色、`showWhenPreorder`、`fromName/fromEmail`、`minStockThreshold`、`notifyAtZeroIfContinueSelling`、`displayLocationIds`(逗号分隔 location gid)、品牌 `logoUrl/brandColor/websiteUrl/companyAddress/supportEmail`。

迁移:`init` → `add_match_features` → `pro_email_templates`(见 `prisma/migrations/`)。

---

## 5. 路由 / 文件清单（`app/`）

**公开接口(经 App Proxy `/apps/back-in-stock/*`)**
- `routes/subscribe.tsx` — POST 订阅。Admin API 复核变体,抓 barcode/图/价/币种,upsert + 确认信。返回 `{ok, already}`。
- `routes/availability.tsx` — GET 按所选地点算每个变体是否显示按钮(storefront 拿不到分仓库存)。
- `routes/unsubscribe.tsx` — GET 退订,HMAC 签名 token。

**Webhooks**
- `webhooks.inventory.update.tsx` — 库存变化 → 按地点/阈值/可预订判定 → 到货群发。
- `webhooks.products.update.tsx` — 变体级兜底触发。
- `webhooks.orders.create.tsx` — 转化追踪(默认注释,需 Protected data)。
- `webhooks.app.uninstalled.tsx` — 卸载清理本 app 数据。
- `webhooks.app.scopes_update.tsx` — 模板自带。

**后台(Polaris,`app.tsx` 为布局 + 导航)**
- `app._index.tsx` 总览(总订阅/等待/已发送/转化/累计发信 + 热门缺货 Top10)
- `app.products.tsx` 产品订阅(聚合) + `app.products_.detail.tsx` 下钻看客户
- `app.subscribers.tsx` 订阅者(按人聚合 + CSV 导出) + `app.subscribers_.detail.tsx` 下钻看产品
- `app.requests.tsx` 请求列表(状态分页 + 搜索 + 取消/归档/恢复/删除)
- `app.templates.tsx` 邮件模板(左编辑右实时预览 + 恢复默认 + 发测试)
- `app.settings.tsx` 设置(按钮/发送规则/小部件显示规则/品牌/发件人)

**服务端模块**
- `shopify.server.ts` — shopifyApp 配置 + `webhooks` 声明 + `afterAuth` 自动注册 webhook。
- `db.server.ts` — Prisma 单例。
- `models/subscription.server.ts` — 领域逻辑:`getSettings`、退订签名、`createSubscription`(防重复+确认信)、`notifyVariantRestocked`(先到先得+已通知不重发)、`markOrdered`、统一 `sendEmail`(组装品牌+产品变量 → 渲染 → 发 → 写 EmailLog)。
- `email-templates.server.ts` — 模板变量/条件渲染(`{{var}}`、`{{#if}}`、`{{#unless}}`)+ 品牌化默认模板 + 取/存。
- `mailer.server.ts` — `MailerAdapter` 接口 + `SmtpMailer`(未配置时 dev 打印不发)。

**Theme Extension（`extensions/back-in-stock/`）**
- `blocks/button.liquid` — App Block。输出 `{{ product | json }}` + Liquid 算的 `__BIS_INV__`(分变体真实库存)+ 大量 `data-*`(文案/样式/proxy);`{% schema %}` 暴露全部可视化设置。
- `assets/back-in-stock.js` — 库存状态判定(优先 `/availability` 后端结果,回退 Liquid)、按钮渲染、弹窗(变体过滤、姓名、营销、成功/已订阅/错误文案)、`applyStyles` 把设置写成 CSS 变量、变体切换重渲染。
- `assets/back-in-stock.css` — 全部用 `var(--bis-*, 默认)` 驱动。
- `locales/en.default.json`。

---

## 6. 关键业务逻辑

### 6.1 按钮显示状态(storefront)
经 `/availability`:对每个变体,汇总**所选地点**(空=全部)的 available。`stock<=0` 视为缺货 → `DENY` 显示(状态 B);`CONTINUE` 且开启 `showWhenPreorder` 显示(状态 A)。前端只把「需订阅」的变体放进弹窗下拉,杜绝误订有货变体。

### 6.2 到货触发(后端)
`inventory_levels/update` → 查变体各地点库存 → 按所选地点求和 → `>= minStockThreshold` 触发;`notifyAtZeroIfContinueSelling` 时可预订商品到 0 也触发。`notifyVariantRestocked` 取该变体所有 `ACTIVE` 订阅,按 `createdAt` 顺序发,成功置 `NOTIFIED`,每封间隔限速;已 `NOTIFIED` 不重发。

### 6.3 邮件
变量含品牌(logo/色/网站/地址/客服)+ 产品(图/价/标题/变体/链接)+ 客户。模板支持条件块,空值优雅降级(无图不留破图)。确认信在「首次/重新激活」时发,已在等待中重复订阅不发。

---

## 7. Shopify / App 规范要点

- **Scopes**:`read_products, read_inventory, read_locations`(+ `read_orders` 仅在开启转化追踪并通过 Protected customer data 审批后)。
- **App Proxy**:`[app_proxy] url` 不带路径;subpath `back-in-stock`、prefix `apps`。
- **Webhooks**:经 `afterAuth` 代码注册(dev 可靠);生产 `shopify app deploy` 同步声明式配置。
- **受保护客户数据**:`orders/create` 需 Developer Dashboard 申请。
- **合规**:每封邮件含退订链接(HMAC);卸载 webhook 清数据;邮箱属个人数据需隐私声明;生产配 SPF/DKIM/DMARC。
- **验证**:`tsc --noEmit` + `npm run build` + `prisma migrate` + 直接查 DB / `nodemailer.verify()`(嵌入式 app 无浏览器 preview)。

---

## 8. 已知限制 / 后续

- SQLite + cloudflared 仅 dev;生产需 Postgres/D1 + 固定域名(见 `DEPLOYMENT-CLOUDFLARE.md`)。
- SMTP 有每日发信上限;大促/Workers 环境需切 Resend(adapter 已留)。
- 群发为内联顺序发;高并发需队列(BullMQ / Cloudflare Queues)。
- 转化追踪默认关闭(等 Protected data 审批)。
- 可选增强:多语言、折扣码、推荐商品、Web Push、A/B 测试。
