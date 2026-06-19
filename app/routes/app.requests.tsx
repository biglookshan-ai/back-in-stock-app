// 请求列表：状态分页 + 搜索 + Newsletter/标签/日期 筛选 + 取消/归档/删除 + 标签编辑 + CSV 导出
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher } from "@remix-run/react";
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
  BlockStack,
  InlineStack,
  Text,
  Modal,
  EmptyState,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendManualEmail } from "../models/subscription.server";

// 把 URL/表单的筛选条件构造成 Prisma where（loader 与群发 action 共用）
function buildWhere(shop: string, sp: URLSearchParams): any {
  const status = sp.get("status") ?? "";
  const q = sp.get("q")?.trim() ?? "";
  const marketing = sp.get("marketing") ?? "";
  const tag = sp.get("tag")?.trim() ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const where: any = {
    shop,
    ...(status === "" ? { status: { not: "ARCHIVED" } } : { status }),
    ...(marketing === "yes" ? { marketingConsent: true } : marketing === "no" ? { marketingConsent: false } : {}),
    ...(tag ? { tags: { contains: tag } } : {}),
    ...(q ? { OR: [
      { email: { contains: q } },
      { productTitle: { contains: q } },
      { customerName: { contains: q } },
      { barcode: { contains: q } },
    ] } : {}),
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59.999Z");
  }
  return where;
}

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
  const where = buildWhere(shop, url.searchParams);

  const [rows, counts, filteredCount, customTemplates] = await Promise.all([
    prisma.subscription.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.subscription.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
    prisma.subscription.count({ where }),
    prisma.customTemplate.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, subject: true, htmlBody: true },
    }),
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
    counts: countMap, status, q, filteredCount, customTemplates,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));

  // 发送邮件：发给选中的订阅行
  if (intent === "sendmail") {
    const subject = String(fd.get("subject") ?? "").trim();
    const htmlBody = String(fd.get("htmlBody") ?? "").trim();
    if (!subject || !htmlBody) return { ok: false, message: "主题和正文不能为空" };
    const ids = String(fd.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return { ok: false, message: "请先勾选收件人" };
    const subs = await prisma.subscription.findMany({
      where: { shop: session.shop, id: { in: ids } },
    });
    const sent = await sendManualEmail(subs, subject, htmlBody);
    return { ok: true, message: `已发送 ${sent} 封` };
  }

  // 导出 CSV：返回字符串，前端转成文件下载（走 action，认证可靠）
  if (intent === "export") {
    const mode = String(fd.get("mode") ?? "all");
    const sp = new URLSearchParams();
    ["status", "q", "marketing", "tag", "from", "to"].forEach((k) => {
      const v = fd.get(k);
      if (v) sp.set(k, String(v));
    });
    const expWhere = mode === "all" ? { shop: session.shop } : buildWhere(session.shop, sp);
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
    const filename = mode === "all" ? "subscriptions_all.csv" : `subscriptions_${sp.get("status") || "filtered"}.csv`;
    return { ok: true, csv: header + body, filename };
  }

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

type CustomTpl = { id: string; name: string; subject: string; htmlBody: string };

export default function Requests() {
  const { rows, counts, status, q, filteredCount, customTemplates } =
    useLoaderData<typeof loader>() as {
      rows: Row[]; counts: Record<string, number>; status: string; q: string;
      filteredCount: number; customTemplates: CustomTpl[];
    };
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok: boolean; message?: string; csv?: string; filename?: string }>();
  const shopify = useAppBridge();

  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  // 行选择
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows as unknown as { [key: string]: unknown; id: string }[]);

  // 发送邮件 modal
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTplId, setSendTplId] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;
    if (d.csv != null) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([d.csv], { type: "text/csv;charset=utf-8" }));
      a.download = d.filename || "export.csv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      return;
    }
    if (d.message) {
      shopify.toast.show(d.message);
      if (d.ok && sendOpen) setSendOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const selectedTab = Math.max(0, STATUS_TABS.findIndex((t) => t.id === status));
  const get = (k: string) => params.get(k) ?? "";

  const pickSendTpl = (id: string) => {
    setSendTplId(id);
    const t = customTemplates.find((x) => x.id === id);
    if (t) { setSendSubject(t.subject); setSendBody(t.htmlBody); }
  };
  const doSend = () =>
    fetcher.submit(
      { intent: "sendmail", subject: sendSubject, htmlBody: sendBody, ids: selectedResources.join(",") },
      { method: "POST" },
    );

  // 搜索框：本地状态 + 防抖（避免每次按键都跳转、丢焦点）
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== q) setParam("q", searchInput); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // 导出 CSV：走 action（认证可靠），返回字符串后前端转文件下载
  const exportCsv = (mode: "view" | "all") => {
    const data: Record<string, string> = { intent: "export", mode };
    if (mode === "view") {
      if (status) data.status = status;
      (["q", "marketing", "tag", "from", "to"] as const).forEach((k) => { if (get(k)) data[k] = get(k); });
    }
    fetcher.submit(data, { method: "POST" });
  };

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
                  value={searchInput} onChange={setSearchInput} clearButton onClearButtonClick={() => setSearchInput("")} autoComplete="off" />
              </Box>
              <InlineStack gap="200">
                <Button onClick={() => exportCsv("view")}>导出当前筛选</Button>
                <Button onClick={() => exportCsv("all")} variant="primary">导出全部</Button>
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
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={[{ content: "发送邮件", onAction: () => setSendOpen(true) }]}
              headings={[
                { title: "商品 / 变体" }, { title: "客户" }, { title: "标签" },
                { title: "状态" }, { title: "日期" }, { title: "操作" },
              ]}
            >
              {rows.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i} selected={selectedResources.includes(r.id)}>
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

      {/* 群发邮件：发给当前筛选结果 */}
      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={`发送邮件（已选 ${selectedResources.length} 人）`}
        primaryAction={{
          content: `发送给 ${selectedResources.length} 人`,
          onAction: doSend,
          loading: fetcher.state !== "idle",
          disabled: !sendSubject || !sendBody || selectedResources.length === 0,
        }}
        secondaryActions={[{ content: "取消", onAction: () => setSendOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued" variant="bodySm">
              发送给<b>勾选</b>的客人。列表里勾选单个或多个(表头可全选),再点「发送邮件」。
            </Text>
            <Select
              label="选择模板（可选）"
              options={[
                { label: "— 空白 / 自己写 —", value: "" },
                ...customTemplates.map((t) => ({ label: t.name, value: t.id })),
              ]}
              value={sendTplId}
              onChange={pickSendTpl}
              helpText="模板在「自定义邮件模板」页管理。选了可继续编辑。"
            />
            <TextField label="主题" value={sendSubject} onChange={setSendSubject} autoComplete="off" />
            <TextField label="正文（HTML，支持变量）" value={sendBody} onChange={setSendBody} multiline={8} autoComplete="off" />
            <Text as="p" tone="subdued" variant="bodySm">
              变量:{"{{customer_name}} {{product_title}} {{variant_title}} {{product_url}} {{unsubscribe_url}}"} 等。每人会按自己订阅的商品渲染。
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
