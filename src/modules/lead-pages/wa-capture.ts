import "server-only";

import { randomBytes } from "node:crypto";
import { generateAccessCode, hashAccessCode } from "./leads";
import type { Service } from "./hub-query";
import { adFromEvolution, decideCapture, firstMessageText, type CaptureDecision, type LeadWaMode } from "./wa-rules";
import { parseEvolutionMessage } from "@/modules/whatsapp/inbox-parse";
import { getMetaApiConfig } from "@/lib/env";
import { graphCall } from "./graph-call";
import { appSecretsFromEnv } from "./graph-proof";
import { leadsTokenCandidates } from "./leads-tokens";

/** Fonte (lead_pages) da sessão de WhatsApp: criada na primeira captação; uma por sessão. */
async function waSourceId(service: Service, session: { id: string; agency_id: string; client_id: string }): Promise<string | null> {
  const found = await service.from("lead_pages").select("id").eq("wa_session_id", session.id).maybeSingle();
  if (found.data) return found.data.id;
  const created = await service.from("lead_pages").insert({
    agency_id: session.agency_id, client_id: session.client_id, kind: "whatsapp", wa_session_id: session.id, fb_page_id: null,
    slug: `whatsapp-${randomBytes(6).toString("hex")}`, title: "WhatsApp", access_hash: hashAccessCode(generateAccessCode()),
  }).select("id").single();
  if (created.data) return created.data.id;
  // Outra entrega criou ao mesmo tempo: usa a que ficou.
  const again = await service.from("lead_pages").select("id").eq("wa_session_id", session.id).maybeSingle();
  return again.data?.id ?? null;
}

export type CaptureResult = { created: string | null; adId?: string | null; reason?: Extract<CaptureDecision, { create: false }>["reason"] | "no_message" | "error" };

/** Recebe o corpo do aviso do Evolution de uma sessão de captação e cria o lead quando as regras do cliente permitem. */
export async function captureWhatsAppLead(service: Service, session: { id: string; agency_id: string; client_id: string; qualify_mode: LeadWaMode; ignored_numbers: string[]; connected_phone: string | null }, body: unknown, now = new Date()): Promise<CaptureResult> {
  const message = parseEvolutionMessage(body, now);
  if (!message) return { created: null, reason: "no_message" };
  const ad = adFromEvolution(body);
  // Leads do cliente com telefone (qualquer canal): evita duplicar a mesma pessoa.
  const pages = await service.from("lead_pages").select("id").eq("client_id", session.client_id);
  const pageIds = (pages.data ?? []).map(page => page.id);
  const existing = pageIds.length ? await service.from("leads").select("phone,status,created_time").in("lead_page_id", pageIds).not("phone", "is", null).order("created_time", { ascending: false }).limit(3000) : { data: [], error: null };
  if (pages.error || existing.error) return { created: null, reason: "error" };
  const decision = decideCapture({
    mode: session.qualify_mode, message, now, ownPhone: session.connected_phone?.replace(/\D/g, "") || null, ignored: session.ignored_numbers, ad,
    existing: (existing.data ?? []).map(row => ({ phone: row.phone, status: row.status, createdTime: row.created_time })),
  });
  if (!decision.create) return { created: null, reason: decision.reason };
  const sourceId = await waSourceId(service, session);
  if (!sourceId) return { created: null, reason: "error" };
  const inserted = await service.from("leads").upsert({
    lead_page_id: sourceId, leadgen_id: `wa:${message.externalId}`.slice(0, 64), channel: "whatsapp", name: message.title, phone: `+${message.remoteId}`,
    first_message: firstMessageText(message), field_data: [] as never, created_time: message.sentAt,
    ...(ad ? { ad_id: ad.adId, ad_name: ad.title } : {}),
  }, { onConflict: "lead_page_id,leadgen_id", ignoreDuplicates: true }).select("id");
  if (inserted.error) return { created: null, reason: "error" };
  return { created: inserted.data?.[0]?.id ?? null, adId: ad?.adId ?? null };
}

/** Descobre anúncio, conjunto e campanha pelo id do anúncio (Graph API, só leitura) e completa o lead. Se a Meta não responder, o lead fica como está. */
export async function resolveWaAdNames(service: Service, input: { agencyId: string; leadId: string; adId: string }): Promise<boolean> {
  const config = getMetaApiConfig();
  if (!config || !/^[0-9]{5,30}$/.test(input.adId)) return false;
  for (const token of await leadsTokenCandidates(service, input.agencyId)) {
    const response = await graphCall({ token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv(), path: `${input.adId}?fields=name,adset{id,name},campaign{id,name}` }).catch(() => null);
    if (!response?.ok) continue;
    const body = response.body as { name?: unknown; adset?: { id?: unknown; name?: unknown }; campaign?: { id?: unknown; name?: unknown } } | null;
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    const id = (value: unknown) => typeof value === "string" && /^[0-9]{5,30}$/.test(value) ? value : null;
    const { error } = await service.from("leads").update({
      ad_name: text(body?.name, 300), adset_id: id(body?.adset?.id), adset_name: text(body?.adset?.name, 300), campaign_id: id(body?.campaign?.id), campaign_name: text(body?.campaign?.name, 300),
    }).eq("id", input.leadId);
    return !error;
  }
  return false;
}
