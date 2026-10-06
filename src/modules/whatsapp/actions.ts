"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { connectWhatsApp, listWhatsAppTemplates, selectWhatsAppTemplate, WhatsAppSetupError } from "./server";

const failure = (error: unknown, fallback: string) => ({ error: error instanceof WhatsAppSetupError ? error.message : fallback });

export async function connectWhatsAppAction(input: unknown) {
  const parsed = z.object({
    wabaId: z.string().trim().regex(/^\d{5,30}$/, "ID da conta do WhatsApp Business inválido."),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "ID do número inválido."),
    accessToken: z.string().trim().min(20, "Token de acesso inválido.").max(1000),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem conectar o WhatsApp." };
  try {
    const result = await connectWhatsApp({ agencyId: context.agency.id, ...parsed.data });
    revalidatePath("/dashboard/integracoes");
    return { success: true as const, ...result };
  } catch (error) { return failure(error, "Não foi possível conectar o WhatsApp agora."); }
}

export async function listWhatsAppTemplatesAction() {
  const context = await requireAgencyContext();
  try {
    const result = await listWhatsAppTemplates(context.agency.id);
    return { success: true as const, usable: result.usable.map(item => ({ name: item.name, language: item.language })), total: result.all.length, selected: result.selected };
  } catch (error) { return failure(error, "Não foi possível consultar as mensagens modelo."); }
}

export async function selectWhatsAppTemplateAction(input: unknown) {
  const parsed = z.object({ name: z.string().regex(/^[a-z0-9_]{1,512}$/), language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/) }).safeParse(input);
  if (!parsed.success) return { error: "Mensagem modelo inválida." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem alterar a mensagem modelo." };
  try {
    await selectWhatsAppTemplate(context.agency.id, parsed.data.name, parsed.data.language);
    revalidatePath("/dashboard/integracoes");
    return { success: true as const };
  } catch (error) { return failure(error, "Não foi possível salvar a mensagem modelo."); }
}
