import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // 清理本 app 数据（自用无需保留）
  await db.subscription.deleteMany({ where: { shop } });
  await db.emailTemplate.deleteMany({ where: { shop } });
  await db.emailLog.deleteMany({ where: { shop } });
  await db.settings.deleteMany({ where: { shop } });

  return new Response();
};
