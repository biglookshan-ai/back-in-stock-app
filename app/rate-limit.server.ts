// 极简内存滑动窗口限流（Railway 常驻进程，单实例足够）。
// 防止 storefront 订阅接口被脚本批量灌库 / 邮件轰炸。
const hits = new Map<string, number[]>();
let lastPrune = 0;

// 返回 true=放行，false=超限。key 维度自定（IP / 邮箱）。
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  // 周期性清理过期 key，避免 Map 无限增长（最多每分钟一次）
  if (now - lastPrune > 60_000) {
    lastPrune = now;
    for (const [k, arr] of hits) {
      const live = arr.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
  }

  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

// 从请求头尽力取客户端 IP（App Proxy 会带 x-forwarded-for）。
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
