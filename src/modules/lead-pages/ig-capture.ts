import "server-only";

import { getMetaApiConfig } from "@/lib/env";
import { graphCall } from "./graph-call";
import { appSecretsFromEnv } from "./graph-proof";
import type { Service } from "./hub-query";
import { cleanHandle, instagramFirstMessage, shouldCaptureInstagram, type IgMessage } from "./ig-rules";
import { leadsTokenCandidates, tokenForPage } from "./leads-tokens";

export type IgCapture = { created: string[]; retry: boolean };

/** Nome e @ de quem escreveu (Graph API, só leitura). Se a Meta não responder, o lead nasce sem nome. */
async function readProfile(service: Service, source: { agency_id: string; fb_page_id: string | null }, senderId: string): Promise<{ name: string | null; handle: string | null }> {
  const config = getMetaApiConfig();
  if (!config || !source.fb_page_id) return { name: null, handle: null };
  const tokens = await leadsTokenCandidates(service, source.agency_id);
  const found = await tokenForPage(tokens, { pageId: source.fb_page_id, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() });
  if (!found) return { name: null, handle: null };
  const response = await graphCall({ token: found.pageToken, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv(), path: `${senderId}?fields=name,username` }).catch(() => null);
  const body = response?.ok ? response.body as { name?: unknown; username?: unknown } | null : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 300) : null;
  return { name, handle: cleanHandle(body?.username) };
}

/** Cria o lead de quem escreveu pela primeira vez para a conta (uma vez por pessoa e por conta). Devolve os ids criados. */
export async function captureInstagramLeads(service: Service, messages: IgMessage[]): Promise<IgCapture> {
  const created: string[] = [];
  let retry = false;
  const seen = new Set<string>();
  for (const message of messages) {
    if (!shouldCaptureInstagram(message)) continue;
    const key = `${message.igAccountId}:${message.senderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const sources = await service.from("lead_pages").select("id,agency_id,fb_page_id").eq("kind", "instagram").eq("ig_account_id", message.igAccountId).eq("active", true);
      if (sources.error) { retry = true; continue; }
      for (const source of sources.data ?? []) {
        const leadgenId = `ig:${message.senderId}`;
        const exists = await service.from("leads").select("id").eq("lead_page_id", source.id).eq("leadgen_id", leadgenId).maybeSingle();
        if (exists.error) { retry = true; continue; }
        if (exists.data) continue;
        const profile = await readProfile(service, source, message.senderId);
        const inserted = await service.from("leads").upsert({
          lead_page_id: source.id, leadgen_id: leadgenId, channel: "instagram", name: profile.name ?? profile.handle, handle: profile.handle, phone: null,
          first_message: instagramFirstMessage(message), field_data: [] as never, created_time: message.at,
        }, { onConflict: "lead_page_id,leadgen_id", ignoreDuplicates: true }).select("id");
        if (inserted.error) { retry = true; continue; }
        const id = inserted.data?.[0]?.id;
        if (id) created.push(id);
      }
    } catch { retry = true; }
  }
  return { created, retry };
}
