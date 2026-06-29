// 发信时用：按 variantId 去 Shopify 拉「当前最新」产品信息，用于渲染邮件产品卡。
// 不写回数据库（订阅快照保持不变），只覆盖邮件里的展示字段；拉不到则回退快照。
type AdminClient = { graphql: (q: string, opts?: any) => Promise<Response> };

export type LiveCardVars = {
  productTitle: string;
  variantTitle: string;
  productImage: string | null;
  price: string | null;
  productHandle: string | null;
};

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", CAD: "C$", AUD: "A$", JPY: "¥", CNY: "¥", HKD: "HK$",
};
function fmtPrice(price?: string | null, code?: string): string | null {
  if (!price) return null;
  const sym = code ? CURRENCY_SYMBOL[code] : "";
  const n = Number(price);
  const num = Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, "") : price;
  return sym ? `${sym}${num}` : code ? `${num} ${code}` : num;
}

// 批量拉多个变体的最新信息，返回 { [variantGid]: LiveCardVars }。
// 出错或变体已删除则不在 map 中（调用方回退快照）。
export async function fetchLiveCardVars(
  admin: AdminClient,
  variantIds: string[],
): Promise<Record<string, LiveCardVars>> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return {};
  try {
    const resp = await admin.graphql(
      `#graphql
      query LiveCards($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            price
            image { url }
            product { title handle featuredImage { url } }
          }
        }
        shop { currencyCode }
      }`,
      { variables: { ids } },
    );
    const j = await resp.json();
    const currency = j?.data?.shop?.currencyCode ?? "";
    const out: Record<string, LiveCardVars> = {};
    for (const n of j?.data?.nodes ?? []) {
      if (!n?.id || !n.product) continue; // 变体或产品已删
      out[n.id] = {
        productTitle: n.product.title,
        variantTitle: n.title,
        productImage: n.image?.url ?? n.product.featuredImage?.url ?? null,
        price: fmtPrice(n.price, currency),
        productHandle: n.product.handle,
      };
    }
    return out;
  } catch (e) {
    console.error("[live-product] fetch failed", e);
    return {};
  }
}
