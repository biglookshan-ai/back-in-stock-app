// Dashboard 总览：订阅/发信统计 + 热门缺货商品
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link as RemixLink } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  InlineStack,
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

  const [total, active, notified, ordered, emailsSent, top, products, customers] = await Promise.all([
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
    prisma.subscription.findMany({ where: { shop }, select: { productId: true }, distinct: ["productId"] }),
    prisma.subscription.findMany({ where: { shop }, select: { email: true }, distinct: ["email"] }),
  ]);

  return {
    total, active, notified, ordered, emailsSent, top,
    productCount: products.length,
    customerCount: customers.length,
  };
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

// 可点击的导航模块：跳转到对应列表页
function NavTile({ to, title, value, hint }: { to: string; title: string; value: number; hint: string }) {
  return (
    <RemixLink to={to} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="headingMd">{title}</Text>
            <Text as="span" variant="headingMd" tone="subdued">→</Text>
          </InlineStack>
          <Text as="p" variant="heading2xl">{value.toLocaleString()}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{hint}</Text>
        </BlockStack>
      </Card>
    </RemixLink>
  );
}

export default function Dashboard() {
  const { total, active, notified, ordered, emailsSent, top, productCount, customerCount } =
    useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Back in Stock Dashboard" />
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="400">
          <Stat label="总订阅数" value={total} />
          <Stat label="待发提醒（等待中）" value={active} />
          <Stat label="已通知（已发送）" value={notified} />
          <Stat label="转化（已订购）" value={ordered} />
          <Stat label="累计发信成功" value={emailsSent} />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <NavTile to="/app/requests" title="所有订阅" value={total} hint="查看请求列表 →" />
          <NavTile to="/app/products" title="所有产品" value={productCount} hint="查看产品订阅 →" />
          <NavTile to="/app/subscribers" title="所有客人" value={customerCount} hint="查看订阅者 →" />
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
