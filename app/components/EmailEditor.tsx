// 邮件编辑器：富文本(所见即所得) / 代码 双模式。
// 插入的产品卡在富文本里显示成「紧凑小卡片(带✕删除)」，真实卡片 HTML 存在
// data-bis-card 包裹里，导出/发送时自动展开成完整邮件 HTML。
import { useEffect, useRef, useState } from "react";
import { Button, ButtonGroup, InlineStack } from "@shopify/polaris";

export type PickedCard = { html: string; label: string; thumb?: string };

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 卡片在「值」里的存储形态：一个带 data-bis-card 的 div 包裹真实卡片 HTML。
// 这个 div 在最终邮件里是透明包裹，不影响渲染。
function cardWrapper(realHtml: string, label: string, thumb?: string) {
  return `<div data-bis-card data-label="${escapeAttr(label)}"${thumb ? ` data-thumb="${escapeAttr(thumb)}"` : ""}>${realHtml}</div>`;
}

// 把编辑器 DOM 里的 [data-bis-card] 变成紧凑小卡片(只用于显示，真实 HTML 仍保留)
function hydrate(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-bis-card]").forEach((el) => {
    if (el.dataset.hydrated) return;
    const real = el.innerHTML; // 真实卡片 HTML
    const label = el.getAttribute("data-label") || "产品卡";
    const thumb = el.getAttribute("data-thumb") || "";
    el.dataset.hydrated = "1";
    el.contentEditable = "false";
    el.classList.add("bis-card");
    el.innerHTML =
      `<span class="bis-card-real" style="display:none"></span>` +
      `<span class="bis-card-chip">` +
      (thumb
        ? `<span class="bis-card-thumb" style="background-image:url('${escapeAttr(thumb)}')"></span>`
        : `<span class="bis-card-thumb bis-card-thumb-empty">🖼</span>`) +
      `<span class="bis-card-label"></span>` +
      `<button type="button" class="bis-card-x" title="移除此产品">✕</button>` +
      `</span>`;
    (el.querySelector(".bis-card-real") as HTMLElement).innerHTML = real;
    (el.querySelector(".bis-card-label") as HTMLElement).textContent = label;
  });
}

// 从编辑器 DOM 还原出「干净值」：小卡片 → data-bis-card 包裹的真实卡片 HTML
function serialize(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>(".bis-card").forEach((el) => {
    const realHtml = (el.querySelector(".bis-card-real") as HTMLElement | null)?.innerHTML ?? "";
    const label = el.getAttribute("data-label") || "";
    const thumb = el.getAttribute("data-thumb") || "";
    const repl = document.createElement("div");
    repl.setAttribute("data-bis-card", "");
    if (label) repl.setAttribute("data-label", label);
    if (thumb) repl.setAttribute("data-thumb", thumb);
    repl.innerHTML = realHtml;
    el.replaceWith(repl);
  });
  return clone.innerHTML;
}

export function EmailEditor({
  value,
  onChange,
  onPickProducts,
  customerCard,
}: {
  value: string;
  onChange: (html: string) => void;
  // 选产品 → 返回要插入的卡片（含展示用 label/thumb）
  onPickProducts: () => Promise<PickedCard[]>;
  // 若提供：显示「插入客人产品卡」按钮（这张卡每位收件人各自渲染自己的产品）
  customerCard?: { html: string; label: string };
}) {
  const [mode, setMode] = useState<"rich" | "code">("rich");
  const richRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const internal = useRef(false); // 标记本次 value 变化来自编辑器内部，避免重置光标

  // 外部 value 变化（选模板/切模式）时灌入富文本并重建小卡片；内部输入则跳过
  useEffect(() => {
    if (mode !== "rich" || !richRef.current) return;
    if (internal.current) { internal.current = false; return; }
    if (serialize(richRef.current) !== value) {
      richRef.current.innerHTML = value;
      hydrate(richRef.current);
    }
  }, [mode, value]);

  const emitRich = () => {
    internal.current = true;
    if (richRef.current) onChange(serialize(richRef.current));
  };
  const exec = (cmd: string, arg?: string) => {
    richRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitRich();
  };
  const link = () => {
    const url = window.prompt("链接 URL:", "https://");
    if (url) exec("createLink", url);
  };

  const insertHtml = (html: string) => {
    if (mode === "rich") {
      richRef.current?.focus();
      document.execCommand("insertHTML", false, html);
      if (richRef.current) hydrate(richRef.current);
      emitRich();
    } else {
      const ta = codeRef.current;
      if (!ta) { onChange(value + html); return; }
      const s = ta.selectionStart ?? value.length;
      const e = ta.selectionEnd ?? value.length;
      onChange(value.slice(0, s) + html + value.slice(e));
    }
  };

  const pickAndInsert = async () => {
    const cards = await onPickProducts();
    if (cards.length) insertHtml(cards.map((c) => cardWrapper(c.html, c.label, c.thumb)).join(""));
  };

  // 点击小卡片右上角 ✕ → 删除该卡片
  const onRichClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest?.(".bis-card-x")) {
      e.preventDefault();
      t.closest(".bis-card")?.remove();
      emitRich();
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <InlineStack gap="200" blockAlign="center" wrap>
          <ButtonGroup variant="segmented">
            <Button pressed={mode === "rich"} onClick={() => setMode("rich")}>富文本</Button>
            <Button pressed={mode === "code"} onClick={() => setMode("code")}>代码</Button>
          </ButtonGroup>
          {mode === "rich" && (
            <ButtonGroup>
              <Button onClick={() => exec("bold")}>粗体</Button>
              <Button onClick={() => exec("italic")}>斜体</Button>
              <Button onClick={() => exec("underline")}>下划线</Button>
              <Button onClick={() => exec("formatBlock", "H2")}>标题</Button>
              <Button onClick={() => exec("insertUnorderedList")}>列表</Button>
              <Button onClick={link}>链接</Button>
            </ButtonGroup>
          )}
          {customerCard && (
            <Button onClick={() => insertHtml(cardWrapper(customerCard.html, customerCard.label))}>
              插入客人产品卡
            </Button>
          )}
          <Button onClick={pickAndInsert} variant="primary">插入推荐产品卡</Button>
        </InlineStack>
      </div>

      <style>{`
        .bis-rich h1{font-size:26px;font-weight:700;margin:14px 0}
        .bis-rich h2{font-size:21px;font-weight:700;margin:12px 0}
        .bis-rich h3{font-size:17px;font-weight:700;margin:10px 0}
        .bis-rich b,.bis-rich strong{font-weight:700}
        .bis-rich i,.bis-rich em{font-style:italic}
        .bis-rich u{text-decoration:underline}
        .bis-rich a{color:#2c6ecb;text-decoration:underline}
        .bis-rich ul{padding-left:22px;margin:8px 0;list-style:disc}
        .bis-rich p{margin:8px 0}
        .bis-rich img{max-width:100%}
        .bis-card{display:block;margin:8px 0}
        .bis-card-chip{display:inline-flex;align-items:center;gap:10px;border:1px solid #c9cccf;border-radius:10px;padding:6px 8px 6px 6px;background:#f6f6f7;max-width:100%;box-shadow:0 1px 1px rgba(0,0,0,.04)}
        .bis-card-thumb{width:36px;height:36px;border-radius:6px;background-size:cover;background-position:center;background-color:#1a1a1a;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font-size:16px}
        .bis-card-label{font-size:13px;color:#202223;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bis-card-x{border:none;background:#e3e3e3;color:#5c5f62;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;flex:0 0 auto;padding:0}
        .bis-card-x:hover{background:#d4d4d4;color:#1a1a1a}
      `}</style>
      {mode === "rich" ? (
        <div
          ref={richRef}
          className="bis-rich"
          contentEditable
          onInput={emitRich}
          onClick={onRichClick}
          suppressContentEditableWarning
          style={{
            minHeight: 220, maxHeight: 360, overflow: "auto",
            border: "1px solid #c9cccf", borderRadius: 8, padding: "12px 14px",
            fontFamily: "Arial, sans-serif", fontSize: 14, lineHeight: 1.5, background: "#fff",
          }}
        />
      ) : (
        <textarea
          ref={codeRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%", minHeight: 220, boxSizing: "border-box",
            border: "1px solid #c9cccf", borderRadius: 8, padding: "12px 14px",
            fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.5,
          }}
        />
      )}
    </div>
  );
}
