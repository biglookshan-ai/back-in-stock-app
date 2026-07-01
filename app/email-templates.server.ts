// 邮件模板：默认内容 + 变量/条件渲染 + 取/存。
import prisma from "./db.server";
import {
  heroBand, greeting, para, sectionLabel, productCard, featureRows, helpCta, signoff, spacer,
  priceFootnote, wrapEmailBody,
} from "./email-blocks";

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
      <td class="bis-col" style="padding:22px 26px;vertical-align:middle;">
        <div style="font-size:16px;font-weight:700;color:#ffffff;">Gear Up Now, Pay Later</div>
        <div style="font-size:12px;color:#bbbbbb;margin-top:4px;">We offer Klarna payments on all of our products.</div>
      </td>
      <td align="right" class="bis-col bis-center-sm bis-pt-sm" style="padding:22px 26px;vertical-align:middle;">
        <img src="https://cdn.shopify.com/s/files/1/1258/4351/files/Klarna_Payment_Badge.png?v=1782477265" alt="Klarna" height="30" style="height:30px;border:0;display:block;">
      </td>
    </tr></table>
    <div style="border-top:1px solid #2a2a2a;margin:0 26px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="bis-col" style="padding:20px 26px;vertical-align:top;font-size:12px;line-height:1.6;">
        <div style="color:#e8c84d;font-weight:700;font-size:15px;">Visit our showroom</div>
        <div style="margin-top:3px;color:#e8c84d;font-size:12px;">Try Before You Buy</div>
        <div style="margin-top:9px;color:#bbbbbb;">Opening Hours:<br>Monday to Friday 9:00am &ndash; 5:30pm</div>
        <div style="margin-top:10px;color:#bbbbbb;">London Showroom:<br>Unit 7, Victoria Park Industrial Centre<br>Rothbury Road, London E9 5HD</div>
      </td>
      <td align="right" class="bis-col bis-center-sm bis-pt-sm" style="padding:20px 26px;vertical-align:top;">
        <a href="https://maps.google.com/?q=CINEGEARPRO+LTD+London+E9+5HD"><img class="bis-map" src="https://cdn.shopify.com/s/files/1/1258/4351/files/Cgp_map.jpg?v=1782477265" alt="Map to CINEGEARPRO, London E9 5HD" width="200" style="width:200px;max-width:200px;border:0;display:block;border-radius:4px;"></a>
      </td>
    </tr></table>
    <div style="padding:6px 26px 24px;">
      <div>
        <a href="https://facebook.com/cinegearpro"><img src="https://cdn.shopify.com/shopify-email/pgiqu05kn0pdfi4jnqq2p14qu5rw.svg?width=60&height=60&format=png" height="22" width="22" alt="Facebook" style="border:0;margin-right:16px;vertical-align:middle;"></a>
        <a href="https://instagram.com/cinegearpro"><img src="https://cdn.shopify.com/shopify-email/tv9pnmzfjzjjsp1ylzgxokl6nnx3.svg?width=60&height=60&format=png" height="22" width="22" alt="Instagram" style="border:0;margin-right:16px;vertical-align:middle;"></a>
        <a href="https://youtube.com/@cinegearpro"><img src="https://cdn.shopify.com/shopify-email/trx6uyjo3dzi5zerszkhemidvmts.svg?width=60&height=60&format=png" height="22" width="22" alt="YouTube" style="border:0;vertical-align:middle;"></a>
      </div>
      <div style="margin-top:20px;font-size:12px;color:#999999;">Copyright &copy; {{shop_name}}.</div>
      <div style="margin-top:6px;font-size:12px;color:#999999;">No longer want to receive these emails? <a href="{{unsubscribe_url}}" style="color:#bbbbbb;text-decoration:underline;">Unsubscribe</a></div>
    </div>
  </td></tr>`;

// ── 全局页眉/页脚的内置默认（设置里为空时用这个）──────────────────
// 版本标记：内置默认页眉/页脚更新时递增。旧的「保存副本」若不含当前标记，
// 视为过时 → 自动改用最新内置默认（省去用户每次手动 reset）。
export const SHELL_TOKEN = "bis-shell-3";
export const DEFAULT_HEADER = `${HEADER}<!--${SHELL_TOKEN}-->`;
export const DEFAULT_FOOTER = `${FOOTER}<!--${SHELL_TOKEN}-->`;
export const CUSTOMER_PRODUCT_CARD = PRODUCT_CARD; // 「插入客人产品卡」用

// 解析实际使用的页眉/页脚：保存值含当前版本标记则用保存值，否则用最新内置默认。
export function effectiveHeader(saved?: string | null): string {
  return saved && saved.includes(SHELL_TOKEN) ? saved : DEFAULT_HEADER;
}
export function effectiveFooter(saved?: string | null): string {
  return saved && saved.includes(SHELL_TOKEN) ? saved : DEFAULT_FOOTER;
}

// 外壳：把 页眉+正文+页脚 包进邮件外层表格。
// 关键：正文放进独立 <td> 单元格，正文可为任意 HTML（div/table），
// 不会因为非 <tr> 内容被浏览器「踢」出表格（foster-parenting）而错位。
export function composeEmail(header: string, body: string, footer: string) {
  return wrapEmailBody(header, body, footer);
}

// 默认模板「正文」——只含中间内容（页眉/页脚由全局提供，useGlobalShell=true）
const DEFAULTS: Record<TemplateType, { subject: string; htmlBody: string }> = {
  CONFIRMATION: {
    subject: "You're on the list — {{product_title}}",
    htmlBody: [
      heroBand({
        pill: "Subscription Confirmed",
        intro: "We've saved your request.",
        title: "You're on the List",
        tagline: "We'll let you know the moment it's back.",
      }),
      greeting(),
      para("Thanks for your interest — we've added <strong>{{product_title}}</strong> to your back-in-stock alerts. We'll email <strong>{{customer_email}}</strong> as soon as it's available to order from {{shop_name}}."),
      spacer(),
      sectionLabel("Your requested item"),
      productCard({ ctaLabel: "View product", ctaUrl: "{{product_url}}", showPriceNote: true }),
      spacer(),
      featureRows([
        { title: "We'll notify you", desc: "You'll be among the first to hear when it's back in stock." },
        { title: "No spam", desc: "We'll only email you about this item — nothing else." },
        { title: "Official UK supplier", desc: "Genuine products, warranty support and expert advice." },
      ]),
      spacer(),
      priceFootnote(),
      spacer(),
      signoff(),
    ].join("\n"),
  },
  BACK_IN_STOCK: {
    subject: "Back in stock: {{product_title}}",
    htmlBody: [
      heroBand({
        pill: "Back in Stock Notification",
        intro: "The gear you asked about is available again.",
        title: "Your Requested Item Is Back in Stock",
        tagline: "Limited availability — order soon to avoid missing out.",
      }),
      greeting(),
      para("Good news — the item you asked to be notified about is now back in stock and available to order from {{shop_name}}."),
      para("As stock may be limited, we recommend placing your order as soon as possible if you're still interested."),
      spacer(),
      sectionLabel("Your product"),
      productCard({ ctaLabel: "Shop now", ctaUrl: "{{product_url}}", showPriceNote: true }),
      spacer(),
      featureRows([
        { title: "Back in stock", desc: "Available to order now." },
        { title: "Fast dispatch", desc: "Orders are processed as quickly as possible." },
        { title: "Official UK supplier", desc: "Genuine products, warranty support and expert advice." },
      ]),
      spacer(),
      helpCta({
        title: "Need help before ordering?",
        text: "Not sure if this is the right item for your setup? Our team can help with compatibility, alternatives, lead times, and product advice.",
        btnLabel: "Speak to the Team",
      }),
      spacer(),
      priceFootnote(),
      spacer(),
      signoff(),
    ].join("\n"),
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
