# 运行指南（CINEGEARPRO 到货提醒 App）

自用 Custom App。本机已完成:依赖安装、Prisma 迁移、TypeScript 通过、生产构建通过。

## 一次性准备
1. 安装 Shopify CLI(本机尚未安装):
   ```bash
   npm install -g @shopify/cli@latest
   ```
2. 用 Shopify Partner 账号登录,并把本 app 关联到你的开发店/正式店:
   ```bash
   shopify app config link
   ```
   这会自动写入 `shopify.app.toml` 的 `client_id`、`application_url`、`app_proxy.url`。
3. 复制环境变量并填 SMTP(发信通道):
   ```bash
   cp .env.example .env   # 填 SMTP_HOST / SMTP_USER / SMTP_PASS 等
   ```
   > 未配置 SMTP 时,确认/到货邮件只会在终端打印,方便先联调流程。

## 本地开发
```bash
npm run dev          # shopify app dev：起隧道、装到店铺、热更新
```
- 后台:店铺 admin → Apps → 本 app。可见「总览 / 订阅记录 / 邮件模板 / 设置」。
- storefront 按钮:主题编辑器 → 商品模板 → 添加 App Block「Back in Stock 按钮」。

## 自测到货流程
1. 把某变体库存设为 0(不可超卖)→ 商品页应出现「Email me when Available」。
2. 点击 → 弹窗填邮箱 → 提交 → 收到确认邮件(或看终端日志)。
3. 后台「订阅记录」应出现该订阅,带 barcode、订阅时间。
4. 把库存补到 >0 → `inventory_levels/update` webhook 触发 → 收到到货邮件;
   订阅状态变 NOTIFIED,「总览」发信数 +1。

## 部署(自用上线)
```bash
npm run deploy       # 部署 extension + webhook 配置
```
后端可托管到 Fly.io / Railway / Render;生产建议把 Prisma 切到 PostgreSQL
(改 `prisma/schema.prisma` 的 datasource,设 `DATABASE_URL`)。

## 已实现 (M1–M4)
- ✅ 库存双状态判定(缺货可预订 / 缺货不可预订)+ 变体切换锁定 barcode
- ✅ 弹窗订阅 → App Proxy 接口 → Admin API 复核 barcode → 写库 → 确认邮件
- ✅ inventory/products webhook → 到货群发(先到先得、已通知不重发)
- ✅ 后台:总览统计、订阅列表(筛选/CSV 导出)、邮件模板编辑(测试发送)、设置
- ✅ 退订链接(HMAC 签名)、卸载清理数据

## 待办 (M5)
- 大促群发量大时:把 `notifyVariantRestocked` 换成 BullMQ + Redis 队列
- 发信量触顶时:新增 `ResendMailer` 适配器(`app/mailer.server.ts` 已留接口)
- 可选:GDPR 合规 webhooks(自用非必须)
