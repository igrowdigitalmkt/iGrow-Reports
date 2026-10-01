"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAgencyContext } from "@/modules/agencies/context";
import { consentInputSchema, recipientInputSchema, type RecipientResult } from "./recipient-schema";
const scope = z.object({ agencyId: z.uuid(), clientId: z.uuid() });

export async function loadRecipients(input: unknown): Promise<RecipientResult> {
  const context = await requireAgencyContext();
  const parsed = scope.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const recipients = [];
  const events = [];
  for (let offset = 0; ; offset += 500) {
    const result = await context.supabase.from("client_recipients").select("id,name,phone,active,consent_status,consent_at,consent_source,unsubscribed_at")
      .eq("agency_id", context.agency.id).eq("client_id", parsed.data.clientId).order("id").range(offset, offset + 499);
    if (result.error) return { error: "Não foi possível carregar. Confira se as migrations foram aplicadas." };
    recipients.push(...result.data);
    if (result.data.length < 500) break;
  }
  for (let offset = 0; ; offset += 500) {
    const result = await context.supabase.from("recipient_consent_events").select("id,recipient_id,event_type,phone,source,occurred_at,recorded_at,actor_id")
      .eq("agency_id", context.agency.id).eq("client_id", parsed.data.clientId).order("recorded_at", { ascending: false }).order("id").range(offset, offset + 499);
    if (result.error) return { error: "Não foi possível carregar o histórico." };
    events.push(...result.data);
    if (result.data.length < 500) break;
  }
  return { recipients, events };
}

export async function saveRecipient(input: unknown): Promise<RecipientResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar destinatários." };
  const parsed = scope.extend(recipientInputSchema.shape).extend({ id: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const value = parsed.data;
  if (value.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { error } = await context.supabase.rpc("save_client_recipient", { p_agency_id: context.agency.id, p_client_id: value.clientId, p_id: value.id, p_name: value.name, p_phone: value.phone, p_active: value.active });
  if (error) return { error: error.code === "23505" ? "Este telefone já está cadastrado para o cliente." : "Não foi possível salvar. Confira seu acesso e se o cliente está ativo." };
  revalidatePath("/dashboard/clientes");
  return loadRecipients(value);
}

export async function recordRecipientConsent(input: unknown): Promise<RecipientResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar destinatários." };
  const parsed = scope.extend({ id: z.uuid(), phone: recipientInputSchema.shape.phone }).safeParse(input);
  const consent = consentInputSchema.safeParse(input);
  if (!parsed.success || !consent.success) return { error: "Informe telefone, origem e uma data de autorização válida." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { error } = await context.supabase.rpc("set_recipient_consent", { p_agency_id: context.agency.id, p_client_id: parsed.data.clientId, p_recipient_id: parsed.data.id, p_phone: parsed.data.phone, p_granted: consent.data.granted, p_source: consent.data.source, p_occurred_at: consent.data.occurredAt });
  if (error) return { error: "Registro recusado. Atualize os dados e confira se a autorização é posterior ao último descadastro e o destinatário está ativo." };
  revalidatePath("/dashboard/clientes");
  return loadRecipients(parsed.data);
}
