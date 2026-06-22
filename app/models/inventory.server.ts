// 实时库存：查变体在「门店(CineGearPro Shop)」与「EW(External Warehouse)」两地的 Available。
// 用于按变体清单 / 请求列表展示当前可用库存，辅助判断是否手动发提醒。

type Admin = { graphql: (q: string, opts?: any) => Promise<Response> };

export type StockLocations = {
  shopLocId: string | null;
  ewLocId: string | null;
  shopName: string;
  ewName: string;
};

export type Availability = { shop: number | null; ew: number | null };

// 找出要展示的两个地点（按名称匹配；找不到则为 null，对应列显示「—」）
export async function resolveStockLocations(admin: Admin): Promise<StockLocations> {
  try {
    const resp = await admin.graphql(
      `#graphql
      query { locations(first: 50) { edges { node { id name } } } }`,
    );
    const json = await resp.json();
    const locs: { id: string; name: string }[] = (json?.data?.locations?.edges ?? []).map(
      (e: any) => ({ id: e.node.id, name: e.node.name as string }),
    );
    const find = (re: RegExp) => locs.find((l) => re.test(l.name));
    const shop = find(/cinegearpro|\bshop\b/i) ?? null;
    const ew = find(/external|\bEW\b/i) ?? null;
    return {
      shopLocId: shop?.id ?? null,
      ewLocId: ew?.id ?? null,
      shopName: shop?.name ?? "门店",
      ewName: ew?.name ?? "EW",
    };
  } catch (e) {
    console.error("[inventory] resolveStockLocations failed", e);
    return { shopLocId: null, ewLocId: null, shopName: "门店", ewName: "EW" };
  }
}

// 批量查变体在两地的 Available（按 variantId gid 取回）
export async function getAvailability(
  admin: Admin,
  variantIds: string[],
  loc: StockLocations,
): Promise<Record<string, Availability>> {
  const out: Record<string, Availability> = {};
  const ids = Array.from(new Set(variantIds.filter(Boolean)));
  if (ids.length === 0 || (!loc.shopLocId && !loc.ewLocId)) return out;

  // 只查需要的两个地点（inventoryLevel.locationId 为必填，按地点是否存在动态拼字段）
  const fields = [
    loc.shopLocId
      ? `shop: inventoryLevel(locationId:"${loc.shopLocId}") { quantities(names:["available"]) { quantity } }`
      : "",
    loc.ewLocId
      ? `ew: inventoryLevel(locationId:"${loc.ewLocId}") { quantities(names:["available"]) { quantity } }`
      : "",
  ].join("\n");

  try {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const resp = await admin.graphql(
        `#graphql
        query Avail($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              inventoryItem { ${fields} }
            }
          }
        }`,
        { variables: { ids: chunk } },
      );
      const json = await resp.json();
      for (const n of json?.data?.nodes ?? []) {
        if (!n?.id) continue;
        const shopQ = n.inventoryItem?.shop?.quantities?.[0]?.quantity;
        const ewQ = n.inventoryItem?.ew?.quantities?.[0]?.quantity;
        out[n.id] = {
          shop: typeof shopQ === "number" ? shopQ : null,
          ew: typeof ewQ === "number" ? ewQ : null,
        };
      }
    }
  } catch (e) {
    console.error("[inventory] getAvailability failed", e);
  }
  return out;
}
