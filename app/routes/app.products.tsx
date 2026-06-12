// 产品订阅：按产品聚合 —— 当前等待数 / 最后请求时间 / 历史总请求数
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, Card, IndexTable, EmptyState, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [totals, actives] = await Promise.all([
    prisma.subscription.groupBy({
      by: ["productId", "productTitle"],
      where: { shop },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.subscription.groupBy({
      by: ["productId"],
      where: { shop, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ]);

  const activeMap: Record<string, number> = {};
  actives.forEach((a) => (activeMap[a.productId] = a._count._all));

  const rows = totals
    .map((t) => ({
      productId: t.productId,
      productTitle: t.productTitle,
      active: activeMap[t.productId] ?? 0,
      total: t._count._all,
      last: t._max.createdAt?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));

  return { rows };
};

export default function Products() {
  const { rows } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="产品订阅" />
      <Card padding="0">
        {rows.length === 0 ? (
          <EmptyState heading="还没有产品订阅" image="">
            <p>客户在缺货商品页订阅后，这里会按产品汇总需求。</p>
          </EmptyState>
        ) : (
          <IndexTable
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: "产品" },
              { title: "当前等待" },
              { title: "最后请求" },
              { title: "历史总请求" },
            ]}
          >
            {rows.map((r, i) => (
              <IndexTable.Row id={r.productId} key={r.productId} position={i}>
                <IndexTable.Cell>
                  <Link to={`/app/products/detail?productId=${encodeURIComponent(r.productId)}`}>
                    {r.productTitle}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{r.active}</IndexTable.Cell>
                <IndexTable.Cell>
                  {r.last ? new Date(r.last).toLocaleString() : "—"}
                </IndexTable.Cell>
                <IndexTable.Cell>{r.total}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
