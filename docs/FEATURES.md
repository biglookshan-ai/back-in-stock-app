# 功能说明文档 — CINEGEARPRO 到货提醒 App

> 面向使用者/接手者,完整说明这个 app 能做什么、各板块怎么用、背后逻辑、技术与服务、费用。

---

## 1. 一句话定位

Shopify 缺货商品上展示「Email me when Available」按钮,客户填邮箱订阅(精准到变体 barcode),商品到货时**自动发邮件**,后台有完整统计与全套可视化自定义。对标 SW Back in Stock / Swym / Klaviyo 同类功能。

---

## 2. Storefront(客户侧)

### 2.1 按钮何时出现
两种缺货状态都显示按钮:
- **缺货 + 不可超卖**(`inventory_policy=deny`,Sold out)
- **缺货 + 可继续售卖/预订**(`inventory_policy=continue`,可同时显示「立即购买」+「到货提醒」)
- **按库存地点判定**:只统计设置里勾选的仓库,合计 ≤0 才算缺货(由后端 `/availability` 精确计算,storefront 拿不到分仓库存)。

### 2.2 弹窗
点按钮弹出表单:**变体下拉(只列需订阅的变体)、姓名、邮箱、营销同意勾选、底部说明**。提交成功显示「You're on the list ✓」;重复订阅显示「已订阅过」且不重发确认信。

### 2.3 全可视化自定义(主题编辑器 → block 设置)
- **文案**:按钮文字、弹窗标题、提交按钮、各输入框提示、营销勾选文案、底部说明、成功/已订阅/邮箱错误/通用错误/网络错误 提示
- **样式(滑块/取色)**:按钮颜色/文字色/字号/上下间距/圆角/是否占满宽;弹窗宽度/背景色/文字色/圆角/内边距/标题字号/遮罩透明度
- 实现:每个设置写成 CSS 变量挂到元素上,`var(--bis-*, 默认值)` 兜底。

---

## 3. 后台(Admin,Polaris,7 个页面)

| 页面 | 作用 |
|---|---|
| **总览** | 总订阅 / 等待中 / 已发送 / 转化(已订购)/ 累计发信 + 热门缺货 Top10 |
| **产品订阅** | 按产品聚合(当前等待/最后请求/历史总数),点产品名下钻看**哪些客人订了** |
| **订阅者** | 按人聚合(姓名/营销/首次请求/总数)+ 导出列表/详情;点邮箱下钻看**这人订了哪些** |
| **请求列表** | 状态分页(全部/等待中/已发送/已订购/已取消/已归档)+ 搜索 + 每行取消/归档/恢复/删除 + **手动添加订阅** |
| **手动添加** | Resource Picker 选产品/变体 + 邮箱/姓名/状态,录入或迁移历史数据(不发确认信) |
| **邮件模板** | 确认信/到货信,**左编辑右实时预览** + 恢复默认 + 发测试邮件 |
| **设置** | 见下 |

---

## 4. 设置板块

- **按钮**:文案、颜色、缺货可预订时是否显示
- **发送规则**:最小库存阈值(达到才通知)、库存=0 且可继续售卖也通知
- **小部件显示规则**:勾选参与库存计算的地点(多仓)
- **品牌/公司信息(邮件用)**:logo URL、品牌主色、官网、公司地址、客服邮箱
- **发件人**:发件人名称、发件邮箱(需 Resend 验证域名)

---

## 5. 邮件

- **两类**:订阅确认信(订阅即发)、到货信(补货群发,带回购链接)
- **品牌化模板**:头部 logo + 产品卡(图/标题/变体/价格)+ CTA 按钮 + 公司信息页脚 + 退订
- **变量**:`{{product_title}} {{variant_title}} {{product_image}} {{product_price}} {{product_url}} {{customer_name}} {{customer_email}} {{shop_name}} {{brand_logo}} {{brand_color}} {{website_url}} {{company_address}} {{support_email}} {{unsubscribe_url}}`
- **条件块**:`{{#if x}}…{{/if}}`、`{{#unless x}}…{{/unless}}`(空值优雅降级,无图不留破图)
- **发送通道**:**Resend HTTP API**(可插拔 `MailerAdapter`,亦支持 SMTP)。统计写自己的 `EmailLog`,不依赖邮件商。

---

## 6. 核心逻辑

- **按钮显示**:`/availability`(App Proxy)按所选地点求和库存 → 决定每个变体是否显示;失败回退 Liquid。
- **到货触发**:`inventory_levels/update` webhook → 按所选地点库存 + 阈值判定 → 取该变体所有 ACTIVE 订阅按时间顺序群发 → 置 NOTIFIED;已通知不重发。
- **防重复**:`@@unique([shop,email,variantId])`;已在等待中重复订阅不重发确认信。
- **转化追踪**:`orders/create` webhook 匹配邮箱+变体 → 标记 ORDERED(需 Protected data 权限,默认关)。
- **数据安全**:storefront 提交后端用 Admin API **复核** barcode/价格(防篡改);退订 HMAC 签名;honeypot 反机器人。

---

## 7. 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Remix + `@shopify/shopify-app-remix` ^4 |
| 后台 | Polaris ^12 + App Bridge ^4 |
| Storefront | Theme App Extension(Liquid + 原生 JS + CSS 变量) |
| DB / ORM | PostgreSQL + Prisma ^6 |
| 邮件 | Resend(HTTP);可插拔到 SMTP |
| 运行 | Node 22(Docker)on Railway |

数据模型:`Session / Subscription / EmailTemplate / EmailLog / Settings`(详见 `DEVELOPMENT.md`)。

---

## 8. 用到的服务 + 费用(自用 / 中小量)

| 服务 | 作用 | 费用 |
|---|---|---|
| **Railway**(Hobby) | 跑 app + PostgreSQL(含数据库) | **~$5/月**(含用量额度) |
| **Resend** | 发邮件 | **免费**(3000 封/月、100 封/天);超量 $20/月起(50k 封) |
| **Cloudflare** | 域名 DNS / 邮件 DNS 验证 | **免费** |
| **Shopify app** | 自用 Custom App,不上架 | **免费**(无 App Store 抽成) |
| 域名 | 邮件发件域名 | ~£10/年(通常已有) |

> **典型月成本 ≈ $5**(Railway)。发信量小的话 Resend 免费够用。大促群发量大时:Resend 升级 + 加队列(BullMQ/Cloudflare Queues)。

---

## 9. 部署方式

GitHub → Railway 自动部署(push 即构建);Shopify 配置经 `shopify app deploy` 发布;邮件 Resend。完整步骤见 `DEPLOYMENT.md`。

**更新方式**:
- 改后端/后台代码 → `git push`(Railway 自动部署)
- 改主题扩展 / Shopify 配置 → `git push` + `npm run deploy`
- 改数据库结构 → 建迁移 → `git push`(容器启动自动 `migrate deploy`)
