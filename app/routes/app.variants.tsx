// 「变体清单」已并入「产品订阅」页（视图切换）。保留路由作重定向，避免旧书签 404。
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const sp = new URLSearchParams({ view: "variant" });
  if (q) sp.set("q", q);
  return redirect(`/app/products?${sp.toString()}`);
};
