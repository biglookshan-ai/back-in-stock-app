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
  Checkbox,
  EmptyState,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendManualEmail, getSettings } from "../models/subscription.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER } from "../email-templates.server";
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
// 推荐产品卡 HTML（颜色用 {{brand_color}} 变量，发送时按品牌渲染）
function productCard(p: { title: string; image: string; price: string; url: string }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin:12px 0">
  <tr>
    ${p.image ? `<td width="120" style="padding:0"><img src="${p.image}" width="120" style="width:120px;height:120px;object-fit:cover;display:block;border:0"></td>` : ""}
    <td style="padding:14px 16px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:#1a1a1a">${p.title}</div>
      ${p.price ? `<div style="font-size:14px;font-weight:600;color:{{brand_color}};margin-top:6px">${p.price}</div>` : ""}
      <a href="${p.url}" style="display:inline-block;margin-top:10px;background:{{brand_color}};color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px">View product</a>
    </td>
  </tr>
</table>`;
}

// 客人订阅的产品卡（带变量，发送时每人按自己的订阅渲染）
const CUSTOMER_CARD = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin:12px 0">
  <tr>
    {{#if product_image}}<td width="120" style="padding:0"><img src="{{product_image}}" width="120" style="width:120px;height:120px;object-fit:cover;display:block;border:0"></td>{{/if}}
    <td style="padding:14px 16px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:#1a1a1a">{{product_title}}</div>
      {{#if variant_title}}<div style="font-size:13px;color:#888;margin-top:4px">{{variant_title}}</div>{{/if}}
      {{#if product_price}}<div style="font-size:14px;font-weight:600;color:{{brand_color}};margin-top:6px">{{product_price}}</div>{{/if}}
      <a href="{{product_url}}" style="display:inline-block;margin-top:10px;background:{{brand_color}};color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px">View product</a>
    </td>
  </tr>
</table>`;

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

  const [rows, counts, filteredCount, customTemplates, settings] = await Promise.all([
    prisma.subscription.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.subscription.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
    prisma.subscription.count({ where }),
    prisma.customTemplate.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, subject: true, htmlBody: true, useGlobalShell: true },
    }),
    getSettings(shop),
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
    shop,
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
  productTitle: string; variantTitle: string; status: string;
  tags: string; marketing: boolean; createdAt: string;
};

type CustomTpl = { id: string; name: string; subject: string; htmlBody: string; useGlobalShell: boolean };

export default function Requests() {
  const { rows, counts, status, q, customTemplates, shop, brand, globalHeader, globalFooter } =
    useLoaderData<typeof loader>() as {
      rows: Row[]; counts: Record<string, number>; status: string; q: string;
      filteredCount: number; customTemplates: CustomTpl[];
      shop: string; brand: Record<string, string>;
      globalHeader: string; globalFooter: string;
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

  // 选产品 → 生成产品卡 HTML 数组（编辑器在光标处插入）
  const pickProductCards = async (): Promise<string[]> => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!picked || picked.length === 0) return [];
    return (picked as any[]).map((p) => {
      const img = p.images?.[0]?.originalSrc || p.images?.[0]?.url || p.featuredImage?.url || "";
      const price = p.variants?.[0]?.price ? String(p.variants[0].price) : "";
      const url = p.handle ? `https://${shop}/products/${p.handle}` : "#";
      return productCard({ title: p.title, image: img, price, url });
    });
  };

  const sendWrapped = sendShell
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">${globalHeader}<tr><td style="padding:0">${sendBody}</td></tr>${globalFooter}</table></td></tr></table>`
    : sendBody;
  const sendPreview = renderClient(sendWrapped, { ...SAMPLE_VARS, ...brand });

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
            <Box borderRadius="200" borderWidth="025" borderColor="border">
              <iframe title="send-preview" srcDoc={sendPreview}
                style={{ width: "100%", height: 480, border: "none", display: "block" }} />
            </Box>
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
              <EmailEditor value={sendBody} onChange={setSendBody} onPickProducts={pickProductCards} customerCardHtml={CUSTOMER_CARD} />
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
