// 请求列表：状态分页 + 搜索 + Newsletter/标签/日期 筛选 + 取消/归档/删除 + 标签编辑 + CSV 导出
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, useFetcher, useNavigate } from "@remix-run/react";
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
  Checkbox,
  Combobox,
  Listbox,
  Tag,
  EmptyState,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendManualEmail, getSettings } from "../models/subscription.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER } from "../email-templates.server";
import { resolveStockLocations, getAvailability } from "../models/inventory.server";
import { productCard, CUSTOMER_CARD } from "../email-cards";
import { EmailEditor } from "../components/EmailEditor";

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
      { email: { contains: q, mode: "insensitive" } },
      { productTitle: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q, mode: "insensitive" } },
    ] } : {}),
  };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59.999Z");
  }
  return where;
}

// 客户端渲染（与服务端一致：条件块 + 变量），用于预览
function renderClient(tpl: string, vars: Record<string, string>) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) => (vars[k] ? inner : ""));
  out = out.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, k, inner) => (vars[k] ? "" : inner));
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : ""));
}
// 预览用样例（客人订阅的产品）
const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Alex", customer_email: "customer@example.com",
  product_title: "客人订阅的产品", variant_title: "EF Mount",
  product_image: "https://placehold.co/240x240/1a1a1a/ffffff?text=Product",
  product_price: "£2,629.95", product_url: "#", unsubscribe_url: "#",
};
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

// 库存数字：缺货(<=0)红色，有货默认，未知「—」
const stockNum = (n: number | null) =>
  n == null ? (
    <Text as="span" tone="subdued" variant="bodySm">—</Text>
  ) : (
    <Text as="span" variant="bodySm" fontWeight="semibold" tone={n <= 0 ? "critical" : undefined}>{n}</Text>
  );

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const where = buildWhere(shop, url.searchParams);

  const [rows, counts, filteredCount, customTemplates, settings, tagRows] = await Promise.all([
    prisma.subscription.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.subscription.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
    prisma.subscription.count({ where }),
    prisma.customTemplate.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, subject: true, htmlBody: true, useGlobalShell: true },
    }),
    getSettings(shop),
    prisma.subscription.findMany({ where: { shop, tags: { not: "" } }, select: { tags: true } }),
  ]);

  // 已用过的全部标签（去重排序），供编辑/筛选下拉
  const allTags = Array.from(
    new Set(tagRows.flatMap((t) => t.tags.split(",").map((s) => s.trim()).filter(Boolean))),
  ).sort();

  const countMap: Record<string, number> = {};
  let nonArchived = 0;
  counts.forEach((c) => {
    countMap[c.status] = c._count._all;
    if (c.status !== "ARCHIVED") nonArchived += c._count._all;
  });
  countMap[""] = nonArchived;

  // 两地实时 Available 库存（按当前页面行的变体批量查），辅助判断是否手动发信
  const loc = await resolveStockLocations(admin);
  const avail = await getAvailability(admin, rows.map((r) => r.variantId), loc);

  return {
    rows: rows.map((r) => ({
      id: r.id, email: r.email, customerName: r.customerName,
      productTitle: r.productTitle, variantTitle: r.variantTitle,
      productImage: r.productImage, price: r.price, productHandle: r.productHandle,
      status: r.status, tags: r.tags, marketing: r.marketingConsent,
      createdAt: r.createdAt.toISOString(),
      stockShop: avail[r.variantId]?.shop ?? null,
      stockEw: avail[r.variantId]?.ew ?? null,
    })),
    counts: countMap, status, q, filteredCount, customTemplates, allTags,
    shop,
    stockNames: { shopName: loc.shopName, ewName: loc.ewName },
    globalHeader: settings.emailHeader || DEFAULT_HEADER,
    globalFooter: settings.emailFooter || DEFAULT_FOOTER,
    brand: {
      shop_name: settings.fromName, brand_logo: settings.logoUrl, brand_color: settings.brandColor,
      website_url: settings.websiteUrl, company_address: settings.companyAddress, support_email: settings.supportEmail,
    },
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
    const useGlobalShell = fd.get("useGlobalShell") !== "false";
    const subs = await prisma.subscription.findMany({
      where: { shop: session.shop, id: { in: ids } },
    });
    const sent = await sendManualEmail(subs, subject, htmlBody, useGlobalShell);
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
  productTitle: string; variantTitle: string;
  productImage: string | null; price: string | null; productHandle: string | null;
  status: string; tags: string; marketing: boolean; createdAt: string;
  stockShop: number | null; stockEw: number | null;
};

type CustomTpl = { id: string; name: string; subject: string; htmlBody: string; useGlobalShell: boolean };

export default function Requests() {
  const { rows, counts, status, q, customTemplates, allTags, shop, brand, globalHeader, globalFooter, stockNames } =
    useLoaderData<typeof loader>() as {
      rows: Row[]; counts: Record<string, number>; status: string; q: string;
      filteredCount: number; customTemplates: CustomTpl[]; allTags: string[];
      shop: string; brand: Record<string, string>;
      globalHeader: string; globalFooter: string;
      stockNames: { shopName: string; ewName: string };
    };
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok: boolean; message?: string; csv?: string; filename?: string }>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagList, setTagList] = useState<string[]>([]); // 编辑中的标签
  const [tagInput, setTagInput] = useState(""); // 标签输入/搜索框

  // 行选择
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows as unknown as { [key: string]: unknown; id: string }[]);

  // 发送邮件 modal
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTplId, setSendTplId] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sendShell, setSendShell] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);

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
    if (t) { setSendSubject(t.subject); setSendBody(t.htmlBody); setSendShell(t.useGlobalShell); }
  };
  const doSend = () =>
    fetcher.submit(
      { intent: "sendmail", subject: sendSubject, htmlBody: sendBody, useGlobalShell: String(sendShell), ids: selectedResources.join(",") },
      { method: "POST" },
    );

  // 选产品 → 生成产品卡（编辑器显示成小卡片，含展示用 label/thumb）
  const pickProductCards = async () => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!picked || picked.length === 0) return [];
    return (picked as any[]).map((p) => {
      const img = p.images?.[0]?.originalSrc || p.images?.[0]?.url || p.featuredImage?.url || "";
      const price = p.variants?.[0]?.price ? String(p.variants[0].price) : "";
      const url = p.handle ? `https://${shop}/products/${p.handle}` : "#";
      return { html: productCard({ title: p.title, image: img, price, url }), label: p.title as string, thumb: img };
    });
  };

  const sendWrapped = sendShell
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">${globalHeader}<tr><td style="padding:24px 32px">${sendBody}</td></tr>${globalFooter}</table></td></tr></table>`
    : sendBody;
  // 预览用「第一个勾选客人」的真实产品；没勾选则回退到样例
  const firstSel = rows.find((r) => r.id === selectedResources[0]);
  const previewProductVars: Record<string, string> = firstSel
    ? {
        customer_name: firstSel.customerName ?? "",
        customer_email: firstSel.email,
        product_title: firstSel.productTitle,
        variant_title: firstSel.variantTitle && firstSel.variantTitle !== "Default Title" ? firstSel.variantTitle : "",
        product_image: firstSel.productImage ?? "",
        product_price: firstSel.price ?? "",
        product_url: firstSel.productHandle ? `https://${shop}/products/${firstSel.productHandle}` : "#",
      }
    : {};
  const sendPreview = renderClient(sendWrapped, { ...SAMPLE_VARS, ...brand, ...previewProductVars });

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

  const openTag = (r: Row) => {
    setTagEditId(r.id);
    setTagList(r.tags ? r.tags.split(",").map((s) => s.trim()).filter(Boolean) : []);
    setTagInput("");
  };
  const saveTag = () => { if (tagEditId) act("tag", tagEditId, { tags: tagList.join(",") }); setTagEditId(null); };
  const toggleTag = (t: string) =>
    setTagList((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const addNewTag = () => {
    const v = tagInput.trim();
    if (v && !tagList.includes(v)) setTagList([...tagList, v]);
    setTagInput("");
  };
  // 标签下拉候选：已用过、未选中、匹配输入
  const tagOptions = allTags.filter(
    (t) => !tagList.includes(t) && t.toLowerCase().includes(tagInput.trim().toLowerCase()),
  );
  const canCreateTag =
    !!tagInput.trim() &&
    !allTags.some((t) => t.toLowerCase() === tagInput.trim().toLowerCase()) &&
    !tagList.includes(tagInput.trim());

  return (
    <Page
      backAction={{ content: "返回", onAction: () => navigate("/app") }}
      primaryAction={{ content: "手动添加订阅", url: "/app/requests/new" }}
      secondaryActions={[
        {
          content: selectedResources.length ? `手动发送邮件 (${selectedResources.length})` : "手动发送邮件",
          onAction: () => setSendOpen(true),
          disabled: selectedResources.length === 0,
        },
      ]}
    >
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
                <Button onClick={() => exportCsv("all")}>导出全部</Button>
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
                  <Select label="标签" labelInline
                    options={[{ label: "全部标签", value: "" }, ...allTags.map((t) => ({ label: t, value: t }))]}
                    value={get("tag")} onChange={(v) => setParam("tag", v)} />
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
            <Box paddingBlockStart="200">
              <Text as="span" variant="bodySm" tone="subdued">
                「可用库存」列：UK = {stockNames.shopName} · EW = {stockNames.ewName}（实时 Available）
              </Text>
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
              headings={[
                { title: "商品 / 变体" }, { title: "客户" }, { title: "可用库存" },
                { title: "状态" }, { title: "日期" }, { title: "操作", alignment: "end" },
              ]}
            >
              {rows.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i} selected={selectedResources.includes(r.id)}>
                  <IndexTable.Cell>
                    <div style={{ width: 220, minWidth: 0 }}>
                      <div title={r.productTitle} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "normal", wordBreak: "break-word", minWidth: 0 }}>
                        <Text as="span" variant="bodyMd">{r.productTitle}</Text>
                      </div>
                      <div title={r.variantTitle} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        <Text as="span" variant="bodySm" tone="subdued">{r.variantTitle}</Text>
                      </div>
                      {r.tags ? (
                        <Box paddingBlockStart="100">
                          <InlineStack gap="100" wrap>
                            {r.tags.split(",").map((t) => <Badge key={t} size="small">{t}</Badge>)}
                          </InlineStack>
                        </Box>
                      ) : null}
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{r.email}</Text>
                    {r.customerName ? (<><br /><Text as="span" variant="bodySm" tone="subdued">{r.customerName}</Text></>) : null}
                    {r.marketing ? (<><br /><Badge tone="success" size="small">Newsletter</Badge></>) : null}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                        <Text as="span" variant="bodySm" tone="subdued">UK</Text>{stockNum(r.stockShop)}
                      </InlineStack>
                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                        <Text as="span" variant="bodySm" tone="subdued">EW</Text>{stockNum(r.stockEw)}
                      </InlineStack>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status] ?? r.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone="subdued">{new Date(r.createdAt).toLocaleDateString()}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="300" align="end" blockAlign="center" wrap={false}>
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
          <BlockStack gap="300">
            <Combobox
              allowMultiple
              activator={
                <Combobox.TextField
                  label="标签"
                  labelHidden
                  value={tagInput}
                  onChange={setTagInput}
                  placeholder="搜索已有标签，或输入新标签后从下拉点「新增」"
                  autoComplete="off"
                />
              }
            >
              {tagOptions.length > 0 || canCreateTag ? (
                <Listbox
                  onSelect={(value) => {
                    if (value === "__create__") addNewTag();
                    else toggleTag(value);
                    setTagInput("");
                  }}
                >
                  {tagOptions.map((t) => (
                    <Listbox.Option key={t} value={t}>{t}</Listbox.Option>
                  ))}
                  {canCreateTag ? (
                    <Listbox.Action value="__create__">{`新增标签 “${tagInput.trim()}”`}</Listbox.Action>
                  ) : null}
                </Listbox>
              ) : null}
            </Combobox>
            {tagList.length > 0 ? (
              <InlineStack gap="200" wrap>
                {tagList.map((t) => (
                  <Tag key={t} onRemove={() => setTagList(tagList.filter((x) => x !== t))}>{t}</Tag>
                ))}
              </InlineStack>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">还没有标签。从上面选已有标签，或输入新标签。</Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* 发送邮件：发给勾选的人 */}
      <Modal
        open={sendOpen}
        onClose={() => { setSendOpen(false); setPreviewMode(false); }}
        title={previewMode ? "邮件预览" : `发送邮件（已选 ${selectedResources.length} 人）`}
        primaryAction={
          previewMode
            ? { content: "← 返回编辑", onAction: () => setPreviewMode(false) }
            : {
                content: `发送给 ${selectedResources.length} 人`,
                onAction: doSend,
                loading: fetcher.state !== "idle",
                disabled: !sendSubject || !sendBody || selectedResources.length === 0,
              }
        }
        secondaryActions={
          previewMode
            ? [{ content: "发送", onAction: doSend, disabled: !sendSubject || !sendBody || selectedResources.length === 0 }]
            : [{ content: "预览", onAction: () => setPreviewMode(true), disabled: !sendBody }, { content: "取消", onAction: () => setSendOpen(false) }]
        }
      >
        <Modal.Section>
          {previewMode ? (
            <BlockStack gap="200">
              {firstSel && (
                <Text as="p" tone="subdued" variant="bodySm">
                  预览以勾选的第一位客人为例：<b>{firstSel.customerName || firstSel.email}</b> 订阅了「{firstSel.productTitle}{firstSel.variantTitle && firstSel.variantTitle !== "Default Title" ? ` / ${firstSel.variantTitle}` : ""}」。每位收件人都会替换成自己订阅的产品。
                </Text>
              )}
              <Box borderRadius="200" borderWidth="025" borderColor="border">
                <iframe title="send-preview" srcDoc={sendPreview}
                  style={{ width: "100%", height: 480, border: "none", display: "block" }} />
              </Box>
            </BlockStack>
          ) : (
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                发送给<b>勾选</b>的客人。富文本/代码可切换;插入产品卡到光标处;「预览」看效果。
              </Text>
              <Checkbox
                label="使用全局页眉/页脚（顶部 logo + 底部公司信息）"
                checked={sendShell}
                onChange={setSendShell}
                helpText="勾选时只写正文，页眉页脚由「页眉页脚」页统一提供。"
              />
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
              <EmailEditor value={sendBody} onChange={setSendBody} onPickProducts={pickProductCards} customerCard={{ html: CUSTOMER_CARD, label: "客人订阅的产品（每人各自显示）" }} />
              <Text as="p" tone="subdued" variant="bodySm">
                变量:{"{{customer_name}} {{product_title}} {{product_image}} {{product_price}} {{product_url}} {{unsubscribe_url}}"}（每人按自己订阅的商品渲染）。
              </Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
