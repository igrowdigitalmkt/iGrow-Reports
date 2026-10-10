"use client";

import { useState, type ReactNode } from "react";
import assets from "./emoji-assets.json";

const manifest: Record<string, string> = assets;
const segments = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
const isEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
export function emojiAssetPath(emoji: string) {
  if (manifest[emoji]) return "/whatsapp-emojis/" + manifest[emoji];
  const code = Array.from(emoji, char => char.codePointAt(0)!.toString(16).padStart(6, "0")).join("_");
  return `https://web.whatsapp.com/emoji/v1/16/0/2/single/w/64/${code}.png`;
}

/** Keep Unicode as the message/reaction payload; only the visible glyph uses WhatsApp artwork. */
export function WhatsAppEmoji({ emoji }: { emoji: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span>{emoji}</span> : /* eslint-disable-next-line @next/next/no-img-element -- original fixed-size emoji glyph, no optimizer needed */
    <img className="wai-original-emoji" src={emojiAssetPath(emoji)} alt={emoji} width={32} height={32}
      loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />;
}

export function WhatsAppEmojiText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let plain = "";
  for (const { segment, index } of segments.segment(text)) {
    if (!isEmoji.test(segment)) { plain += segment; continue; }
    if (plain) { nodes.push(plain); plain = ""; }
    nodes.push(<WhatsAppEmoji key={index} emoji={segment} />);
  }
  if (plain) nodes.push(plain);
  return <>{nodes}</>;
}
