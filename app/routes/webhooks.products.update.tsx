// products/update → 兜底：变体 inventory_policy 改为 continue 后可能"可购买"，
// 或变体增删导致库存恢复。逐变体检查总库存，>0 则触发到货群发。
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { notifyVariantRestocked } from "../models/subscription.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  const variants =
    (payload as { variants?: Array<{ id: number; inventory_quantity?: number }> })
      .variants ?? [];

  for (const v of variants) {
    if ((v.inventory_quantity ?? 0) > 0) {
      const gid = `gid://shopify/ProductVariant/${v.id}`;
      const { notified } = await notifyVariantRestocked(shop, gid, admin ?? undefined);
      if (notified) console.log(`[webhook] product restock ${gid} → 发信 ${notified} 封`);
    }
  }

  return new Response();
};
