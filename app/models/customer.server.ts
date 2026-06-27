// 新老客分类：用订阅邮箱去 Shopify 查客户档案 + 下单数
//   ORDERED  = Shopify 有客户档案且下过单（老客·已下单）
//   NO_ORDER = Shopify 有客户档案但从没下单（老客·未下单）
//   NEW      = Shopify 查无此客户（新客）
// 需要 read_customers scope。
import prisma from "../db.server";

export type CustomerType = "ORDERED" | "NO_ORDER" | "NEW";

export const CUSTOMER_TYPE_VALUES: CustomerType[] = ["ORDERED", "NO_ORDER", "NEW"];

type AdminClient = { graphql: (q: string, opts?: any) => Promise<Response> };

// 单个邮箱分类。查不到/出错时返回 null（视为未知，不写库）。
export async function classifyCustomer(
  admin: AdminClient,
  email: string,
): Promise<CustomerType | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  try {
    const resp = await admin.graphql(
      `#graphql
      query ClassifyCustomer($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { id numberOfOrders } }
        }
      }`,
      { variables: { q: `email:"${clean}"` } },
    );
    const json = await resp.json();
    const node = json?.data?.customers?.edges?.[0]?.node;
    if (!node) return "NEW";
    const orders = parseInt(String(node.numberOfOrders ?? "0"), 10) || 0;
    return orders > 0 ? "ORDERED" : "NO_ORDER";
  } catch (e) {
    console.error("[customer] classify failed", clean, e);
    return null;
  }
}

// 批量回填：把店铺里所有（或指定）邮箱分类后，写回该邮箱的全部订阅行。
// 顺序执行避免触发 Shopify API 限流；返回 { classified, byType }。
export async function classifyAndStore(
  admin: AdminClient,
  shop: string,
  opts: { onlyMissing?: boolean } = {},
): Promise<{ classified: number; byType: Record<CustomerType, number> }> {
  const where: any = { shop };
  if (opts.onlyMissing) where.customerType = null;

  const rows = await prisma.subscription.findMany({
    where,
    select: { email: true },
    distinct: ["email"],
  });
  const emails = rows.map((r) => r.email);

  const byType: Record<CustomerType, number> = { ORDERED: 0, NO_ORDER: 0, NEW: 0 };
  let classified = 0;
  for (const email of emails) {
    const type = await classifyCustomer(admin, email);
    if (!type) continue;
    await prisma.subscription.updateMany({
      where: { shop, email },
      data: { customerType: type },
    });
    byType[type] += 1;
    classified += 1;
  }
  return { classified, byType };
}
