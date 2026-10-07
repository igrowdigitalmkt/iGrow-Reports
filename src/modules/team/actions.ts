"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import type { Database } from "@/types/database";

const ROLES = ["owner", "admin", "editor", "viewer"] as const;
const MODULES = ["visao_geral", "clientes", "relatorios", "agendamentos", "integracoes"] as const;
const denied = { error: "Somente proprietários e administradores gerenciam a equipe." };

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
}

/**
 * Invites by e-mail. New people get an account invitation, existing accounts a sign-in link; the
 * invitation is accepted when that e-mail signs in. The direct link is also returned so it can be
 * shared another way (WhatsApp, for example).
 */
export async function inviteMemberAction(input: unknown) {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254), role: z.enum(ROLES) }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return denied;
  if (parsed.data.role === "owner" && context.role !== "owner") return { error: "Somente proprietários convidam proprietários." };
  const { data, error } = await context.supabase.rpc("issue_agency_invitation", { p_agency_id: context.agency.id, p_email: parsed.data.email, p_role: parsed.data.role, p_expires_in_hours: 168 });
  const row = data?.[0];
  if (error || !row) return { error: "Não foi possível registrar o convite." };
  const link = `${appOrigin()}/convite?token=${row.token}`;

  const service = createSupabaseServiceClient();
  const config = getSupabaseConfig();
  let emailed = false;
  if (service && config) {
    const redirectTo = `${appOrigin()}/entrar`;
    const invited = await service.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo, data: { invited_to_agency: context.agency.name } });
    if (!invited.error) emailed = true;
    else if (invited.error.code === "email_exists" || invited.error.code === "user_already_exists") {
      const anonymous = createClient<Database>(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
      const otp = await anonymous.auth.signInWithOtp({ email: parsed.data.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      emailed = !otp.error;
    }
  }
  revalidatePath("/dashboard/equipe");
  return { success: true as const, link, emailed, expiresAt: row.expires_at };
}

export async function setMemberRoleAction(input: unknown) {
  const parsed = z.object({ userId: z.uuid(), role: z.enum(ROLES) }).safeParse(input);
  if (!parsed.success) return { error: "Papel inválido." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return denied;
  const { error } = await context.supabase.rpc("set_agency_member_role", { p_agency_id: context.agency.id, p_user_id: parsed.data.userId, p_role: parsed.data.role });
  if (error?.code === "23514") return { error: "O espaço de trabalho precisa manter pelo menos um proprietário." };
  if (error) return { error: error.code === "42501" ? "Somente proprietários gerenciam proprietários." : "Não foi possível alterar o papel." };
  revalidatePath("/dashboard/equipe");
  return { success: true as const };
}

export async function setMemberModulesAction(input: unknown) {
  const parsed = z.object({ userId: z.uuid(), modules: z.array(z.enum(MODULES)).nullable() }).safeParse(input);
  if (!parsed.success) return { error: "Permissões inválidas." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return denied;
  // Every module checked means no restriction.
  const modules = parsed.data.modules && parsed.data.modules.length === MODULES.length ? null : parsed.data.modules;
  const { error } = await context.supabase.rpc("set_agency_member_modules", { p_agency_id: context.agency.id, p_user_id: parsed.data.userId, p_modules: modules });
  if (error) return { error: error.code === "22023" ? "Proprietários e administradores têm acesso a tudo." : "Não foi possível salvar as permissões." };
  revalidatePath("/dashboard/equipe");
  return { success: true as const };
}

export async function removeMemberAction(input: unknown) {
  const parsed = z.object({ userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Membro inválido." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return denied;
  if (parsed.data.userId === context.user.id) return { error: "Você não pode remover a si mesmo." };
  const { error } = await context.supabase.rpc("remove_agency_member", { p_agency_id: context.agency.id, p_user_id: parsed.data.userId });
  if (error?.code === "23514") return { error: "O espaço de trabalho precisa manter pelo menos um proprietário." };
  if (error) return { error: "Não foi possível remover este membro." };
  revalidatePath("/dashboard/equipe");
  return { success: true as const };
}

export async function revokeInvitationAction(input: unknown) {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Convite inválido." };
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return denied;
  const { error } = await context.supabase.rpc("revoke_agency_invitation", { p_invitation_id: parsed.data.id });
  if (error) return { error: "Não foi possível cancelar o convite." };
  revalidatePath("/dashboard/equipe");
  return { success: true as const };
}
