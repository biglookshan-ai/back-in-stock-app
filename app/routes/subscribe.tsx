// 公开订阅接口（经 App Proxy：storefront POST /apps/back-in-stock/subscribe）
// App Proxy 同源转发，无需 CORS；Shopify 用 signature 校验请求合法性。
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createSubscription } from "../models/subscription.server";
import { classifyEmailInBackground } from "../models/customer.server";
import { allow } from "../rate-limit.server";
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

  // ── 限流：只按「邮箱」限（可靠）。
  //   不按 IP 限：请求经 App Proxy 转发，x-forwarded-for 往往是 Shopify 代理 IP，
  //   全店会共用同一个 IP → 误把所有客人挡在门外。邮箱维度足够防单邮箱刷屏。
  const emailKey = email.trim().toLowerCase();
  if (!allow(`bis:email:${shop}:${emailKey}`, 20, 60 * 60 * 1000)) {
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

  // ── 先写入订阅（核心数据，务必保证进库；分类等放后台，绝不阻塞）──
  let alreadySubscribed = false;
  try {
    const res = await createSubscription({
      shop,
      email: emailKey,
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
    alreadySubscribed = res.alreadySubscribed;
  } catch (e) {
    console.error("[subscribe] createSubscription failed", e);
    return json({ error: "server_error" }, { status: 500 });
  }

  // 新老客分类：后台执行（查 Shopify 客户档案 + 下单数），失败不影响订阅
  void classifyEmailInBackground(admin, shop, emailKey).catch((e) =>
    console.error("[subscribe] classify failed", e),
  );

  return json({ ok: true, already: alreadySubscribed });
};
