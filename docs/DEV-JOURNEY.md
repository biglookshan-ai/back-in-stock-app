# 开发全过程记录 — 从 0 到上线的完整 build log

> 这是一份**详细的开发记录/复盘**(比 `skill-shopify-custom-app.md` 更细),按真实推进顺序记录:做了什么、为什么、踩了什么坑、怎么解决、学到什么。给接手者或下一个类似项目复用。
> 项目:CINEGEARPRO Shopify 到货提醒 App ｜ 周期:2026-06 ｜ 类型:自用 Custom App。

---

## 阶段 0 — 立项与设计

**目标**:缺货商品显示「Email me when Available」按钮(两种缺货态)→ 客户订阅(记 barcode)→ 到货自动发信 → 后台统计 + 自定义邮件。参考成熟 app(SW Back in Stock / Swym / Klaviyo)。

**关键决策**:
- **自用 Custom App**(不上架),但数据带 `shopId` 留多店余地。
- 必须 **CLI 构建 + Theme App Extension**(要 storefront 按钮)。
- 邮件:Shopify 无事务邮件 API → 设计**可插拔 MailerAdapter**(先 SMTP,后可换 Resend)。

---

## 阶段 1 — 脚手架

- 用官方 **Shopify Remix 模板**;`distribution: SingleMerchant`。
- Prisma 模型:`Session / Subscription / EmailTemplate / EmailLog / Settings`。
- 验证手段确立:**`tsc --noEmit` + `npm run build` + `prisma migrate` + 直接查 DB**(嵌入式 app 无浏览器 preview)。
- **坑#1**:手动搬模板文件后没渲染 `shopify.web.toml`(只有 `.liquid`)→ CLI 不启动 Remix 后端 → app 首页一直占位页。**修**:手写 `shopify.web.toml`。

---

## 阶段 2 — 核心功能

- **库存双状态**:`deny`(不可超卖)/`continue`(可预订),`{{ product | json }}` + Liquid 算的 `__BIS_INV__` 给前端判定。
- **App Proxy** 公开接口 `/subscribe`:`authenticate.public.appProxy` 验签 + 拿 admin client + Admin API 复核 barcode。
- **坑#2**:`[app_proxy].url` 带了路径(`/apps/default-app-home`)→ dev 只换域名保留路径 → 请求落到 `/那段/subscribe` → 404。**修**:url 不带路径。
- 到货:`inventory_levels/update` webhook → 群发。
- 后台:总览 + 列表 + 模板编辑 + 设置。

---

## 阶段 3 — 对标参考 app(SW Back in Stock)

用户给了成熟 app 截图,要求 match。扩展出:
- 弹窗:姓名、变体下拉(**只列需订阅的变体**,防误订有货变体)、营销同意、全文案可配。
- 后台三视图:**产品订阅 / 订阅者 / 请求列表**(状态分页 + 下钻 + 取消/归档/删除)。
- 设置:最小库存阈值、库存=0也通知、**按地点显示**。
- 转化追踪(orders webhook)。
- **坑#3**:storefront 拿不到分仓库存 → 加 `/availability`(App Proxy)后端按所选地点算,前端拿结果;失败回退 Liquid。

---

## 阶段 4 — 邮件 & 模板

- 品牌化模板(logo + 产品卡 + 公司页脚),`{{#if}}/{{#unless}}` 条件渲染,实时预览,恢复默认,测试发送。
- 产品图/价格订阅时抓取存快照。
- **SMTP 调通**:用 Lark 邮箱(`smtp.larksuite.com:465`)。
- **坑#4**:Lark SMTP `535 authentication failed` → 要用「客户端专用密码」+ 组织放行第三方客户端。用 `nodemailer.verify()` 脱离 app 快速验证。
- **防重复**:已在等待中重复订阅不重发确认信。

---

## 阶段 5 — dev 环境踩坑合集(新版 Developer Dashboard)

- **坑#5**:dev 开发店没开 Online Store 渠道 → 一直问 store password / 无主题。**修**:加 Online Store 渠道。
- **坑#6**:app 首页一直占位页「Find this app in the pages where you work」。根因 = Remix 后端没起(见坑#1)+ 新 Dashboard 的 app URL 托管行为。诊断:`ps` 看进程、`lsof` 看端口、查 `SHOPIFY_APP_URL`。**修**:`--reset` 让 CLI 新建 app + 渲染 `shopify.web.toml`。
- **坑#7**:声明式 webhook 在 dev 不自动注册 → 改库存收不到到货信。诊断:`webhookSubscriptions` Admin 查询为空 ≠ 没注册;看**服务端日志**才准。**修**:`shopifyApp({webhooks, hooks.afterAuth → registerWebhooks})` 代码注册,按当前 appUrl 注册。
- **坑#8**:Prisma 迁移后没重启 → 进程用旧 client → `Unknown argument xxx`。**修**:重启 dev。
- **坑#9**:cloudflared 免费快速隧道偶尔自己断 → 公网「连接被拒」。**修**:重启(上线换固定域名根治)。

---

## 阶段 6 — 决策:全 Cloudflare vs Railway

- 用户想「全 Cloudflare(Workers+D1+Resend)」。分析:Workers **不能跑 SMTP**(无 TCP),且 Shopify Remix 跑 Workers 不确定。
- 用户「想留 Lark + 少服务」→ 选 **Plan B:Railway(app+Postgres)+ Cloudflare(DNS)+ Lark(暂)**,风险低、邮件不折腾。
- **教训**:决策要先厘清硬约束(SMTP/TCP、运行时支持),再选路线。

---

## 阶段 7 — Railway 部署踩坑合集(上线最硬的一段)

- **坑#10**:`DATABASE_URL` 填成占位文字/空 → `P1012 empty URL` 崩溃循环。**修**:填真实值。
- **坑#11**:用内网 `postgres.railway.internal` → `P1001 can't reach db`。**修**:改用 **`DATABASE_PUBLIC_URL`**(public proxy 地址)。
- **坑#12(重大)**:邮件 `EmailLog.error = Connection timeout`。根因 = **Railway 封外发 SMTP**(Hobby plan,官方政策防滥用,2025-08 起)。诊断靠 `EmailLog` 存的错误。**修**:切 **Resend**(HTTP 443,不受限);子域名验证不影响 Lark。
- **坑#13(重大)**:订阅成功但前端报 `Network error`,接口 **500**:`TypeError: Response.json is not a function` —— `remix-serve` 运行时的 `Response` 没有静态 `json()`。dev 能跑是因为 Node 环境不同。**修**:全部改用 Remix `json()` 助手。
- **坑#14**:store 后台仍加载旧隧道。根因 = 残留的 **dev preview** 覆盖了已发布版本。**修**:Dev Console **Clean dev preview**。
- **体验修**:确认信改 **fire-and-forget**(不阻塞订阅响应),SMTP/发信慢不影响前端;并给 mailer 加超时。

---

## 阶段 8 — 收尾功能

- **手动添加订阅**(Resource Picker 选产品/变体 + 设状态,不发确认信)便于迁移历史数据。
- 探讨但暂缓:**Lark AnyCross 发信链路**(Base 记录触发 → Mail Helper SMTP 从 Lark 侧发,绕开 Railway 封锁 → 写回状态)。记入待办。

---

## 最终架构

```
Cloudflare(DNS/邮件验证)
   └─ GitHub(代码,push 自动部署)
        └─ Railway(Docker:Remix app + PostgreSQL,常驻)
             ├─ Shopify(Admin API / App Proxy / Webhooks)
             └─ Resend(HTTPS 发邮件,发件人 @你的域名)
```

---

## 十条最值钱的教训

1. **嵌入式 app 用静态+数据层验证**(tsc/build/migrate/查 DB/verify),别指望浏览器 preview。
2. **CLI 创建 app**,别手动建再 link(新 Dashboard URL 托管会坑)。
3. **必须有 `shopify.web.toml`**,否则后端不起。
4. **App Proxy url 不带路径**。
5. **webhook 用 `afterAuth` 代码注册**(dev 可靠);空的 Admin 查询不代表没注册,看服务端日志。
6. **迁移后重启**(stale Prisma client)。
7. **云主机普遍封 SMTP** → 事务邮件用 HTTP API(Resend)。Lark/SMTP 在被封的主机上必然 `Connection timeout`。
8. **`remix-serve` 用 Remix `json()`,别用 `Response.json()`**。
9. **Railway 数据库用 public URL**(内网首连易超时);**dev preview 会覆盖已发布版**,记得 Clean。
10. **副作用(发信)别阻塞用户响应** → fire-and-forget + 把状态写自己的库(EmailLog),诊断全靠它。

---

## 关联文档

- `DEPLOYMENT.md` — 部署到新店的步骤
- `FEATURES.md` — 功能/技术/费用
- `DEVELOPMENT.md` — 架构/数据模型/路由清单
- `TODO.md` — 待办/测试清单
- `skill-shopify-custom-app.md` — 提炼版可复用 skill
