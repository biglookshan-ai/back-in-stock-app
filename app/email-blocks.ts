// 邮件正文构件（纯字符串，客户端安全，不依赖 prisma）。
// 自动模板(email-templates.server)与内置手动模板(email-presets)共用，视觉统一。
// 放在全局外壳(页眉/页脚)之间的正文区；外壳正文 td 内边距为 24px 32px。
// hero 用负边距做全宽（贴合页眉），其余块靠正文 td 的内边距。

const GOLD = "#d4a72c"; // 品牌金（按钮/徽章/标签）
const GOLD_SOFT = "#e8c84d"; // 深色底上的金色文字
const HERO_BG = "#1c1f26"; // hero 深色，衔接页眉 #23262e
const INK = "#1a1a1a";
const MUTED = "#666666";
const LIGHT_BAND = "#f6f5f1";

// 联系我们页（所有「Speak to the Team」按钮统一指向）
export const CONTACT_URL = "https://www.cinegearpro.co.uk/pages/contact-us";

// 模块间可点击空行（编辑器里方便落光标插入内容；邮件里是一小段间距）
export function spacer() {
  return `<p style="margin:0;line-height:20px;">&nbsp;</p>`;
}

// 顶部 hero：全宽深色banner（负边距抵消正文 td 的 24px/32px 内边距，贴合页眉）
export function heroBand(o: { pill: string; intro: string; title: string; tagline?: string }) {
  return `
  <div style="margin:-24px -32px 22px;">
    <div style="background:${HERO_BG};padding:40px 30px;text-align:center;">
      <span style="display:inline-block;background:${GOLD};color:${INK};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:8px 18px;border-radius:20px;">${o.pill}</span>
      <div style="color:#9aa0aa;font-size:13px;margin-top:16px;">${o.intro}</div>
      <div style="color:#ffffff;font-size:23px;font-weight:700;line-height:1.3;margin-top:8px;">${o.title}</div>
      ${o.tagline ? `<div style="color:${GOLD_SOFT};font-size:13px;font-weight:700;margin-top:12px;">${o.tagline}</div>` : ""}
    </div>
  </div>`;
}

// 问候语（含姓名条件块）
export function greeting() {
  return `<div style="font-size:17px;font-weight:700;color:${INK};margin:0;">Hi{{#if customer_name}} {{customer_name}}{{/if}},</div>`;
}

// 正文段落
export function para(text: string) {
  return `<div style="font-size:15px;color:#555;line-height:1.7;margin:14px 0 0;">${text}</div>`;
}

// 小节金色标签
export function sectionLabel(text: string) {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};margin:0 0 12px;">${text}</div>`;
}

// 横版产品卡（左大图 + 右信息）——用客人订阅产品的变量渲染。
//   ctaLabel/ctaUrl 有则显示按钮；statusText 有则显示状态胶囊（替代价格）。
//   showPriceNote：价格下方加一行时效说明。
export function productCard(o: {
  ctaLabel?: string;
  ctaUrl?: string;
  statusText?: string;
  subline?: string;
  showPriceNote?: boolean;
}) {
  const priceBlock = o.statusText
    ? `<div style="display:inline-block;margin-top:10px;background:#efeee9;color:#555;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:6px 14px;border-radius:16px;">${o.statusText}</div>`
    : `{{#if product_price}}<div style="font-size:18px;font-weight:700;color:${INK};margin-top:10px;">{{product_price}}</div>${o.showPriceNote ? `<div style="font-size:11px;color:#999;line-height:1.5;margin-top:4px;">Price shown was correct when this email was sent and may change — see the website for the latest.</div>` : ""}{{/if}}`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
    <tr>
      {{#if product_image}}<td width="180" style="padding:0;vertical-align:top;"><img src="{{product_image}}" alt="{{product_title}}" width="180" style="width:180px;height:180px;object-fit:cover;display:block;border:0;background:${HERO_BG};"></td>{{/if}}
      <td style="padding:18px 20px;vertical-align:top;">
        <div style="font-size:17px;font-weight:700;color:${INK};line-height:1.35;">{{product_title}}</div>
        {{#if variant_title}}<div style="font-size:13px;color:#888;margin-top:5px;">{{variant_title}}</div>{{/if}}
        ${priceBlock}
        ${o.subline ? `<div style="font-size:12px;color:#999;margin-top:8px;">${o.subline}</div>` : ""}
        ${o.ctaLabel && o.ctaUrl ? `<div style="margin-top:16px;"><a href="${o.ctaUrl}" style="display:inline-block;background:${GOLD};color:${INK};font-weight:700;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:12px 24px;border-radius:6px;text-decoration:none;">${o.ctaLabel}</a></div>` : ""}
      </td>
    </tr>
  </table>`;
}

// 把客人产品卡包进 data-bis-card：在富文本编辑器里显示成「紧凑小卡片」而非原始 HTML。
// 发送/预览时会展开成完整卡片。label 只在编辑器 chip 上显示。
export function customerCardChip(cardHtml: string, label = "Customer's product") {
  return `<div data-bis-card data-label="${label}">${cardHtml}</div>`;
}

// 浅色特性清单（金色勾 + 标题 + 说明）
export function featureRows(items: Array<{ title: string; desc: string }>) {
  const rows = items
    .map(
      (it, i) => `
    <tr>
      <td width="34" valign="top" style="padding:${i ? "16px" : "0"} 12px 0 0;">
        <div style="width:22px;height:22px;border-radius:50%;background:${GOLD};color:${INK};font-size:13px;font-weight:700;text-align:center;line-height:22px;">&#10003;</div>
      </td>
      <td valign="top" style="padding:${i ? "16px" : "0"} 0 0 0;">
        <div style="font-size:14px;font-weight:700;color:${INK};">${it.title}</div>
        <div style="font-size:13px;color:#777;margin-top:3px;line-height:1.55;">${it.desc}</div>
      </td>
    </tr>`,
    )
    .join("");
  return `
  <div style="background:${LIGHT_BAND};border-radius:12px;padding:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>`;
}

// 帮助 CTA（居中标题 + 说明 + 描边金按钮，链接到 contact-us）
export function helpCta(o: { title: string; text: string; btnLabel: string }) {
  return `
  <div style="text-align:center;padding:6px 8px 2px;">
    <div style="font-size:17px;font-weight:700;color:${INK};">${o.title}</div>
    <div style="font-size:14px;color:${MUTED};line-height:1.65;margin-top:10px;">${o.text}</div>
    <div style="margin-top:18px;"><a href="${CONTACT_URL}" style="display:inline-block;border:1.5px solid ${GOLD};color:${INK};font-weight:700;font-size:13px;padding:12px 26px;border-radius:6px;text-decoration:none;">${o.btnLabel}</a></div>
  </div>`;
}

// 结尾签名（Thanks for choosing…），衔接全局黑色页脚
export function signoff() {
  return `
  <div style="border-top:1px solid #eee;padding-top:22px;text-align:center;">
    <div style="font-size:14px;font-weight:700;color:${INK};">Thanks for choosing {{shop_name}}.</div>
    <div style="font-size:13px;color:#888;line-height:1.6;margin-top:6px;">Premium filmmaking equipment for creators, productions, rental houses and working professionals.</div>
  </div>`;
}
