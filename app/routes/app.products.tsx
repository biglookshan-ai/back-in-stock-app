// 产品订阅：按「产品」或「变体/Barcode」聚合，可切换视图 + 排序 + 搜索。
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate, Link as RemixLink } from "@remix-run/react";
import {
  Page, Card, IndexTable, EmptyState, Text, Box, InlineStack, ButtonGroup, Button,
  Select, TextField, Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type Row = {
  id: string;
  productId?: string;
  productTitle: string;
  variantTitle?: string;
  barcode?: string | null;
  active: number;
  total: number;
  last: string | null;
  storefrontUrl?: string;
  adminUrl?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(".myshopify.com", "");
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "variant" ? "variant" : "product";
  const sort = url.searchParams.get("sort") ?? "last";
  const q = url.searchParams.get("q")?.trim() ?? "";

  const qFilter = q
    ? {
        OR: [
          { productTitle: { contains: q, mode: "insensitive" as const } },
          { variantTitle: { contains: q, mode: "insensitive" as const } },
          { barcode: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  let rows: Row[];
  if (view === "variant") {
    const [totals, actives] = await Promise.all([
      prisma.subscription.groupBy({
        by: ["variantId", "productId", "productTitle", "variantTitle", "barcode", "productHandle"],
        where: { shop, ...qFilter },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.subscription.groupBy({
        by: ["variantId"],
        where: { shop, status: "ACTIVE" },
        _count: { _all: true },
      }),
    ]);
    const activeMap: Record<string, number> = {};
    actives.forEach((a) => (activeMap[a.variantId] = a._count._all));
    rows = totals.map((t) => {
      const vid = t.variantId.split("/").pop() ?? "";
      const pid = t.productId.split("/").pop() ?? "";
      return {
        id: t.variantId,
        productTitle: t.productTitle,
        variantTitle: t.variantTitle,
        barcode: t.barcode,
        active: activeMap[t.variantId] ?? 0,
        total: t._count._all,
        last: t._max.createdAt?.toISOString() ?? null,
        storefrontUrl: t.productHandle
          ? `https://${shop}/products/${t.productHandle}?variant=${vid}`
          : `https://${shop}`,
        adminUrl: `https://admin.shopify.com/store/${storeHandle}/products/${pid}/variants/${vid}`,
      };
    });
  } else {
    const [totals, actives] = await Promise.all([
      prisma.subscription.groupBy({
        by: ["productId", "productTitle"],
        where: { shop, ...(q ? { productTitle: { contains: q, mode: "insensitive" as const } } : {}) },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.subscription.groupBy({
        by: ["productId"],
        where: { shop, status: "ACTIVE" },
        _count: { _all: true },
      }),
    ]);
    const activeMap: Record<string, number> = {};
    actives.forEach((a) => (activeMap[a.productId] = a._count._all));
    rows = totals.map((t) => ({
      id: t.productId,
      productId: t.productId,
      productTitle: t.productTitle,
      active: activeMap[t.productId] ?? 0,
      total: t._count._all,
      last: t._max.createdAt?.toISOString() ?? null,
    }));
  }

  rows.sort((a, b) => {
    if (sort === "name")
      return a.productTitle.localeCompare(b.productTitle) || (a.variantTitle ?? "").localeCompare(b.variantTitle ?? "");
    if (sort === "active") return b.active - a.active || (b.last ?? "").localeCompare(a.last ?? "");
    if (sort === "total") return b.total - a.total || (b.last ?? "").localeCompare(a.last ?? "");
    return (b.last ?? "").localeCompare(a.last ?? "");
  });

  return { view, sort, q, rows };
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

export default function Products() {
  const { view, sort, q, rows } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Page backAction={{ content: "返回", onAction: () => navigate("/app") }}>
      <TitleBar title="产品订阅" />
      <Card padding="0">
        <Box padding="300">
          <InlineStack gap="300" align="space-between" blockAlign="center">
            <ButtonGroup variant="segmented">
              <Button pressed={view === "product"} onClick={() => setParam("view", "")}>按产品</Button>
              <Button pressed={view === "variant"} onClick={() => setParam("view", "variant")}>按变体 / Barcode</Button>
            </ButtonGroup>
            <InlineStack gap="300" blockAlign="center">
              <Box minWidth="200px">
                <TextField
                  label="搜索" labelHidden
                  placeholder={view === "variant" ? "barcode / 产品 / 变体" : "产品名称"}
                  value={q} onChange={(v) => setParam("q", v)}
                  clearButton onClearButtonClick={() => setParam("q", "")} autoComplete="off"
                />
              </Box>
              <Box minWidth="160px">
                <Select
                  label="排序" labelInline
                  options={[
                    { label: "最后请求", value: "last" },
                    { label: "产品名称", value: "name" },
                    { label: "当前等待", value: "active" },
                    { label: "历史总请求", value: "total" },
                  ]}
                  value={sort} onChange={(v) => setParam("sort", v)}
                />
              </Box>
            </InlineStack>
          </InlineStack>
        </Box>

        {rows.length === 0 ? (
          <EmptyState heading="还没有数据" image="">
            <p>客户在缺货商品页订阅后，这里会按{view === "variant" ? "变体 / barcode" : "产品"}汇总需求。</p>
          </EmptyState>
        ) : view === "variant" ? (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "产品 / 变体" }, { title: "Barcode" }, { title: "等待中" },
              { title: "总数" }, { title: "最后请求" }, { title: "链接" },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.id} key={r.id} position={i}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{r.productTitle}</Text>
                  <br />
                  <Text as="span" variant="bodySm" tone="subdued">{r.variantTitle}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="medium">{r.barcode ?? "—"}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{r.active}</IndexTable.Cell>
                <IndexTable.Cell>{r.total}</IndexTable.Cell>
                <IndexTable.Cell>{fmtDate(r.last)}</IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="300">
                    <Link url={r.storefrontUrl!} target="_blank">前台 ↗</Link>
                    <Link url={r.adminUrl!} target="_blank">后台 ↗</Link>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "产品" }, { title: "当前等待" }, { title: "最后请求" }, { title: "历史总请求" },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.id} key={r.id} position={i}>
                <IndexTable.Cell>
                  <RemixLink to={`/app/products/detail?productId=${encodeURIComponent(r.productId!)}`}>
                    {r.productTitle}
                  </RemixLink>
                </IndexTable.Cell>
                <IndexTable.Cell>{r.active}</IndexTable.Cell>
                <IndexTable.Cell>{fmtDate(r.last)}</IndexTable.Cell>
                <IndexTable.Cell>{r.total}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
