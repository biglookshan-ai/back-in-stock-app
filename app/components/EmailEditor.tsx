// 邮件编辑器：富文本(所见即所得) / 代码 双模式。
// - 插入的产品卡在富文本里显示成「紧凑小卡片(带✕删除)」，真实卡片 HTML 存在
//   data-bis-card 包裹里，导出/发送时自动展开成完整邮件 HTML。
// - 卡片前后自动补可编辑空行，并把光标移到卡片下一行，保证随处可插字。
// - 「插入变量」下拉：客人/产品相关变量一键插入；选区保存/恢复，精准落点。
import { useEffect, useRef, useState } from "react";
import { Button, ButtonGroup, InlineStack, Popover, ActionList } from "@shopify/polaris";
import { useT } from "../i18n";

export type PickedCard = { html: string; label: string; thumb?: string };

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 卡片在「值」里的存储形态：一个带 data-bis-card 的 div 包裹真实卡片 HTML。
function cardWrapper(realHtml: string, label: string, thumb?: string) {
  return `<div data-bis-card data-label="${escapeAttr(label)}"${thumb ? ` data-thumb="${escapeAttr(thumb)}"` : ""}>${realHtml}</div>`;
}

const isCardNode = (n: Node | null) =>
  !!n && n.nodeType === 1 && (n as HTMLElement).classList?.contains("bis-card");

function makeLine() {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}

// 在每张小卡片前后补一个可编辑空行：保证卡片相邻 / 在首尾时光标仍能落脚
function padCards(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".bis-card").forEach((card) => {
    if (!card.parentNode) return;
    if (!card.previousSibling || isCardNode(card.previousSibling)) {
      card.parentNode.insertBefore(makeLine(), card);
    }
    if (!card.nextSibling || isCardNode(card.nextSibling)) {
      card.parentNode.insertBefore(makeLine(), card.nextSibling);
    }
  });
}

// 把编辑器 DOM 里的 [data-bis-card] 变成紧凑小卡片(只用于显示，真实 HTML 仍保留)
function hydrate(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-bis-card]").forEach((el) => {
    if (el.dataset.hydrated) return;
    const real = el.innerHTML;
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
      `<button type="button" class="bis-card-x" title="Remove">✕</button>` +
      `</span>`;
    (el.querySelector(".bis-card-real") as HTMLElement).innerHTML = real;
    (el.querySelector(".bis-card-label") as HTMLElement).textContent = label;
  });
  padCards(root);
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

// 可插入的变量（客人 / 产品 / 其他）
const VAR_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "客人相关", items: [["客人名称", "{{customer_name}}"], ["客人邮箱", "{{customer_email}}"]] },
  {
    title: "产品相关",
    items: [
      ["产品名称", "{{product_title}}"],
      ["变体", "{{variant_title}}"],
      ["价格", "{{product_price}}"],
      ["产品链接", "{{product_url}}"],
      ["产品图片", "{{product_image}}"],
    ],
  },
  { title: "其他", items: [["店铺名称", "{{shop_name}}"], ["退订链接", "{{unsubscribe_url}}"]] },
];

export function EmailEditor({
  value,
  onChange,
  onPickProducts,
  customerCard,
}: {
  value: string;
  onChange: (html: string) => void;
  onPickProducts: () => Promise<PickedCard[]>;
  customerCard?: { html: string; label: string };
}) {
  const t = useT();
  const [mode, setMode] = useState<"rich" | "code">("rich");
  const [varOpen, setVarOpen] = useState(false);
  const richRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const internal = useRef(false); // 标记 value 变化来自内部，避免重置光标
  const savedRange = useRef<Range | null>(null); // 富文本失焦前的选区

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

  // 选区保存/恢复：点击 Polaris 工具按钮会让富文本失焦，需记住光标位置
  const saveSel = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && richRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSel = () => {
    const root = richRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (savedRange.current && root.contains(savedRange.current.commonAncestorContainer)) {
      sel.addRange(savedRange.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      sel.addRange(r);
    }
  };

  const exec = (cmd: string, arg?: string) => {
    restoreSel();
    document.execCommand(cmd, false, arg);
    saveSel();
    emitRich();
  };
  const link = () => {
    const url = window.prompt(t("链接 URL:"), "https://");
    if (url) exec("createLink", url);
  };

  // 插入纯文本（变量）到光标处
  const insertInline = (text: string) => {
    if (mode === "rich") {
      restoreSel();
      document.execCommand("insertText", false, text);
      saveSel();
      emitRich();
    } else {
      const ta = codeRef.current;
      if (!ta) { onChange(value + text); return; }
      const s = ta.selectionStart ?? value.length;
      const e = ta.selectionEnd ?? value.length;
      onChange(value.slice(0, s) + text + value.slice(e));
    }
  };

  // 插入产品卡（块级）：在光标处放入卡片，并在其后补一行、光标移过去
  const insertCards = (html: string) => {
    if (mode === "rich") {
      const root = richRef.current;
      if (!root) return;
      restoreSel();
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : document.createRange();
      range.deleteContents();
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      const trailing = makeLine();
      frag.appendChild(trailing);
      range.insertNode(frag);
      hydrate(root);
      // 光标落到卡片后的空行
      const after = document.createRange();
      after.setStart(trailing, 0);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
      saveSel();
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
    if (cards.length) insertCards(cards.map((c) => cardWrapper(c.html, c.label, c.thumb)).join(""));
  };

  const onRichClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest?.(".bis-card-x")) {
      e.preventDefault();
      target.closest(".bis-card")?.remove();
      emitRich();
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <InlineStack gap="200" blockAlign="center" wrap>
          <ButtonGroup variant="segmented">
            <Button pressed={mode === "rich"} onClick={() => setMode("rich")}>{t("富文本")}</Button>
            <Button pressed={mode === "code"} onClick={() => setMode("code")}>{t("代码")}</Button>
          </ButtonGroup>
          {mode === "rich" && (
            <ButtonGroup>
              <Button onClick={() => exec("bold")}>{t("粗体")}</Button>
              <Button onClick={() => exec("italic")}>{t("斜体")}</Button>
              <Button onClick={() => exec("underline")}>{t("下划线")}</Button>
              <Button onClick={() => exec("formatBlock", "H2")}>{t("标题")}</Button>
              <Button onClick={() => exec("insertUnorderedList")}>{t("列表")}</Button>
              <Button onClick={link}>{t("插入链接")}</Button>
            </ButtonGroup>
          )}
          <Popover
            active={varOpen}
            onClose={() => setVarOpen(false)}
            activator={
              <Button disclosure onClick={() => setVarOpen((v) => !v)}>{t("插入变量")}</Button>
            }
          >
            <ActionList
              sections={VAR_GROUPS.map((g) => ({
                title: t(g.title),
                items: g.items.map(([label, token]) => ({
                  content: t(label),
                  helpText: token,
                  onAction: () => { insertInline(token); setVarOpen(false); },
                })),
              }))}
            />
          </Popover>
          {customerCard && (
            <Button onClick={() => insertCards(cardWrapper(customerCard.html, customerCard.label))}>
              {t("插入客人产品卡")}
            </Button>
          )}
          <Button onClick={pickAndInsert} variant="primary">{t("插入推荐产品卡")}</Button>
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
          onKeyUp={saveSel}
          onMouseUp={saveSel}
          onBlur={saveSel}
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
