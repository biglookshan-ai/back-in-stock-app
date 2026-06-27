// 订阅者列表：按邮箱聚合 —— 姓名 / 营销同意 / 首次请求 / 总请求数 + CSV 导出
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Button,
  InlineStack,
  Box,
  Text,
  Select,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useT, translate, type Lang } from "../i18n";
import { getSettings } from "../models/subscription.server";
import { classifyAndStore } from "../models/customer.server";
import { CTYPE_LABEL, CTYPE_TONE } from "../customer-types";

interface Subscriber {
  email: string;
  name: string | null;
  marketing: boolean;
  customerType: string | null;
  firstAt: string;
  total: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const ctype = url.searchParams.get("ctype")?.trim() ?? "";

  const all = await prisma.subscription.findMany({
    where: { shop },
    select: { email: true, customerName: true, marketingConsent: true, customerType: true, createdAt: true },
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
        customerType: r.customerType,
        firstAt: r.createdAt.toISOString(),
        total: 1,
      });
    } else {
      cur.total += 1;
      if (!cur.name && r.customerName) cur.name = r.customerName;
      if (r.marketingConsent) cur.marketing = true;
      if (!cur.customerType && r.customerType) cur.customerType = r.customerType;
      if (r.createdAt.toISOString() < cur.firstAt) cur.firstAt = r.createdAt.toISOString();
    }
  }
  let subscribers = [...map.values()].sort((a, b) => b.firstAt.localeCompare(a.firstAt));

  // 各分类计数（用于筛选下拉旁的提示）
  const typeCounts = { ORDERED: 0, NO_ORDER: 0, NEW: 0, UNKNOWN: 0 };
  for (const s of subscribers) typeCounts[(s.customerType ?? "UNKNOWN") as keyof typeof typeCounts]++;

  const totalCount = subscribers.length;
  if (ctype) subscribers = subscribers.filter((s) => (s.customerType ?? "UNKNOWN") === ctype);

  return { subscribers: subscribers.slice(0, 1000), totalCount, shown: subscribers.length, ctype, typeCounts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  // 回填/刷新新老客分类
  if (intent === "reclassify") {
    const lang: Lang = (await getSettings(shop)).uiLanguage === "zh" ? "zh" : "en";
    const onlyMissing = fd.get("onlyMissing") === "true";
    const { classified, byType } = await classifyAndStore(admin, shop, { onlyMissing });
    return {
      ok: true,
      message: translate("已分类 {n} 位客人：老客已下单 {a} · 老客未下单 {b} · 新客 {c}", lang, {
        n: classified, a: byType.ORDERED, b: byType.NO_ORDER, c: byType.NEW,
      }),
    };
  }

  const mode = String(fd.get("mode") ?? "list");
  const all = await prisma.subscription.findMany({
    where: { shop },
    select: { email: true, customerName: true, marketingConsent: true, customerType: true, createdAt: true, productTitle: true, variantTitle: true, status: true, barcode: true },
    orderBy: { createdAt: "desc" },
  });

  if (mode === "details") {
    const header = "email,name,marketing,customer_type,product,variant,barcode,status,date\n";
    const body = all
      .map((r) => [r.email, r.customerName, r.marketingConsent ? "Yes" : "No", r.customerType ?? "", r.productTitle, r.variantTitle, r.barcode, r.status, r.createdAt.toISOString()].map(esc).join(","))
      .join("\n");
    return { csv: header + body, filename: "subscriptions_details.csv" };
  }

  // list：按邮箱聚合
  const map = new Map<string, { email: string; name: string | null; marketing: boolean; customerType: string | null; firstAt: string; total: number }>();
  for (const r of all) {
    const cur = map.get(r.email);
    if (!cur) map.set(r.email, { email: r.email, name: r.customerName, marketing: r.marketingConsent, customerType: r.customerType, firstAt: r.createdAt.toISOString(), total: 1 });
    else {
      cur.total += 1;
      if (!cur.name && r.customerName) cur.name = r.customerName;
      if (r.marketingConsent) cur.marketing = true;
      if (!cur.customerType && r.customerType) cur.customerType = r.customerType;
      if (r.createdAt.toISOString() < cur.firstAt) cur.firstAt = r.createdAt.toISOString();
    }
  }
  const header = "email,name,marketing,customer_type,first_request,total_requests\n";
  const body = [...map.values()]
    .map((s) => [s.email, s.name, s.marketing ? "Yes" : "No", s.customerType ?? "", s.firstAt, s.total].map(esc).join(","))
    .join("\n");
  return { csv: header + body, filename: "subscribers.csv" };
};

export default function Subscribers() {
  const { subscribers, totalCount, shown, ctype, typeCounts } = useLoaderData<typeof loader>() as {
    subscribers: Subscriber[];
    totalCount: number;
    shown: number;
    ctype: string;
    typeCounts: { ORDERED: number; NO_ORDER: number; NEW: number; UNKNOWN: number };
  };

  const fetcher = useFetcher<{ csv?: string; filename?: string }>();
  const classifyFetcher = useFetcher<{ ok?: boolean; message?: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const shopify = useAppBridge();
  const t = useT();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.csv) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([fetcher.data.csv], { type: "text/csv;charset=utf-8" }));
    a.download = fetcher.data.filename || "export.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (classifyFetcher.state === "idle" && classifyFetcher.data?.message) {
      shopify.toast.show(classifyFetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifyFetcher.state, classifyFetcher.data]);

  const exportCsv = (mode: "list" | "details") =>
    fetcher.submit({ mode }, { method: "POST" });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Page fullWidth backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("订阅者列表")} />
      <Card padding="0">
        <Box padding="400">
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <InlineStack gap="300" blockAlign="center">
              <Text as="span" variant="bodyMd">
                {t("显示 {shown} 共 {total} 位订阅者", { shown, total: totalCount })}
              </Text>
              <Box minWidth="180px">
                <Select label={t("客户类型")} labelInline
                  options={[
                    { label: t("全部"), value: "" },
                    { label: `${t("老客·已下单")} (${typeCounts.ORDERED})`, value: "ORDERED" },
                    { label: `${t("老客·未下单")} (${typeCounts.NO_ORDER})`, value: "NO_ORDER" },
                    { label: `${t("新客")} (${typeCounts.NEW})`, value: "NEW" },
                    { label: `${t("未分类")} (${typeCounts.UNKNOWN})`, value: "UNKNOWN" },
                  ]}
                  value={ctype} onChange={(v) => setParam("ctype", v)} />
              </Box>
            </InlineStack>
            <InlineStack gap="200">
              <Button
                loading={classifyFetcher.state !== "idle"}
                onClick={() => classifyFetcher.submit({ intent: "reclassify", onlyMissing: "true" }, { method: "POST" })}
              >{t("识别新老客")}</Button>
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
              { title: t("客户类型") },
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
                  {s.customerType ? (
                    <Badge tone={CTYPE_TONE[s.customerType]} size="small">{t(CTYPE_LABEL[s.customerType] ?? s.customerType)}</Badge>
                  ) : (
                    <Text as="span" tone="subdued" variant="bodySm">—</Text>
                  )}
                </IndexTable.Cell>
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
