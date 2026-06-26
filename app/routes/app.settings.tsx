// 设置：按钮 / 发件人 / 发送规则 / 小部件显示规则（按库存地点）
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  Checkbox,
  Select,
  Button,
  BlockStack,
  Text,
  Box,
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../models/subscription.server";
import { useT } from "../i18n";
import { useState } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  // 拉取店铺库存地点
  let locations: Array<{ id: string; name: string }> = [];
  try {
    const resp = await admin.graphql(
      `#graphql
      query { locations(first: 50) { edges { node { id name } } } }`,
    );
    const json = await resp.json();
    locations = (json?.data?.locations?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      name: e.node.name,
    }));
  } catch (e) {
    console.error("locations fetch failed", e);
  }

  return { settings, locations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  await prisma.settings.update({
    where: { shop: session.shop },
    data: {
      buttonText: String(fd.get("buttonText") ?? ""),
      buttonColor: String(fd.get("buttonColor") ?? "#000000"),
      showWhenPreorder: fd.get("showWhenPreorder") === "true",
      fromName: String(fd.get("fromName") ?? ""),
      fromEmail: String(fd.get("fromEmail") ?? ""),
      autoConfirmEnabled: fd.get("autoConfirmEnabled") === "true",
      autoRestockEnabled: fd.get("autoRestockEnabled") === "true",
      minStockThreshold: Math.max(0, parseInt(String(fd.get("minStockThreshold") ?? "1"), 10) || 0),
      notifyAtZeroIfContinueSelling: fd.get("notifyAtZeroIfContinueSelling") === "true",
      displayLocationIds: String(fd.get("displayLocationIds") ?? ""),
      logoUrl: String(fd.get("logoUrl") ?? ""),
      brandColor: String(fd.get("brandColor") ?? "#1a1a1a"),
      websiteUrl: String(fd.get("websiteUrl") ?? ""),
      companyAddress: String(fd.get("companyAddress") ?? ""),
      supportEmail: String(fd.get("supportEmail") ?? ""),
      ccEnabled: fd.get("ccEnabled") === "true",
      ccEmails: String(fd.get("ccEmails") ?? ""),
      uiLanguage: fd.get("uiLanguage") === "zh" ? "zh" : "en",
    },
  });
  return { ok: true };
};

export default function SettingsPage() {
  const { settings, locations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const t = useT();
  const [s, setS] = useState(settings);
  // 选中的地点（空数组 = 全部）
  const [locs, setLocs] = useState<string[]>(
    settings.displayLocationIds ? settings.displayLocationIds.split(",").filter(Boolean) : [],
  );

  if (fetcher.data?.ok && fetcher.state === "idle") {
    shopify.toast.show(t("设置已保存"));
  }

  const toggleLoc = (id: string, on: boolean) =>
    setLocs((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const save = () =>
    fetcher.submit(
      {
        buttonText: s.buttonText,
        buttonColor: s.buttonColor,
        showWhenPreorder: String(s.showWhenPreorder),
        fromName: s.fromName,
        fromEmail: s.fromEmail,
        autoConfirmEnabled: String(s.autoConfirmEnabled),
        autoRestockEnabled: String(s.autoRestockEnabled),
        minStockThreshold: String(s.minStockThreshold),
        notifyAtZeroIfContinueSelling: String(s.notifyAtZeroIfContinueSelling),
        displayLocationIds: locs.join(","),
        logoUrl: s.logoUrl,
        brandColor: s.brandColor,
        websiteUrl: s.websiteUrl,
        companyAddress: s.companyAddress,
        supportEmail: s.supportEmail,
        ccEnabled: String(s.ccEnabled),
        ccEmails: s.ccEmails,
        uiLanguage: s.uiLanguage,
      },
      { method: "POST" },
    );

  return (
    <Page fullWidth backAction={{ content: t("返回"), onAction: () => navigate("/app") }}>
      <TitleBar title={t("设置")} />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("界面语言")}</Text>
            <Select
              label={t("界面语言（仅后台，不影响客人邮件）")}
              options={[
                { label: t("English（英文）"), value: "en" },
                { label: t("中文（Chinese）"), value: "zh" },
              ]}
              value={s.uiLanguage}
              onChange={(v) => setS({ ...s, uiLanguage: v })}
              helpText={t("切换后台显示语言。发送给客人的邮件内容由邮件模板单独控制，不受此项影响。")}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("按钮")}</Text>
            <TextField label={t("按钮文案")} value={s.buttonText} onChange={(v) => setS({ ...s, buttonText: v })} autoComplete="off" />
            <TextField label={t("按钮颜色 (hex)")} value={s.buttonColor} onChange={(v) => setS({ ...s, buttonColor: v })} autoComplete="off" />
            <Checkbox
              label={t("缺货但可预订时也显示「到货提醒」按钮")}
              helpText={t("关闭后，可预订状态只显示「加入购物车 / 预订」。")}
              checked={s.showWhenPreorder}
              onChange={(v) => setS({ ...s, showWhenPreorder: v })}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("自动发送")}</Text>
            <Checkbox
              label={t("订阅时自动发送确认邮件")}
              helpText={t("关闭后，客人订阅时不再自动收到「已加入提醒名单」的确认信。")}
              checked={s.autoConfirmEnabled}
              onChange={(v) => setS({ ...s, autoConfirmEnabled: v })}
            />
            <Checkbox
              label={t("到货时自动发送提醒邮件")}
              helpText={t("关闭后，库存到货也不会自动群发提醒；订阅会保留在「等待中」，可稍后开启再发或手动发送。")}
              checked={s.autoRestockEnabled}
              onChange={(v) => setS({ ...s, autoRestockEnabled: v })}
            />
            <Text as="p" tone="subdued" variant="bodySm">{t("需要临时停掉所有自动邮件时，把上面两个都关掉即可。")}</Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("发送规则")}</Text>
            <TextField
              label={t("通知的最小库存")}
              type="number"
              value={String(s.minStockThreshold)}
              onChange={(v) => setS({ ...s, minStockThreshold: parseInt(v, 10) || 0 })}
              helpText={t("库存达到此值才发送到货通知（默认 1）。")}
              autoComplete="off"
            />
            <Checkbox
              label={t("库存为 0 且开启「缺货时继续销售」也发送通知")}
              helpText={t("开启后，可预订商品库存回到 0 时也会通知，最小库存将被忽略。")}
              checked={s.notifyAtZeroIfContinueSelling}
              onChange={(v) => setS({ ...s, notifyAtZeroIfContinueSelling: v })}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("邮件密送（BCC）")}</Text>
            <Checkbox
              label={t("把所有发出的邮件密送给同事")}
              helpText={t("开启后，无论是确认信、到货通知还是手动群发，都会同时密送给下面填写的邮箱，方便同事知道发了什么。密送对收件客人不可见。")}
              checked={s.ccEnabled}
              onChange={(v) => setS({ ...s, ccEnabled: v })}
            />
            <TextField
              label={t("密送邮箱")}
              value={s.ccEmails}
              onChange={(v) => setS({ ...s, ccEmails: v })}
              placeholder="alice@cinegearpro.co.uk, bob@cinegearpro.co.uk"
              helpText={t("多个邮箱用逗号、分号或换行分隔。客人收到的邮件里看不到这些地址。开关关闭时不密送。")}
              multiline={3}
              autoComplete="off"
              disabled={!s.ccEnabled}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("小部件显示规则")}</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("选择参与库存计算的地点。只统计所选地点的库存来决定是否显示按钮 / 发送到货通知。不勾选 = 统计全部地点。")}
            </Text>
            {locations.length === 0 ? (
              <Text as="p" tone="subdued">{t("未获取到地点（需要 read_locations / 库存权限）。")}</Text>
            ) : (
              locations.map((l) => (
                <Checkbox
                  key={l.id}
                  label={l.name}
                  checked={locs.includes(l.id)}
                  onChange={(on) => toggleLoc(l.id, on)}
                />
              ))
            )}
            <Text as="p" tone="subdued" variant="bodySm">
              {locs.length === 0 ? t("统计全部地点") : t("已选择 {n} 个地点", { n: locs.length })}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("品牌 / 公司信息（邮件）")}</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("这些信息会自动用在到货/确认邮件的头部 logo、主色、页脚公司信息里。")}
            </Text>
            <TextField
              label={t("Logo 图片 URL")}
              value={s.logoUrl}
              onChange={(v) => setS({ ...s, logoUrl: v })}
              helpText={t("邮件头部显示的 logo（留空则显示发件人名称文字）。")}
              placeholder="https://cinegearpro.co.uk/logo.png"
              autoComplete="off"
            />
            <TextField
              label={t("品牌主色 (hex)")}
              value={s.brandColor}
              onChange={(v) => setS({ ...s, brandColor: v })}
              helpText={t("邮件标题、按钮、价格的颜色。")}
              autoComplete="off"
            />
            <TextField
              label={t("官网链接")}
              value={s.websiteUrl}
              onChange={(v) => setS({ ...s, websiteUrl: v })}
              placeholder="https://cinegearpro.co.uk"
              autoComplete="off"
            />
            <TextField
              label={t("公司地址（页脚）")}
              value={s.companyAddress}
              onChange={(v) => setS({ ...s, companyAddress: v })}
              multiline={2}
              autoComplete="off"
            />
            <TextField
              label={t("客服邮箱（页脚）")}
              type="email"
              value={s.supportEmail}
              onChange={(v) => setS({ ...s, supportEmail: v })}
              autoComplete="off"
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("发件人")}</Text>
            <TextField label={t("发件人名称")} value={s.fromName} onChange={(v) => setS({ ...s, fromName: v })} autoComplete="off" />
            <TextField
              label={t("发件邮箱")}
              type="email"
              value={s.fromEmail}
              onChange={(v) => setS({ ...s, fromEmail: v })}
              helpText={t("需在 .env 配置 SMTP，且该邮箱域名建议设置 SPF/DKIM 提升送达率。")}
              autoComplete="email"
            />
            <Banner tone="warning">
              <p>{t("发信走 SMTP（.env 中 SMTP_HOST 等）。店铺邮箱通常有每日发信上限，大促群发可能触顶——届时建议切换 Resend/SendGrid（mailer 已预留接口）。")}</p>
            </Banner>
          </BlockStack>
        </Card>

        <Box>
          <Button variant="primary" loading={fetcher.state !== "idle"} onClick={save}>
            {t("保存设置")}
          </Button>
        </Box>
      </BlockStack>
    </Page>
  );
}
