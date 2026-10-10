"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type Ref } from "react";
import { emojiAssetPath } from "./whatsapp-emoji";

export type EmojiInputHandle = { focus: () => void; insertText: (text: string) => void };
type Selection = { start: number; end: number };
type Entry = Selection & { text: string };
const graphemes = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
const emojiPattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;

function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLImageElement) return node.alt;
  if (node instanceof HTMLBRElement) return node.dataset.editorTail ? "" : "\n";
  return Array.from(node.childNodes, plainText).join("");
}
function selectionIn(element: HTMLElement, fallback: Selection): Selection {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return fallback;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return fallback;
  const before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
  return { start: plainText(before.cloneContents()).length, end: plainText(before.cloneContents()).length + plainText(range.cloneContents()).length };
}
function restoreSelection(element: HTMLElement, { start, end }: Selection) {
  function point(offset: number): [Node, number] {
    let remaining = offset;
    for (const child of element.childNodes) {
      const length = plainText(child).length;
      if (child.nodeType === Node.TEXT_NODE && remaining <= length) return [child, remaining];
      if (child instanceof HTMLImageElement && remaining < length) return [element, Array.from(element.childNodes).indexOf(child)];
      remaining -= length;
    }
    return [element, element.childNodes.length - (element.lastChild instanceof HTMLBRElement ? 1 : 0)];
  }
  const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
function paint(element: HTMLElement, text: string) {
  const fragment = document.createDocumentFragment();
  let plain = "";
  const flush = () => { if (plain) fragment.append(document.createTextNode(plain)); plain = ""; };
  for (const { segment } of graphemes.segment(text)) {
    if (!emojiPattern.test(segment)) { plain += segment; continue; }
    flush();
    const image = document.createElement("img");
    image.src = emojiAssetPath(segment); image.alt = segment; image.className = "wai-original-emoji";
    image.width = 22; image.height = 22; image.draggable = false; image.contentEditable = "false"; image.referrerPolicy = "no-referrer";
    fragment.append(image);
  }
  flush();
  // A trailing line needs a layout sentinel; it is excluded from the Unicode payload.
  if (text.endsWith("\n")) { const tail = document.createElement("br"); tail.dataset.editorTail = "true"; fragment.append(tail); }
  element.replaceChildren(fragment);
}

/** Editable original emoji artwork; clipboard, history and outgoing messages stay plain Unicode. */
export function EmojiInput({ value, onChange, onKeyDown, maxLength, label, autoFocus, ref }: {
  value: string; onChange: (value: string) => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  maxLength: number; label: string; autoFocus?: boolean; ref?: Ref<EmojiInputHandle>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const lastSelection = useRef<Selection>({ start: value.length, end: value.length });
  const composing = useRef(false);
  const history = useRef<Entry[]>([{ text: value, start: value.length, end: value.length }]);
  const position = useRef(0);
  function remember() { if (element.current) lastSelection.current = selectionIn(element.current, lastSelection.current); }
  function commit(text: string, selected: Selection, record = true) {
    const editor = element.current; if (!editor) return;
    if (text.length > maxLength) {
      let trimmed = "";
      for (const { segment } of graphemes.segment(text)) { if (trimmed.length + segment.length > maxLength) break; trimmed += segment; }
      text = trimmed;
    }
    selected = { start: Math.min(selected.start, text.length), end: Math.min(selected.end, text.length) };
    if (record && history.current[position.current]?.text !== text) {
      history.current = [...history.current.slice(0, position.current + 1), { text, ...selected }].slice(-100);
      position.current = history.current.length - 1;
    }
    paint(editor, text); lastSelection.current = selected; restoreSelection(editor, selected); onChange(text);
  }
  function insert(text: string) {
    const editor = element.current; if (!editor) return;
    remember();
    const current = plainText(editor), { start, end } = lastSelection.current;
    const available = Math.max(0, maxLength - current.length + end - start);
    let inserted = "";
    for (const { segment } of graphemes.segment(text)) { if (inserted.length + segment.length > available) break; inserted += segment; }
    editor.focus(); commit(current.slice(0, start) + inserted + current.slice(end), { start: start + inserted.length, end: start + inserted.length });
  }
  function undo(redo: boolean) {
    const next = position.current + (redo ? 1 : -1);
    if (next < 0 || next >= history.current.length) return;
    position.current = next; const entry = history.current[next]; commit(entry.text, entry, false);
  }
  useImperativeHandle(ref, () => ({ focus: () => element.current?.focus(), insertText: insert }));
  useLayoutEffect(() => {
    const editor = element.current; if (!editor || composing.current || plainText(editor) === value) return;
    paint(editor, value); lastSelection.current = { start: value.length, end: value.length };
    history.current = [{ text: value, ...lastSelection.current }]; position.current = 0;
    if (document.activeElement === editor) restoreSelection(editor, lastSelection.current);
  }, [value]);
  useLayoutEffect(() => { if (autoFocus) element.current?.focus(); }, [autoFocus]);
  return <div ref={element} className="wai-emoji-input" role="textbox" aria-label={label} aria-multiline="true"
    data-placeholder="Digite uma mensagem" contentEditable suppressContentEditableWarning spellCheck
    onSelect={remember} onBlur={remember}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; const editor = element.current!; commit(plainText(editor), selectionIn(editor, lastSelection.current)); }}
    onInput={() => { if (!composing.current) { const editor = element.current!; commit(plainText(editor), selectionIn(editor, lastSelection.current)); } }}
    onBeforeInput={event => {
      const type = (event.nativeEvent as InputEvent).inputType;
      if (type === "historyUndo" || type === "historyRedo") { event.preventDefault(); undo(type === "historyRedo"); }
      else if (!composing.current && (type === "insertParagraph" || type === "insertLineBreak")) { event.preventDefault(); insert("\n"); }
    }}
    onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n")); }}
    onDrop={event => { event.preventDefault(); insert(event.dataTransfer.getData("text/plain").replace(/\r\n?/g, "\n")); }}
    onCopy={event => { remember(); const { start, end } = lastSelection.current; event.clipboardData.setData("text/plain", plainText(element.current!).slice(start, end)); event.preventDefault(); }}
    onCut={event => { remember(); const { start, end } = lastSelection.current; event.clipboardData.setData("text/plain", plainText(element.current!).slice(start, end)); event.preventDefault(); insert(""); }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) { event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === "y"); return; }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); remember();
        const current = plainText(element.current!), selected = { ...lastSelection.current };
        if (selected.start === selected.end) {
          const units = Array.from(graphemes.segment(current));
          if (event.key === "Backspace") selected.start = units.filter(unit => unit.index < selected.start).at(-1)?.index ?? selected.start;
          else { const next = units.find(unit => unit.index >= selected.end); if (next) selected.end = next.index + next.segment.length; }
        }
        commit(current.slice(0, selected.start) + current.slice(selected.end), { start: selected.start, end: selected.start }); return;
      }
      if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); insert("\n"); return; }
      onKeyDown(event);
    }} />;
}
