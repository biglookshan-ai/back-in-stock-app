// 邮件模板编辑：确认信 / 到货信 —— 实时预览 + 变量/条件 + 恢复默认 + 发测试
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  Checkbox,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Box,
  Banner,
  Tabs,
  InlineGrid,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getAllTemplates,
  renderTemplate,
  composeEmail,
  DEFAULT_TEMPLATES,
  DEFAULT_HEADER,
  DEFAULT_FOOTER,
  type TemplateType,
} from "../email-templates.server";
import { mailer } from "../mailer.server";
import { getSettings } from "../models/subscription.server";
import { useT, translate, type Lang } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [templates, settings] = await Promise.all([
    getAllTemplates(session.shop),
    getSettings(session.shop),
  ]);
  return {
    templates,
    globalHeader: settings.emailHeader || DEFAULT_HEADER,
    globalFooter: settings.emailFooter || DEFAULT_FOOTER,
    brand: {
      shop_name: settings.fromName,
      brand_logo: settings.logoUrl,
      brand_color: settings.brandColor,
      website_url: settings.websiteUrl,
      company_address: settings.companyAddress,
      support_email: settings.supportEmail,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");
  const type = fd.get("type") as TemplateType;
  const settings0 = await getSettings(shop);
  const lang: Lang = settings0.uiLanguage === "zh" ? "zh" : "en";
  const tr = (zh: string, vars?: Record<string, string | number>) => translate(zh, lang, vars);

  if (intent === "reset") {
    const def = DEFAULT_TEMPLATES[type];
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      update: { subject: def.subject, htmlBody: def.htmlBody, enabled: true, useGlobalShell: true },
      create: { shop, type, subject: def.subject, htmlBody: def.htmlBody, enabled: true, useGlobalShell: true },
    });
    return { ok: true, message: tr("已恢复默认模板"), reset: { type, ...def, useGlobalShell: true } };
  }

  const subject = String(fd.get("subject") ?? "");
  const htmlBody = String(fd.get("htmlBody") ?? "");
  const enabled = fd.get("enabled") === "true";
  const useGlobalShell = fd.get("useGlobalShell") === "true";

  if (intent === "save") {
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      update: { subject, htmlBody, enabled, useGlobalShell },
      create: { shop, type, subject, htmlBody, enabled, useGlobalShell },
    });
    return { ok: true, message: tr("已保存") };
  }

  if (intent === "test") {
    const to = String(fd.get("testEmail") ?? "");
    const settings = await getSettings(shop);
    const fullBody = useGlobalShell
      ? composeEmail(
          settings.emailHeader || DEFAULT_HEADER,
          htmlBody,
          settings.emailFooter || DEFAULT_FOOTER,
        )
      : htmlBody;
    const { subject: s, html } = renderTemplate(
      { subject, htmlBody: fullBody },
      {
        ...SAMPLE_VARS,
        customer_email: to,
        shop_name: settings.fromName,
        brand_logo: settings.logoUrl,
        brand_color: settings.brandColor,
        website_url: settings.websiteUrl,
        company_address: settings.companyAddress,
        support_email: settings.supportEmail,
        unsubscribe_url: `https://${shop}`,
        product_url: `https://${shop}`,
      },
    );
    const res = await mailer.send({
      to,
      subject: s,
      html,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail || `no-reply@${shop}`,
    });
    return res.ok
      ? { ok: true, message: tr("测试邮件已发送至 {to}", { to }) }
      : { ok: false, message: tr("发送失败：{error}", { error: String(res.error) }) };
  }

  return { ok: false, message: "unknown intent" };
};

// 预览/测试用样例产品数据
const SAMPLE_VARS = {
  customer_email: "customer@example.com",
  customer_name: "Alex",
  product_title: "DZOFILM Arcana 32/45/75mm Anamorphic 3-Lens Set",
  variant_title: "EF Mount / Kine Mount",
  product_image: "https://placehold.co/240x240/1a1a1a/ffffff?text=Product",
  product_price: "£2,629.95",
  product_url: "#",
  shop_name: "CINEGEARPRO",
  brand_logo: "",
  brand_color: "#1a1a1a",
  website_url: "",
  company_address: "",
  support_email: "",
  unsubscribe_url: "#",
};

const LABELS: Record<TemplateType, string> = {
  CONFIRMATION: "订阅确认邮件",
  BACK_IN_STOCK: "到货提醒邮件",
};

// 客户端渲染（与服务端 renderTemplate 一致：条件块 + 变量）
function renderClient(tpl: string, vars: Record<string, string>) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) =>
    vars[k] ? inner : "",
  );
  out = out.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, k, inner) =>
    vars[k] ? "" : inner,
  );
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : ""));
  return out;
}

export default function Templates() {
  const { templates, brand, globalHeader, globalFooter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const t = useT();
  const [tab, setTab] = useState(0);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      templates.map((t) => [t.type, { subject: t.subject, htmlBody: t.htmlBody, enabled: t.enabled, useGlobalShell: t.useGlobalShell }]),
    ),
  );
  const [testEmail, setTestEmail] = useState("");

  const current = templates[tab];
  const d = drafts[current.type];
  const setDraft = (patch: Partial<typeof d>) =>
    setDrafts((prev) => ({ ...prev, [current.type]: { ...prev[current.type], ...patch } }));

  // toast + 恢复默认后回填编辑器
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.message) shopify.toast.show(fetcher.data.message);
    const reset = (fetcher.data as any).reset;
    if (reset) {
      setDrafts((prev) => ({
        ...prev,
        [reset.type]: { subject: reset.subject, htmlBody: reset.htmlBody, enabled: true, useGlobalShell: true },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "save" | "test" | "reset") =>
    fetcher.submit(
      { intent, type: current.type, subject: d.subject, htmlBody: d.htmlBody, enabled: String(d.enabled), useGlobalShell: String(d.useGlobalShell), testEmail },
      { method: "POST" },
    );

  // 预览：样例产品 + 真实品牌设置；勾选全局外壳时把正文包进页眉/页脚
  const previewVars = { ...SAMPLE_VARS, ...brand };
  const wrapped = d.useGlobalShell
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">${globalHeader}<tr><td style="padding:24px 32px">${d.htmlBody}</td></tr>${globalFooter}</table></td></tr></table>`
    : d.htmlBody;
  const previewHtml = renderClient(wrapped, previewVars);
  const previewSubject = renderClient(d.subject, previewVars);

  return (
    <Page backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("自动发送模板")} />
      <Tabs
        selected={tab}
        onSelect={setTab}
        tabs={templates.map((tpl) => ({ id: tpl.type, content: t(LABELS[tpl.type as TemplateType]) }))}
      >
        <Box padding="400">
          <BlockStack gap="400">
            <Banner tone="info">
              <p>
                {t("变量：")}<code>{"{{product_title}}"}</code> <code>{"{{variant_title}}"}</code>{" "}
                <code>{"{{product_image}}"}</code> <code>{"{{product_price}}"}</code>{" "}
                <code>{"{{product_url}}"}</code> <code>{"{{customer_name}}"}</code>{" "}
                <code>{"{{customer_email}}"}</code> <code>{"{{shop_name}}"}</code>{" "}
                <code>{"{{brand_logo}}"}</code> <code>{"{{brand_color}}"}</code>{" "}
                <code>{"{{website_url}}"}</code> <code>{"{{company_address}}"}</code>{" "}
                <code>{"{{support_email}}"}</code> <code>{"{{unsubscribe_url}}"}</code>
                <br />
                {t("条件块：")}<code>{"{{#if product_image}}...{{/if}}"}</code>{" "}
                <code>{"{{#unless brand_logo}}...{{/unless}}"}</code>{t("（值为空时隐藏/显示）")}
                <br />
                {t("品牌信息（logo/主色/网站/地址）在 ")}<b>{t("设置")}</b>{t(" 页统一配置，模板里用变量自动带入。")}
              </p>
            </Banner>

            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {/* 编辑器 */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">{t("编辑")}</Text>
                    <Button variant="plain" onClick={() => submit("reset")}>
                      {t("恢复默认模板")}
                    </Button>
                  </InlineStack>
                  <Checkbox label={t("启用此邮件")} checked={d.enabled} onChange={(v) => setDraft({ enabled: v })} />
                  <Checkbox
                    label={t("使用全局页眉/页脚")}
                    checked={d.useGlobalShell}
                    onChange={(v) => setDraft({ useGlobalShell: v })}
                    helpText={d.useGlobalShell
                      ? t("下面只写正文，顶部 logo 与底部公司信息由「页眉页脚」页统一提供。")
                      : t("不使用全局外壳，下面需写完整邮件（含页眉/页脚）。")}
                  />
                  <TextField
                    label={t("邮件主题")}
                    value={d.subject}
                    onChange={(v) => setDraft({ subject: v })}
                    autoComplete="off"
                  />
                  <TextField
                    label={d.useGlobalShell ? t("邮件正文（HTML，仅中间内容）") : t("邮件正文（HTML，完整邮件）")}
                    value={d.htmlBody}
                    onChange={(v) => setDraft({ htmlBody: v })}
                    multiline={16}
                    autoComplete="off"
                  />
                  <InlineStack gap="300">
                    <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => submit("save")}>
                      {t("保存")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* 实时预览 */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">{t("实时预览")}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("主题：")}{previewSubject}
                  </Text>
                  <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="hidden">
                    <iframe
                      title="email-preview"
                      srcDoc={previewHtml}
                      style={{ width: "100%", height: 560, border: "none", display: "block" }}
                    />
                  </Box>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">{t("发送测试邮件")}</Text>
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="280px">
                    <TextField
                      label={t("收件邮箱")}
                      type="email"
                      value={testEmail}
                      onChange={setTestEmail}
                      autoComplete="email"
                    />
                  </Box>
                  <Button onClick={() => submit("test")} disabled={!testEmail}>
                    {t("发送测试")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Box>
      </Tabs>
    </Page>
  );
}
