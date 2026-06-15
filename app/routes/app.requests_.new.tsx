// 手动添加订阅：选产品/变体（Resource Picker）+ 邮箱/姓名/状态。不发确认信。
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  Select,
  Checkbox,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createManualSubscription } from "../models/subscription.server";

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", CAD: "C$", AUD: "A$", JPY: "¥", CNY: "¥", HKD: "HK$",
};
function fmtPrice(price?: string | null, code?: string) {
  if (!price) return null;
  const sym = code ? CURRENCY_SYMBOL[code] : "";
  const n = Number(price);
  const num = Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : price;
  return sym ? `${sym}${num}` : code ? `${num} ${code}` : num;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const variantId = String(fd.get("variantId") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const status = String(fd.get("status") ?? "ACTIVE");
  const marketing = fd.get("marketing") === "true";

  if (!EMAIL_RE.test(email)) return json({ error: "邮箱格式不正确" }, { status: 422 });
  if (!variantId) return json({ error: "请先选择产品/变体" }, { status: 422 });

  // Admin API 取权威 barcode/标题/图/价
  let variant: any;
  let currency = "";
  try {
    const resp = await admin.graphql(
      `#graphql
      query($id: ID!) {
        productVariant(id: $id) {
          id title barcode price
          image { url }
          product { id title handle featuredImage { url } }
        }
        shop { currencyCode }
      }`,
      { variables: { id: variantId } },
    );
    const j = await resp.json();
    variant = j?.data?.productVariant;
    currency = j?.data?.shop?.currencyCode ?? "";
  } catch (e) {
    return json({ error: "查询产品失败" }, { status: 502 });
  }
  if (!variant?.product) return json({ error: "找不到该变体" }, { status: 404 });

  await createManualSubscription({
    shop: session.shop,
    email,
    productId: variant.product.id,
    variantId: variant.id,
    barcode: variant.barcode ?? null,
    customerName: name || null,
    marketingConsent: marketing,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    productHandle: variant.product.handle,
    productImage: variant.image?.url ?? variant.product.featuredImage?.url ?? null,
    price: fmtPrice(variant.price, currency),
    status,
  });

  return redirect("/app/requests");
};

const STATUS_OPTIONS = [
  { label: "等待中（会在到货时收到通知）", value: "ACTIVE" },
  { label: "已发送", value: "NOTIFIED" },
  { label: "已订购", value: "ORDERED" },
  { label: "已取消", value: "CANCELLED" },
  { label: "已归档", value: "ARCHIVED" },
];

export default function NewSubscription() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [productTitle, setProductTitle] = useState("");
  const [variants, setVariants] = useState<Array<{ id: string; title: string }>>([]);
  const [variantId, setVariantId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [marketing, setMarketing] = useState(false);

  const pickProduct = async () => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: false });
    if (!picked || picked.length === 0) return;
    const p: any = picked[0];
    setProductTitle(p.title);
    const vs = (p.variants ?? []).map((v: any) => ({ id: v.id, title: v.title }));
    setVariants(vs);
    setVariantId(vs[0]?.id ?? "");
  };

  const submit = () =>
    fetcher.submit(
      { email, variantId, name, status, marketing: String(marketing) },
      { method: "POST" },
    );

  const err = (fetcher.data as any)?.error;

  return (
    <Page
      backAction={{ content: "请求列表", url: "/app/requests" }}
      title="手动添加订阅"
    >
      <TitleBar title="手动添加订阅" />
      <Card>
        <BlockStack gap="400">
          <Banner tone="info">
            <p>用于后台手动录入,或从其它 app 迁移历史订阅。此操作<b>不会</b>给客户发确认邮件。</p>
          </Banner>

          {/* 产品/变体 */}
          <BlockStack gap="200">
            <Text as="span" variant="bodyMd" fontWeight="medium">产品 / 变体</Text>
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={pickProduct}>{productTitle ? "重新选择" : "选择产品"}</Button>
              {productTitle ? <Text as="span" variant="bodyMd">{productTitle}</Text> : null}
            </InlineStack>
            {variants.length > 0 && (
              <Select
                label="变体"
                options={variants.map((v) => ({ label: v.title, value: v.id }))}
                value={variantId}
                onChange={setVariantId}
              />
            )}
          </BlockStack>

          <TextField label="客户邮箱" type="email" value={email} onChange={setEmail} autoComplete="email" requiredIndicator />
          <TextField label="客户姓名（可选）" value={name} onChange={setName} autoComplete="off" />
          <Select label="状态" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
          <Checkbox label="营销同意" checked={marketing} onChange={setMarketing} />

          {err ? <Banner tone="critical"><p>{err}</p></Banner> : null}

          <Box>
            <Button
              variant="primary"
              loading={fetcher.state !== "idle"}
              disabled={!email || !variantId}
              onClick={submit}
            >
              添加订阅
            </Button>
          </Box>
        </BlockStack>
      </Card>
    </Page>
  );
}
