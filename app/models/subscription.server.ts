// 订阅领域逻辑：创建订阅、发确认信、到货群发、设置读写、退订签名。
import crypto from "crypto";
import prisma from "../db.server";
import { mailer } from "../mailer.server";
import { getTemplate, renderTemplate } from "../email-templates.server";

const SIGN_SECRET = process.env.SHOPIFY_API_SECRET || "dev-secret";

// ── 设置 ──────────────────────────────────────────────────────────
export async function getSettings(shop: string) {
  const s = await prisma.settings.findUnique({ where: { shop } });
  if (s) return s;
  return prisma.settings.create({ data: { shop } });
}

// ── 退订 token（无状态，HMAC 签名） ───────────────────────────────
export function signUnsubscribe(subscriptionId: string) {
  const sig = crypto
    .createHmac("sha256", SIGN_SECRET)
    .update(subscriptionId)
    .digest("hex")
    .slice(0, 32);
  return `${subscriptionId}.${sig}`;
}

export function verifyUnsubscribe(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expect = crypto
    .createHmac("sha256", SIGN_SECRET)
    .update(id)
    .digest("hex")
    .slice(0, 32);
  return sig === expect ? id : null;
}

function unsubscribeUrl(appUrl: string, subscriptionId: string) {
  return `${appUrl}/api/unsubscribe?token=${encodeURIComponent(signUnsubscribe(subscriptionId))}`;
}

function productUrl(shop: string, handle: string | null, variantId: string) {
  const vid = variantId.split("/").pop();
  return handle
    ? `https://${shop}/products/${handle}?variant=${vid}`
    : `https://${shop}`;
}

// ── 创建订阅 + 发确认信 ───────────────────────────────────────────
export interface SubscribeInput {
  shop: string;
  email: string;
  productId: string;
  variantId: string;
  barcode?: string | null;
  customerName?: string | null;
  marketingConsent?: boolean;
  productTitle: string;
  variantTitle: string;
  productHandle?: string | null;
  productImage?: string | null;
  price?: string | null;
  source?: string | null;
  locale?: string | null;
}

export async function createSubscription(input: SubscribeInput) {
  // 先看是否已存在、且当前就在「等待中」——若是，则不重复发确认信
  const existing = await prisma.subscription.findUnique({
    where: {
      shop_email_variantId: {
        shop: input.shop,
        email: input.email,
        variantId: input.variantId,
      },
    },
    select: { status: true },
  });
  const alreadySubscribed = existing?.status === "ACTIVE";

  const sub = await prisma.subscription.upsert({
    where: {
      shop_email_variantId: {
        shop: input.shop,
        email: input.email,
        variantId: input.variantId,
      },
    },
    // 已有订阅：重新激活（之前可能已 NOTIFIED/CANCELLED），刷新快照
    update: {
      status: "ACTIVE",
      notifiedAt: null,
      orderedAt: null,
      barcode: input.barcode ?? undefined,
      customerName: input.customerName ?? undefined,
      marketingConsent: input.marketingConsent ?? undefined,
      productTitle: input.productTitle,
      variantTitle: input.variantTitle,
      productHandle: input.productHandle ?? undefined,
      productImage: input.productImage ?? undefined,
      price: input.price ?? undefined,
    },
    create: {
      shop: input.shop,
      email: input.email,
      productId: input.productId,
      variantId: input.variantId,
      barcode: input.barcode ?? null,
      customerName: input.customerName ?? null,
      marketingConsent: input.marketingConsent ?? false,
      productTitle: input.productTitle,
      variantTitle: input.variantTitle,
      productHandle: input.productHandle ?? null,
      productImage: input.productImage ?? null,
      price: input.price ?? null,
      source: input.source ?? "product_page",
      locale: input.locale ?? null,
      status: "ACTIVE",
    },
  });

  // 后台发确认信，不阻塞响应（SMTP 慢/超时不应让前端报 Network error）。
  // Railway 是常驻 Node 进程，fire-and-forget 的 promise 会在后台跑完。
  if (!alreadySubscribed) {
    void sendConfirmation(sub.id).catch((e) =>
      console.error("[mailer] confirmation send failed", e),
    );
  }
  return { sub, alreadySubscribed };
}

// 转化追踪：某邮箱下单了某变体 → 把对应订阅标记为 ORDERED
export async function markOrdered(
  shop: string,
  email: string,
  variantIds: string[],
) {
  if (!email || variantIds.length === 0) return 0;
  const res = await prisma.subscription.updateMany({
    where: {
      shop,
      email: email.toLowerCase(),
      variantId: { in: variantIds },
      status: { in: ["ACTIVE", "NOTIFIED"] },
    },
    data: { status: "ORDERED", orderedAt: new Date() },
  });
  return res.count;
}

async function sendConfirmation(subscriptionId: string) {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!sub) return;
  const tpl = await getTemplate(sub.shop, "CONFIRMATION");
  if (!tpl.enabled) return;
  await sendEmail(sub, "CONFIRMATION", tpl);
}

// ── 到货群发 ──────────────────────────────────────────────────────
// inventory webhook 调用：把某 variant 的所有 ACTIVE 订阅发「到货」信。
// v1 内联顺序发送（带每封间隔，温和限速）。量大时可替换为 BullMQ + Redis。
export async function notifyVariantRestocked(shop: string, variantId: string) {
  const subs = await prisma.subscription.findMany({
    where: { shop, variantId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }, // 先到先得
  });
  if (subs.length === 0) return { notified: 0 };

  const tpl = await getTemplate(shop, "BACK_IN_STOCK");
  let notified = 0;
  for (const sub of subs) {
    const res = await sendEmail(sub, "BACK_IN_STOCK", tpl);
    if (res.ok) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "NOTIFIED", notifiedAt: new Date() },
      });
      notified++;
    }
    await new Promise((r) => setTimeout(r, 200)); // 温和限速
  }
  return { notified };
}

// ── 统一发信 + 写 EmailLog ────────────────────────────────────────
async function sendEmail(
  sub: {
    id: string;
    shop: string;
    email: string;
    customerName: string | null;
    productTitle: string;
    variantTitle: string;
    variantId: string;
    productHandle: string | null;
    productImage: string | null;
    price: string | null;
  },
  type: "CONFIRMATION" | "BACK_IN_STOCK",
  tpl: { subject: string; htmlBody: string },
) {
  const settings = await getSettings(sub.shop);
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const variantLabel =
    sub.variantTitle && sub.variantTitle !== "Default Title" ? sub.variantTitle : "";
  const { subject, html } = renderTemplate(tpl, {
    customer_email: sub.email,
    customer_name: sub.customerName ?? "",
    product_title: sub.productTitle,
    variant_title: variantLabel,
    product_image: sub.productImage ?? "",
    product_price: sub.price ?? "",
    product_url: productUrl(sub.shop, sub.productHandle, sub.variantId),
    shop_name: settings.fromName,
    brand_logo: settings.logoUrl,
    brand_color: settings.brandColor,
    website_url: settings.websiteUrl,
    company_address: settings.companyAddress,
    support_email: settings.supportEmail,
    unsubscribe_url: unsubscribeUrl(appUrl, sub.id),
  });

  const result = await mailer.send({
    to: sub.email,
    subject,
    html,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail || `no-reply@${sub.shop}`,
  });

  await prisma.emailLog.create({
    data: {
      shop: sub.shop,
      subscriptionId: sub.id,
      type,
      toEmail: sub.email,
      status: result.ok ? "SENT" : "FAILED",
      error: result.error ?? null,
    },
  });
  return result;
}
