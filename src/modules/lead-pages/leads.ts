import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Páginas de acompanhamento de leads (formulário instantâneo da Meta / Lead Ads).
 * Aqui ficam só as regras puras: ler o aviso da Meta, normalizar os campos do formulário e conferir o código de acesso.
 */

export type LeadgenEvent = { leadgenId: string; pageId: string; formId: string | null; adId: string | null; adsetId: string | null; createdTime: string | null };

/** Lê o aviso `leadgen` do webhook da Meta (objeto "page"). Ignora qualquer outro campo ou formato inesperado. */
export function parseLeadgenEvents(payload: unknown): LeadgenEvent[] {
  if (!payload || typeof payload !== "object" || (payload as { object?: unknown }).object !== "page") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const events: LeadgenEvent[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if ((change as { field?: unknown })?.field !== "leadgen") continue;
      const value = (change as { value?: Record<string, unknown> }).value;
      const leadgenId = text(value?.leadgen_id);
      const pageId = text(value?.page_id) ?? text((entry as { id?: unknown }).id);
      if (!leadgenId || !pageId) continue;
      const created = Number(value?.created_time);
      events.push({
        leadgenId, pageId, formId: text(value?.form_id), adId: text(value?.ad_id), adsetId: text(value?.adgroup_id),
        createdTime: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
      });
    }
  }
  return events;
}

const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;

export type LeadFields = { name: string | null; phone: string | null; email: string | null };

/** Campos do formulário (`field_data`) → nome, WhatsApp e e-mail. Os demais campos ficam guardados na íntegra em `field_data`. */
export function parseLeadFields(fieldData: unknown): LeadFields {
  const values = new Map<string, string>();
  if (Array.isArray(fieldData)) {
    for (const item of fieldData) {
      const name = text((item as { name?: unknown })?.name)?.toLowerCase();
      const first = Array.isArray((item as { values?: unknown })?.values) ? text(((item as { values: unknown[] }).values)[0]) : null;
      if (name && first) values.set(name, first);
    }
  }
  const pick = (...keys: string[]) => keys.map(key => values.get(key)).find(Boolean) ?? null;
  const fullName = pick("full_name", "nome_completo", "nome", "name");
  const joined = [pick("first_name", "primeiro_nome"), pick("last_name", "sobrenome")].filter(Boolean).join(" ");
  return { name: fullName ?? (joined || null), phone: normalizePhone(pick("phone_number", "phone", "telefone", "whatsapp", "celular")), email: pick("email", "e-mail", "e_mail")?.toLowerCase() ?? null };
}

/** "p:+5586999999999" → "+5586999999999"; mantém só dígitos e o "+" inicial. Vazio vira null. */
export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/^p:/i, "").replace(/[^\d+]/g, "");
  const cleaned = digits.startsWith("+") ? `+${digits.slice(1).replace(/\+/g, "")}` : digits.replace(/\+/g, "");
  return cleaned.replace(/\D/g, "").length >= 8 ? cleaned : null;
}

// --- Código de acesso da página de acompanhamento (link privado) ---------------------------------------------------------------

export const generateAccessCode = () => randomBytes(18).toString("base64url");
export const hashAccessCode = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");
/** Compara o código recebido com o hash guardado, em tempo constante. Hash ou código ausente nunca confere. */
export function accessCodeMatches(code: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!code || !storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const received = Buffer.from(hashAccessCode(code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// --- Leitura do lead na Graph API -----------------------------------------------------------------------------------------------

export type FetchedLead = { leadgenId: string; formId: string | null; adId: string | null; adsetId: string | null; campaignId: string | null; createdTime: string | null; fieldData: unknown[] };

/** Busca os dados de um lead. Lança erro quando a Meta recusa ou não responde: o webhook devolve 503 e a Meta tenta de novo depois. */
export async function fetchLead(input: { leadgenId: string; token: string; apiVersion: string; appSecret?: string; fetchImpl?: typeof fetch }): Promise<FetchedLead> {
  const proof = input.appSecret ? `&appsecret_proof=${createHmac("sha256", input.appSecret).update(input.token).digest("hex")}` : "";
  const url = `https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(input.leadgenId)}?fields=id,created_time,ad_id,adset_id,campaign_id,form_id,field_data${proof}`;
  const response = await (input.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${input.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body || body.error) throw new Error(`Graph ${response.status}`);
  return {
    leadgenId: text(body.id) ?? input.leadgenId, formId: text(body.form_id), adId: text(body.ad_id), adsetId: text(body.adset_id), campaignId: text(body.campaign_id),
    createdTime: text(body.created_time) ? new Date(String(body.created_time)).toISOString() : null, fieldData: Array.isArray(body.field_data) ? body.field_data : [],
  };
}

export type LeadPage = { id: string; slug: string; title: string; fbPageId: string; formId: string | null };

/**
 * Processa os avisos já validados: para cada lead novo, descobre a(s) página(s) de acompanhamento, busca os dados e grava. `save` deve ser
 * idempotente (a Meta pode repetir o aviso). Devolve `retry: true` quando algo falhou de forma que valha tentar de novo.
 */
export async function processLeadgenEvents(events: LeadgenEvent[], deps: {
  findPages: (pageId: string, formId: string | null) => Promise<LeadPage[]>;
  fetchLead: (leadgenId: string) => Promise<FetchedLead>;
  save: (page: LeadPage, lead: FetchedLead, fields: LeadFields) => Promise<void>;
}): Promise<{ saved: number; ignored: number; retry: boolean }> {
  let saved = 0, ignored = 0, retry = false;
  for (const event of events) {
    try {
      const pages = await deps.findPages(event.pageId, event.formId);
      if (!pages.length) { ignored += 1; continue; }
      const lead = await deps.fetchLead(event.leadgenId);
      const fields = parseLeadFields(lead.fieldData);
      for (const page of pages) { await deps.save(page, { ...lead, formId: lead.formId ?? event.formId, adId: lead.adId ?? event.adId, adsetId: lead.adsetId ?? event.adsetId, createdTime: lead.createdTime ?? event.createdTime }, fields); saved += 1; }
    } catch { retry = true; }
  }
  return { saved, ignored, retry };
}
