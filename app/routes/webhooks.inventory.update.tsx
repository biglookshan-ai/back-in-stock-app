// inventory_levels/update → 按设置(地点/阈值)判定是否到货 → 群发到货邮件
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  notifyVariantRestocked,
  getSettings,
} from "../models/subscription.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop}`);

  const inventoryItemId = (payload as { inventory_item_id?: number })
    .inventory_item_id;
  if (!inventoryItemId || !admin) return new Response();

  const settings = await getSettings(shop);
  // 参与计算的库存地点（空 = 全部）
  const selectedLocations = settings.displayLocationIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 查变体 + 各地点 available 库存
  const gid = `gid://shopify/InventoryItem/${inventoryItemId}`;
  let variant:
    | {
        id: string;
        inventoryPolicy: string;
        levels: Array<{ locationId: string; available: number }>;
      }
    | undefined;
  try {
    const resp = await admin.graphql(
      `#graphql
      query VariantStock($id: ID!) {
        inventoryItem(id: $id) {
          variant { id inventoryPolicy }
          inventoryLevels(first: 50) {
            edges {
              node {
                location { id }
                quantities(names: ["available"]) { quantity }
              }
            }
          }
        }
      }`,
      { variables: { id: gid } },
    );
    const json = await resp.json();
    const item = json?.data?.inventoryItem;
    if (item?.variant) {
      variant = {
        id: item.variant.id,
        inventoryPolicy: item.variant.inventoryPolicy, // CONTINUE | DENY
        levels: (item.inventoryLevels?.edges ?? []).map((e: any) => ({
          locationId: e.node.location.id,
          available: e.node.quantities?.[0]?.quantity ?? 0,
        })),
      };
    }
  } catch (e) {
    console.error("[webhook] variant lookup failed", e);
    return new Response();
  }
  if (!variant) return new Response();

  // 按所选地点汇总库存
  const total = variant.levels
    .filter((l) => selectedLocations.length === 0 || selectedLocations.includes(l.locationId))
    .reduce((sum, l) => sum + l.available, 0);

  // 触发判定
  const threshold = settings.minStockThreshold ?? 1;
  let shouldNotify = total >= threshold;
  // 「缺货可继续售卖时库存=0也通知」
  if (
    settings.notifyAtZeroIfContinueSelling &&
    variant.inventoryPolicy === "CONTINUE" &&
    total >= 0
  ) {
    shouldNotify = true;
  }

  if (shouldNotify) {
    const { notified } = await notifyVariantRestocked(shop, variant.id);
    if (notified)
      console.log(`[webhook] restock ${variant.id} (库存 ${total}) → 发信 ${notified} 封`);
  }

  return new Response();
};
