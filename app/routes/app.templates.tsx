// 邮件模板编辑：确认信 / 到货信 —— 实时预览 + 变量/条件 + 恢复默认 + 发测试
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  DEFAULT_TEMPLATES,
  type TemplateType,
} from "../email-templates.server";
import { mailer } from "../mailer.server";
import { getSettings } from "../models/subscription.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [templates, settings] = await Promise.all([
    getAllTemplates(session.shop),
    getSettings(session.shop),
  ]);
  return {
    templates,
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

  if (intent === "reset") {
    const def = DEFAULT_TEMPLATES[type];
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      update: { subject: def.subject, htmlBody: def.htmlBody, enabled: true },
      create: { shop, type, subject: def.subject, htmlBody: def.htmlBody, enabled: true },
    });
    return { ok: true, message: "已恢复默认模板", reset: { type, ...def } };
  }

  const subject = String(fd.get("subject") ?? "");
  const htmlBody = String(fd.get("htmlBody") ?? "");
  const enabled = fd.get("enabled") === "true";

  if (intent === "save") {
    await prisma.emailTemplate.upsert({
      where: { shop_type: { shop, type } },
      update: { subject, htmlBody, enabled },
      create: { shop, type, subject, htmlBody, enabled },
    });
    return { ok: true, message: "已保存" };
  }

  if (intent === "test") {
    const to = String(fd.get("testEmail") ?? "");
    const settings = await getSettings(shop);
    const { subject: s, html } = renderTemplate(
      { subject, htmlBody },
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
      ? { ok: true, message: `测试邮件已发送至 ${to}` }
      : { ok: false, message: `发送失败：${res.error}` };
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
  const { templates, brand } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [tab, setTab] = useState(0);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      templates.map((t) => [t.type, { subject: t.subject, htmlBody: t.htmlBody, enabled: t.enabled }]),
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
        [reset.type]: { subject: reset.subject, htmlBody: reset.htmlBody, enabled: true },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "save" | "test" | "reset") =>
    fetcher.submit(
      { intent, type: current.type, subject: d.subject, htmlBody: d.htmlBody, enabled: String(d.enabled), testEmail },
      { method: "POST" },
    );

  // 预览：样例产品 + 真实品牌设置
  const previewVars = { ...SAMPLE_VARS, ...brand };
  const previewHtml = renderClient(d.htmlBody, previewVars);
  const previewSubject = renderClient(d.subject, previewVars);

  return (
    <Page>
      <TitleBar title="邮件模板" />
      <Tabs
        selected={tab}
        onSelect={setTab}
        tabs={templates.map((t) => ({ id: t.type, content: LABELS[t.type as TemplateType] }))}
      >
        <Box padding="400">
          <BlockStack gap="400">
            <Banner tone="info">
              <p>
                变量：<code>{"{{product_title}}"}</code> <code>{"{{variant_title}}"}</code>{" "}
                <code>{"{{product_image}}"}</code> <code>{"{{product_price}}"}</code>{" "}
                <code>{"{{product_url}}"}</code> <code>{"{{customer_name}}"}</code>{" "}
                <code>{"{{customer_email}}"}</code> <code>{"{{shop_name}}"}</code>{" "}
                <code>{"{{brand_logo}}"}</code> <code>{"{{brand_color}}"}</code>{" "}
                <code>{"{{website_url}}"}</code> <code>{"{{company_address}}"}</code>{" "}
                <code>{"{{support_email}}"}</code> <code>{"{{unsubscribe_url}}"}</code>
                <br />
                条件块：<code>{"{{#if product_image}}...{{/if}}"}</code>{" "}
                <code>{"{{#unless brand_logo}}...{{/unless}}"}</code>（值为空时隐藏/显示）
                <br />
                品牌信息（logo/主色/网站/地址）在 <b>设置</b> 页统一配置，模板里用变量自动带入。
              </p>
            </Banner>

            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {/* 编辑器 */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">编辑</Text>
                    <Button variant="plain" onClick={() => submit("reset")}>
                      恢复默认模板
                    </Button>
                  </InlineStack>
                  <Checkbox label="启用此邮件" checked={d.enabled} onChange={(v) => setDraft({ enabled: v })} />
                  <TextField
                    label="邮件主题"
                    value={d.subject}
                    onChange={(v) => setDraft({ subject: v })}
                    autoComplete="off"
                  />
                  <TextField
                    label="邮件正文（HTML）"
                    value={d.htmlBody}
                    onChange={(v) => setDraft({ htmlBody: v })}
                    multiline={16}
                    autoComplete="off"
                  />
                  <InlineStack gap="300">
                    <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => submit("save")}>
                      保存
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* 实时预览 */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">实时预览</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    主题：{previewSubject}
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
                <Text as="h3" variant="headingMd">发送测试邮件</Text>
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="280px">
                    <TextField
                      label="收件邮箱"
                      type="email"
                      value={testEmail}
                      onChange={setTestEmail}
                      autoComplete="email"
                    />
                  </Box>
                  <Button onClick={() => submit("test")} disabled={!testEmail}>
                    发送测试
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
