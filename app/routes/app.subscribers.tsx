// 订阅者列表：按邮箱聚合 —— 姓名 / 营销同意 / 首次请求 / 总请求数 + CSV 导出
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, Link } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Button,
  InlineStack,
  Box,
  Text,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface Subscriber {
  email: string;
  name: string | null;
  marketing: boolean;
  firstAt: string;
  total: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const all = await prisma.subscription.findMany({
    where: { shop },
    select: { email: true, customerName: true, marketingConsent: true, createdAt: true, productTitle: true, variantTitle: true, status: true, barcode: true },
    orderBy: { createdAt: "desc" },
  });

  // 按邮箱聚合
  const map = new Map<string, Subscriber>();
  for (const r of all) {
    const cur = map.get(r.email);
    if (!cur) {
      map.set(r.email, {
        email: r.email,
        name: r.customerName,
        marketing: r.marketingConsent,
        firstAt: r.createdAt.toISOString(),
        total: 1,
      });
    } else {
      cur.total += 1;
      if (!cur.name && r.customerName) cur.name = r.customerName;
      if (r.marketingConsent) cur.marketing = true;
      if (r.createdAt.toISOString() < cur.firstAt) cur.firstAt = r.createdAt.toISOString();
    }
  }
  const subscribers = [...map.values()].sort((a, b) => b.firstAt.localeCompare(a.firstAt));

  // CSV 导出
  const exp = url.searchParams.get("export");
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  if (exp === "list") {
    const header = "email,name,marketing,first_request,total_requests\n";
    const body = subscribers
      .map((s) => [s.email, s.name, s.marketing ? "Yes" : "No", s.firstAt, s.total].map(esc).join(","))
      .join("\n");
    return new Response(header + body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="subscribers.csv"' },
    });
  }
  if (exp === "details") {
    const header = "email,name,marketing,product,variant,barcode,status,date\n";
    const body = all
      .map((r) => [r.email, r.customerName, r.marketingConsent ? "Yes" : "No", r.productTitle, r.variantTitle, r.barcode, r.status, r.createdAt.toISOString()].map(esc).join(","))
      .join("\n");
    return new Response(header + body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="subscriptions_details.csv"' },
    });
  }

  return { subscribers: subscribers.slice(0, 1000), totalCount: subscribers.length };
};

export default function Subscribers() {
  const { subscribers, totalCount } = useLoaderData<typeof loader>() as {
    subscribers: Subscriber[];
    totalCount: number;
  };

  return (
    <Page>
      <TitleBar title="订阅者列表" />
      <Card padding="0">
        <Box padding="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd">
              显示 {subscribers.length} 共 {totalCount} 位订阅者
            </Text>
            <InlineStack gap="200">
              <Form method="get" reloadDocument>
                <input type="hidden" name="export" value="list" />
                <Button submit>导出列表</Button>
              </Form>
              <Form method="get" reloadDocument>
                <input type="hidden" name="export" value="details" />
                <Button submit variant="primary">导出详情</Button>
              </Form>
            </InlineStack>
          </InlineStack>
        </Box>

        {subscribers.length === 0 ? (
          <EmptyState heading="还没有订阅者" image="">
            <p>客户订阅后这里会按人汇总。</p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={subscribers.length}
            selectable={false}
            headings={[
              { title: "电子邮件" },
              { title: "姓名" },
              { title: "营销" },
              { title: "首次请求" },
              { title: "总请求数" },
            ]}
          >
            {subscribers.map((s, i) => (
              <IndexTable.Row id={s.email} key={s.email} position={i}>
                <IndexTable.Cell>
                  <Link to={`/app/subscribers/detail?email=${encodeURIComponent(s.email)}`}>
                    {s.email}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{s.name ?? "—"}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={s.marketing ? "success" : undefined}>{s.marketing ? "Yes" : "No"}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{new Date(s.firstAt).toLocaleString()}</IndexTable.Cell>
                <IndexTable.Cell>{String(s.total)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
