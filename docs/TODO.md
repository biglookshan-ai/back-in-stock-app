# 待开发 / 待测试清单

> 截至 2026-06-13。✅=已完成 ⬜=待办

---

## A. 已完成(核心功能 + 测试店上线)

- ✅ 双状态缺货按钮 + 按库存地点判定
- ✅ 弹窗(变体过滤/姓名/营销/全文案全样式可自定义)
- ✅ 订阅 → 确认信 → 库存 webhook → 到货群发
- ✅ 后台 7 页 + 下钻 + 归档/删除 + 手动添加
- ✅ 品牌化邮件模板 + 实时预览 + 恢复默认 + 测试发送
- ✅ 防重复订阅、退订(HMAC)、防篡改
- ✅ 部署到 Railway(app+Postgres)+ Resend(邮件)+ Cloudflare(DNS)
- ✅ 测试店完整回归通过

---

## B. 上正式店前必做

- ⬜ **新建独立「生产」app**(独立 client_id),与 dev/测试 app 隔离
- ⬜ 生产 Railway 环境变量(生产 Postgres、生产 SHOPIFY_APP_URL)
- ⬜ 生产域名邮件 DNS(SPF/DKIM/DMARC)在 Cloudflare 配齐
- ⬜ 正式主题挂「Back in Stock 按钮」block + 调品牌文案/样式
- ⬜ 库存地点口径:Shopify Locations/Markets 与 app 设置一致
- ⬜ **灰度**:先在 1–2 个真实缺货商品上挂,观察几天(订阅/到货/送达/退信)再全量

---

## C. 功能增强(可选,按需做)

- ⬜ **转化追踪上线**:申请 Protected customer data → 开 `orders/create` webhook + `read_orders`
- ⬜ **CSV 导入**:拿到来源 app 的导出样例后,写字段映射导入器
- ⬜ **手动添加可选发确认信**:加一个 checkbox
- ⬜ **Lark AnyCross 发信链路**(备选,详见 DEVELOPMENT.md §10)或用于内部通知/数据进 Base
- ⬜ 大促群发上**队列**(BullMQ + Redis / Cloudflare Queues),避免 webhook 超时 + 限速
- ⬜ Resend 套餐随发信量升级
- ⬜ 主题扩展 JS 压缩(`back-in-stock.js` ~10.5KB,超主题检查 10KB 警告阈值)
- ⬜ 多语言、折扣码、推荐商品、Web Push、A/B 测试

---

## D. 运维 / 合规

- ⬜ 监控 + 错误告警(Railway logs / 第三方)
- ⬜ Postgres 定期备份(Railway 备份 / 导出)
- ⬜ Resend 发信配额 + 退信/投诉率告警
- ⬜ 隐私政策声明(收集邮箱属个人数据)
- ⬜ GDPR 合规 webhooks(`customers/data_request`、`customers/redact`、`shop/redact`)——自用非强制,上架/多店需做

---

## E. 每次新部署的回归测试清单

- ⬜ Railway 部署 Active、日志无报错、迁移已应用
- ⬜ 后台 7 页可开、设置可存
- ⬜ storefront 两种缺货态按钮、分仓判断
- ⬜ 订阅 → 成功提示 → 收确认信(EmailLog=SENT)
- ⬜ 改库存 → 到货信 + 状态 NOTIFIED + 统计 +1
- ⬜ 重复订阅不重发、退订、归档/删除、手动添加
- ⬜ 模板预览 + 测试发送
