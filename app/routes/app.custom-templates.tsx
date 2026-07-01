// 自定义邮件模板库：手动发送邮件时可选用的可复用模板（新建/编辑/删除 + 实时预览）
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Card, TextField, Checkbox, Button, BlockStack, InlineStack, Text, Box,
  InlineGrid, Banner, ResourceList, ResourceItem, Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../models/subscription.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER } from "../email-templates.server";
import { useT, translate, type Lang } from "../i18n";
import { productCard, CUSTOMER_CARD } from "../email-cards";
import { EMAIL_PRESETS } from "../email-presets";
import { EmailEditor } from "../components/EmailEditor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [templates, settings] = await Promise.all([
    prisma.customTemplate.findMany({ where: { shop: session.shop }, orderBy: { updatedAt: "desc" } }),
    getSettings(session.shop),
  ]);
  return {
    shop: session.shop,
    templates: templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, htmlBody: t.htmlBody, useGlobalShell: t.useGlobalShell })),
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
  const lang: Lang = (await getSettings(session.shop)).uiLanguage === "zh" ? "zh" : "en";
  const tr = (zh: string) => translate(zh, lang);
  if (intent === "delete") {
    await prisma.customTemplate.deleteMany({ where: { id: String(fd.get("id")), shop: session.shop } });
    return { ok: true, message: tr("已删除"), deleted: true };
  }
  const name = String(fd.get("name") ?? "").trim() || tr("未命名模板");
  const subject = String(fd.get("subject") ?? "");
  const htmlBody = String(fd.get("htmlBody") ?? "");
  const useGlobalShell = fd.get("useGlobalShell") !== "false";
  const id = String(fd.get("id") ?? "");
  if (id) {
    await prisma.customTemplate.updateMany({ where: { id, shop: session.shop }, data: { name, subject, htmlBody, useGlobalShell } });
    return { ok: true, message: tr("已保存"), savedId: id };
  }
  const created = await prisma.customTemplate.create({ data: { shop: session.shop, name, subject, htmlBody, useGlobalShell } });
  return { ok: true, message: tr("已创建"), savedId: created.id };
};

const SAMPLE = {
  customer_name: "Alex", customer_email: "customer@example.com",
  product_title: "DZOFILM Arcana 35mm", variant_title: "EF Mount",
  product_image: "https://placehold.co/240x240/1a1a1a/ffffff?text=Product",
  product_price: "£2,629.95", product_url: "#", unsubscribe_url: "#",
};
function renderClient(tpl: string, vars: Record<string, string>) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) => (vars[k] ? inner : ""));
  out = out.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, k, inner) => (vars[k] ? "" : inner));
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : ""));
}

// 默认正文（中间内容；页眉/页脚 + 外边距由全局外壳提供）
const DEFAULT_BODY = `<div style="font-family:Arial,sans-serif">
  <h2 style="color:{{brand_color}};margin:0 0 12px">Hi {{customer_name}},</h2>
  <p style="font-size:15px;color:#444;line-height:1.6">Regarding <strong>{{product_title}}</strong> ({{variant_title}}) — write your message here, e.g. it's expected to ship in about 3 weeks; do you still want it?</p>
  <p style="margin-top:16px"><a href="{{product_url}}" style="display:inline-block;background:{{brand_color}};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">View product</a></p>
</div>`;

// 与服务端 composeEmail 一致的外壳（预览用）
function wrapShell(header: string, body: string, footer: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">${header}<tr><td style="padding:24px 32px">${body}</td></tr>${footer}</table></td></tr></table>`;
}

type Tpl = { id: string; name: string; subject: string; htmlBody: string; useGlobalShell: boolean };

export default function CustomTemplates() {
  const { shop, templates, brand, globalHeader, globalFooter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const t = useT();

  const [sel, setSel] = useState<Tpl | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isNew = sel !== null && !sel.id;

  // 选产品 → 小卡片（含展示用 label/thumb），编辑器光标处插入
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

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.message) shopify.toast.show(fetcher.data.message);
    const savedId = (fetcher.data as any).savedId;
    if (savedId && sel) setSel({ ...sel, id: savedId });
    if ((fetcher.data as any).deleted) setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const newTpl = () => setSel({ id: "", name: "", subject: "", htmlBody: DEFAULT_BODY, useGlobalShell: true });
  // 从内置模板新建（复制内容，编辑后另存为自己的模板）
  const newFromPreset = (key: string) => {
    const p = EMAIL_PRESETS.find((x) => x.key === key);
    if (p) setSel({ id: "", name: t(p.name), subject: p.subject, htmlBody: p.htmlBody, useGlobalShell: p.useGlobalShell });
  };
  const save = () =>
    sel && fetcher.submit({ intent: "save", id: sel.id, name: sel.name, subject: sel.subject, htmlBody: sel.htmlBody, useGlobalShell: String(sel.useGlobalShell) }, { method: "POST" });
  const del = () => sel?.id && fetcher.submit({ intent: "delete", id: sel.id }, { method: "POST" });

  const previewVars = { ...SAMPLE, ...brand } as Record<string, string>;

  return (
    <Page fullWidth backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("自定义邮件模板")} />
      <Banner tone="info">
        <p>{t("这些模板用于手动发送邮件(在「请求列表」筛选客人后群发)。变量同其它模板:")}<code>{"{{customer_name}} {{product_title}} {{variant_title}} {{product_url}} {{brand_color}}"}</code>{t(" 等。")}</p>
      </Banner>
      <Box paddingBlockStart="400">
        <InlineGrid columns={{ xs: 1, md: ["oneThird", "twoThirds"] }} gap="400">
          {/* 列表 */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">{t("模板")}</Text>
                <Button onClick={newTpl} variant="primary">{t("新建")}</Button>
              </InlineStack>
              <BlockStack gap="150">
                <Text as="span" variant="bodySm" tone="subdued">{t("从内置模板开始：")}</Text>
                <InlineStack gap="200" wrap>
                  {EMAIL_PRESETS.map((p) => (
                    <Button key={p.key} size="slim" onClick={() => newFromPreset(p.key)}>{t(p.name)}</Button>
                  ))}
                </InlineStack>
              </BlockStack>
              {templates.length === 0 ? (
                <Text as="p" tone="subdued">{t("还没有模板,点「新建」创建一个。")}</Text>
              ) : (
                <ResourceList
                  items={templates}
                  renderItem={(tpl: Tpl) => (
                    <ResourceItem id={tpl.id} onClick={() => setSel(tpl)}>
                      <Text as="span" variant="bodyMd" fontWeight="medium">{tpl.name}</Text>
                      <br />
                      <Text as="span" variant="bodySm" tone="subdued">{tpl.subject}</Text>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>

          {/* 编辑 + 预览 */}
          {sel ? (
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">{isNew ? t("新建模板") : t("编辑模板")}</Text>
                <TextField label={t("模板名称")} value={sel.name} onChange={(v) => setSel({ ...sel, name: v })} autoComplete="off" />
                <Checkbox
                  label={t("使用全局页眉/页脚")}
                  checked={sel.useGlobalShell}
                  onChange={(v) => setSel({ ...sel, useGlobalShell: v })}
                  helpText={sel.useGlobalShell
                    ? t("下面只写正文，页眉页脚由「页眉页脚」页统一提供。")
                    : t("不使用全局外壳，下面需写完整邮件。")}
                />
                <TextField label={t("邮件主题")} value={sel.subject} onChange={(v) => setSel({ ...sel, subject: v })} autoComplete="off" />
                <Box>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {sel.useGlobalShell ? t("正文（仅中间内容）") : t("正文（完整邮件）")}
                  </Text>
                  <Box paddingBlockStart="200">
                    <EmailEditor
                      value={sel.htmlBody}
                      onChange={(v) => setSel({ ...sel, htmlBody: v })}
                      onPickProducts={pickProductCards}
                      customerCard={{ html: CUSTOMER_CARD, label: t("客人订阅的产品（每人各自显示）") }}
                    />
                  </Box>
                </Box>
                <InlineStack gap="300">
                  <Button variant="primary" loading={fetcher.state !== "idle"} onClick={save}>{t("保存")}</Button>
                  <Button onClick={() => setPreviewOpen(true)} disabled={!sel.htmlBody}>{t("预览")}</Button>
                  {!isNew && <Button tone="critical" onClick={del}>{t("删除")}</Button>}
                </InlineStack>
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <Box padding="400"><Text as="p" tone="subdued">{t("左侧选一个模板编辑,或点「新建」。")}</Text></Box>
            </Card>
          )}
        </InlineGrid>
      </Box>

      <Modal
        size="large"
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={t("邮件预览")}
        primaryAction={{ content: t("关闭"), onAction: () => setPreviewOpen(false) }}
      >
        <Modal.Section>
          <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="scroll">
            <iframe title="preview"
              srcDoc={renderClient(
                sel?.useGlobalShell ? wrapShell(globalHeader, sel?.htmlBody ?? "", globalFooter) : (sel?.htmlBody ?? ""),
                previewVars,
              )}
              style={{ width: 600, height: 560, border: "none", display: "block", margin: "0 auto" }} />
          </Box>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
