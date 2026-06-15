# 部署指南 — 把本 App 部署到一个 Shopify 店铺

> 本文是**实际采用并跑通**的部署方案(取代早期的 `DEPLOYMENT-CLOUDFLARE.md` 设想)。
> 技术栈:**Railway**(app + PostgreSQL)+ **Resend**(邮件)+ **Cloudflare**(域名 DNS)+ **Shopify Developer Dashboard / CLI**(app)。
> 适用:自用 Custom App,部署到任意一个你拥有的 Shopify 店铺。每一步都有说明。

---

## 0. 你需要准备的账号 / 工具

| 项 | 用途 | 费用 |
|---|---|---|
| Shopify Partner / Dev 账号 | 创建 app | 免费 |
| 目标 Shopify 店铺(开发店或正式店) | 安装 app | 店铺自己的 Shopify 套餐 |
| Railway 账号(**Hobby ≥ $5/mo**) | 跑 app + Postgres | ~$5/mo |
| Resend 账号 | 发邮件(HTTP API) | 免费 3000 封/月起 |
| 一个域名 + DNS 在 Cloudflare | 邮件验证 / 可选自定义域名 | 域名 ~£10/yr |
| 本机:Node ≥20、Git、Shopify CLI | 创建 app + deploy | 免费 |

```bash
npm install -g @shopify/cli@latest
```

---

## 1. 拿到代码

```bash
# 方式 A：解压备份包
tar -xzf back-in-stock-app_v1.x_*.tar.gz && cd back-in-stock-app
# 方式 B：克隆仓库
git clone https://github.com/<你的账号>/back-in-stock-app.git && cd back-in-stock-app
npm install
```

---

## 2. 在 Shopify 创建 App(关键:用 CLI 创建)

> ⚠️ **必须用 CLI 创建**,不要在 Developer Dashboard 手动建再 link —— 后者会出现 `application_url` 占位、URL 不更新等坑。

```bash
npm run dev -- --reset
```
按提示:
1. 登录你的组织
2. **`Create this app as a new app on Shopify?` → Yes**(让 CLI 新建)
3. 起名(如 `back-in-stock-<店名>`)
4. 选目标开发店
5. 启动后可先 `Ctrl+C` 停掉(我们要部署到 Railway,不长期跑 dev)

记下生成的配置文件 `shopify.app.<handle>.toml` 里的 **`client_id`**。
到 Developer Dashboard → 该 app → Settings → Credentials,复制 **Client secret**。

---

## 3. 推代码到 GitHub

```bash
# 新建一个 PRIVATE GitHub 仓库，然后：
git remote add origin https://github.com/<你的账号>/back-in-stock-app.git
git push -u origin main
```
> `.gitignore` 已确保 `.env` / 数据库文件不进库;`package-lock.json` 会进库(Railway 构建需要)。

---

## 4. Railway:建 app + 数据库

1. **New Project → Deploy from GitHub repo** → 选该仓库(自动识别 Dockerfile 构建)
2. **+ New → Database → PostgreSQL**(命名如 `Postgres-prod`)
3. app 服务 → **Settings → Networking → Generate Domain** → 端口填 **`3000`** → 得到 `xxx.up.railway.app`
4. app 服务 → **Variables**(Raw Editor 粘贴,值换成真实的):
   ```
   SHOPIFY_API_KEY=<client_id>
   SHOPIFY_API_SECRET=<client secret>
   SCOPES=read_products,read_inventory,read_locations
   SHOPIFY_APP_URL=https://xxx.up.railway.app
   PORT=3000
   DATABASE_URL=<见下方说明>
   RESEND_API_KEY=<第 5 步拿>
   ```
   - **`DATABASE_URL`**:打开 `Postgres-prod` → Variables → 复制 **`DATABASE_PUBLIC_URL`** 的值,粘贴这里。
     > ⚠️ 用 **public** URL(`xxx.proxy.rlwy.net:port`),**不要**用内网 `.railway.internal`(首连易 P1001 超时)。
   - 启动时容器会自动 `prisma migrate deploy` 建表。日志出现 `Applying migration ..._init` 即成功。

---

## 5. Resend:验证发信域名 + 拿 API Key

1. resend.com 注册 → **Domains → Add Domain** → 填你的域名(如 `cinegearpro.co.uk`)
2. Resend 给几条 DNS 记录(MX / SPF-TXT / DKIM-TXT)→ 到 **Cloudflare DNS 新增**这些记录(代理设 **DNS only / 灰云**)
   > ⚠️ 只**新增**,别动该域名已有的邮箱(如 Lark)的 MX/SPF —— Resend 的记录在 `send.` 子域名 + 独立 DKIM 选择器上,不冲突。
3. 等状态变 **Verified**(几分钟~1 小时)
4. **API Keys → Create** → 复制 `re_xxxx` → 填进 Railway 的 `RESEND_API_KEY`
5. 发件人地址用该域名下的地址(如 `noreply@cinegearpro.co.uk`)——后续在 app 设置页填。

> 为什么必须 Resend:**Railway(及多数云主机)封外发 SMTP** → Lark/SMTP 发不出(Connection timeout)。Resend 走 HTTPS,不受限。

---

## 6. 把 App URL 指向 Railway,并 deploy

编辑当前 `shopify.app.<handle>.toml`:
```toml
application_url = "https://xxx.up.railway.app"

[auth]
redirect_urls = [
  "https://xxx.up.railway.app/auth/callback",
  "https://xxx.up.railway.app/auth/shopify/callback",
  "https://xxx.up.railway.app/api/auth/callback"
]

[app_proxy]
url = "https://xxx.up.railway.app"   # ⚠️ 不能带路径！
subpath = "back-in-stock"
prefix = "apps"

[build]
automatically_update_urls_on_dev = false   # 部署到固定域名后关掉
```
然后推送配置到 Shopify:
```bash
npm run deploy        # = shopify app deploy；问 config 选你的 app；问 release 选 Yes
```
> 这会注册:application_url、App Proxy、webhooks(库存/产品/卸载)、scopes、以及 storefront 主题扩展。

---

## 7. 安装到店铺 + 主题挂按钮

1. 打开 app 公网域名 `https://xxx.up.railway.app/` 不该是 502(说明 app 活着)
2. 店铺 admin → **Apps** → 打开本 app(从 Railway 加载,后台 6 页应出现)
   - 若仍显示旧隧道:底部 **Dev Console → Clean dev preview**,再刷新
3. **Online Store → Themes → Customize → 商品模板 → Add block → 「Back in Stock 按钮」** → 调文案/样式 → Save
4. app **设置**页填:发件邮箱(Resend 验证过的地址)、品牌 logo/色/网址、参与统计的库存地点

---

## 8. 库存口径(多仓时)

- Shopify:**Settings → Locations** 的「Fulfill online orders」开关 + **Markets** 决定哪些仓线上可售/算有货。
- app **设置 → 小部件显示规则**:勾选参与统计的地点,保持与上面一致。

---

## 9. (可选)转化追踪 = orders webhook

需要受保护客户数据权限:
1. Developer Dashboard → app → 申请 **Protected customer data access**(自用提交即批)
2. 取消 toml 里 `orders/create` webhook 注释 + scopes 加 `read_orders`
3. `npm run deploy` 重新发布

---

## 10. 上线验收清单

- [ ] Railway 部署 Active、日志有 `Applying migration` 且无报错
- [ ] 后台 6 页可开、品牌设置可存
- [ ] storefront 两种缺货态按钮显示、分仓判断正确
- [ ] 订阅 → 弹窗显示成功 → 收到 Resend 确认信(查 EmailLog = SENT)
- [ ] 改库存 0→N → 收到货信、状态变「已发送」、统计 +1
- [ ] 重复订阅不重发;退订链接生效;归档/删除/手动添加可用

---

## 附:踩过的坑速查(下次部署直接避开)

| 现象 | 原因 | 解决 |
|---|---|---|
| app 首页空白占位 | dev preview 覆盖 / URL 没更新 | Clean dev preview;`npm run deploy` |
| 容器崩溃 `DATABASE_URL empty` | 变量没填/引用没解析 | 填真实值 |
| `P1001 can't reach db` | 用了内网地址 | 改用 `DATABASE_PUBLIC_URL` |
| 邮件 `Connection timeout` | Railway 封 SMTP | 用 Resend |
| 前端 `Network error` + 500 | `Response.json` 运行时不支持 | 已改 Remix `json()`(代码内置) |
| 改库存收不到到货信 | webhook 没注册 | 已用 `afterAuth` 自动注册(代码内置) |
