// 公开订阅接口（经 App Proxy：storefront POST /apps/back-in-stock/subscribe）
// App Proxy 同源转发，无需 CORS；Shopify 用 signature 校验请求合法性。
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createSubscription } from "../models/subscription.server";
import { classifyCustomer } from "../models/customer.server";
import { allow, clientIp } from "../rate-limit.server";
import { isDisposableEmail } from "../disposable-domains.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", CAD: "C$", AUD: "A$", JPY: "¥", CNY: "¥", HKD: "HK$",
};
function formatPrice(price?: string | null, code?: string): string | null {
  if (!price) return null;
  const sym = code ? CURRENCY_SYMBOL[code] : "";
  // 价格通常形如 "749.95"；去掉无意义的 .00
  const n = Number(price);
  const num = Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : price;
  return sym ? `${sym}${num}` : code ? `${num} ${code}` : num;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  // 校验是经 Shopify App Proxy 转发的合法请求，并拿到已认证的 admin client
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const shop = session.shop;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad_request" }, { status: 400 });

  const { email, variantId, source, locale, hp, name, marketing } =
    body as Record<string, any>;

  // honeypot 反机器人：隐藏字段被填 → 直接当成功丢弃
  if (hp) return json({ ok: true });

  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, { status: 422 });
  }
  if (!variantId) {
    return json({ error: "missing_variant" }, { status: 422 });
  }

  // ── 一次性/临时邮箱拦截 ──
  if (isDisposableEmail(email)) {
    return json({ error: "invalid_email" }, { status: 422 });
  }

  // ── 限流（两层独立防护，挡批量灌库 + 邮件轰炸） ──
  //   IP 是挡洪水的主力：同一来源 30 次/10 分钟
  //   邮箱只是防呆上限，放宽：同一邮箱 20 次/小时（真实客人订多个缺货品也够用）
  const ip = clientIp(request);
  const emailKey = email.trim().toLowerCase();
  if (
    !allow(`bis:ip:${shop}:${ip}`, 30, 10 * 60 * 1000) ||
    !allow(`bis:email:${shop}:${emailKey}`, 20, 60 * 60 * 1000)
  ) {
    return json({ error: "rate_limited" }, { status: 429 });
  }

  // ── Admin API 复核变体（防篡改 + 拿权威 barcode/标题/handle） ──
  const gid = variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;

  let variant;
  let currencyCode = "";
  try {
    const resp = await admin.graphql(
      `#graphql
      query VariantForBis($id: ID!) {
        productVariant(id: $id) {
          id
          title
          barcode
          price
          image { url }
          product { id title handle featuredImage { url } }
        }
        shop { currencyCode }
      }`,
      { variables: { id: gid } },
    );
    const respJson = await resp.json();
    variant = respJson?.data?.productVariant;
    currencyCode = respJson?.data?.shop?.currencyCode ?? "";
  } catch (e) {
    return json({ error: "lookup_failed" }, { status: 502 });
  }

  if (!variant?.product) {
    return json({ error: "variant_not_found" }, { status: 404 });
  }

  // 新老客分类（查 Shopify 客户档案 + 下单数）；失败不阻塞订阅
  const customerType = await classifyCustomer(admin, email);

  const { alreadySubscribed } = await createSubscription({
    shop,
    email: email.trim().toLowerCase(),
    customerType,
    productId: variant.product.id,
    variantId: variant.id,
    barcode: variant.barcode ?? null, // ★ 权威 barcode
    customerName: name?.trim() || null,
    marketingConsent: marketing === "true" || marketing === "1" || marketing === true,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    productHandle: variant.product.handle,
    productImage: variant.image?.url ?? variant.product.featuredImage?.url ?? null,
    price: formatPrice(variant.price, currencyCode),
    source: source ?? "product_page",
    locale: locale ?? null,
  });

  return json({ ok: true, already: alreadySubscribed });
};
