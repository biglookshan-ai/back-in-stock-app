// 邮件页眉/页脚：全局统一编辑。所有「使用全局外壳」的模板共用这里的页眉+页脚。
// 留空＝使用内置默认。改一次，全部模板的上标/下标同步更新。
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page, Card, TextField, Button, ButtonGroup, BlockStack, InlineStack, Text, Box, Banner, InlineGrid,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../models/subscription.server";
import { DEFAULT_HEADER, DEFAULT_FOOTER, effectiveHeader, effectiveFooter } from "../email-templates.server";
import { wrapEmailBody } from "../email-blocks";
import { useT, translate, type Lang } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    header: effectiveHeader(settings.emailHeader),
    footer: effectiveFooter(settings.emailFooter),
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
  const lang: Lang = (await getSettings(session.shop)).uiLanguage === "zh" ? "zh" : "en";
  await prisma.settings.update({
    where: { shop: session.shop },
    data: { emailHeader, emailFooter },
  });
  return { ok: true, message: translate("已保存，所有使用全局外壳的模板已同步", lang) };
};

// 客户端渲染（与服务端 renderTemplate 一致）
function renderClient(tpl: string, vars: Record<string, string>) {
  let out = tpl.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, k, inner) => (vars[k] ? inner : ""));
  out = out.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, k, inner) => (vars[k] ? "" : inner));
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k]) : ""));
}

// 与 email-templates.server.ts 的 composeEmail 保持一致的外壳
const wrapShell = wrapEmailBody;

// 预览中段（代表模板正文的位置）
const SAMPLE_BODY = `
  <div style="font-size:22px;font-weight:700;color:#1a1a1a;">This is the template body</div>
  <div style="font-size:15px;color:#555;line-height:1.6;margin-top:8px;">The header is above and the footer below, both controlled on this page. Each template only writes this middle section.</div>`;

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
  const navigate = useNavigate();
  const t = useT();

  const [h, setH] = useState(header);
  const [f, setF] = useState(footer);
  const [pvMobile, setPvMobile] = useState(false);

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
    <Page fullWidth backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("邮件页眉页脚")} />
      <BlockStack gap="400">
        <Banner tone="info">
          <p>
            {t("这里统一编辑所有邮件的页眉（顶部 logo）和页脚（公司信息 / 退订）。模板里勾选「使用全局页眉页脚」即可共用，改一次全部模板同步。")}
            <br />
            {t("两个框留空＝使用内置默认。可用变量：")}
            <code>{"{{shop_name}} {{brand_logo}} {{brand_color}} {{website_url}} {{company_address}} {{support_email}} {{unsubscribe_url}}"}</code>
          </p>
        </Banner>

        <InlineGrid columns={1} gap="400">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">{t("页眉 HTML")}</Text>
                <InlineStack gap="200">
                  <Button variant="plain" onClick={() => setH(defaultHeader)}>{t("载入默认")}</Button>
                  <Button variant="plain" onClick={() => setH("")}>{t("清空（用内置）")}</Button>
                </InlineStack>
              </InlineStack>
              <TextField label={t("页眉")} labelHidden value={h} onChange={setH}
                multiline={6} autoComplete="off" placeholder={t("留空＝使用内置默认页眉")} />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">{t("页脚 HTML")}</Text>
                <InlineStack gap="200">
                  <Button variant="plain" onClick={() => setF(defaultFooter)}>{t("载入默认")}</Button>
                  <Button variant="plain" onClick={() => setF("")}>{t("清空（用内置）")}</Button>
                </InlineStack>
              </InlineStack>
              <TextField label={t("页脚")} labelHidden value={f} onChange={setF}
                multiline={8} autoComplete="off" placeholder={t("留空＝使用内置默认页脚")} />

              <InlineStack gap="300">
                <Button variant="primary" loading={fetcher.state !== "idle"} onClick={save}>{t("保存")}</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">{t("实时预览")}</Text>
                <ButtonGroup variant="segmented">
                  <Button size="slim" pressed={!pvMobile} onClick={() => setPvMobile(false)}>{t("桌面")}</Button>
                  <Button size="slim" pressed={pvMobile} onClick={() => setPvMobile(true)}>{t("手机")}</Button>
                </ButtonGroup>
              </InlineStack>
              <Box borderRadius="200" borderWidth="025" borderColor="border" overflowX="scroll">
                <iframe title="shell-preview" srcDoc={previewHtml}
                  style={{ width: pvMobile ? 390 : 600, height: 760, zoom: pvMobile ? 1 : 1.3, border: "none", display: "block", margin: "0 auto" }} />
              </Box>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
