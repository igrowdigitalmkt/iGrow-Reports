/** Regras puras da captação de leads por WhatsApp (sem banco): decidem se uma mensagem recebida vira lead. */

export type LeadWaMode = "all" | "ads" | "manual";
export type WaAd = { adId: string | null; title: string | null; sourceUrl: string | null; clickId: string | null };

/** Telefone brasileiro pode vir com ou sem o nono dígito: compara por DDI+DDD e os 8 últimos (igual à função do banco). */
export function phoneKey(digits: string): string {
  const raw = digits.replace(/\D/g, "");
  // Sem o código do país (10 ou 11 dígitos), assume Brasil.
  const only = raw.length === 10 || raw.length === 11 ? `55${raw}` : raw;
  return /^55\d{10,11}$/.test(only) ? only.slice(0, 4) + only.slice(-8) : only;
}

/** Mensagem recebida há mais que isso não é contato novo: é histórico entregue ao reconectar. */
export const RECENT_MS = 30 * 60_000;
/** Mesmo telefone dentro desta janela não vira outro lead. */
export const REENTRY_DAYS = 30;

export type ExistingLead = { phone: string | null; status: string; createdTime: string };

export type CaptureDecision = { create: true } | { create: false; reason: "outgoing" | "group" | "invalid_phone" | "old" | "own_number" | "ignored" | "manual" | "needs_ad" | "already_lead" };

/** Decide pelo conteúdo e pelas regras do cliente. `existing` são os leads do cliente com telefone (qualquer canal). */
export function decideCapture(input: {
  mode: LeadWaMode; message: { remoteId: string; isGroup: boolean; direction: "in" | "out"; sentAt: string };
  now: Date; ownPhone: string | null; ignored: string[]; existing: ExistingLead[]; ad: WaAd | null;
}): CaptureDecision {
  const { message } = input;
  if (message.direction !== "in") return { create: false, reason: "outgoing" };
  if (message.isGroup) return { create: false, reason: "group" };
  const digits = message.remoteId.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15 || digits !== message.remoteId) return { create: false, reason: "invalid_phone" };
  const age = input.now.getTime() - Date.parse(message.sentAt);
  if (!Number.isFinite(age) || age > RECENT_MS || age < -5 * 60_000) return { create: false, reason: "old" };
  const key = phoneKey(digits);
  if (input.ownPhone && phoneKey(input.ownPhone) === key) return { create: false, reason: "own_number" };
  if (input.ignored.some(item => phoneKey(item) === key)) return { create: false, reason: "ignored" };
  if (input.mode === "manual") return { create: false, reason: "manual" };
  if (input.mode === "ads" && !input.ad) return { create: false, reason: "needs_ad" };
  const cutoff = input.now.getTime() - REENTRY_DAYS * 86_400_000;
  const open = new Set(["new", "contacted", "visit"]);
  if (input.existing.some(lead => lead.phone && phoneKey(lead.phone) === key && (Date.parse(lead.createdTime) >= cutoff || open.has(lead.status)))) return { create: false, reason: "already_lead" };
  return { create: true };
}

const KIND_LABEL: Record<string, string> = { image: "[imagem]", video: "[vídeo]", audio: "[áudio]", document: "[documento]", sticker: "[figurinha]", location: "[localização]", contact: "[contato]", template: "[mensagem automática]" };

/** Texto curto da primeira mensagem (até 300 caracteres); mídia sem legenda vira um rótulo. */
export function firstMessageText(message: { kind: string; body: string | null }): string | null {
  const body = message.body?.replace(/\s+/g, " ").trim();
  if (body) return body.slice(0, 300);
  return KIND_LABEL[message.kind] ?? null;
}

type Reply = { sourceId?: unknown; sourceUrl?: unknown; title?: unknown; ctwaClid?: unknown; sourceType?: unknown };
const str = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Dado do anúncio quando o aparelho informa (conversa iniciada por anúncio Click-to-WhatsApp); null se não houver. */
export function adFromEvolution(body: unknown): WaAd | null {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return null;
  const message = data.message as Record<string, unknown> | undefined;
  const contexts: unknown[] = [data.contextInfo];
  for (const value of Object.values(message ?? {})) if (value && typeof value === "object") contexts.push((value as { contextInfo?: unknown }).contextInfo);
  for (const context of contexts) {
    const reply = (context as { externalAdReply?: Reply } | undefined)?.externalAdReply;
    if (!reply || typeof reply !== "object") continue;
    const adId = str(reply.sourceId, 40);
    const isAd = reply.sourceType === "ad" || reply.sourceType === 1 || !!adId || !!str(reply.ctwaClid, 200);
    if (!isAd) continue;
    return { adId: adId && /^[0-9]{5,30}$/.test(adId) ? adId : null, title: str(reply.title, 300), sourceUrl: str(reply.sourceUrl, 500), clickId: str(reply.ctwaClid, 200) };
  }
  return null;
}
