import { Fragment, type ReactNode } from "react";

// WhatsApp text formatting: *bold*, _italic_, ~strikethrough~, `code`, ```monospace``` and links.
// A marker only counts at a word boundary, as in WhatsApp ("2*3*4" stays as it is).
const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const BOUNDARY = /[\s.,;:!?()[\]{}"'«»…-]/;

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index;
    const before = start > 0 ? text[start - 1] : " ";
    const after = start + token.length < text.length ? text[start + token.length] : " ";
    const isLink = token.startsWith("http");
    const inner = token.slice(1, -1);
    // Markers need a boundary on both sides and text that does not start or end with a space.
    if (!isLink && (!BOUNDARY.test(before) || !BOUNDARY.test(after) || /^\s|\s$/.test(inner))) continue;
    if (start > last) nodes.push(text.slice(last, start));
    const id = `${key}-${start}`;
    if (isLink) nodes.push(<a key={id} href={token} target="_blank" rel="noopener noreferrer nofollow">{token}</a>);
    else if (token[0] === "*") nodes.push(<strong key={id}>{inline(inner, id)}</strong>);
    else if (token[0] === "_") nodes.push(<em key={id}>{inline(inner, id)}</em>);
    else if (token[0] === "~") nodes.push(<s key={id}>{inline(inner, id)}</s>);
    else nodes.push(<code key={id}>{inner}</code>);
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Message text with WhatsApp's formatting applied; line breaks are kept by the bubble's CSS. */
export function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]+?```)/g);
  return <>{parts.map((part, index) => part.startsWith("```") && part.endsWith("```") && part.length > 6
    ? <code key={index} className="wai-mono">{part.slice(3, -3)}</code>
    : <Fragment key={index}>{inline(part, String(index))}</Fragment>)}</>;
}
