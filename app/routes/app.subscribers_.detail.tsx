// 订阅者详情：某客人订阅了哪些产品
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
  const email = new URL(request.url).searchParams.get("email") ?? "";

  const subs = await prisma.subscription.findMany({
    where: { shop: session.shop, email },
    orderBy: { createdAt: "desc" },
  });

  return {
    email,
    name: subs.find((s) => s.customerName)?.customerName ?? null,
    rows: subs.map((r) => ({
      id: r.id,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      barcode: r.barcode,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  };
};

export default function SubscriberDetail() {
  const { email, name, rows } = useLoaderData<typeof loader>();

  return (
    <Page
      backAction={{ content: "订阅者", url: "/app/subscribers" }}
      title={email}
      subtitle={name ? `${name} · ${rows.length} 条订阅` : `${rows.length} 条订阅`}
    >
      <TitleBar title="订阅者详情" />
      <Card padding="0">
        {rows.length === 0 ? (
          <EmptyState heading="该客人暂无订阅" image="">
            <p><Link to="/app/subscribers">返回订阅者列表</Link></p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "产品" },
              { title: "变体" },
              { title: "Barcode" },
              { title: "状态" },
              { title: "订阅时间" },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.id} key={r.id} position={i}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">{r.productTitle}</Text>
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
