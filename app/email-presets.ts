// 内置手动发送模板（客户端安全）。在「手动发送」弹窗和「自定义模板」页可直接选用。
// 用全局页眉/页脚外壳；正文用 email-blocks 构件，视觉与自动模板统一。
import {
  heroBand, greeting, para, sectionLabel, productCardVertical, featureRows, helpCta, signoff,
} from "./email-blocks";

export type EmailPreset = {
  key: string;
  name: string; // 显示名（下拉/列表）
  subject: string;
  htmlBody: string;
  useGlobalShell: boolean;
};

// ① 产品无货 · 推荐替代品
const OUT_OF_STOCK_ALT: EmailPreset = {
  key: "out_of_stock_alt",
  name: "内置 · 无货推荐替代品",
  subject: "An update on your requested item — {{product_title}}",
  useGlobalShell: true,
  htmlBody: [
    heroBand({
      pill: "Product Update",
      intro: "An update on the item you asked about.",
      title: "This Item Isn't Available — But We Can Help",
      tagline: "Let's find you the right alternative.",
    }),
    greeting(),
    para("Thanks for your patience while we looked into this for you."),
    para("Unfortunately, we're not able to get hold of <strong>{{product_title}}</strong> at the moment — it looks to be discontinued or no longer available to source, so we don't expect any further stock to become available."),
    para("We don't want to leave you without options. Our team would be glad to help you find an equivalent or upgraded alternative for your setup."),
    productCardVertical({
      label: "The item you asked about",
      statusText: "No longer available",
      ctaLabel: "Browse similar products",
      ctaUrl: "{{website_url}}",
    }),
    sectionLabel("Our recommendations"),
    para("Here are a few alternatives our team suggests for your setup:"),
    "<!-- 用编辑器上方「插入产品卡」按钮，在这行下面添加 1–3 个推荐产品；如无推荐，可删除本区块（含上面的「Our recommendations」标题）。 -->",
    featureRows([
      { title: "Straight with you", desc: "If we can't get hold of something, we'll always tell you rather than leave you waiting." },
      { title: "Expert alternatives", desc: "Our team can recommend equivalent or upgraded gear that fits your needs." },
      { title: "Official UK supplier", desc: "Genuine products, full warranty support and expert advice." },
    ]),
    helpCta({
      title: "Want a personal recommendation?",
      text: "Tell us what you were planning to use this for, and our team will point you toward the best available option. Many customers find something that suits them even better.",
      btnLabel: "Speak to the Team",
      btnUrl: "mailto:{{support_email}}",
    }),
    signoff(),
  ].join("\n"),
};

// ② 可下单提醒（按需订购 · 下单付款后采购）
const READY_TO_ORDER: EmailPreset = {
  key: "ready_to_order",
  name: "内置 · 可下单提醒",
  subject: "Ready to order — {{product_title}}",
  useGlobalShell: true,
  htmlBody: [
    heroBand({
      pill: "Ready to Order",
      intro: "The gear you asked about can now be ordered.",
      title: "Your Requested Item Is Ready to Order",
      tagline: "Sourced especially for you.",
    }),
    greeting(),
    para("Thanks for your interest in this item — we wanted to let you know it's now ready to order."),
    para("This particular item isn't something we hold in general stock. Instead, we order it in directly once a customer places an order, sourced straight from the manufacturer or distributor."),
    para("As soon as your order is placed, we'll begin sourcing it on your behalf. Our normal lead time for this item is <strong>7–10 working days</strong>, and our team will keep you updated every step of the way."),
    productCardVertical({
      label: "Your product",
      ctaLabel: "Place your order",
      ctaUrl: "{{product_url}}",
      subline: "Estimated lead time: 7–10 working days from order",
    }),
    featureRows([
      { title: "Sourced on demand", desc: "We order this item in specially once you check out, so you receive genuine, manufacturer-fresh stock." },
      { title: "Kept in the loop", desc: "We'll make sure you're kept up to date on your order's progress." },
      { title: "Official UK supplier", desc: "Genuine products, full warranty support and expert advice." },
    ]),
    helpCta({
      title: "Questions before you order?",
      text: "Want to confirm lead times, check compatibility, or talk through alternatives? Our team has handled plenty of special orders like this one and is happy to help before you commit.",
      btnLabel: "Speak to the Team",
      btnUrl: "mailto:{{support_email}}",
    }),
    signoff(),
  ].join("\n"),
};

export const EMAIL_PRESETS: EmailPreset[] = [OUT_OF_STOCK_ALT, READY_TO_ORDER];

export function getPreset(key: string): EmailPreset | undefined {
  return EMAIL_PRESETS.find((p) => p.key === key);
}
