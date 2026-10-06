"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { unknownVariables } from "@/modules/automations/message";

const SEGMENTS = ["geral", "mensagens", "vendas", "leads", "seguidores", "trafego", "reconhecimento"] as const;

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Dê um nome com pelo menos 2 letras.").max(80, "Use até 80 caracteres no nome."),
  segment: z.enum(SEGMENTS).default("geral"),
  channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
  subject: z.string().trim().max(200, "Use até 200 caracteres no assunto.").optional(),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "A mensagem passou de 4.000 caracteres."),
}).superRefine((value, ctx) => {
  if (value.channel === "email" && !value.subject) ctx.addIssue({ code: "custom", message: "Escreva o assunto do e-mail.", path: ["subject"] });
  const unknown = unknownVariables(`${value.subject ?? ""} ${value.body}`);
  if (unknown.length) ctx.addIssue({ code: "custom", message: `Variável desconhecida: {{${unknown[0]}}}.`, path: ["body"] });
});

function refresh() {
  revalidatePath("/dashboard/relatorios/templates");
  revalidatePath("/dashboard/agendamentos");
}

export async function saveMessageTemplateAction(input: unknown) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Leitores não podem salvar templates." };
  const { id, name, segment, body, channel, subject } = parsed.data;
  // The channel columns only go in for e-mail, so WhatsApp templates keep saving before migration 202610070005.
  const row = { agency_id: context.agency.id, name, segment, body, updated_at: new Date().toISOString(), ...(channel === "email" ? { channel, subject: subject ?? null } : {}) };
  const result = id
    ? await context.supabase.from("message_templates").update(row).eq("agency_id", context.agency.id).eq("id", id).select("*").single()
    : await context.supabase.from("message_templates").insert({ ...row, created_by: context.user.id }).select("*").single();
  if (result.error?.code === "PGRST204") return { error: "Templates de e-mail precisam de uma atualização do banco de dados (migração 202610070005)." };
  if (result.error?.code === "23505") return { error: "Já existe um template com esse nome. Escolha outro nome." };
  if (result.error || !result.data) return { error: "Não foi possível salvar o template." };
  refresh();
  const saved = result.data;
  return { success: true as const, template: { id: saved.id, name: saved.name, segment: saved.segment, channel: saved.channel ?? "whatsapp", subject: saved.subject ?? null, body: saved.body, updatedAt: saved.updated_at } };
}

export async function deleteMessageTemplateAction(input: unknown) {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Template inválido." };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Leitores não podem excluir templates." };
  const { error } = await context.supabase.from("message_templates").delete().eq("agency_id", context.agency.id).eq("id", parsed.data.id);
  if (error) return { error: "Não foi possível excluir o template." };
  refresh();
  return { success: true as const };
}
