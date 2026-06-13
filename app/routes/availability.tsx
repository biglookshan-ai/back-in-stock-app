// 公开接口（App Proxy）：按「所选库存地点」计算每个变体是否应显示到货提醒按钮。
// storefront 拿不到分地点库存，故由后端用 Admin API 计算后返回。
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/subscription.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const shop = session.shop;
  const url = new URL(request.url);
  const productIdRaw = url.searchParams.get("productId") ?? "";
  const productId = productIdRaw.startsWith("gid://")
    ? productIdRaw
    : `gid://shopify/Product/${productIdRaw}`;

  const settings = await getSettings(shop);
  const selected = settings.displayLocationIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const noStore = { "Cache-Control": "no-store" };

  let variants: Array<{
    id: string;
    policy: string;
    levels: Array<{ locationId: string; available: number }>;
  }> = [];
  try {
    const resp = await admin.graphql(
      `#graphql
      query ProductStock($id: ID!) {
        product(id: $id) {
          variants(first: 100) {
            edges {
              node {
                id
                inventoryPolicy
                inventoryItem {
                  inventoryLevels(first: 50) {
                    edges {
                      node {
                        location { id }
                        quantities(names: ["available"]) { quantity }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: productId } },
    );
    const respJson = await resp.json();
    variants = (respJson?.data?.product?.variants?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      policy: e.node.inventoryPolicy, // CONTINUE | DENY
      levels: (e.node.inventoryItem?.inventoryLevels?.edges ?? []).map((l: any) => ({
        locationId: l.node.location.id,
        available: l.node.quantities?.[0]?.quantity ?? 0,
      })),
    }));
  } catch (e) {
    return json({ error: "lookup_failed" }, { status: 502, headers: noStore });
  }

  // 每个变体：所选地点库存 <= 0 才算缺货 → 按状态决定是否显示按钮
  const result: Record<string, { show: boolean }> = {};
  for (const v of variants) {
    const stock = v.levels
      .filter((l) => selected.length === 0 || selected.includes(l.locationId))
      .reduce((sum, l) => sum + l.available, 0);
    const outOfStock = stock <= 0;
    let show = false;
    if (outOfStock) {
      if (v.policy === "DENY") show = true; // 状态 B
      else if (v.policy === "CONTINUE" && settings.showWhenPreorder) show = true; // 状态 A
    }
    const numericId = v.id.split("/").pop() as string;
    result[numericId] = { show };
  }

  return json({ variants: result }, { headers: noStore });
};
