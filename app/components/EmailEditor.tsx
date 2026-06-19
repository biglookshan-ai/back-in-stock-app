// 邮件编辑器：富文本(所见即所得) / 代码 双模式 + 光标处插入产品卡。
import { useEffect, useRef, useState } from "react";
import { Button, ButtonGroup, InlineStack } from "@shopify/polaris";

export function EmailEditor({
  value,
  onChange,
  onPickProducts,
}: {
  value: string;
  onChange: (html: string) => void;
  // 返回要插入的产品卡 HTML 数组（由父组件用 Resource Picker 选择并生成）
  onPickProducts: () => Promise<string[]>;
}) {
  const [mode, setMode] = useState<"rich" | "code">("rich");
  const richRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const internal = useRef(false); // 标记本次 value 变化来自编辑器内部，避免重置光标

  // 外部 value 变化（选模板/切模式/代码模式插入）时灌入富文本；内部输入则跳过
  useEffect(() => {
    if (mode !== "rich" || !richRef.current) return;
    if (internal.current) { internal.current = false; return; }
    if (richRef.current.innerHTML !== value) richRef.current.innerHTML = value;
  }, [mode, value]);

  const emitRich = () => {
    internal.current = true;
    if (richRef.current) onChange(richRef.current.innerHTML);
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
    if (cards.length) insertHtml(cards.join(""));
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
          <Button onClick={pickAndInsert} variant="primary">插入产品卡</Button>
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
      `}</style>
      {mode === "rich" ? (
        <div
          ref={richRef}
          className="bis-rich"
          contentEditable
          onInput={emitRich}
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
