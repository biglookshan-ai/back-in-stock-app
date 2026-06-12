# CINEGEARPRO 到货提醒 App — 技术设计文档

> 版本 v1.0 ｜ 2026-06-12
> 类型:Shopify **Custom App(自用 / 未上架)**
> 目标:产品缺货时展示「Email me when Available」按钮 → 客户订阅(精准到变体 barcode）→ 到货自动发信 → 后台完整统计 + 自定义邮件模板

---

## 0. 文档目的与范围

本文档定义该 App 的架构、数据模型、API、前端交互、库存判定与邮件流程,作为开发依据。

**范围内**:storefront 订阅按钮/弹窗、订阅数据采集、库存到货检测、邮件发送(确认/到货)、后台统计与模板管理。
**范围外(v1)**:短信/Push、多语言全量翻译、A/B 测试、Web Push。预留扩展位但不实现。

---

## 1. App 形态与关键决策

| 决策点 | 选择 | 说明 |
|---|---|---|
| 分发方式 | **Custom distribution(CLI 构建,未上架)** | 必须用 Shopify CLI 构建的 app,而非 admin 后台「Develop apps」创建的 app——因为只有前者支持 **Theme App Extension(storefront 按钮/弹窗)** 和 App Bridge 后台。 |
| 多租户 | 单店为主,**数据仍带 `shopId`** | 自用但保留隔离字段,日后若上架/多店零重构。 |
| 计费 Billing | **不做** | 自用免审核、免 Billing。 |
| App Store 审核 | **不走** | 但 GDPR/卸载清理仍建议保留(规范且低成本)。 |
| 邮件通道 | **SMTP 适配器(可插拔)** | 见第 7 节。统计自存,不依赖邮件商。 |

> 注意区分两种「Custom App」:
> - admin 后台创建的 → 拿到 Admin API token,简单,但**没有 Theme Extension / App Block**,只能改主题代码或 ScriptTag(不推荐)。
> - **CLI 构建 + Custom distribution → 本项目采用**,功能完整。

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| App 框架 | **Shopify Remix App Template** | 官方推荐,内置 OAuth/Session/Webhook 注册。 |
| 后台 UI | **Polaris + App Bridge** | Shopify 原生设计系统,嵌入 admin。 |
| Storefront 注入 | **Theme App Extension(App Embed Block)** | 不污染主题、客户端一键开关。 |
| DB | **PostgreSQL + Prisma** | 关系型,统计查询方便。 |
| 队列 | **BullMQ + Redis** | 到货群发限流、重试、去重。 |
| 邮件 | **Nodemailer(SMTP 适配器)** | 先 SMTP,接口化便于替换。 |
| 托管 | Fly.io / Railway / Render | 对 Remix 友好。 |

---

## 3. 系统架构

```
                         ┌────────────────────────────┐
   Storefront (主题)      │     Back-in-Stock App        │
 ┌──────────────────┐     │  (Remix on Node)             │
 │ Theme Extension  │     │                              │
 │  - 库存判定       │ AJAX │  ┌────────────┐              │
 │  - 按钮/Popup     ├─────►│  │ Public API │ 写订阅        │
 │  - 锁定 barcode   │     │  │ /subscribe │              │
 └──────────────────┘     │  └─────┬──────┘              │
                          │        ▼                     │
 ┌──────────────────┐     │  ┌────────────┐   ┌────────┐ │
 │ Shopify Webhooks │────►│  │  Postgres  │◄──┤ Admin  │ │
 │ inventory_levels │     │  │ (Prisma)   │   │ Polaris│ │
 │ products/update  │     │  └─────┬──────┘   └────────┘ │
 └──────────────────┘     │        ▼                     │
                          │  ┌────────────┐   ┌────────┐ │
                          │  │ BullMQ Job │──►│ Mailer │─┼──► SMTP → 客户
                          │  │ (到货群发)  │   │ adapter│ │
                          │  └────────────┘   └────────┘ │
                          └────────────────────────────┘
```

---

## 4. 库存状态判定(核心逻辑)

### 4.1 关键字段
```
variant.inventory_quantity   // 库存数
variant.inventory_policy     // "deny"(不可超卖) | "continue"(可超卖=可预订)
variant.available            // 是否可购买
variant.barcode              // ★ 需精准记录
```

### 4.2 需要显示「Email me when Available」的两种状态

| 状态 | 条件 | 备注 |
|---|---|---|
| A. 缺货可预订 | `inventory_quantity <= 0 && inventory_policy === "continue"` | 此时仍可「加入购物车」。后台开关决定是否同时显示「预订」+「到货提醒」。 |
| B. 缺货不可预订 | `inventory_quantity <= 0 && inventory_policy === "deny"`(即 `available === false`) | 只显示「到货提醒」。 |

### 4.3 前端取数与变体切换
- 主题模板用 Liquid 输出当前产品 JSON:`<script>window.__BIS_PRODUCT__ = {{ product | json }}</script>`(由 Theme Extension 注入)。
- 监听变体切换:`?variant=` URL 变化 / 主题 `variant:change` 事件 → 重新判定状态、刷新按钮、**重置锁定的 variantId + barcode**。
- 兜底:若主题不暴露事件,用 Storefront AJAX `/products/{handle}.js` 拉取变体数组。

> ★ barcode 来源:从当前选中 variant 对象直接读 `barcode` 字段,提交订阅时一并发送,后端再用 Admin API 校验一次(防篡改)。

---

## 5. 数据模型(Prisma schema 摘要)

```prisma
model Shop {
  id          String   @id @default(cuid())
  domain      String   @unique
  accessToken String
  installedAt DateTime @default(now())
  settings    Settings?
  subscriptions Subscription[]
}

model Subscription {
  id            String   @id @default(cuid())
  shopId        String
  email         String
  productId     String
  variantId     String
  barcode       String?               // ★ 精准记录
  productTitle  String                // 快照,防改名
  variantTitle  String
  status        SubStatus @default(ACTIVE) // PENDING/ACTIVE/NOTIFIED/CANCELLED
  source        String?               // product_page / collection
  locale        String?
  createdAt     DateTime @default(now())   // ★ 订阅时间
  notifiedAt    DateTime?                  // ★ 到货发信时间
  shop          Shop @relation(fields:[shopId], references:[id])
  emailLogs     EmailLog[]
  @@index([shopId, variantId, status])
  @@unique([shopId, email, variantId])      // 同邮箱同变体不重复订阅
}

model EmailTemplate {
  id        String   @id @default(cuid())
  shopId    String
  type      EmailType            // CONFIRMATION / BACK_IN_STOCK
  subject   String
  htmlBody  String
  enabled   Boolean  @default(true)
  @@unique([shopId, type])
}

model EmailLog {
  id             String   @id @default(cuid())
  shopId         String
  subscriptionId String
  type           EmailType
  status         String   // SENT / FAILED / BOUNCED
  error          String?
  sentAt         DateTime @default(now())
  subscription   Subscription @relation(fields:[subscriptionId], references:[id])
}

model Settings {
  id              String  @id @default(cuid())
  shopId          String  @unique
  buttonText      String  @default("Email me when Available")
  buttonColor     String  @default("#000000")
  showWhenPreorder Boolean @default(true)   // A 状态是否显示提醒
  doubleOptIn     Boolean @default(false)   // 是否需邮件二次确认
  fromName        String?
  fromEmail       String?
}

enum SubStatus { PENDING ACTIVE NOTIFIED CANCELLED }
enum EmailType { CONFIRMATION BACK_IN_STOCK }
```

---

## 6. API 设计

### 6.1 Storefront 公开接口(被 Theme Extension 调用)
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/subscribe` | body: `{email, productId, variantId, barcode, source}`。校验邮箱格式 → 用 Admin API 复核 variant/barcode → upsert Subscription → 发确认邮件。带 CORS + 速率限制 + honeypot 防机器人。 |
| GET | `/api/unsubscribe?token=...` | 退订(邮件底部链接),签名 token。 |

### 6.2 后台接口(Admin,App Bridge 鉴权)
| 路径 | 说明 |
|---|---|
| `/app` | Dashboard 总览 |
| `/app/subscriptions` | 列表 + 筛选 + CSV 导出 |
| `/app/templates` | 邮件模板编辑 + 测试发送 |
| `/app/settings` | 按钮与发信设置 |

### 6.3 Webhook
| Topic | 用途 |
|---|---|
| `inventory_levels/update` | 库存变化 → 触发到货检测(主) |
| `products/update` | 变体增删/policy 变化兜底 |
| `app/uninstalled` | 清理数据 |
| `customers/data_request` `customers/redact` `shop/redact` | GDPR(保留,合规) |

---

## 7. 邮件模块(可插拔)★

```ts
interface MailerAdapter {
  send(opts: { to:string; subject:string; html:string; from:string }): Promise<MailResult>
}
// v1: SmtpMailer(Nodemailer，用店铺邮箱 SMTP)
// 日后: ResendMailer / SendgridMailer —— 只换实现，不动调用方
```

- **模板变量**:`{{customer_email}}` `{{product_title}}` `{{variant_title}}` `{{product_url}}` `{{shop_name}}` `{{unsubscribe_url}}`。
- **两类邮件**:
  - `CONFIRMATION`:订阅成功即发。
  - `BACK_IN_STOCK`:到货群发,正文含直达该 variant 的回购链接 `/products/{handle}?variant={id}`。
- **统计自存**:每次发送写 `EmailLog`,所以「发了多少封/成功/失败/何时发」全部来自我们自己的库,不依赖邮件商。
- **合规**:每封含退订链接;SMTP 发件域名需配 SPF/DKIM 以提高送达。

---

## 8. 到货检测与群发流程

```
inventory_levels/update webhook
   │
   ├─ 解析出 inventory_item_id → 映射 variantId（缓存映射表）
   ├─ 库存由 <=0 变为 >0 ?  否 → 结束
   │                         是 ↓
   ├─ 查 active 订阅(shopId + variantId)
   ├─ 逐条入 BullMQ 队列（限速，避免 SMTP 被封）
   │     └─ Job：渲染 BACK_IN_STOCK 模板 → mailer.send()
   │            → 成功: status=NOTIFIED, notifiedAt=now, 写 EmailLog(SENT)
   │            → 失败: 重试3次 → 写 EmailLog(FAILED)
   └─ 去重锁：同 variant 短时间多次波动，用 Redis 锁 + 已 NOTIFIED 不再发
```

**先到先得(可选)**:库存数 < 订阅数时,按 `createdAt` 排序,只给前 N 名发「现货」邮件,其余发「补货中」或不发(后台开关)。

---

## 9. 后台 Dashboard 页面

1. **总览**:总订阅数、待发/已发、到货转化率(发信后下单,用 UTM 或订单匹配)、热门缺货 Top 10。
2. **订阅列表**:按邮箱/产品/barcode/时间/状态筛选;显示「订阅时间、产品、变体、barcode、状态、发信时间」;CSV 导出。
3. **邮件模板**:确认/到货两套,变量插入、实时预览、发测试邮件。
4. **设置**:按钮文案/颜色、可预订时是否显示、double opt-in、发件人信息。
5. **发信记录**:每封状态(SENT/FAILED/BOUNCED)。

---

## 10. 安全与合规

- Storefront 接口:CORS 白名单(仅本店域名)、速率限制、honeypot/简单校验防爬。
- 邮箱属个人数据:隐私政策声明、退订机制、GDPR webhooks 保留。
- Webhook HMAC 校验。
- barcode/variant 提交后端二次校验,防伪造。

---

## 11. 开发里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 脚手架 | Remix 模板、Prisma、Polaris 框架、Custom distribution 安装 | App 能装进店铺 |
| M2 Storefront | Theme Extension、库存判定、Popup、`/api/subscribe` | 客户能订阅、记录 barcode |
| M3 邮件闭环 | SMTP 适配器、确认邮件、inventory webhook、BullMQ 到货群发 | 到货自动发信跑通 |
| M4 后台 | 订阅列表、Dashboard、模板编辑器、CSV、发信记录 | 全量统计可见 |
| M5 收尾 | GDPR/卸载清理、退订、SPF/DKIM、压测去重 | 自用上线 |

---

## 12. 待确认/风险项

- **SMTP 发件量**:店铺邮箱 SMTP(如 Gmail/企业邮)通常有每日发信上限,大促到货群发可能触顶 → 这是 v1 最大风险,届时建议切 Resend/SendGrid(接口已预留)。
- **inventory_item_id → variantId 映射**:需建缓存表,首次安装时全量同步一次。
- **主题兼容**:不同主题暴露变体事件方式不同,需 AJAX 兜底。
```
