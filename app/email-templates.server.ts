// 邮件模板：默认内容 + 变量/条件渲染 + 取/存。
import prisma from "./db.server";

export const TEMPLATE_TYPES = ["CONFIRMATION", "BACK_IN_STOCK"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

// 支持的占位符
export interface TemplateVars {
  customer_email: string;
  customer_name: string;
  product_title: string;
  variant_title: string;
  product_image: string;
  product_price: string;
  product_url: string;
  shop_name: string;
  brand_logo: string;
  brand_color: string;
  website_url: string;
  company_address: string;
  support_email: string;
  unsubscribe_url: string;
}

// ── 品牌化邮件外壳（深色页眉 logo + 页脚展厅信息，对齐 Newsletter 版式）──────
const HEADER = `
  <tr><td align="left" style="background:#23262e;padding:18px 24px;">
    <img src="https://cdn.shopify.com/shopify-email/kxuq59r7o9axnrab05g6y1puvobi.png?width=960&height=960" alt="{{shop_name}}" height="38" style="height:38px;display:block;border:0;">
  </td></tr>`;

// 产品卡：独立 table（水平内边距由正文单元格统一提供，这里只留上下间距）
const PRODUCT_CARD = `
  <div style="margin:16px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;overflow:hidden;">
      <tr>
        {{#if product_image}}<td width="120" style="padding:0;"><img src="{{product_image}}" alt="" width="120" style="width:120px;height:120px;object-fit:cover;display:block;border:0;"></td>{{/if}}
        <td style="padding:16px 18px;vertical-align:top;">
          <div style="font-size:16px;font-weight:700;color:#1a1a1a;line-height:1.35;">{{product_title}}</div>
          {{#if variant_title}}<div style="font-size:13px;color:#888;margin-top:4px;">{{variant_title}}</div>{{/if}}
          {{#if product_price}}<div style="font-size:16px;font-weight:600;color:{{brand_color}};margin-top:10px;">{{product_price}}</div>{{/if}}
        </td>
      </tr>
    </table>
  </div>`;

const FOOTER = `
  <tr><td style="background:#000000;padding:0;font-family:Arial,sans-serif;color:#cfcfcf;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:26px 32px;vertical-align:middle;">
        <div style="font-size:18px;font-weight:700;color:#ffffff;">Gear Up Now, Pay Later</div>
        <div style="font-size:13px;color:#bbbbbb;margin-top:5px;">We offer Klarna payments on all of our products.</div>
      </td>
      <td align="right" style="padding:26px 32px;vertical-align:middle;">
        <img src="https://cdn.shopify.com/s/files/1/1258/4351/files/Klarna_Payment_Badge.png?v=1782477265" alt="Klarna" height="34" style="height:34px;border:0;display:block;">
      </td>
    </tr></table>
    <div style="border-top:1px solid #2a2a2a;margin:0 32px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:22px 32px;vertical-align:top;font-size:13px;line-height:1.7;">
        <div style="color:#e8c84d;font-weight:700;font-size:16px;">Visit our showroom</div>
        <div style="margin-top:4px;color:#e8c84d;font-size:13px;">Try Before You Buy</div>
        <div style="margin-top:10px;color:#bbbbbb;">Opening Hours:<br>Monday to Friday 9:00am &ndash; 5:30pm</div>
        <div style="margin-top:12px;color:#bbbbbb;">London Showroom:<br>Unit 7, Victoria Park Industrial Centre<br>Rothbury Road, London E9 5HD</div>
      </td>
      <td align="right" style="padding:22px 32px;vertical-align:top;">
        <a href="https://maps.google.com/?q=CINEGEARPRO+LTD+London+E9+5HD"><img src="https://cdn.shopify.com/s/files/1/1258/4351/files/Cgp_map.jpg?v=1782477265" alt="Map to CINEGEARPRO, London E9 5HD" width="220" style="width:220px;max-width:220px;border:0;display:block;border-radius:4px;"></a>
      </td>
    </tr></table>
    <div style="padding:6px 32px 28px;">
      <div>
        <a href="https://facebook.com/cinegearpro"><img src="https://cdn.shopify.com/shopify-email/pgiqu05kn0pdfi4jnqq2p14qu5rw.svg?width=60&height=60&format=png" height="22" width="22" alt="Facebook" style="border:0;margin-right:16px;vertical-align:middle;"></a>
        <a href="https://instagram.com/cinegearpro"><img src="https://cdn.shopify.com/shopify-email/tv9pnmzfjzjjsp1ylzgxokl6nnx3.svg?width=60&height=60&format=png" height="22" width="22" alt="Instagram" style="border:0;margin-right:16px;vertical-align:middle;"></a>
        <a href="https://youtube.com/@cinegearpro"><img src="https://cdn.shopify.com/shopify-email/trx6uyjo3dzi5zerszkhemidvmts.svg?width=60&height=60&format=png" height="22" width="22" alt="YouTube" style="border:0;vertical-align:middle;"></a>
      </div>
      <div style="margin-top:20px;font-size:12px;color:#999999;">Copyright &copy; {{shop_name}}.</div>
      <div style="margin-top:6px;font-size:12px;color:#999999;">No longer want to receive these emails? <a href="{{unsubscribe_url}}" style="color:#bbbbbb;text-decoration:underline;">Unsubscribe</a></div>
    </div>
  </td></tr>`;

function button(label: string) {
  return `<div style="margin:16px 0 4px;">
    <a href="{{product_url}}" style="display:inline-block;background:{{brand_color}};color:#ffffff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">${label}</a>
  </div>`;
}

// ── 全局页眉/页脚的内置默认（设置里为空时用这个）──────────────────
export const DEFAULT_HEADER = HEADER;
export const DEFAULT_FOOTER = FOOTER;
export const CUSTOMER_PRODUCT_CARD = PRODUCT_CARD; // 「插入客人产品卡」用

// 外壳：把 页眉+正文+页脚 包进邮件外层表格。
// 关键：正文放进独立 <td> 单元格，正文可为任意 HTML（div/table），
// 不会因为非 <tr> 内容被浏览器「踢」出表格（foster-parenting）而错位。
export function composeEmail(header: string, body: string, footer: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">
      ${header}
      <tr><td style="padding:24px 32px;">${body}</td></tr>
      ${footer}
    </table>
  </td></tr>
</table>`;
}

// 默认模板「正文」——只含中间内容（页眉/页脚由全局提供，useGlobalShell=true）
const DEFAULTS: Record<TemplateType, { subject: string; htmlBody: string }> = {
  CONFIRMATION: {
    subject: "You're on the list — {{product_title}}",
    htmlBody: `
  <div style="font-size:22px;font-weight:700;color:#1a1a1a;">Thanks{{#if customer_name}}, {{customer_name}}{{/if}}!</div>
  <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">We'll email you the moment this item is back in stock.</div>
  ${PRODUCT_CARD}
  <div style="font-size:13px;color:#999;margin-top:8px;">A confirmation that <strong>{{customer_email}}</strong> is subscribed.</div>`,
  },
  BACK_IN_STOCK: {
    subject: "Back in stock: {{product_title}}",
    htmlBody: `
  <div style="font-size:22px;font-weight:700;color:#1a1a1a;">It's back in stock 🎉</div>
  <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">The item you wanted is available again. Stock can be limited — grab it before it's gone.</div>
  ${PRODUCT_CARD}
  ${button("Shop now")}`,
  },
};

// 渲染：先处理 {{#if}} / {{#unless}} 条件块，再替换 {{var}}
export function renderTemplate(
  tpl: { subject: string; htmlBody: string },
  vars: TemplateVars,
): { subject: string; html: string } {
  const fill = (s: string) => {
    let out = s.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_m, key: string, inner: string) =>
        vars[key as keyof TemplateVars] ? inner : "",
    );
    out = out.replace(
      /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (_m, key: string, inner: string) =>
        vars[key as keyof TemplateVars] ? "" : inner,
    );
    out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
      key in vars ? String(vars[key as keyof TemplateVars]) : "",
    );
    return out;
  };
  return { subject: fill(tpl.subject), html: fill(tpl.htmlBody) };
}

// 取模板：库里没有就回退到默认（并惰性创建一条，方便后台编辑）。
export async function getTemplate(shop: string, type: TemplateType) {
  const existing = await prisma.emailTemplate.findUnique({
    where: { shop_type: { shop, type } },
  });
  if (existing) return existing;
  return prisma.emailTemplate.create({
    data: { shop, type, ...DEFAULTS[type], enabled: true, useGlobalShell: true },
  });
}

export async function getAllTemplates(shop: string) {
  return Promise.all(TEMPLATE_TYPES.map((t) => getTemplate(shop, t)));
}

export { DEFAULTS as DEFAULT_TEMPLATES };
