// 新老客分类的展示常量（客户端安全，多个页面共用）
// 值：ORDERED(老客·已下单) | NO_ORDER(老客·未下单) | NEW(新客) | null(未分类)
export const CTYPE_LABEL: Record<string, string> = {
  ORDERED: "老客·已下单", NO_ORDER: "老客·未下单", NEW: "新客",
};
export const CTYPE_TONE: Record<string, "success" | "attention" | "info"> = {
  ORDERED: "success", NO_ORDER: "attention", NEW: "info",
};
