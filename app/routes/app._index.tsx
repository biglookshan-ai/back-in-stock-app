// Dashboard 总览：订阅/发信统计 + 热门缺货商品
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Box,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [total, active, notified, ordered, emailsSent, top] = await Promise.all([
    prisma.subscription.count({ where: { shop } }),
    prisma.subscription.count({ where: { shop, status: "ACTIVE" } }),
    prisma.subscription.count({ where: { shop, status: "NOTIFIED" } }),
    prisma.subscription.count({ where: { shop, status: "ORDERED" } }),
    prisma.emailLog.count({ where: { shop, status: "SENT" } }),
    prisma.subscription.groupBy({
      by: ["variantId", "productTitle", "variantTitle"],
      where: { shop, status: "ACTIVE" },
      _count: { _all: true },
      orderBy: { _count: { variantId: "desc" } },
      take: 10,
    }),
  ]);

  return { total, active, notified, ordered, emailsSent, top };
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value.toLocaleString()}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function Dashboard() {
  const { total, active, notified, ordered, emailsSent, top } =
    useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="到货提醒 · 总览" />
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="400">
          <Stat label="总订阅数" value={total} />
          <Stat label="待发提醒（等待中）" value={active} />
          <Stat label="已通知（已发送）" value={notified} />
          <Stat label="转化（已订购）" value={ordered} />
          <Stat label="累计发信成功" value={emailsSent} />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">
                  热门缺货商品（待发提醒 Top 10）
                </Text>
              </Box>
              {top.length === 0 ? (
                <EmptyState heading="还没有订阅数据" image="">
                  <p>客户在缺货商品页订阅后，这里会显示需求最高的商品。</p>
                </EmptyState>
              ) : (
                <IndexTable
                  itemCount={top.length}
                  selectable={false}
                  headings={[
                    { title: "商品" },
                    { title: "变体" },
                    { title: "等待人数" },
                  ]}
                >
                  {top.map((row, i) => (
                    <IndexTable.Row
                      id={row.variantId}
                      key={row.variantId}
                      position={i}
                    >
                      <IndexTable.Cell>{row.productTitle}</IndexTable.Cell>
                      <IndexTable.Cell>{row.variantTitle}</IndexTable.Cell>
                      <IndexTable.Cell>{row._count._all}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
