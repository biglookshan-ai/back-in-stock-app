// 产品订阅详情：某产品有哪些客人订阅了
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Text,
  Link as PolarisLink,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useT } from "../i18n";

const TONE: Record<string, "info" | "success" | "attention" | "critical"> = {
  ACTIVE: "attention",
  NOTIFIED: "info",
  ORDERED: "success",
  CANCELLED: "critical",
};
const LABEL: Record<string, string> = {
  ACTIVE: "等待中",
  NOTIFIED: "已发送",
  ORDERED: "已订购",
  CANCELLED: "已取消",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const storeHandle = shop.replace(".myshopify.com", "");
  const productId = new URL(request.url).searchParams.get("productId") ?? "";

  const subs = await prisma.subscription.findMany({
    where: { shop, productId },
    orderBy: { createdAt: "desc" },
  });

  const pid = productId.split("/").pop() ?? "";
  return {
    productTitle: subs[0]?.productTitle ?? "产品",
    rows: subs.map((r) => {
      const vid = r.variantId.split("/").pop() ?? "";
      return {
        id: r.id,
        email: r.email,
        customerName: r.customerName,
        variantTitle: r.variantTitle,
        barcode: r.barcode,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        storefrontUrl: r.productHandle
          ? `https://${shop}/products/${r.productHandle}?variant=${vid}`
          : `https://${shop}`,
        adminUrl: `https://admin.shopify.com/store/${storeHandle}/products/${pid}/variants/${vid}`,
      };
    }),
  };
};

export default function ProductDetail() {
  const { productTitle, rows } = useLoaderData<typeof loader>();
  const t = useT();

  return (
    <Page
      backAction={{ content: t("产品订阅"), url: "/app/products" }}
      title={productTitle}
      subtitle={t("{n} 条订阅", { n: rows.length })}
    >
      <TitleBar title={t("产品订阅详情")} />
      <Card padding="0">
        {rows.length === 0 ? (
          <EmptyState heading={t("该产品暂无订阅")} image="">
            <p><Link to="/app/products">{t("返回产品订阅")}</Link></p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: t("客户") },
              { title: t("变体") },
              { title: t("Barcode") },
              { title: t("状态") },
              { title: t("订阅日期") },
              { title: t("链接") },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.id} key={r.id} position={i}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{r.email}</Text>
                  {r.customerName ? (
                    <>
                      <br />
                      <Text as="span" variant="bodySm" tone="subdued">{r.customerName}</Text>
                    </>
                  ) : null}
                </IndexTable.Cell>
                <IndexTable.Cell>{r.variantTitle}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="medium">{r.barcode ?? "—"}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={TONE[r.status] ?? "info"}>{t(LABEL[r.status] ?? r.status)}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">{new Date(r.createdAt).toLocaleDateString()}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="300">
                    <PolarisLink url={r.storefrontUrl} target="_blank">{t("前台 ↗")}</PolarisLink>
                    <PolarisLink url={r.adminUrl} target="_blank">{t("后台 ↗")}</PolarisLink>
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
