// 请求列表：状态分页 + 搜索 + 取消 / 归档 / 恢复 / 删除
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Tabs,
  TextField,
  Box,
  Button,
  InlineStack,
  Text,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const STATUS_TABS = [
  { id: "", label: "全部" },
  { id: "ACTIVE", label: "等待中" },
  { id: "NOTIFIED", label: "已发送" },
  { id: "ORDERED", label: "已订购" },
  { id: "CANCELLED", label: "已取消" },
  { id: "ARCHIVED", label: "已归档" },
];

const TONE: Record<string, "info" | "success" | "attention" | "critical" | undefined> = {
  ACTIVE: "attention",
  NOTIFIED: "info",
  ORDERED: "success",
  CANCELLED: "critical",
  ARCHIVED: undefined,
};
const LABEL: Record<string, string> = {
  ACTIVE: "等待中",
  NOTIFIED: "已发送",
  ORDERED: "已订购",
  CANCELLED: "已取消",
  ARCHIVED: "已归档",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";

  // "全部"=非归档的工作集；"已归档"=只看归档；其它=按状态
  const statusWhere =
    status === ""
      ? { status: { not: "ARCHIVED" } }
      : { status };

  const where = {
    shop,
    ...statusWhere,
    ...(q
      ? {
          OR: [
            { email: { contains: q } },
            { productTitle: { contains: q } },
            { customerName: { contains: q } },
            { barcode: { contains: q } },
          ],
        }
      : {}),
  };

  const [rows, counts] = await Promise.all([
    prisma.subscription.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.subscription.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
  ]);

  const countMap: Record<string, number> = {};
  let nonArchived = 0;
  counts.forEach((c) => {
    countMap[c.status] = c._count._all;
    if (c.status !== "ARCHIVED") nonArchived += c._count._all;
  });
  countMap[""] = nonArchived; // 「全部」不含归档

  return {
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      customerName: r.customerName,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    counts: countMap,
    status,
    q,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const id = String(fd.get("id"));
  const where = { id, shop: session.shop };

  if (intent === "cancel") await prisma.subscription.updateMany({ where, data: { status: "CANCELLED" } });
  else if (intent === "archive") await prisma.subscription.updateMany({ where, data: { status: "ARCHIVED" } });
  else if (intent === "restore") await prisma.subscription.updateMany({ where, data: { status: "ACTIVE" } });
  else if (intent === "delete") await prisma.subscription.deleteMany({ where }); // 永久删除

  return { ok: true };
};

export default function Requests() {
  const { rows, counts, status, q } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher();

  const selectedTab = Math.max(0, STATUS_TABS.findIndex((t) => t.id === status));

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const act = (intent: string, id: string) =>
    fetcher.submit({ intent, id }, { method: "POST" });

  return (
    <Page primaryAction={{ content: "手动添加订阅", url: "/app/requests/new" }}>
      <TitleBar title="请求列表" />
      <Card padding="0">
        <Tabs
          selected={selectedTab}
          onSelect={(i) => setParam("status", STATUS_TABS[i].id)}
          tabs={STATUS_TABS.map((t) => ({
            id: t.id || "all",
            content: `${t.label} (${counts[t.id] ?? 0})`,
          }))}
        >
          <Box padding="300">
            <Box maxWidth="320px">
              <TextField
                label="搜索"
                labelHidden
                placeholder="邮箱 / 姓名 / 商品 / barcode"
                value={q}
                onChange={(v) => setParam("q", v)}
                autoComplete="off"
              />
            </Box>
          </Box>

          {rows.length === 0 ? (
            <EmptyState heading="没有符合条件的请求" image="">
              <p>调整筛选或等待客户订阅。</p>
            </EmptyState>
          ) : (
            <IndexTable
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "商品 / 变体" },
                { title: "客户" },
                { title: "状态" },
                { title: "日期" },
                { title: "操作" },
              ]}
            >
              {rows.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{r.productTitle}</Text>
                    <br />
                    <Text as="span" variant="bodySm" tone="subdued">{r.variantTitle}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{r.email}</Text>
                    {r.customerName ? (
                      <>
                        <br />
                        <Text as="span" variant="bodySm" tone="subdued">{r.customerName}</Text>
                      </>
                    ) : null}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status] ?? r.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{new Date(r.createdAt).toLocaleString()}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === "ARCHIVED" ? (
                      <InlineStack gap="300">
                        <Button variant="plain" onClick={() => act("restore", r.id)}>恢复</Button>
                        <Button variant="plain" tone="critical" onClick={() => act("delete", r.id)}>删除</Button>
                      </InlineStack>
                    ) : (
                      <InlineStack gap="300">
                        {r.status !== "CANCELLED" && (
                          <Button variant="plain" onClick={() => act("cancel", r.id)}>取消</Button>
                        )}
                        <Button variant="plain" onClick={() => act("archive", r.id)}>归档</Button>
                      </InlineStack>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Tabs>
      </Card>
    </Page>
  );
}
