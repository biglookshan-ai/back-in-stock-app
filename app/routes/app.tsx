import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { getSettings } from "../models/subscription.server";
import { useT } from "../i18n";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const lang = settings.uiLanguage === "zh" ? "zh" : "en";
  return { apiKey: process.env.SHOPIFY_API_KEY || "", lang };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const t = useT();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          {t("Back in Stock Dashboard")}
        </Link>
        <Link to="/app/requests">{t("请求列表")}</Link>
        <Link to="/app/products">{t("产品订阅")}</Link>
        <Link to="/app/subscribers">{t("订阅者")}</Link>
        <Link to="/app/custom-templates">{t("自定义模板")}</Link>
        <Link to="/app/templates">{t("自动发送模板")}</Link>
        <Link to="/app/email-shell">{t("页眉页脚")}</Link>
        <Link to="/app/settings">{t("设置")}</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
