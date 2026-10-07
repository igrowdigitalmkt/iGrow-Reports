"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { connectWhatsApp, connectWhatsAppEmbedded, listWhatsAppTemplates, removeWhatsAppNumber, renameWhatsAppNumber, selectWhatsAppTemplate, whatsAppAppId, WhatsAppSetupError } from "./server";
import { META_LOGIN_APP_ID } from "@/modules/meta/login-config";

const failure = (error: unknown, fallback: string) => ({ error: error instanceof WhatsAppSetupError ? error.message : fallback });
// Absent for workspaces whose database is still on a single number (before migration 202610070010).
const connectionId = z.uuid().nullable().optional();

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

export async function listWhatsAppTemplatesAction(input?: unknown) {
  const parsed = z.object({ connectionId }).safeParse(input ?? {});
  if (!parsed.success) return { error: "Número inválido." };
  const context = await requireAgencyContext();
  try {
    const result = await listWhatsAppTemplates(context.agency.id, parsed.data.connectionId);
    return { success: true as const, usable: result.usable.map(item => ({ name: item.name, language: item.language })), total: result.all.length, selected: result.selected };
  } catch (error) { return failure(error, "Não foi possível consultar as mensagens modelo."); }
}

export async function selectWhatsAppTemplateAction(input: unknown) {
  const parsed = z.object({ connectionId, name: z.string().regex(/^[a-z0-9_]{1,512}$/), language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/) }).safeParse(input);
  if (!parsed.success) return { error: "Mensagem modelo inválida." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem alterar a mensagem modelo." };
  try {
    await selectWhatsAppTemplate(context.agency.id, parsed.data.connectionId ?? null, parsed.data.name, parsed.data.language);
    revalidatePath("/dashboard/integracoes");
    return { success: true as const };
  } catch (error) { return failure(error, "Não foi possível salvar a mensagem modelo."); }
}

export async function connectWhatsAppEmbeddedAction(input: unknown) {
  const parsed = z.object({
    code: z.string().trim().min(10).max(2000),
    wabaId: z.string().regex(/^\d{5,30}$/), phoneNumberId: z.string().regex(/^\d{5,30}$/),
    coexistence: z.boolean(),
  }).safeParse(input);
  if (!parsed.success) return { error: "A Meta não retornou a conta e o número escolhidos. Tente novamente." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem conectar o WhatsApp." };
  try {
    const result = await connectWhatsAppEmbedded({ agencyId: context.agency.id, appId: whatsAppAppId(META_LOGIN_APP_ID), ...parsed.data });
    revalidatePath("/dashboard/integracoes");
    return { success: true as const, ...result };
  } catch (error) { return failure(error, "Não foi possível conectar o WhatsApp agora."); }
}

export async function renameWhatsAppNumberAction(input: unknown) {
  const parsed = z.object({ connectionId: z.uuid(), label: z.string().trim().max(60, "Use até 60 caracteres.") }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem alterar os números." };
  try {
    await renameWhatsAppNumber(context.agency.id, parsed.data.connectionId, parsed.data.label || null);
    revalidatePath("/dashboard/integracoes");
    return { success: true as const };
  } catch (error) { return failure(error, "Não foi possível renomear o número."); }
}

export async function removeWhatsAppNumberAction(input: unknown) {
  const parsed = z.object({ connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Número inválido." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Apenas proprietários e administradores podem remover números." };
  try {
    await removeWhatsAppNumber(context.agency.id, parsed.data.connectionId);
    revalidatePath("/dashboard/integracoes");
    revalidatePath("/dashboard/agendamentos");
    return { success: true as const };
  } catch (error) { return failure(error, "Não foi possível remover o número."); }
}
