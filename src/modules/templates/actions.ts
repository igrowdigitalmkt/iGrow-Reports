"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { unknownVariables } from "@/modules/automations/message";

const SEGMENTS = ["geral", "mensagens", "vendas", "leads", "seguidores", "trafego", "reconhecimento"] as const;

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Dê um nome com pelo menos 2 letras.").max(80, "Use até 80 caracteres no nome."),
  segment: z.enum(SEGMENTS),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "A mensagem passou de 4.000 caracteres."),
}).superRefine((value, ctx) => {
  const unknown = unknownVariables(value.body);
  if (unknown.length) ctx.addIssue({ code: "custom", message: `Variável desconhecida: {{${unknown[0]}}}.`, path: ["body"] });
});

function refresh() {
  revalidatePath("/dashboard/relatorios/templates");
  revalidatePath("/dashboard/relatorios/agendamentos");
}

export async function saveMessageTemplateAction(input: unknown) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Leitores não podem salvar templates." };
  const { id, name, segment, body } = parsed.data;
  const row = { agency_id: context.agency.id, name, segment, body, updated_at: new Date().toISOString() };
  const result = id
    ? await context.supabase.from("message_templates").update(row).eq("agency_id", context.agency.id).eq("id", id).select("id,name,segment,body,updated_at").single()
    : await context.supabase.from("message_templates").insert({ ...row, created_by: context.user.id }).select("id,name,segment,body,updated_at").single();
  if (result.error?.code === "23505") return { error: "Já existe um template com esse nome. Escolha outro nome." };
  if (result.error || !result.data) return { error: "Não foi possível salvar o template." };
  refresh();
  const saved = result.data;
  return { success: true as const, template: { id: saved.id, name: saved.name, segment: saved.segment, body: saved.body, updatedAt: saved.updated_at } };
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
