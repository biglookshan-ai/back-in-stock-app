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
import { resolveStockLocations, getAvailability } from "../models/inventory.server";
import { useT } from "../i18n";

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
  stockShop?: number | null;
  stockEw?: number | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
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

  // 变体视图：查两地实时 Available 库存并附到每行
  let stockNames = { shopName: "门店", ewName: "EW" };
  if (view === "variant" && rows.length > 0) {
    const loc = await resolveStockLocations(admin);
    stockNames = { shopName: loc.shopName, ewName: loc.ewName };
    const avail = await getAvailability(admin, rows.map((r) => r.id), loc);
    rows.forEach((r) => {
      const a = avail[r.id];
      r.stockShop = a?.shop ?? null;
      r.stockEw = a?.ew ?? null;
    });
  }

  return { view, sort, q, rows, stockNames };
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

// 库存数字：缺货(<=0)红色，有货默认，未知显示「—」
const stockText = (n: number | null | undefined) =>
  n == null ? (
    <Text as="span" tone="subdued">—</Text>
  ) : (
    <Text as="span" fontWeight="semibold" tone={n <= 0 ? "critical" : undefined}>{n}</Text>
  );

export default function Products() {
  const { view, sort, q, rows, stockNames } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Page backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("产品订阅")} />
      <Card padding="0">
        <Box padding="300">
          <InlineStack gap="300" align="space-between" blockAlign="center">
            <ButtonGroup variant="segmented">
              <Button pressed={view === "product"} onClick={() => setParam("view", "")}>{t("按产品")}</Button>
              <Button pressed={view === "variant"} onClick={() => setParam("view", "variant")}>{t("按变体 / Barcode")}</Button>
            </ButtonGroup>
            <InlineStack gap="300" blockAlign="center">
              <Box minWidth="200px">
                <TextField
                  label={t("搜索")} labelHidden
                  placeholder={view === "variant" ? t("barcode / 产品 / 变体") : t("产品名称")}
                  value={q} onChange={(v) => setParam("q", v)}
                  clearButton onClearButtonClick={() => setParam("q", "")} autoComplete="off"
                />
              </Box>
              <Box minWidth="160px">
                <Select
                  label={t("排序")} labelInline
                  options={[
                    { label: t("最后请求"), value: "last" },
                    { label: t("产品名称"), value: "name" },
                    { label: t("当前等待"), value: "active" },
                    { label: t("历史总请求"), value: "total" },
                  ]}
                  value={sort} onChange={(v) => setParam("sort", v)}
                />
              </Box>
            </InlineStack>
          </InlineStack>
          {view === "variant" && (
            <Box paddingBlockStart="200">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("库存简写：UK = {shop} · EW = {ew}（实时 Available）", { shop: stockNames.shopName, ew: stockNames.ewName })}
              </Text>
            </Box>
          )}
        </Box>

        {rows.length === 0 ? (
          <EmptyState heading={t("还没有数据")} image="">
            <p>{t("客户在缺货商品页订阅后，这里会按{kind}汇总需求。", { kind: view === "variant" ? t("变体 / barcode") : t("产品") })}</p>
          </EmptyState>
        ) : view === "variant" ? (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: t("产品 / 变体") }, { title: t("Barcode") },
              { title: t("UK 可用") }, { title: t("EW 可用") },
              { title: t("等待中") }, { title: t("总数") }, { title: t("最后请求") }, { title: t("链接") },
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
                <IndexTable.Cell>{stockText(r.stockShop)}</IndexTable.Cell>
                <IndexTable.Cell>{stockText(r.stockEw)}</IndexTable.Cell>
                <IndexTable.Cell>{r.active}</IndexTable.Cell>
                <IndexTable.Cell>{r.total}</IndexTable.Cell>
                <IndexTable.Cell>{fmtDate(r.last)}</IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="300">
                    <Link url={r.storefrontUrl!} target="_blank">{t("前台 ↗")}</Link>
                    <Link url={r.adminUrl!} target="_blank">{t("后台 ↗")}</Link>
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
              { title: t("商品") }, { title: t("当前等待") }, { title: t("最后请求") }, { title: t("历史总请求") },
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
