# 部署到 Cloudflare + 正式上线 实施文档

> 目标:把当前 dev(SQLite + cloudflared 隧道 + SMTP)迁移到 **全 Cloudflare 技术栈**,先在测试店跑通,再上正式 CINEGEARPRO 店。

---

## 0. 先说清楚:全 Cloudflare 的现实与约束

Cloudflare 不提供「常驻 Node 容器」,它的运行时是 **Workers(边缘 V8 isolate)**。把本 app 放上去,有 **3 个必须改的点**和 **1 个风险点**:

| 项 | dev 现状 | Cloudflare 必须改成 | 原因 |
|---|---|---|---|
| 运行时 | Node(`@shopify/shopify-app-remix/adapters/node`) | **Remix Cloudflare 适配器 + Workers** | Workers 非 Node |
| 数据库 | SQLite 文件 | **Cloudflare D1**(+ Prisma D1 driver adapter) | 边缘原生 SQLite,schema 兼容 |
| 邮件 | Nodemailer **SMTP** | **Resend HTTP API**(adapter 已留接口) | ⚠️ Workers **不支持原始 TCP**,SMTP 用不了 |
| 群发 | 内联顺序发 | **Cloudflare Queues**(可选,量大时) | 边缘函数有 CPU/时长限制 |

> **风险点**:`@shopify/shopify-app-remix` 在 Workers 上跑需要 web 适配,官方对 Workers 的支持不如 Node 成熟,迁移需实测。**若卡住,退路**:app 跑在 Node 主机(Fly/Railway),Cloudflare 负责域名/CDN/D1(经 HTTP)/Resend——仍"以 Cloudflare 为中心",但不强求 app 本体在 Workers。本文档先走**全 Workers 方案**。

---

## 阶段 A：代码改造(部署前,在 dev 完成并验证)

### A1. 邮件切 Resend（必做）
1. `npm i resend`
2. 新增 `app/mailer.resend.server.ts` 实现 `MailerAdapter`,用 `fetch` 调 Resend API(不依赖 TCP)。
3. `mailer.server.ts` 按环境选择:`process.env.RESEND_API_KEY ? new ResendMailer() : new SmtpMailer()`。
4. Resend 后台**验证发信域名** `cinegearpro.co.uk`(加 CF DNS 的 SPF/DKIM 记录),发件人用 `noreply@cinegearpro.co.uk`。
> 调用方(subscription.server)零改动 —— 当初就是为这步设计的可插拔。

### A2. Prisma 切 D1
1. `schema.prisma`:`datasource db { provider = "sqlite" }` 保持(D1 即 SQLite);`generator` 开 `previewFeatures = ["driverAdapters"]`。
2. `npm i @prisma/adapter-d1`;`db.server.ts` 用 D1 binding 构造 PrismaClient(`new PrismaClient({ adapter: new PrismaD1(env.DB) })`)。
3. 迁移:`wrangler d1 create back-in-stock`;用 `prisma migrate diff` 生成 SQL,`wrangler d1 migrations apply` 应用到 D1。

### A3. Remix 切 Cloudflare 适配器
1. 改 `vite.config.ts` 用 Cloudflare 预设(`@remix-run/dev` + cloudflare proxy)。
2. `shopify.server.ts`:换掉 `adapters/node` 引入 web 适配;`appUrl` 用环境变量(生产域名)。
3. 本地用 `wrangler dev` / `vite` 验证可启动、OAuth、Polaris、proxy、webhook。

### A4.（可选)群发上 Cloudflare Queues
- 到货时把每个收件人 enqueue,Queue consumer 限速发 Resend,避免单次 Worker 超时。中小量可暂不做。

> ⚠️ A3 是工作量与风险最大的一步。建议**单开分支**改造,每步 `tsc + build + wrangler dev` 验证,通过后再继续。若 A3 受阻,转「Node 主机 + Cloudflare 周边」退路(见 §附录)。

---

## 阶段 B：Cloudflare 资源与配置

1. **Workers/Pages 项目**:`wrangler.toml` 配 `name`、`compatibility_date`、`nodejs_compat`(若需)、D1 binding、Queues binding、Vars。
2. **D1**:`wrangler d1 create` → 记下 database_id 填 `wrangler.toml`。
3. **Secrets**(`wrangler secret put`):`SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET`、`RESEND_API_KEY`。
4. **自定义域名**:把 app 绑到如 `bis.cinegearpro.co.uk`(CF DNS 一条记录 + Workers 路由)。固定域名 = 告别隧道乱跳。
5. **DNS 邮件记录**:SPF / DKIM(Resend 给)/ DMARC,加到 cinegearpro.co.uk。

---

## 阶段 C：在测试店部署上线

1. `shopify.app.toml` 把 `application_url` / `app_proxy.url` / `redirect_urls` 指向固定域名(`https://bis.cinegearpro.co.uk`)。`app_proxy.url` 仍**不带路径**。
2. `npm run deploy`(`shopify app deploy`)推送 app 配置 + extension + webhook 声明到 Shopify。
3. `wrangler deploy` 部署 Worker。
4. 装到测试店,跑**完整回归**:
   - 后台 6 页可开;品牌设置可存
   - storefront 按钮(两种缺货态 + 分仓)、弹窗订阅 → 收确认信(Resend)
   - 改库存 → 收到货信、状态变已发送、统计 +1
   - 重复订阅不重发;退订链接生效;归档/删除
5. 观察 Workers 日志(`wrangler tail`)、D1 数据、Resend 投递报表。

---

## 阶段 D：上正式 CINEGEARPRO 店

> 建议**新建一个"生产" app**(独立 client_id),用 `shopify.app.production.toml`,与 dev 隔离;别让 dev 隧道/重置影响生产。

1. **Protected customer data**:若要转化追踪,在 Developer Dashboard 为生产 app 申请 `orders` 权限审批通过后,取消 `webhooks.orders.create` 注释 + 加回 `read_orders`。
2. 用生产 app 配置 `deploy` + `wrangler deploy`(生产 D1、生产 Resend 域名)。
3. 在正式店安装 app;**主题编辑器**把「Back in Stock 按钮」block 加到生产主题商品页;按品牌调好文案/样式。
4. **库存口径**:用 Shopify `Settings → Locations` 的「Fulfill online orders」开关 + Markets 决定哪些仓线上可售;app 设置里勾选参与统计的地点保持一致。
5. **灰度**:先在 1–2 个真实缺货商品上挂按钮,观察几天(订阅、到货、送达、退信),无误再全量。
6. **正式运行**:监控 + D1 定期导出备份 + Resend 配额告警 + 退信/投诉率。

---

## 上线检查清单

- [ ] A1 Resend adapter + 域名验证(SPF/DKIM/DMARC)
- [ ] A2 Prisma D1 + 迁移已 apply
- [ ] A3 Remix/Cloudflare 适配本地 `wrangler dev` 通过
- [ ] B wrangler.toml / D1 / Secrets / 自定义域名
- [ ] C 测试店 deploy + 完整回归通过
- [ ] D 生产 app(独立 client_id)+ Protected data 审批(如需)
- [ ] 生产主题挂 block + 库存地点口径一致
- [ ] 监控 / 备份 / 告警

---

## 附录：退路方案（A3 受阻时）

若 Shopify Remix 在 Workers 上迁移成本过高:
- **App 本体**部署到 Node 主机(Fly.io / Railway,几行配置、官方支持好)。
- **数据库**仍可用 Cloudflare D1(经 HTTP / Hyperdrive)或主机自带 Postgres。
- **邮件** Resend、**DNS/CDN/WAF/域名** 全在 Cloudflare。
- 体验上仍"以 Cloudflare 为中心",但规避了 Workers 跑 Shopify Remix 的不确定性。这是更稳的折中,可作为 Plan B。
