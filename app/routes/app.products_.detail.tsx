// 产品订阅详情：某产品有哪些客人订阅了
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Text,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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
  const productId = new URL(request.url).searchParams.get("productId") ?? "";

  const subs = await prisma.subscription.findMany({
    where: { shop: session.shop, productId },
    orderBy: { createdAt: "desc" },
  });

  return {
    productTitle: subs[0]?.productTitle ?? "产品",
    rows: subs.map((r) => ({
      id: r.id,
      email: r.email,
      customerName: r.customerName,
      variantTitle: r.variantTitle,
      barcode: r.barcode,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  };
};

export default function ProductDetail() {
  const { productTitle, rows } = useLoaderData<typeof loader>();

  return (
    <Page
      backAction={{ content: "产品订阅", url: "/app/products" }}
      title={productTitle}
      subtitle={`${rows.length} 条订阅`}
    >
      <TitleBar title="产品订阅详情" />
      <Card padding="0">
        {rows.length === 0 ? (
          <EmptyState heading="该产品暂无订阅" image="">
            <p><Link to="/app/products">返回产品订阅</Link></p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "客户" },
              { title: "变体" },
              { title: "Barcode" },
              { title: "状态" },
              { title: "订阅时间" },
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
                <IndexTable.Cell>{r.barcode ?? "—"}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={TONE[r.status] ?? "info"}>{LABEL[r.status] ?? r.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{new Date(r.createdAt).toLocaleString()}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
