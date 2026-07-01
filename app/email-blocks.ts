// 邮件正文构件（纯字符串，客户端安全，不依赖 prisma）。
// 自动模板(email-templates.server)与内置手动模板(email-presets)共用，视觉统一。
// 放在全局外壳(页眉/页脚)之间的正文区；外壳正文 td 内边距为 24px 32px。
// hero 用负边距做全宽（贴合页眉），其余块靠正文 td 的内边距。
//
// 统一字号：hero标题 21 / 段落·大标题 16 / 正文 14 / 卡标题 15 /
//          小标签 11 / 特性标题 13·说明 12 / 按钮 12。

const GOLD = "#d4a72c"; // 品牌金（按钮/徽章/标签）
const GOLD_SOFT = "#e8c84d"; // 深色底上的金色文字
const HERO_BG = "#1c1f26"; // hero 深色，衔接页眉 #23262e
const INK = "#1a1a1a";
const MUTED = "#666666";
const LIGHT_BAND = "#f6f5f1";

// 联系我们页（所有「Speak to the Team」按钮统一指向）
export const CONTACT_URL = "https://www.cinegearpro.co.uk/pages/contact-us";

// 金色按钮（实心）/ 描边按钮：统一尺寸
function solidBtn(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;background:${GOLD};color:${INK};font-weight:700;font-size:12px;letter-spacing:.5px;text-transform:uppercase;padding:10px 20px;border-radius:6px;text-decoration:none;">${label}</a>`;
}
function outlineBtn(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;border:1.5px solid ${GOLD};color:${INK};font-weight:700;font-size:12px;padding:10px 22px;border-radius:6px;text-decoration:none;">${label}</a>`;
}

// 模块间可点击空行（编辑器里方便落光标插入内容；邮件里是一小段间距）
export function spacer() {
  return `<p style="margin:0;line-height:18px;">&nbsp;</p>`;
}

// 顶部 hero：全宽深色banner（负边距抵消正文 td 的 24px/32px 内边距，贴合页眉）
export function heroBand(o: { pill: string; intro: string; title: string; tagline?: string }) {
  return `
  <div style="margin:-24px -32px 20px;">
    <div style="background:${HERO_BG};padding:32px 28px;text-align:center;">
      <span style="display:inline-block;background:${GOLD};color:${INK};font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:7px 16px;border-radius:20px;">${o.pill}</span>
      <div style="color:#9aa0aa;font-size:12px;margin-top:14px;">${o.intro}</div>
      <div style="color:#ffffff;font-size:21px;font-weight:700;line-height:1.3;margin-top:8px;">${o.title}</div>
      ${o.tagline ? `<div style="color:${GOLD_SOFT};font-size:12px;font-weight:700;margin-top:10px;">${o.tagline}</div>` : ""}
    </div>
  </div>`;
}

// 问候语（含姓名条件块）
export function greeting() {
  return `<div style="font-size:16px;font-weight:700;color:${INK};margin:0;">Hi{{#if customer_name}} {{customer_name}}{{/if}},</div>`;
}

// 正文段落
export function para(text: string) {
  return `<div style="font-size:14px;color:#555;line-height:1.7;margin:14px 0 0;">${text}</div>`;
}

// 小节金色标签
export function sectionLabel(text: string) {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};margin:0 0 10px;">${text}</div>`;
}

// 横版产品卡（左图 + 右信息）——用客人订阅产品的变量渲染。
//   ctaLabel/ctaUrl 有则显示按钮；statusText 有则显示状态胶囊（替代价格）。
//   showPriceNote：价格下方加一行简短时效说明。
export function productCard(o: {
  ctaLabel?: string;
  ctaUrl?: string;
  statusText?: string;
  subline?: string;
  showPriceNote?: boolean;
}) {
  const priceBlock = o.statusText
    ? `<div style="display:inline-block;margin-top:10px;background:#efeee9;color:#555;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:5px 12px;border-radius:16px;">${o.statusText}</div>`
    : `{{#if product_price}}<div style="font-size:16px;font-weight:700;color:${INK};margin-top:10px;">{{product_price}}</div>${o.showPriceNote ? `<div style="font-size:11px;color:#999;margin-top:3px;">Price may change — see the website.</div>` : ""}{{/if}}`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
    <tr>
      {{#if product_image}}<td width="140" style="padding:0;vertical-align:top;"><img src="{{product_image}}" alt="{{product_title}}" width="140" style="width:140px;height:140px;object-fit:cover;display:block;border:0;background:${HERO_BG};"></td>{{/if}}
      <td style="padding:16px 18px;vertical-align:top;">
        <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.35;">{{product_title}}</div>
        {{#if variant_title}}<div style="font-size:12px;color:#888;margin-top:4px;">{{variant_title}}</div>{{/if}}
        ${priceBlock}
        ${o.subline ? `<div style="font-size:11px;color:#999;margin-top:6px;">${o.subline}</div>` : ""}
        ${o.ctaLabel && o.ctaUrl ? `<div style="margin-top:14px;">${solidBtn(o.ctaLabel, o.ctaUrl)}</div>` : ""}
      </td>
    </tr>
  </table>`;
}

// 把客人产品卡包进 data-bis-card：在富文本编辑器里显示成「紧凑小卡片」而非原始 HTML。
export function customerCardChip(cardHtml: string, label = "Customer's product") {
  return `<div data-bis-card data-label="${label}">${cardHtml}</div>`;
}

// 浅色特性清单（金色勾 + 标题 + 说明）
export function featureRows(items: Array<{ title: string; desc: string }>) {
  const rows = items
    .map(
      (it, i) => `
    <tr>
      <td width="30" valign="top" style="padding:${i ? "14px" : "0"} 12px 0 0;">
        <div style="width:20px;height:20px;border-radius:50%;background:${GOLD};color:${INK};font-size:12px;font-weight:700;text-align:center;line-height:20px;">&#10003;</div>
      </td>
      <td valign="top" style="padding:${i ? "14px" : "0"} 0 0 0;">
        <div style="font-size:13px;font-weight:700;color:${INK};">${it.title}</div>
        <div style="font-size:12px;color:#777;margin-top:2px;line-height:1.55;">${it.desc}</div>
      </td>
    </tr>`,
    )
    .join("");
  return `
  <div style="background:${LIGHT_BAND};border-radius:12px;padding:22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>`;
}

// 帮助 CTA（居中标题 + 说明 + 描边金按钮，链接到 contact-us）
export function helpCta(o: { title: string; text: string; btnLabel: string }) {
  return `
  <div style="text-align:center;padding:4px 8px 0;">
    <div style="font-size:16px;font-weight:700;color:${INK};">${o.title}</div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:8px;">${o.text}</div>
    <div style="margin-top:16px;">${outlineBtn(o.btnLabel, CONTACT_URL)}</div>
  </div>`;
}

// 结尾签名（Thanks for choosing…），衔接全局黑色页脚
export function signoff() {
  return `
  <div style="border-top:1px solid #eee;padding-top:20px;text-align:center;">
    <div style="font-size:13px;font-weight:700;color:${INK};">Thanks for choosing {{shop_name}}.</div>
    <div style="font-size:12px;color:#888;line-height:1.6;margin-top:5px;">Premium filmmaking equipment for creators, productions, rental houses and working professionals.</div>
  </div>`;
}
