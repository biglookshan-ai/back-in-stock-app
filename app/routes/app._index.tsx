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
import { useT } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [total, active, notified, ordered, emailsSent, restockAuto, restockManual, top, products, customers] = await Promise.all([
    prisma.subscription.count({ where: { shop } }),
    prisma.subscription.count({ where: { shop, status: "ACTIVE" } }),
    prisma.subscription.count({ where: { shop, status: "NOTIFIED" } }),
    prisma.subscription.count({ where: { shop, status: "ORDERED" } }),
    prisma.emailLog.count({ where: { shop, status: "SENT" } }),
    prisma.emailLog.count({ where: { shop, status: "SENT", type: "BACK_IN_STOCK" } }),
    prisma.emailLog.count({ where: { shop, status: "SENT", type: "MANUAL" } }),
    prisma.subscription.groupBy({
      by: ["variantId", "productTitle", "variantTitle"],
      where: { shop, status: "ACTIVE" },
      _count: { _all: true },
      orderBy: { _count: { variantId: "desc" } },
      take: 10,
    }),
    prisma.subscription.findMany({ where: { shop }, select: { productId: true }, distinct: ["productId"] }),
    prisma.subscription.findMany({ where: { shop }, select: { email: true, customerType: true }, distinct: ["email"] }),
  ]);

  // 新老客（按人去重）：老客已下单 / 老客未下单 / 新客 / 未分类
  const ctype = { ORDERED: 0, NO_ORDER: 0, NEW: 0, UNKNOWN: 0 };
  for (const c of customers) ctype[(c.customerType ?? "UNKNOWN") as keyof typeof ctype]++;

  return {
    total, active, notified, ordered, emailsSent, restockAuto, restockManual, top,
    productCount: products.length,
    customerCount: customers.length,
    ctype,
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

export default function Dashboard() {
  const { total, active, notified, ordered, emailsSent, restockAuto, restockManual, top, productCount, customerCount, ctype } =
    useLoaderData<typeof loader>();
  const t = useT();

  return (
    <Page fullWidth>
      <TitleBar title="Back in Stock Dashboard" />
      <BlockStack gap="500">
        {/* 订阅：状态维度 */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("订阅")}</Text>
            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="400">
              <Stat label={t("总订阅数")} value={total} />
              <Stat label={t("待发提醒（等待中）")} value={active} />
              <Stat label={t("已通知（已发送）")} value={notified} />
              <Stat label={t("转化（已订购）")} value={ordered} />
            </InlineGrid>
            <InlineStack>
              <RemixLink to="/app/requests" style={{ textDecoration: "none" }}>
                <Text as="span" variant="bodySm" tone="subdued">{t("查看请求列表 →")}</Text>
              </RemixLink>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* 客人：按人去重 + 新老客构成 */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("客人")}</Text>
            <InlineGrid columns={{ xs: 2, sm: 5 }} gap="400">
              <Stat label={t("总人数")} value={customerCount} />
              <Stat label={t("老客·已下单")} value={ctype.ORDERED} />
              <Stat label={t("老客·未下单")} value={ctype.NO_ORDER} />
              <Stat label={t("新客")} value={ctype.NEW} />
              <Stat label={t("未分类")} value={ctype.UNKNOWN} />
            </InlineGrid>
            {ctype.UNKNOWN > 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("有 {n} 位客人尚未识别，去订阅者或请求列表点「识别新老客」即可补齐。", { n: ctype.UNKNOWN })}
              </Text>
            ) : null}
            <InlineStack>
              <RemixLink to="/app/subscribers" style={{ textDecoration: "none" }}>
                <Text as="span" variant="bodySm" tone="subdued">{t("查看订阅者 →")}</Text>
              </RemixLink>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* 邮件 */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("邮件")}</Text>
            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="400">
              <Stat label={t("累计发信成功")} value={emailsSent} />
              <Stat label={t("等待发送（等待中）")} value={active} />
              <Stat label={t("有货通知·自动")} value={restockAuto} />
              <Stat label={t("有货通知·手动")} value={restockManual} />
            </InlineGrid>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">
                  {t("热门缺货商品（待发提醒 Top 10）")}
                </Text>
              </Box>
              {top.length === 0 ? (
                <EmptyState heading={t("还没有订阅数据")} image="">
                  <p>{t("客户在缺货商品页订阅后，这里会显示需求最高的商品。")}</p>
                </EmptyState>
              ) : (
                <IndexTable
                  itemCount={top.length}
                  selectable={false}
                  headings={[
                    { title: t("商品") },
                    { title: t("变体") },
                    { title: t("等待人数") },
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
              <Box padding="400" borderColor="border" borderBlockStartWidth="025">
                <RemixLink to="/app/products" style={{ textDecoration: "none" }}>
                  <Text as="span" variant="bodySm" tone="subdued">{t("查看产品订阅（{n} 个商品）→", { n: productCount })}</Text>
                </RemixLink>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
