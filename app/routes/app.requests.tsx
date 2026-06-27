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
import { classifyAndStore, importNewNewsletterToShopify } from "../models/customer.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER } from "../email-templates.server";
import { resolveStockLocations, getAvailability } from "../models/inventory.server";
import { useT, translate, type Lang } from "../i18n";
import { CTYPE_LABEL, CTYPE_TONE } from "../customer-types";
import { productCard, CUSTOMER_CARD } from "../email-cards";
import { EmailEditor } from "../components/EmailEditor";

// 把 URL/表单的筛选条件构造成 Prisma where（loader 与群发 action 共用）
function buildWhere(shop: string, sp: URLSearchParams): any {
  const status = sp.get("status") ?? "";
  const q = sp.get("q")?.trim() ?? "";
  const marketing = sp.get("marketing") ?? "";
  const tag = sp.get("tag")?.trim() ?? "";
  const ctype = sp.get("ctype")?.trim() ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const where: any = {
    shop,
    ...(status === "" ? { status: { not: "ARCHIVED" } } : { status }),
    ...(marketing === "yes" ? { marketingConsent: true } : marketing === "no" ? { marketingConsent: false } : {}),
    ...(tag ? { tags: { contains: tag } } : {}),
    ...(ctype === "UNKNOWN" ? { customerType: null } : ctype ? { customerType: ctype } : {}),
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
  product_title: "Customer's subscribed product", variant_title: "EF Mount",
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

  // 客户类型各档计数（沿用其它筛选，但忽略 ctype 本身，便于看每档有多少）
  const spNoCtype = new URLSearchParams(url.searchParams);
  spNoCtype.delete("ctype");
  const ctypeWhere = buildWhere(shop, spNoCtype);

  const [rows, counts, filteredCount, customTemplates, settings, tagRows, ctypeGroups, importable] = await Promise.all([
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
    prisma.subscription.groupBy({ by: ["customerType"], where: ctypeWhere, _count: { _all: true } }),
    prisma.subscription.findMany({ where: { shop, customerType: "NEW", marketingConsent: true }, select: { email: true }, distinct: ["email"] }),
  ]);

  // 客户类型计数：null 归为 UNKNOWN
  const ctypeCounts = { ORDERED: 0, NO_ORDER: 0, NEW: 0, UNKNOWN: 0 };
  ctypeGroups.forEach((g) => {
    ctypeCounts[(g.customerType ?? "UNKNOWN") as keyof typeof ctypeCounts] = g._count._all;
  });
  const importableCount = importable.length;

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

  // 每条订阅「最近一次发信」结果（自动/手动 + 成功/失败）
  const rowIds = rows.map((r) => r.id);
  const lastLogs = rowIds.length
    ? await prisma.emailLog.findMany({
        // 只看「通知类」邮件（到货/手动），订阅确认信不算"已通知"
        where: { subscriptionId: { in: rowIds }, type: { not: "CONFIRMATION" } },
        orderBy: [{ subscriptionId: "asc" }, { sentAt: "desc" }],
        distinct: ["subscriptionId"],
        select: { subscriptionId: true, type: true, status: true, error: true, sentAt: true },
      })
    : [];
  const lastSendMap: Record<string, { type: string; status: string; error: string | null; sentAt: string }> = {};
  lastLogs.forEach((l) => {
    lastSendMap[l.subscriptionId] = { type: l.type, status: l.status, error: l.error, sentAt: l.sentAt.toISOString() };
  });

  return {
    rows: rows.map((r) => ({
      id: r.id, email: r.email, customerName: r.customerName,
      productTitle: r.productTitle, variantTitle: r.variantTitle,
      productImage: r.productImage, price: r.price, productHandle: r.productHandle,
      status: r.status, tags: r.tags, marketing: r.marketingConsent,
      customerType: r.customerType,
      createdAt: r.createdAt.toISOString(),
      stockShop: avail[r.variantId]?.shop ?? null,
      stockEw: avail[r.variantId]?.ew ?? null,
      lastSend: lastSendMap[r.id] ?? null,
    })),
    counts: countMap, status, q, filteredCount, customTemplates, allTags,
    ctypeCounts, importableCount,
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
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const lang: Lang = (await getSettings(session.shop)).uiLanguage === "zh" ? "zh" : "en";
  const tr = (zh: string, vars?: Record<string, string | number>) => translate(zh, lang, vars);

  // 回填/刷新新老客分类：查 Shopify 客户档案，写回每个邮箱的全部订阅
  if (intent === "reclassify") {
    const onlyMissing = fd.get("onlyMissing") === "true";
    const { classified, byType } = await classifyAndStore(admin, session.shop, { onlyMissing });
    return {
      ok: true,
      message: tr("已分类 {n} 位客人：老客已下单 {a} · 老客未下单 {b} · 新客 {c}", {
        n: classified, a: byType.ORDERED, b: byType.NO_ORDER, c: byType.NEW,
      }),
    };
  }

  // 把「新客 + 已订阅 Newsletter」导入 Shopify 客户库（带营销同意）
  if (intent === "import_customers") {
    const { created, existed, failed, total } = await importNewNewsletterToShopify(admin, session.shop);
    if (total === 0) return { ok: true, message: tr("没有「新客且已订阅 Newsletter」的客人可导入") };
    return {
      ok: true,
      message: tr("导入完成：新建 {created} · 已存在 {existed} · 失败 {failed}（共 {total}）", {
        created, existed, failed, total,
      }),
    };
  }

  // 发送邮件：发给选中的订阅行
  if (intent === "sendmail") {
    const subject = String(fd.get("subject") ?? "").trim();
    const htmlBody = String(fd.get("htmlBody") ?? "").trim();
    if (!subject || !htmlBody) return { ok: false, message: tr("主题和正文不能为空") };
    const ids = String(fd.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return { ok: false, message: tr("请先勾选收件人") };
    const useGlobalShell = fd.get("useGlobalShell") !== "false";
    const subs = await prisma.subscription.findMany({
      where: { shop: session.shop, id: { in: ids } },
    });
    const sent = await sendManualEmail(subs, subject, htmlBody, useGlobalShell);
    return { ok: true, message: tr("已发送 {n} 封", { n: sent }) };
  }

  // 某订阅的发信记录列表（不含正文，省流量）
  if (intent === "maillogs") {
    const subscriptionId = String(fd.get("subscriptionId") ?? "");
    const logs = await prisma.emailLog.findMany({
      where: { shop: session.shop, subscriptionId },
      orderBy: { sentAt: "desc" },
      select: { id: true, type: true, status: true, error: true, subject: true, toEmail: true, sentAt: true, htmlBody: true },
    });
    return {
      logs: logs.map((l) => ({
        id: l.id, type: l.type, status: l.status, error: l.error,
        subject: l.subject, toEmail: l.toEmail, sentAt: l.sentAt.toISOString(),
        hasBody: !!l.htmlBody,
      })),
    };
  }

  // 取某条发信记录的完整 HTML（点击预览时才拉）
  if (intent === "maillogbody") {
    const logId = String(fd.get("logId") ?? "");
    const log = await prisma.emailLog.findFirst({
      where: { id: logId, shop: session.shop },
      select: { htmlBody: true },
    });
    return { htmlBody: log?.htmlBody ?? "" };
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
    const header = "email,name,marketing,customer_type,tags,product,variant,barcode,status,source,price,subscribedAt,notifiedAt,orderedAt\n";
    const body = all
      .map((r) => [
        r.email, r.customerName, r.marketingConsent ? "Yes" : "No", r.customerType ?? "",
        r.tags, r.productTitle, r.variantTitle, r.barcode, r.status, r.source, r.price,
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
  status: string; tags: string; marketing: boolean; customerType: string | null; createdAt: string;
  stockShop: number | null; stockEw: number | null;
  lastSend: { type: string; status: string; error: string | null; sentAt: string } | null;
};

type MailLog = {
  id: string; type: string; status: string; error: string | null;
  subject: string | null; toEmail: string; sentAt: string; hasBody: boolean;
};

// 邮件类型 → 中文 + 自动/手动
const MAIL_KIND: Record<string, { label: string; auto: boolean }> = {
  BACK_IN_STOCK: { label: "到货通知", auto: true },
  CONFIRMATION: { label: "订阅确认", auto: true },
  MANUAL: { label: "手动发送", auto: false },
};

type CustomTpl = { id: string; name: string; subject: string; htmlBody: string; useGlobalShell: boolean };

export default function Requests() {
  const { rows, counts, status, q, filteredCount, customTemplates, allTags, ctypeCounts, importableCount, shop, brand, globalHeader, globalFooter, stockNames } =
    useLoaderData<typeof loader>() as {
      rows: Row[]; counts: Record<string, number>; status: string; q: string;
      filteredCount: number; customTemplates: CustomTpl[]; allTags: string[];
      ctypeCounts: { ORDERED: number; NO_ORDER: number; NEW: number; UNKNOWN: number };
      importableCount: number;
      shop: string; brand: Record<string, string>;
      globalHeader: string; globalFooter: string;
      stockNames: { shopName: string; ewName: string };
    };
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok: boolean; message?: string; csv?: string; filename?: string }>();
  const logFetcher = useFetcher<{ logs?: MailLog[] }>();
  const bodyFetcher = useFetcher<{ htmlBody?: string }>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const t = useT();

  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagList, setTagList] = useState<string[]>([]); // 编辑中的标签
  const [tagInput, setTagInput] = useState(""); // 标签输入/搜索框

  // 发信记录 modal
  const [logSubId, setLogSubId] = useState<string | null>(null);
  const [previewLogId, setPreviewLogId] = useState<string | null>(null);
  const openLogs = (id: string) => {
    setLogSubId(id);
    setPreviewLogId(null);
    logFetcher.submit({ intent: "maillogs", subscriptionId: id }, { method: "POST" });
  };
  const previewLog = (id: string) => {
    setPreviewLogId(id);
    bodyFetcher.submit({ intent: "maillogbody", logId: id }, { method: "POST" });
  };

  // 行选择
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(rows as unknown as { [key: string]: unknown; id: string }[]);

  // 导入 Shopify 客户库 确认 modal
  const [importOpen, setImportOpen] = useState(false);
  const doImport = () => {
    fetcher.submit({ intent: "import_customers" }, { method: "POST" });
    setImportOpen(false);
  };

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
    <Page fullWidth
      backAction={{ content: t("返回"), onAction: () => navigate("/app") }}
      primaryAction={{ content: t("手动添加订阅"), url: "/app/requests/new" }}
      secondaryActions={[
        {
          content: selectedResources.length ? t("手动发送邮件 ({n})", { n: selectedResources.length }) : t("手动发送邮件"),
          onAction: () => setSendOpen(true),
          disabled: selectedResources.length === 0,
        },
      ]}
    >
      <TitleBar title={t("请求列表")} />
      <Card padding="0">
        <Tabs
          selected={selectedTab}
          onSelect={(i) => setParam("status", STATUS_TABS[i].id)}
          tabs={STATUS_TABS.map((tab) => ({ id: tab.id || "all", content: `${t(tab.label)} (${counts[tab.id] ?? 0})` }))}
        >
          <Box padding="300">
            <InlineStack gap="300" align="space-between" blockAlign="center">
              <Box maxWidth="280px" minWidth="200px">
                <TextField label={t("搜索")} labelHidden placeholder={t("邮箱 / 姓名 / 商品 / barcode")}
                  value={searchInput} onChange={setSearchInput} clearButton onClearButtonClick={() => setSearchInput("")} autoComplete="off" />
              </Box>
              <InlineStack gap="200">
                <Button
                  loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "reclassify"}
                  onClick={() => fetcher.submit({ intent: "reclassify", onlyMissing: "true" }, { method: "POST" })}
                >{t("识别新老客")}</Button>
                <Button
                  disabled={importableCount === 0}
                  loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "import_customers"}
                  onClick={() => setImportOpen(true)}
                >{importableCount > 0 ? t("导入新客到 Shopify ({n})", { n: importableCount }) : t("导入新客到 Shopify")}</Button>
                <Button onClick={() => exportCsv("view")}>{t("导出当前筛选")}</Button>
                <Button onClick={() => exportCsv("all")}>{t("导出全部")}</Button>
              </InlineStack>
            </InlineStack>

            {/* 筛选器 */}
            <Box paddingBlockStart="300">
              <InlineStack gap="300" blockAlign="end">
                <Box minWidth="160px">
                  <Select label="Newsletter" labelInline
                    options={[
                      { label: t("全部"), value: "" },
                      { label: t("已订阅"), value: "yes" },
                      { label: t("未订阅"), value: "no" },
                    ]}
                    value={get("marketing")} onChange={(v) => setParam("marketing", v)} />
                </Box>
                <Box minWidth="160px">
                  <Select label={t("标签")} labelInline
                    options={[{ label: t("全部标签"), value: "" }, ...allTags.map((tag) => ({ label: tag, value: tag }))]}
                    value={get("tag")} onChange={(v) => setParam("tag", v)} />
                </Box>
                <Box minWidth="170px">
                  <Select label={t("客户类型")} labelInline
                    options={[
                      { label: `${t("全部")} (${ctypeCounts.ORDERED + ctypeCounts.NO_ORDER + ctypeCounts.NEW + ctypeCounts.UNKNOWN})`, value: "" },
                      { label: `${t("老客·已下单")} (${ctypeCounts.ORDERED})`, value: "ORDERED" },
                      { label: `${t("老客·未下单")} (${ctypeCounts.NO_ORDER})`, value: "NO_ORDER" },
                      { label: `${t("新客")} (${ctypeCounts.NEW})`, value: "NEW" },
                      { label: `${t("未分类")} (${ctypeCounts.UNKNOWN})`, value: "UNKNOWN" },
                    ]}
                    value={get("ctype")} onChange={(v) => setParam("ctype", v)} />
                </Box>
                <Box minWidth="150px">
                  <TextField label={t("从")} type="date"
                    value={get("from")} onChange={(v) => setParam("from", v)} autoComplete="off" />
                </Box>
                <Box minWidth="150px">
                  <TextField label={t("到")} type="date"
                    value={get("to")} onChange={(v) => setParam("to", v)} autoComplete="off" />
                </Box>
              </InlineStack>
            </Box>
            <Box paddingBlockStart="200">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {t("当前列表共 {n} 条", { n: filteredCount })}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("「可用库存」列：UK = {shop} · EW = {ew}（实时 Available）", { shop: stockNames.shopName, ew: stockNames.ewName })}
                </Text>
              </InlineStack>
            </Box>
          </Box>

          {rows.length === 0 ? (
            <EmptyState heading={t("没有符合条件的请求")} image="">
              <p>{t("调整筛选或等待客户订阅。")}</p>
            </EmptyState>
          ) : (
            <IndexTable
              itemCount={rows.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: t("商品 / 变体") }, { title: t("客户") }, { title: t("可用库存") },
                { title: t("状态") }, { title: t("日期") }, { title: t("操作") },
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
                            {r.tags.split(",").map((tg) => <Badge key={tg} size="small">{tg}</Badge>)}
                          </InlineStack>
                        </Box>
                      ) : null}
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd">{r.email}</Text>
                    {r.customerName ? (<><br /><Text as="span" variant="bodySm" tone="subdued">{r.customerName}</Text></>) : null}
                    {r.customerType || r.marketing ? (
                      <Box paddingBlockStart="100">
                        <BlockStack gap="100">
                          {r.customerType ? (
                            <InlineStack>
                              <Badge tone={CTYPE_TONE[r.customerType]} size="small">{t(CTYPE_LABEL[r.customerType] ?? r.customerType)}</Badge>
                            </InlineStack>
                          ) : null}
                          {r.marketing ? (
                            <InlineStack>
                              <Badge tone="magic" size="small">Newsletter</Badge>
                            </InlineStack>
                          ) : null}
                        </BlockStack>
                      </Box>
                    ) : null}
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
                    <BlockStack gap="100" inlineAlign="start">
                      <InlineStack>
                        <Badge tone={TONE[r.status]}>{t(LABEL[r.status] ?? r.status)}</Badge>
                      </InlineStack>
                      {r.lastSend ? (
                        <InlineStack gap="100" blockAlign="center" wrap={false}>
                          <Badge size="small" tone={MAIL_KIND[r.lastSend.type]?.auto ? "info" : undefined}>
                            {MAIL_KIND[r.lastSend.type]?.auto ? t("自动") : t("手动")}
                          </Badge>
                          <span title={r.lastSend.status === "FAILED" ? (r.lastSend.error ?? t("✗ 失败")) : t("✓ 已发送")}>
                            <Text as="span" variant="bodySm" tone={r.lastSend.status === "SENT" ? "success" : "critical"}>
                              {r.lastSend.status === "SENT" ? t("✓ 已发送") : t("✗ 失败")}
                            </Text>
                          </span>
                        </InlineStack>
                      ) : null}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" tone="subdued">{new Date(r.createdAt).toLocaleDateString()}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="300" align="start" blockAlign="center" wrap={false}>
                      <Button variant="plain" onClick={() => openLogs(r.id)}>{t("记录")}</Button>
                      <Button variant="plain" onClick={() => openTag(r)}>{t("标签")}</Button>
                      {r.status === "ARCHIVED" ? (
                        <>
                          <Button variant="plain" onClick={() => act("restore", r.id)}>{t("恢复")}</Button>
                          <Button variant="plain" tone="critical" onClick={() => act("delete", r.id)}>{t("删除")}</Button>
                        </>
                      ) : (
                        <>
                          {r.status !== "CANCELLED" && <Button variant="plain" onClick={() => act("cancel", r.id)}>{t("取消")}</Button>}
                          <Button variant="plain" onClick={() => act("archive", r.id)}>{t("归档")}</Button>
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
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t("导入新客到 Shopify 客户库")}
        primaryAction={{ content: t("确认导入 {n} 位", { n: importableCount }), onAction: doImport, disabled: importableCount === 0 }}
        secondaryActions={[{ content: t("取消"), onAction: () => setImportOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              {t("将把 {n} 位「新客 + 已订阅 Newsletter」的客人创建为 Shopify 客户，并标记为「已订阅邮件营销」。", { n: importableCount })}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("这些客人都在订阅时勾选了 Newsletter，因此按已同意营销导入。已存在的邮箱会自动跳过。导入后他们会从「新客」变为「老客·未下单」。")}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={tagEditId !== null}
        onClose={() => setTagEditId(null)}
        title={t("编辑标签")}
        primaryAction={{ content: t("保存"), onAction: saveTag }}
        secondaryActions={[{ content: t("取消"), onAction: () => setTagEditId(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Combobox
              allowMultiple
              activator={
                <Combobox.TextField
                  label={t("标签")}
                  labelHidden
                  value={tagInput}
                  onChange={setTagInput}
                  placeholder={t("搜索已有标签，或输入新标签后从下拉点「新增」")}
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
                  {tagOptions.map((opt) => (
                    <Listbox.Option key={opt} value={opt}>{opt}</Listbox.Option>
                  ))}
                  {canCreateTag ? (
                    <Listbox.Action value="__create__">{t("新增标签 “{name}”", { name: tagInput.trim() })}</Listbox.Action>
                  ) : null}
                </Listbox>
              ) : null}
            </Combobox>
            {tagList.length > 0 ? (
              <InlineStack gap="200" wrap>
                {tagList.map((tg) => (
                  <Tag key={tg} onRemove={() => setTagList(tagList.filter((x) => x !== tg))}>{tg}</Tag>
                ))}
              </InlineStack>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">{t("还没有标签。从上面选已有标签，或输入新标签。")}</Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* 发信记录：这条订阅发过哪些邮件（自动/手动、成功/失败、可预览内容）*/}
      <Modal
        size="large"
        open={logSubId !== null}
        onClose={() => { setLogSubId(null); setPreviewLogId(null); }}
        title={previewLogId ? t("邮件内容预览") : t("发信记录")}
        primaryAction={
          previewLogId
            ? { content: t("← 返回记录"), onAction: () => setPreviewLogId(null) }
            : { content: t("关闭"), onAction: () => { setLogSubId(null); } }
        }
      >
        <Modal.Section>
          {previewLogId ? (
            <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="scroll">
              <iframe
                title="maillog-preview"
                srcDoc={bodyFetcher.state !== "idle" ? `<p style='font-family:sans-serif;padding:16px;color:#888'>${t("加载中…")}</p>` : (bodyFetcher.data?.htmlBody || `<p style='font-family:sans-serif;padding:16px;color:#888'>${t("（无存档内容）")}</p>`)}
                style={{ width: 600, height: 560, border: "none", display: "block", margin: "0 auto" }}
              />
            </Box>
          ) : logFetcher.state !== "idle" ? (
            <Text as="p" tone="subdued">{t("加载中…")}</Text>
          ) : logFetcher.data?.logs && logFetcher.data.logs.length > 0 ? (
            <BlockStack gap="300">
              {logFetcher.data.logs.map((l) => {
                const kind = MAIL_KIND[l.type];
                const ok = l.status === "SENT";
                return (
                  <Box key={l.id} borderRadius="200" borderWidth="025" borderColor="border" padding="300">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge size="small" tone={kind?.auto ? "info" : undefined}>{kind?.auto ? t("自动") : t("手动")}</Badge>
                          <Text as="span" variant="bodyMd" fontWeight="medium">{t(kind?.label ?? l.type)}</Text>
                          <Text as="span" variant="bodySm" tone={ok ? "success" : "critical"}>{ok ? t("✓ 已发送") : t("✗ 失败")}</Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {new Date(l.sentAt).toLocaleString()} · {l.toEmail}
                        </Text>
                        {l.subject ? <Text as="span" variant="bodySm">{t("主题：")}{l.subject}</Text> : null}
                        {!ok && l.error ? <Text as="span" variant="bodySm" tone="critical">{t("原因：")}{l.error}</Text> : null}
                      </BlockStack>
                      {l.hasBody ? (
                        <Button variant="plain" onClick={() => previewLog(l.id)}>{t("预览")}</Button>
                      ) : null}
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">{t("这条订阅还没有发信记录。")}</Text>
          )}
        </Modal.Section>
      </Modal>

      {/* 发送邮件：发给勾选的人 */}
      <Modal
        size="large"
        open={sendOpen}
        onClose={() => { setSendOpen(false); setPreviewMode(false); }}
        title={previewMode ? t("邮件预览") : t("发送邮件（已选 {n} 人）", { n: selectedResources.length })}
        primaryAction={
          previewMode
            ? { content: t("← 返回编辑"), onAction: () => setPreviewMode(false) }
            : {
                content: t("发送给 {n} 人", { n: selectedResources.length }),
                onAction: doSend,
                loading: fetcher.state !== "idle",
                disabled: !sendSubject || !sendBody || selectedResources.length === 0,
              }
        }
        secondaryActions={
          previewMode
            ? [{ content: t("发送"), onAction: doSend, disabled: !sendSubject || !sendBody || selectedResources.length === 0 }]
            : [{ content: t("预览"), onAction: () => setPreviewMode(true), disabled: !sendBody }, { content: t("取消"), onAction: () => setSendOpen(false) }]
        }
      >
        <Modal.Section>
          {previewMode ? (
            <BlockStack gap="200">
              {firstSel && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("预览以勾选的第一位客人为例：")}<b>{firstSel.customerName || firstSel.email}</b>{t(" 订阅了「")}{firstSel.productTitle}{firstSel.variantTitle && firstSel.variantTitle !== "Default Title" ? ` / ${firstSel.variantTitle}` : ""}{t("」。每位收件人都会替换成自己订阅的产品。")}
                </Text>
              )}
              <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="scroll">
                <iframe title="send-preview" srcDoc={sendPreview}
                  style={{ width: 600, height: 560, border: "none", display: "block", margin: "0 auto" }} />
              </Box>
            </BlockStack>
          ) : (
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                {t("发送给勾选的客人。富文本/代码可切换;插入产品卡到光标处;「预览」看效果。")}
              </Text>
              <Checkbox
                label={t("使用全局页眉/页脚（顶部 logo + 底部公司信息）")}
                checked={sendShell}
                onChange={setSendShell}
                helpText={t("勾选时只写正文，页眉页脚由「页眉页脚」页统一提供。")}
              />
              <Select
                label={t("选择模板（可选）")}
                options={[
                  { label: t("— 空白 / 自己写 —"), value: "" },
                  ...customTemplates.map((ct) => ({ label: ct.name, value: ct.id })),
                ]}
                value={sendTplId}
                onChange={pickSendTpl}
                helpText={t("模板在「自定义邮件模板」页管理。选了可继续编辑。")}
              />
              <TextField label={t("主题")} value={sendSubject} onChange={setSendSubject} autoComplete="off" />
              <EmailEditor value={sendBody} onChange={setSendBody} onPickProducts={pickProductCards} customerCard={{ html: CUSTOMER_CARD, label: t("客人订阅的产品（每人各自显示）") }} />
              <Text as="p" tone="subdued" variant="bodySm">
                {t("变量:{vars}（每人按自己订阅的商品渲染）。", { vars: "{{customer_name}} {{product_title}} {{product_image}} {{product_price}} {{product_url}} {{unsubscribe_url}}" })}
              </Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
