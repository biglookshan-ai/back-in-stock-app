// 邮件页眉/页脚：全局统一编辑。所有「使用全局外壳」的模板共用这里的页眉+页脚。
// 留空＝使用内置默认。改一次，全部模板的上标/下标同步更新。
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page, Card, TextField, Button, BlockStack, InlineStack, Text, Box, Banner, InlineGrid,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../models/subscription.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER } from "../email-templates.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    header: settings.emailHeader,
    footer: settings.emailFooter,
    defaultHeader: DEFAULT_HEADER,
    defaultFooter: DEFAULT_FOOTER,
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
  const fd = await request.formData();
  const emailHeader = String(fd.get("header") ?? "");
  const emailFooter = String(fd.get("footer") ?? "");
  await prisma.settings.update({
    where: { shop: session.shop },
    data: { emailHeader, emailFooter },
  });
  return { ok: true, message: "已保存，所有使用全局外壳的模板已同步" };
};

// 客户端渲染（与服务端 renderTemplate 一致）
function renderClient(tpl: string, vars: Record<string, string>) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) => (vars[k] ? inner : ""));
  out = out.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, k, inner) => (vars[k] ? "" : inner));
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : ""));
}

// 与 email-templates.server.ts 的 composeEmail 保持一致的外壳
function wrapShell(header: string, body: string, footer: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #eaeaea;">
      ${header}${body}${footer}
    </table>
  </td></tr>
</table>`;
}

// 预览中段（代表模板正文的位置）
const SAMPLE_BODY = `
  <tr><td style="padding:28px 32px 8px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">这里是模板正文</div>
    <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">页眉在上、页脚在下，由本页统一控制。各模板只需写中间这段内容。</div>
  </td></tr>`;

const SAMPLE_VARS = {
  shop_name: "CINEGEARPRO",
  brand_logo: "",
  brand_color: "#1a1a1a",
  website_url: "",
  company_address: "",
  support_email: "",
  unsubscribe_url: "#",
};

export default function EmailShell() {
  const { header, footer, defaultHeader, defaultFooter, brand } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [h, setH] = useState(header);
  const [f, setF] = useState(footer);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const save = () => fetcher.submit({ header: h, footer: f }, { method: "POST" });

  const vars = { ...SAMPLE_VARS, ...brand } as Record<string, string>;
  const previewHtml = renderClient(
    wrapShell(h || defaultHeader, SAMPLE_BODY, f || defaultFooter),
    vars,
  );

  return (
    <Page>
      <TitleBar title="邮件页眉页脚" />
      <BlockStack gap="400">
        <Banner tone="info">
          <p>
            这里统一编辑所有邮件的<b>页眉（顶部 logo）</b>和<b>页脚（公司信息 / 退订）</b>。
            模板里勾选「使用全局页眉页脚」即可共用这里的内容，<b>改一次，全部模板同步</b>。
            <br />
            两个框<b>留空＝使用内置默认</b>。可用变量：
            <code>{"{{shop_name}} {{brand_logo}} {{brand_color}} {{website_url}} {{company_address}} {{support_email}} {{unsubscribe_url}}"}</code>
          </p>
        </Banner>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">页眉 HTML</Text>
                <InlineStack gap="200">
                  <Button variant="plain" onClick={() => setH(defaultHeader)}>载入默认</Button>
                  <Button variant="plain" onClick={() => setH("")}>清空（用内置）</Button>
                </InlineStack>
              </InlineStack>
              <TextField label="页眉" labelHidden value={h} onChange={setH}
                multiline={6} autoComplete="off" placeholder="留空＝使用内置默认页眉" />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">页脚 HTML</Text>
                <InlineStack gap="200">
                  <Button variant="plain" onClick={() => setF(defaultFooter)}>载入默认</Button>
                  <Button variant="plain" onClick={() => setF("")}>清空（用内置）</Button>
                </InlineStack>
              </InlineStack>
              <TextField label="页脚" labelHidden value={f} onChange={setF}
                multiline={8} autoComplete="off" placeholder="留空＝使用内置默认页脚" />

              <InlineStack gap="300">
                <Button variant="primary" loading={fetcher.state !== "idle"} onClick={save}>保存</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">实时预览</Text>
              <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="hidden">
                <iframe title="shell-preview" srcDoc={previewHtml}
                  style={{ width: "100%", height: 560, border: "none", display: "block" }} />
              </Box>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
