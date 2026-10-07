// Labels of the WhatsApp screen, written the way WhatsApp Desktop shows them.

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const DAY = 86_400_000;

function localDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }
const pad = (value: number) => String(value).padStart(2, "0");
const shortDate = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
export const clockTime = (iso: string) => { const date = new Date(iso); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };

/** Conversation list: time today, "Ontem", weekday within a week, date before that. */
export function listTime(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const date = new Date(iso);
  const days = Math.round((localDay(now) - localDay(date)) / DAY);
  if (days <= 0) return clockTime(iso);
  if (days === 1) return "Ontem";
  if (days < 7) return WEEKDAYS[date.getDay()];
  return shortDate(date);
}

/** Separator between days inside a conversation. */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((localDay(now) - localDay(date)) / DAY);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) { const name = WEEKDAYS[date.getDay()]; return name[0].toUpperCase() + name.slice(1); }
  return shortDate(date);
}
export const dayKey = (iso: string) => localDay(new Date(iso));

/** +55 86 99556-0428 (Brazil) or +<digits>; groups and unknown ids are returned as they are. */
export function formatWhatsAppPhone(remoteId: string) {
  if (!/^\d{8,15}$/.test(remoteId)) return remoteId;
  const br = remoteId.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${remoteId}`;
}

export function conversationTitle(conversation: { title: string | null; remoteId: string; isGroup: boolean }) {
  return conversation.title || (conversation.isGroup ? "Grupo" : formatWhatsAppPhone(conversation.remoteId));
}

const KIND_LABELS: Record<string, string> = {
  image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", location: "Localização",
  contact: "Contato", reaction: "Reação", template: "Mensagem modelo", other: "Mensagem",
};
export const kindLabel = (kind: string | null) => (kind && KIND_LABELS[kind]) || "";

export function initialsOf(value: string) {
  const words = value.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "#";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

// Stable avatar and author colors, chosen from a palette that reads on dark and light themes.
const PALETTE = ["#06cf9c", "#53bdeb", "#ff7eb6", "#ffd279", "#a791ff", "#ff8a65", "#25d366", "#7ccdf2", "#e26d9b", "#c4a5ff"];
export function colorFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Same key as the database: Brazilian mobiles compare by DDD + last 8 digits (with or without the 9). */
export function phoneKey(digits: string) {
  const clean = digits.replace(/\D/g, "");
  return /^55\d{10,11}$/.test(clean) ? clean.slice(0, 4) + clean.slice(-8) : clean;
}
