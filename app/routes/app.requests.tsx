// 请求列表：状态分页 + 搜索 + Newsletter/标签/日期 筛选 + 取消/归档/删除 + 标签编辑 + CSV 导出
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher, Form } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Tabs,
  TextField,
  Select,
  Box,
  Button,
  InlineStack,
  Text,
  Modal,
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
  ACTIVE: "attention", NOTIFIED: "info", ORDERED: "success", CANCELLED: "critical", ARCHIVED: undefined,
};
const LABEL: Record<string, string> = {
  ACTIVE: "等待中", NOTIFIED: "已发送", ORDERED: "已订购", CANCELLED: "已取消", ARCHIVED: "已归档",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const marketing = url.searchParams.get("marketing") ?? ""; // yes | no | ""
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const statusWhere = status === "" ? { status: { not: "ARCHIVED" } } : { status };

  const where: any = {
    shop,
    ...statusWhere,
    ...(marketing === "yes" ? { marketingConsent: true } : marketing === "no" ? { marketingConsent: false } : {}),
    ...(tag ? { tags: { contains: tag } } : {}),
    ...(q
      ? { OR: [
          { email: { contains: q } },
          { productTitle: { contains: q } },
          { customerName: { contains: q } },
          { barcode: { contains: q } },
        ] }
      : {}),
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59.999Z");
  }

  // ── CSV 导出 ──
  const exp = url.searchParams.get("export");
  if (exp) {
    const expWhere = exp === "all" ? { shop } : where;
    const all = await prisma.subscription.findMany({ where: expWhere, orderBy: { createdAt: "desc" } });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = "email,name,marketing,tags,product,variant,barcode,status,source,price,subscribedAt,notifiedAt,orderedAt\n";
    const body = all
      .map((r) => [
        r.email, r.customerName, r.marketingConsent ? "Yes" : "No", r.tags,
        r.productTitle, r.variantTitle, r.barcode, r.status, r.source, r.price,
        r.createdAt.toISOString(), r.notifiedAt?.toISOString() ?? "", r.orderedAt?.toISOString() ?? "",
      ].map(esc).join(","))
      .join("\n");
    const fname = exp === "all" ? "subscriptions_all" : `subscriptions_${status || "filtered"}`;
    return new Response(header + body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}.csv"` },
    });
  }

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
  countMap[""] = nonArchived;

  return {
    rows: rows.map((r) => ({
      id: r.id, email: r.email, customerName: r.customerName,
      productTitle: r.productTitle, variantTitle: r.variantTitle,
      status: r.status, tags: r.tags, marketing: r.marketingConsent,
      createdAt: r.createdAt.toISOString(),
    })),
    counts: countMap, status, q,
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
  else if (intent === "delete") await prisma.subscription.deleteMany({ where });
  else if (intent === "tag") {
    const tags = String(fd.get("tags") ?? "")
      .split(",").map((t) => t.trim()).filter(Boolean).join(",");
    await prisma.subscription.updateMany({ where, data: { tags } });
  }
  return { ok: true };
};

type Row = {
  id: string; email: string; customerName: string | null;
  productTitle: string; variantTitle: string; status: string;
  tags: string; marketing: boolean; createdAt: string;
};

export default function Requests() {
  const { rows, counts, status, q } = useLoaderData<typeof loader>() as {
    rows: Row[]; counts: Record<string, number>; status: string; q: string;
  };
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher();

  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const selectedTab = Math.max(0, STATUS_TABS.findIndex((t) => t.id === status));
  const get = (k: string) => params.get(k) ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const act = (intent: string, id: string, extra?: Record<string, string>) =>
    fetcher.submit({ intent, id, ...(extra ?? {}) }, { method: "POST" });

  const openTag = (r: Row) => { setTagEditId(r.id); setTagDraft(r.tags); };
  const saveTag = () => { if (tagEditId) act("tag", tagEditId, { tags: tagDraft }); setTagEditId(null); };

  // 导出表单要带上的当前筛选
  const filterFields = (["q", "marketing", "tag", "from", "to"] as const)
    .map((k) => (get(k) ? <input key={k} type="hidden" name={k} value={get(k)} /> : null));

  return (
    <Page primaryAction={{ content: "手动添加订阅", url: "/app/requests/new" }}>
      <TitleBar title="请求列表" />
      <Card padding="0">
        <Tabs
          selected={selectedTab}
          onSelect={(i) => setParam("status", STATUS_TABS[i].id)}
          tabs={STATUS_TABS.map((t) => ({ id: t.id || "all", content: `${t.label} (${counts[t.id] ?? 0})` }))}
        >
          <Box padding="300">
            <InlineStack gap="300" align="space-between" blockAlign="center">
              <Box maxWidth="280px" minWidth="200px">
                <TextField label="搜索" labelHidden placeholder="邮箱 / 姓名 / 商品 / barcode"
                  value={q} onChange={(v) => setParam("q", v)} autoComplete="off" />
              </Box>
              <InlineStack gap="200">
                <Form method="get" reloadDocument>
                  {status && <input type="hidden" name="status" value={status} />}
                  {filterFields}
                  <input type="hidden" name="export" value="view" />
                  <Button submit>导出当前筛选</Button>
                </Form>
                <Form method="get" reloadDocument>
                  <input type="hidden" name="export" value="all" />
                  <Button submit variant="primary">导出全部</Button>
                </Form>
              </InlineStack>
            </InlineStack>

            {/* 筛选器 */}
            <Box paddingBlockStart="300">
              <InlineStack gap="300" blockAlign="end">
                <Box minWidth="160px">
                  <Select label="Newsletter" labelInline
                    options={[
                      { label: "全部", value: "" },
                      { label: "已订阅", value: "yes" },
                      { label: "未订阅", value: "no" },
                    ]}
                    value={get("marketing")} onChange={(v) => setParam("marketing", v)} />
                </Box>
                <Box minWidth="160px">
                  <TextField label="标签" placeholder="按标签筛选"
                    value={get("tag")} onChange={(v) => setParam("tag", v)} autoComplete="off" />
                </Box>
                <Box minWidth="150px">
                  <TextField label="从" type="date"
                    value={get("from")} onChange={(v) => setParam("from", v)} autoComplete="off" />
                </Box>
                <Box minWidth="150px">
                  <TextField label="到" type="date"
                    value={get("to")} onChange={(v) => setParam("to", v)} autoComplete="off" />
                </Box>
              </InlineStack>
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
                { title: "商品 / 变体" }, { title: "客户" }, { title: "标签" },
                { title: "状态" }, { title: "日期" }, { title: "操作" },
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
                    {r.customerName ? (<><br /><Text as="span" variant="bodySm" tone="subdued">{r.customerName}</Text></>) : null}
                    {r.marketing ? (<><br /><Badge tone="success" size="small">Newsletter</Badge></>) : null}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100" wrap>
                      {r.tags ? r.tags.split(",").map((t) => <Badge key={t} size="small">{t}</Badge>) : <Text as="span" tone="subdued" variant="bodySm">—</Text>}
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status] ?? r.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{new Date(r.createdAt).toLocaleString()}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="300">
                      <Button variant="plain" onClick={() => openTag(r)}>标签</Button>
                      {r.status === "ARCHIVED" ? (
                        <>
                          <Button variant="plain" onClick={() => act("restore", r.id)}>恢复</Button>
                          <Button variant="plain" tone="critical" onClick={() => act("delete", r.id)}>删除</Button>
                        </>
                      ) : (
                        <>
                          {r.status !== "CANCELLED" && <Button variant="plain" onClick={() => act("cancel", r.id)}>取消</Button>}
                          <Button variant="plain" onClick={() => act("archive", r.id)}>归档</Button>
                        </>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Tabs>
      </Card>

      <Modal
        open={tagEditId !== null}
        onClose={() => setTagEditId(null)}
        title="编辑标签"
        primaryAction={{ content: "保存", onAction: saveTag }}
        secondaryActions={[{ content: "取消", onAction: () => setTagEditId(null) }]}
      >
        <Modal.Section>
          <TextField
            label="标签（逗号分隔）"
            value={tagDraft}
            onChange={setTagDraft}
            placeholder="VIP, 待回访, 老客户"
            autoComplete="off"
            helpText="多个标签用逗号分隔。"
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}
