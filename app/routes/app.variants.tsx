// 变体 / Barcode 清单：每个变体单独一行，直接看 barcode，附前台+后台链接。
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  TextField,
  Box,
  Text,
  Link,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(".myshopify.com", "");
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const where = {
    shop,
    ...(q
      ? {
          OR: [
            { barcode: { contains: q } },
            { productTitle: { contains: q } },
            { variantTitle: { contains: q } },
          ],
        }
      : {}),
  };

  const [totals, actives] = await Promise.all([
    prisma.subscription.groupBy({
      by: ["variantId", "productId", "productTitle", "variantTitle", "barcode", "productHandle"],
      where,
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

  const rows = totals
    .map((t) => {
      const vid = t.variantId.split("/").pop() ?? "";
      const pid = t.productId.split("/").pop() ?? "";
      return {
        variantId: t.variantId,
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
    })
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));

  return { rows, q };
};

export default function Variants() {
  const { rows, q } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();

  const setQ = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("q", v);
    else next.delete("q");
    setParams(next);
  };

  return (
    <Page>
      <TitleBar title="变体 / Barcode 清单" />
      <Card padding="0">
        <Box padding="300">
          <Box maxWidth="320px">
            <TextField
              label="搜索"
              labelHidden
              placeholder="barcode / 产品 / 变体"
              value={q}
              onChange={setQ}
              autoComplete="off"
            />
          </Box>
        </Box>

        {rows.length === 0 ? (
          <EmptyState heading="还没有数据" image="">
            <p>有客户订阅后,这里按变体/barcode 平铺。</p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "产品 / 变体" },
              { title: "Barcode" },
              { title: "等待中" },
              { title: "总数" },
              { title: "链接" },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.variantId} key={r.variantId} position={i}>
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
                <IndexTable.Cell>
                  <InlineStack gap="300">
                    <Link url={r.storefrontUrl} target="_blank">前台 ↗</Link>
                    <Link url={r.adminUrl} target="_blank">后台 ↗</Link>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
