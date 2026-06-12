// orders/create → 转化追踪：下单邮箱 + 变体匹配订阅 → 标记 ORDERED
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { markOrdered } from "../models/subscription.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  const order = payload as {
    email?: string;
    customer?: { email?: string };
    line_items?: Array<{ variant_id?: number }>;
  };
  const email = order.email || order.customer?.email;
  if (!email) return new Response();

  const variantIds = (order.line_items ?? [])
    .map((li) => li.variant_id)
    .filter((id): id is number => !!id)
    .map((id) => `gid://shopify/ProductVariant/${id}`);

  const count = await markOrdered(shop, email, variantIds);
  if (count) console.log(`[webhook] 转化：${email} 下单，标记 ${count} 条订阅为 ORDERED`);

  return new Response();
};
