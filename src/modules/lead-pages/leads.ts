import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { requestWithProof } from "./graph-proof";

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

/** Pares (chave, primeiro valor) do `field_data`, preservando a ordem do formulário. */
function entriesOf(fieldData: unknown): { key: string; label: string; value: string }[] {
  if (!Array.isArray(fieldData)) return [];
  return fieldData.flatMap(item => {
    const label = text((item as { name?: unknown })?.name);
    const first = Array.isArray((item as { values?: unknown })?.values) ? text(((item as { values: unknown[] }).values)[0]) : null;
    return label && first ? [{ key: label.toLowerCase(), label, value: first }] : [];
  });
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PHONE_KEY = /(whats|telefone|celular|fone|phone|contato)/i;

/**
 * Campos do formulário (`field_data`) → nome, WhatsApp e e-mail. Primeiro os campos padrão da Meta (full_name, phone_number, email); se o
 * formulário usa perguntas próprias, reconhece pelo conteúdo (e-mail pelo formato; telefone por uma pergunta de contato com número válido;
 * nome por uma pergunta com "nome"). As demais respostas aparecem em `leadAnswers`.
 */
export function parseLeadFields(fieldData: unknown): LeadFields { return splitLeadFields(fieldData).fields; }

export function splitLeadFields(fieldData: unknown): { fields: LeadFields; answers: { question: string; answer: string }[] } {
  const entries = entriesOf(fieldData);
  const values = new Map(entries.map(entry => [entry.key, entry.value]));
  const used = new Set<string>();
  const pick = (...keys: string[]) => { const key = keys.find(candidate => values.get(candidate)); if (key) used.add(key); return key ? values.get(key)! : null; };
  const fullName = pick("full_name", "nome_completo", "nome", "name");
  const joined = [pick("first_name", "primeiro_nome"), pick("last_name", "sobrenome")].filter(Boolean).join(" ");
  let name = fullName ?? (joined || null);
  let phone = normalizePhone(pick("phone_number", "phone", "telefone", "whatsapp", "celular"));
  let email = pick("email", "e-mail", "e_mail")?.toLowerCase() ?? null;

  const spare = entries.filter(entry => !used.has(entry.key));
  if (!email) { const found = spare.find(entry => EMAIL.test(entry.value)); if (found) { email = found.value.toLowerCase(); used.add(found.key); } }
  if (!phone) { const found = spare.find(entry => PHONE_KEY.test(entry.key) && normalizePhone(entry.value)); if (found) { phone = normalizePhone(found.value); used.add(found.key); } }
  if (!name) { const found = spare.find(entry => /(^|[^a-z])(nome|name)([^a-z]|$)/i.test(entry.key) && !EMAIL.test(entry.value) && !normalizePhone(entry.value)); if (found) { name = found.value; used.add(found.key); } }

  const answers = entries.filter(entry => !used.has(entry.key)).map(entry => ({ question: prettyQuestion(entry.label), answer: prettyAnswer(entry.value).slice(0, 300) }));
  return { fields: { name, phone, email }, answers };
}

/** Opção guardada pela Meta em formato de código ("construir_para_morar") → "Construir para morar". Texto digitado pela pessoa nunca é alterado. */
export function prettyAnswer(value: string): string {
  if (!/^[\p{L}\p{N}_-]+$/u.test(value) || !value.includes("_")) return value;
  const spaced = value.replace(/_+/g, " ").trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value;
}

/** "você_tem_interesse_em_visitar?" → "Você tem interesse em visitar?" */
export function prettyQuestion(label: string): string {
  const spaced = label.replace(/_+/g, " ").trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : label;
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

export type FetchedLead = {
  leadgenId: string; formId: string | null; adId: string | null; adsetId: string | null; campaignId: string | null; createdTime: string | null; fieldData: unknown[];
  /** Origem do anúncio (nomes e plataforma), quando a Meta informa. */
  adName: string | null; adsetName: string | null; campaignName: string | null; platform: string | null; isOrganic: boolean | null;
};

/** Busca os dados de um lead. Lança erro quando a Meta recusa ou não responde: o webhook devolve 503 e a Meta tenta de novo depois. */
export async function fetchLead(input: { leadgenId: string; token: string; apiVersion: string; appSecrets?: string[]; fetchImpl?: typeof fetch }): Promise<FetchedLead> {
  const response = await requestWithProof(input.appSecrets ?? [], input.token, proof => (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(input.leadgenId)}?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data${proof ? `&${proof}` : ""}`,
    { headers: { Authorization: `Bearer ${input.token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) }));
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  // Só o código do erro (nunca o token nem dados do lead): suficiente para diagnosticar permissão, token vencido ou limite de uso.
  if (!response.ok || !body || body.error) { const error = body?.error as { code?: unknown; error_subcode?: unknown } | undefined; throw new Error(`Graph ${response.status} código=${String(error?.code ?? "-")} subcódigo=${String(error?.error_subcode ?? "-")}`); }
  return toFetchedLead(body, input.leadgenId);
}

/** Lead no formato da Graph API (`/{lead}` ou item de `/{formulário}/leads`) → formato interno. */
export function toFetchedLead(body: Record<string, unknown>, fallbackId: string): FetchedLead {
  return {
    leadgenId: text(body.id) ?? fallbackId, formId: text(body.form_id), adId: text(body.ad_id), adsetId: text(body.adset_id), campaignId: text(body.campaign_id),
    createdTime: text(body.created_time) ? new Date(String(body.created_time)).toISOString() : null, fieldData: Array.isArray(body.field_data) ? body.field_data : [],
    adName: text(body.ad_name)?.slice(0, 300) ?? null, adsetName: text(body.adset_name)?.slice(0, 300) ?? null, campaignName: text(body.campaign_name)?.slice(0, 300) ?? null,
    platform: text(body.platform)?.slice(0, 30) ?? null, isOrganic: typeof body.is_organic === "boolean" ? body.is_organic : null,
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
  save: (page: LeadPage, lead: FetchedLead, fields: LeadFields) => Promise<unknown>;
}): Promise<{ saved: number; ignored: number; retry: boolean }> {
  let saved = 0, ignored = 0, retry = false;
  for (const event of events) {
    try {
      const pages = await deps.findPages(event.pageId, event.formId);
      if (!pages.length) { ignored += 1; continue; }
      const lead = await deps.fetchLead(event.leadgenId);
      const fields = parseLeadFields(lead.fieldData);
      for (const page of pages) { await deps.save(page, { ...lead, formId: lead.formId ?? event.formId, adId: lead.adId ?? event.adId, adsetId: lead.adsetId ?? event.adsetId, createdTime: lead.createdTime ?? event.createdTime }, fields); saved += 1; }
    } catch (error) { retry = true; console.error("leadgen: falha ao processar aviso", event.leadgenId, error instanceof Error ? error.message : "erro"); }
  }
  return { saved, ignored, retry };
}
