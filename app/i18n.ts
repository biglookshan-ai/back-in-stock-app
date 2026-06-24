// 后台界面国际化（i18n）。仅影响 admin UI，不影响发给客人的邮件。
// 机制：源码里用中文做 key，英文（默认）从 DICT 查；中文模式直接用 key。
// 用法：const t = useT();  t("请求列表")  /  t("发送给 {n} 人", { n: 3 })
import { useRouteLoaderData } from "@remix-run/react";

export type Lang = "en" | "zh";

// 中文 → 英文（英国用词习惯）
const DICT: Record<string, string> = {
  // ── 导航 / 页面标题 ──────────────────────────────────────────────
  "Back in Stock Dashboard": "Back in Stock Dashboard",
  "请求列表": "Requests",
  "产品订阅": "Products",
  "订阅者": "Subscribers",
  "自定义模板": "Custom templates",
  "自动发送模板": "Automatic emails",
  "页眉页脚": "Header & footer",
  "设置": "Settings",
  "产品订阅详情": "Product subscription details",
  "订阅者详情": "Subscriber details",
  "自定义邮件模板": "Custom email templates",
  "邮件页眉页脚": "Email header & footer",

  // ── 通用 ────────────────────────────────────────────────────────
  "返回": "Back",
  "保存": "Save",
  "取消": "Cancel",
  "删除": "Delete",
  "恢复": "Restore",
  "归档": "Archive",
  "新建": "New",
  "编辑": "Edit",
  "关闭": "Close",
  "预览": "Preview",
  "记录": "Log",
  "标签": "Tags",
  "搜索": "Search",
  "排序": "Sort",
  "全部": "All",
  "加载中…": "Loading…",
  "已保存": "Saved",
  "设置已保存": "Settings saved",

  // ── 状态 ────────────────────────────────────────────────────────
  "等待中": "Waiting",
  "已发送": "Notified",
  "已订购": "Ordered",
  "已取消": "Cancelled",
  "已归档": "Archived",
  "自动": "Auto",
  "手动": "Manual",
  "✓ 已发送": "✓ Sent",
  "✗ 失败": "✗ Failed",

  // ── Dashboard ───────────────────────────────────────────────────
  "总订阅数": "Total subscriptions",
  "待发提醒（等待中）": "Awaiting restock (waiting)",
  "已通知（已发送）": "Notified",
  "转化（已订购）": "Converted (ordered)",
  "累计发信成功": "Emails sent",
  "热门缺货商品（待发提醒 Top 10）": "Most-wanted out-of-stock items (top 10)",
  "还没有订阅数据": "No subscriptions yet",
  "客户在缺货商品页订阅后，这里会显示需求最高的商品。": "Once customers subscribe on out-of-stock product pages, the most-wanted items show here.",
  "商品": "Product",
  "变体": "Variant",
  "等待人数": "Waiting",
  "所有订阅": "All subscriptions",
  "所有产品": "All products",
  "所有客人": "All customers",
  "查看请求列表 →": "View requests →",
  "查看产品订阅 →": "View products →",
  "查看订阅者 →": "View subscribers →",

  // ── 设置页 ──────────────────────────────────────────────────────
  "按钮": "Button",
  "按钮文案": "Button text",
  "按钮颜色 (hex)": "Button colour (hex)",
  "缺货但可预订时也显示「到货提醒」按钮": "Show the notify button even when out of stock but available for pre-order",
  "关闭后，可预订状态只显示「加入购物车 / 预订」。": "When off, pre-order items only show “Add to cart / Pre-order”.",
  "发送规则": "Sending rules",
  "通知的最小库存": "Minimum stock to notify",
  "库存达到此值才发送到货通知（默认 1）。": "Send the restock notification only when stock reaches this level (default 1).",
  "库存为 0 且开启「缺货时继续销售」也发送通知": "Also notify when stock is 0 and “continue selling when out of stock” is on",
  "开启后，可预订商品库存回到 0 时也会通知，最小库存将被忽略。": "When on, pre-order items are notified even at 0 stock; the minimum stock is ignored.",
  "邮件密送（BCC）": "Email BCC",
  "把所有发出的邮件密送给同事": "BCC all outgoing emails to colleagues",
  "开启后，无论是确认信、到货通知还是手动群发，都会同时密送给下面填写的邮箱，方便同事知道发了什么。密送对收件客人不可见。": "When on, every email (confirmation, restock notice or manual send) is also blind-copied to the addresses below so colleagues can see what was sent. BCC is invisible to the customer.",
  "密送邮箱": "BCC addresses",
  "多个邮箱用逗号、分号或换行分隔。客人收到的邮件里看不到这些地址。开关关闭时不密送。": "Separate multiple addresses with commas, semicolons or new lines. Customers cannot see these addresses. No BCC when the switch is off.",
  "界面语言": "Interface language",
  "界面语言（仅后台，不影响客人邮件）": "Interface language (admin only, does not affect customer emails)",
  "切换后台显示语言。发送给客人的邮件内容由邮件模板单独控制，不受此项影响。": "Switches the admin display language. Emails to customers are controlled separately by the email templates and are unaffected.",
  "English（英文）": "English",
  "中文（Chinese）": "中文 (Chinese)",
  "保存设置": "Save settings",
  "小部件显示规则": "Widget display rules",
  "选择参与库存计算的地点。只统计所选地点的库存来决定是否显示按钮 / 发送到货通知。不勾选 = 统计全部地点。": "Choose which locations count towards stock. Only the selected locations' stock decides whether to show the button and send restock notices. None selected = count all locations.",
  "未获取到地点（需要 read_locations / 库存权限）。": "No locations found (requires read_locations / inventory access).",
  "统计全部地点": "Counting all locations",
  "已选择 {n} 个地点": "{n} location(s) selected",
  "品牌 / 公司信息（邮件）": "Brand / company info (emails)",
  "这些信息会自动用在到货/确认邮件的头部 logo、主色、页脚公司信息里。": "Used automatically for the logo, primary colour and footer company info in restock and confirmation emails.",
  "Logo 图片 URL": "Logo image URL",
  "邮件头部显示的 logo（留空则显示发件人名称文字）。": "Logo shown at the top of emails (leave blank to show the sender name as text).",
  "品牌主色 (hex)": "Primary brand colour (hex)",
  "邮件标题、按钮、价格的颜色。": "Colour of email headings, buttons and prices.",
  "官网链接": "Website URL",
  "公司地址（页脚）": "Company address (footer)",
  "客服邮箱（页脚）": "Support email (footer)",
  "发件人": "Sender",
  "发件人名称": "Sender name",
  "发件邮箱": "Sender email",
  "需在 .env 配置 SMTP，且该邮箱域名建议设置 SPF/DKIM 提升送达率。": "Configure email sending in your environment; set SPF/DKIM on the sending domain to improve deliverability.",
  "发信走 SMTP（.env 中 SMTP_HOST 等）。店铺邮箱通常有每日发信上限，大促群发可能触顶——届时建议切换 Resend/SendGrid（mailer 已预留接口）。": "Email is sent via the configured provider (Resend in production). Store mailboxes often have daily sending limits that large campaigns can hit — switch providers if needed (the mailer is pluggable).",

  // ── 请求列表 ────────────────────────────────────────────────────
  "手动添加订阅": "Add subscription",
  "手动发送邮件": "Send email",
  "手动发送邮件 ({n})": "Send email ({n})",
  "导出当前筛选": "Export current view",
  "导出全部": "Export all",
  "邮箱 / 姓名 / 商品 / barcode": "Email / name / product / barcode",
  "已订阅": "Subscribed",
  "未订阅": "Not subscribed",
  "全部标签": "All tags",
  "从": "From",
  "到": "To",
  "「可用库存」列：UK = {shop} · EW = {ew}（实时 Available）": "“Available stock” column: UK = {shop} · EW = {ew} (live Available)",
  "商品 / 变体": "Product / variant",
  "客户": "Customer",
  "可用库存": "Available stock",
  "日期": "Date",
  "操作": "Actions",
  "没有符合条件的请求": "No matching requests",
  "调整筛选或等待客户订阅。": "Adjust your filters or wait for customers to subscribe.",
  "编辑标签": "Edit tags",
  "搜索已有标签，或输入新标签后从下拉点「新增」": "Search existing tags, or type a new one and pick “Add” from the list",
  "新增标签 “{name}”": "Add tag “{name}”",
  "还没有标签。从上面选已有标签，或输入新标签。": "No tags yet. Pick an existing tag above or type a new one.",
  "发信记录": "Email log",
  "邮件内容预览": "Email preview",
  "← 返回记录": "← Back to log",
  "（无存档内容）": "(no archived content)",
  "这条订阅还没有发信记录。": "No emails have been sent for this subscription yet.",
  "主题：": "Subject: ",
  "原因：": "Reason: ",
  // 发送邮件弹窗
  "发送邮件（已选 {n} 人）": "Send email ({n} selected)",
  "邮件预览": "Email preview",
  "← 返回编辑": "← Back to editing",
  "发送给 {n} 人": "Send to {n}",
  "发送": "Send",
  "预览以勾选的第一位客人为例：": "Preview based on the first selected customer: ",
  " 订阅了「": " subscribed to “",
  "」。每位收件人都会替换成自己订阅的产品。": "”. Each recipient sees their own subscribed product.",
  "发送给勾选的客人。富文本/代码可切换;插入产品卡到光标处;「预览」看效果。": "Sends to the selected customers. Switch between rich text and code; insert product cards at the cursor; use “Preview” to check.",
  "使用全局页眉/页脚（顶部 logo + 底部公司信息）": "Use global header/footer (top logo + bottom company info)",
  "勾选时只写正文，页眉页脚由「页眉页脚」页统一提供。": "When ticked, only write the body; the header/footer come from the “Header & footer” page.",
  "选择模板（可选）": "Choose template (optional)",
  "— 空白 / 自己写 —": "— Blank / write your own —",
  "模板在「自定义邮件模板」页管理。选了可继续编辑。": "Templates are managed on the “Custom templates” page. You can keep editing after selecting one.",
  "主题": "Subject",
  "变量:{vars}（每人按自己订阅的商品渲染）。": "Variables: {vars} (rendered per recipient's subscribed product).",
  // action toast
  "主题和正文不能为空": "Subject and body cannot be empty",
  "请先勾选收件人": "Please select recipients first",
  "已发送 {n} 封": "Sent {n} email(s)",
  "标签（逗号分隔）": "Tags (comma separated)",
  "到货通知": "Restock notice",
  "订阅确认": "Subscription confirmation",
  "手动发送": "Manual send",
  "客人订阅的产品（每人各自显示）": "Customer's subscribed product (shown per recipient)",

  // ── 产品订阅页 ──────────────────────────────────────────────────
  "按产品": "By product",
  "按变体 / Barcode": "By variant / barcode",
  "barcode / 产品 / 变体": "barcode / product / variant",
  "产品名称": "Product name",
  "最后请求": "Last request",
  "当前等待": "Currently waiting",
  "历史总请求": "Total requests",
  "Barcode": "Barcode",
  "UK 可用": "UK avail.",
  "EW 可用": "EW avail.",
  "总数": "Total",
  "链接": "Links",
  "前台 ↗": "Storefront ↗",
  "后台 ↗": "Admin ↗",
  "库存简写：UK = {shop} · EW = {ew}（实时 Available）": "Stock abbreviations: UK = {shop} · EW = {ew} (live Available)",
  "客户在缺货商品页订阅后，这里会按{kind}汇总需求。": "After customers subscribe on out-of-stock product pages, demand is summarised here by {kind}.",
  "变体 / barcode": "variant / barcode",
  "产品": "product",
  "还没有数据": "No data yet",
  // 产品详情页
  "该产品暂无订阅": "No subscriptions for this product yet",
  "返回产品订阅": "Back to products",
  "订阅日期": "Subscribed",
  "订阅时间": "Subscribed at",
  "{n} 条订阅": "{n} subscription(s)",

  // ── 订阅者页 ────────────────────────────────────────────────────
  "订阅者列表": "Subscribers",
  "显示 {shown} 共 {total} 位订阅者": "Showing {shown} of {total} subscribers",
  "导出列表": "Export list",
  "导出明细": "Export details",
  "姓名": "Name",
  "邮箱": "Email",
  "Newsletter": "Newsletter",
  "订阅数": "Subscriptions",
  "最近订阅": "Last subscribed",
  "还没有订阅者": "No subscribers yet",
  "查看": "View",
  "导出详情": "Export details",
  "客户订阅后这里会按人汇总。": "Once customers subscribe, they are grouped here by person.",
  "电子邮件": "Email",
  "营销": "Marketing",
  "首次请求": "First request",
  "总请求数": "Total requests",
  // 订阅者详情
  "返回订阅者列表": "Back to subscribers",
  "该客人暂无订阅": "This customer has no subscriptions yet",
};

export function translate(zh: string, lang: Lang, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? (DICT[zh] ?? zh) : zh;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
    }
  }
  return s;
}

// 从根 app 路由 loader 取当前语言（app.tsx 的 loader 返回 lang）
export function useLang(): Lang {
  const data = useRouteLoaderData("routes/app") as { lang?: Lang } | undefined;
  return data?.lang === "zh" ? "zh" : "en";
}

export function useT() {
  const lang = useLang();
  return (zh: string, vars?: Record<string, string | number>) => translate(zh, lang, vars);
}
