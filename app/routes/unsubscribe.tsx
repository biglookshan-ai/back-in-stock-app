// 退订（邮件底部链接：/apps/back-in-stock/unsubscribe?token=...）
import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { verifyUnsubscribe } from "../models/subscription.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const id = verifyUnsubscribe(token);

  const page = (msg: string) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><div style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center">${msg}</div>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (!id) return page("<h3>Invalid or expired link.</h3>");

  await prisma.subscription.updateMany({
    where: { id },
    data: { status: "CANCELLED" },
  });
  return page("<h3>You've been unsubscribed.</h3><p>You won't receive further notifications for this item.</p>");
};
