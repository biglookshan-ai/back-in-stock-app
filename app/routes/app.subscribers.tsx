// 订阅者列表：按邮箱聚合 —— 姓名 / 营销同意 / 首次请求 / 总请求数 + CSV 导出
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useFetcher, useNavigate } from "@remix-run/react";
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
import { useT } from "../i18n";

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

  return { subscribers: subscribers.slice(0, 1000), totalCount: subscribers.length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const mode = String(fd.get("mode") ?? "list");
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const all = await prisma.subscription.findMany({
    where: { shop },
    select: { email: true, customerName: true, marketingConsent: true, createdAt: true, productTitle: true, variantTitle: true, status: true, barcode: true },
    orderBy: { createdAt: "desc" },
  });

  if (mode === "details") {
    const header = "email,name,marketing,product,variant,barcode,status,date\n";
    const body = all
      .map((r) => [r.email, r.customerName, r.marketingConsent ? "Yes" : "No", r.productTitle, r.variantTitle, r.barcode, r.status, r.createdAt.toISOString()].map(esc).join(","))
      .join("\n");
    return { csv: header + body, filename: "subscriptions_details.csv" };
  }

  // list：按邮箱聚合
  const map = new Map<string, { email: string; name: string | null; marketing: boolean; firstAt: string; total: number }>();
  for (const r of all) {
    const cur = map.get(r.email);
    if (!cur) map.set(r.email, { email: r.email, name: r.customerName, marketing: r.marketingConsent, firstAt: r.createdAt.toISOString(), total: 1 });
    else {
      cur.total += 1;
      if (!cur.name && r.customerName) cur.name = r.customerName;
      if (r.marketingConsent) cur.marketing = true;
      if (r.createdAt.toISOString() < cur.firstAt) cur.firstAt = r.createdAt.toISOString();
    }
  }
  const header = "email,name,marketing,first_request,total_requests\n";
  const body = [...map.values()]
    .map((s) => [s.email, s.name, s.marketing ? "Yes" : "No", s.firstAt, s.total].map(esc).join(","))
    .join("\n");
  return { csv: header + body, filename: "subscribers.csv" };
};

export default function Subscribers() {
  const { subscribers, totalCount } = useLoaderData<typeof loader>() as {
    subscribers: Subscriber[];
    totalCount: number;
  };

  const fetcher = useFetcher<{ csv?: string; filename?: string }>();
  const navigate = useNavigate();
  const t = useT();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.csv) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([fetcher.data.csv], { type: "text/csv;charset=utf-8" }));
    a.download = fetcher.data.filename || "export.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }, [fetcher.state, fetcher.data]);

  const exportCsv = (mode: "list" | "details") =>
    fetcher.submit({ mode }, { method: "POST" });

  return (
    <Page backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("订阅者列表")} />
      <Card padding="0">
        <Box padding="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd">
              {t("显示 {shown} 共 {total} 位订阅者", { shown: subscribers.length, total: totalCount })}
            </Text>
            <InlineStack gap="200">
              <Button onClick={() => exportCsv("list")}>{t("导出列表")}</Button>
              <Button onClick={() => exportCsv("details")} variant="primary">{t("导出详情")}</Button>
            </InlineStack>
          </InlineStack>
        </Box>

        {subscribers.length === 0 ? (
          <EmptyState heading={t("还没有订阅者")} image="">
            <p>{t("客户订阅后这里会按人汇总。")}</p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={subscribers.length}
            selectable={false}
            headings={[
              { title: t("电子邮件") },
              { title: t("姓名") },
              { title: t("营销") },
              { title: t("首次请求") },
              { title: t("总请求数") },
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
