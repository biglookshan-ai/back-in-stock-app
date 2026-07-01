// 邮件正文构件（纯字符串，客户端安全，不依赖 prisma）。
// 自动模板(email-templates.server)与内置手动模板(email-presets)共用，视觉统一。
// 都放在全局外壳(页眉/页脚)之间的正文区(左右各 32px 内边距)。
// 颜色：品牌金 GOLD，深色 hero，配合现有深色 logo 页眉与黑色页脚。

const GOLD = "#d4a72c"; // 品牌金（按钮/徽章/标签）
const GOLD_SOFT = "#e8c84d"; // 深色底上的金色文字（与页脚展厅标题同色）
const HERO_BG = "#1c1f26"; // hero 深色，衔接页眉 #23262e
const INK = "#1a1a1a";
const MUTED = "#666666";
const LIGHT_BAND = "#f6f5f1";

// 顶部 hero：金色胶囊徽章 + 小字 + 大标题 + 金色副标语
export function heroBand(o: { pill: string; intro: string; title: string; tagline?: string }) {
  return `
  <div style="background:${HERO_BG};border-radius:12px;padding:30px 24px;text-align:center;margin:0 0 22px;">
    <span style="display:inline-block;background:${GOLD};color:${INK};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:7px 16px;border-radius:20px;">${o.pill}</span>
    <div style="color:#9aa0aa;font-size:13px;margin-top:14px;">${o.intro}</div>
    <div style="color:#ffffff;font-size:23px;font-weight:700;line-height:1.28;margin-top:8px;">${o.title}</div>
    ${o.tagline ? `<div style="color:${GOLD_SOFT};font-size:13px;font-weight:700;margin-top:12px;">${o.tagline}</div>` : ""}
  </div>`;
}

// 问候语（含姓名条件块）
export function greeting() {
  return `<div style="font-size:17px;font-weight:700;color:${INK};">Hi{{#if customer_name}} {{customer_name}}{{/if}},</div>`;
}

// 正文段落
export function para(text: string) {
  return `<div style="font-size:15px;color:#555;line-height:1.65;margin-top:14px;">${text}</div>`;
}

// 小节金色标签
export function sectionLabel(text: string) {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${GOLD};margin:24px 0 10px;">${text}</div>`;
}

// 竖版产品卡（图在上，居中）——用客人订阅产品的变量渲染。
// price 与 statusText 二选一；有 subline 则在下方补一行小字。
export function productCardVertical(o: {
  label: string;
  ctaLabel: string;
  ctaUrl: string;
  statusText?: string;
  subline?: string;
}) {
  const priceOrStatus = o.statusText
    ? `<div style="display:inline-block;margin-top:12px;background:#efeee9;color:#555;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:6px 14px;border-radius:16px;">${o.statusText}</div>`
    : `{{#if product_price}}<div style="font-size:17px;font-weight:700;color:${INK};margin-top:12px;">Price: {{product_price}}</div>{{/if}}`;
  return `
  ${sectionLabel(o.label)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
    {{#if product_image}}<tr><td style="padding:0;"><img src="{{product_image}}" alt="{{product_title}}" width="536" style="width:100%;max-width:536px;height:auto;display:block;border:0;"></td></tr>{{/if}}
    <tr><td style="padding:22px 24px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:${INK};line-height:1.35;">{{product_title}}</div>
      {{#if variant_title}}<div style="font-size:13px;color:#888;margin-top:5px;">{{variant_title}}</div>{{/if}}
      ${priceOrStatus}
      ${o.subline ? `<div style="font-size:12px;color:#999;margin-top:8px;">${o.subline}</div>` : ""}
      <div style="margin-top:18px;"><a href="${o.ctaUrl}" style="display:inline-block;background:${GOLD};color:${INK};font-weight:700;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:13px 28px;border-radius:6px;text-decoration:none;">${o.ctaLabel}</a></div>
    </td></tr>
  </table>`;
}

// 浅色特性清单（金色勾 + 标题 + 说明）
export function featureRows(items: Array<{ title: string; desc: string }>) {
  const rows = items
    .map(
      (it, i) => `
    <tr>
      <td width="34" valign="top" style="padding:${i ? "14px" : "0"} 12px 0 0;">
        <div style="width:22px;height:22px;border-radius:50%;background:${GOLD};color:${INK};font-size:13px;font-weight:700;text-align:center;line-height:22px;">&#10003;</div>
      </td>
      <td valign="top" style="padding:${i ? "14px" : "0"} 0 0 0;">
        <div style="font-size:14px;font-weight:700;color:${INK};">${it.title}</div>
        <div style="font-size:13px;color:#777;margin-top:3px;line-height:1.5;">${it.desc}</div>
      </td>
    </tr>`,
    )
    .join("");
  return `
  <div style="background:${LIGHT_BAND};border-radius:12px;padding:24px;margin:24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>`;
}

// 帮助 CTA（居中标题 + 说明 + 描边金按钮）
export function helpCta(o: { title: string; text: string; btnLabel: string; btnUrl: string }) {
  return `
  <div style="text-align:center;padding:6px 8px 2px;">
    <div style="font-size:17px;font-weight:700;color:${INK};">${o.title}</div>
    <div style="font-size:14px;color:${MUTED};line-height:1.6;margin-top:10px;">${o.text}</div>
    <div style="margin-top:18px;"><a href="${o.btnUrl}" style="display:inline-block;border:1.5px solid ${GOLD};color:${INK};font-weight:700;font-size:13px;padding:11px 26px;border-radius:6px;text-decoration:none;">${o.btnLabel}</a></div>
  </div>`;
}

// 结尾签名（Thanks for choosing…），衔接全局黑色页脚
export function signoff() {
  return `
  <div style="border-top:1px solid #eee;margin-top:26px;padding-top:20px;text-align:center;">
    <div style="font-size:14px;font-weight:700;color:${INK};">Thanks for choosing {{shop_name}}.</div>
    <div style="font-size:13px;color:#888;line-height:1.6;margin-top:6px;">Premium filmmaking equipment for creators, productions, rental houses and working professionals.</div>
  </div>`;
}
