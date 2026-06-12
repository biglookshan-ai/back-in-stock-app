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

// ── 品牌化邮件外壳（头部 logo + 页脚公司信息），各模板共用片段 ──────
const HEADER = `
  <tr><td align="center" style="padding:28px 32px 20px;border-bottom:1px solid #efefef;">
    {{#if brand_logo}}<img src="{{brand_logo}}" alt="{{shop_name}}" height="34" style="height:34px;display:block;border:0;">{{/if}}
    {{#unless brand_logo}}<div style="font-size:20px;font-weight:700;letter-spacing:.5px;color:{{brand_color}};">{{shop_name}}</div>{{/unless}}
  </td></tr>`;

const PRODUCT_CARD = `
  <tr><td style="padding:8px 32px 4px;">
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
  </td></tr>`;

const FOOTER = `
  <tr><td style="padding:24px 32px 28px;border-top:1px solid #efefef;">
    <div style="font-size:12px;color:#9a9a9a;line-height:1.7;">
      {{#if website_url}}<a href="{{website_url}}" style="color:{{brand_color}};text-decoration:none;font-weight:600;">{{website_url}}</a><br>{{/if}}
      {{#if company_address}}{{company_address}}<br>{{/if}}
      {{#if support_email}}Questions? <a href="mailto:{{support_email}}" style="color:#9a9a9a;">{{support_email}}</a><br>{{/if}}
      <span style="color:#bbb;">© {{shop_name}}</span>
    </div>
    <div style="font-size:11px;color:#c0c0c0;margin-top:12px;">
      <a href="{{unsubscribe_url}}" style="color:#c0c0c0;">Unsubscribe</a>
    </div>
  </td></tr>`;

function shell(bodyRows: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">
      ${HEADER}
      ${bodyRows}
      ${FOOTER}
    </table>
  </td></tr>
</table>`;
}

function button(label: string) {
  return `<tr><td style="padding:8px 32px 24px;">
    <a href="{{product_url}}" style="display:inline-block;background:{{brand_color}};color:#ffffff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">${label}</a>
  </td></tr>`;
}

const DEFAULTS: Record<TemplateType, { subject: string; htmlBody: string }> = {
  CONFIRMATION: {
    subject: "You're on the list — {{product_title}}",
    htmlBody: shell(`
  <tr><td style="padding:28px 32px 8px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">Thanks{{#if customer_name}}, {{customer_name}}{{/if}}!</div>
    <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">We'll email you the moment this item is back in stock.</div>
  </td></tr>
  ${PRODUCT_CARD}
  <tr><td style="padding:14px 32px 24px;font-size:13px;color:#999;">A confirmation that <strong>{{customer_email}}</strong> is subscribed.</td></tr>`),
  },
  BACK_IN_STOCK: {
    subject: "Back in stock: {{product_title}}",
    htmlBody: shell(`
  <tr><td style="padding:28px 32px 8px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">It's back in stock 🎉</div>
    <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">The item you wanted is available again. Stock can be limited — grab it before it's gone.</div>
  </td></tr>
  ${PRODUCT_CARD}
  ${button("Shop now")}`),
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
    data: { shop, type, ...DEFAULTS[type], enabled: true },
  });
}

export async function getAllTemplates(shop: string) {
  return Promise.all(TEMPLATE_TYPES.map((t) => getTemplate(shop, t)));
}

export { DEFAULTS as DEFAULT_TEMPLATES };
